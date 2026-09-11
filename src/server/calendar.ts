import * as oidc from 'openid-client';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {google,verifiedIdentity,hash,randomToken,cookie,readCookie,type Identity} from './auth';
import {origin} from './config';
import {seal,unseal,calendarConfigured} from './vault';
import {database,type Database} from './database';
import {ApiError} from './line';
import {findSlots,searchSchema,searchWindow,type Busy,type Search} from '../scheduling/slots';
export const calendarScopes=['https://www.googleapis.com/auth/calendar.events.freebusy','https://www.googleapis.com/auth/calendar.events.owned'];
const connectCookie='__Host-relay-calendar';
const callbackPath='/api/calendar/callback';
const nowISO=()=>new Date().toISOString();
export const proposalSchema=searchSchema.safeExtend({title:z.string().trim().min(1).max(120)});
// Parse search independently so strict schemas never accept arbitrary event fields.
export function parseProposal(input: Record<string,unknown>): {title:string;search:Search} {
 const {title,...criteria}=input;
 return {title:z.string().trim().min(1).max(120).parse(title),search:searchSchema.parse(criteria)};
}
export async function calendarStatus(identity:Identity,db:Database=database()){
 if(!calendarConfigured())return {ready:false,connected:false};
 const [connection]=await db.query('SELECT owner_subject FROM relay_private.calendar_connections WHERE owner_subject=$1',[identity.subject]);
 return {ready:true,connected:Boolean(connection)};
}
export async function startCalendar(identity:Identity,db:Database=database(),configuration?:oidc.Configuration){
 if(!calendarConfigured())throw new ApiError(503,'configuration');
 const config=configuration??await google(),token=randomToken(),state=oidc.randomState(),nonce=oidc.randomNonce(),verifier=oidc.randomPKCECodeVerifier();
 await db.query('DELETE FROM relay_private.calendar_oauth WHERE owner_subject=$1 OR expires_at<now()',[identity.subject]);
 await db.query("INSERT INTO relay_private.calendar_oauth VALUES($1,$2,$3,$4,$5,now()+interval '10 minutes')",[hash(token),identity.subject,state,verifier,nonce]);
 const url=oidc.buildAuthorizationUrl(config,{redirect_uri:origin()+callbackPath,scope:'openid email '+calendarScopes.join(' '),state,nonce,code_challenge:await oidc.calculatePKCECodeChallenge(verifier),code_challenge_method:'S256',access_type:'offline',prompt:'consent',login_hint:identity.email});
 return new Response(null,{status:303,headers:{Location:url.href,'Set-Cookie':cookie(connectCookie,token,600)}});
}
export async function finishCalendar(request:Request,identity:Identity,db:Database=database(),configuration?:oidc.Configuration){
 return db.transaction(async tx=>{
 await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['calendar:'+identity.subject]);
 const headers=new Headers({'Set-Cookie':cookie(connectCookie,'',0),Location:'/?calendar=failed#today'});
 const token=readCookie(request,connectCookie);
 if(!token)return new Response(null,{status:303,headers});
 const [attempt]=await tx.query<{state:string;verifier:string;nonce:string}>("DELETE FROM relay_private.calendar_oauth WHERE token_hash=$1 AND owner_subject=$2 AND expires_at>now() RETURNING state,verifier,nonce",[hash(token),identity.subject]);
 if(!attempt)return new Response(null,{status:303,headers});
 try{
  const callback=new URL(origin()+callbackPath),incoming=new URL(request.url);
  for(const key of ['code','state','error','iss'])for(const value of incoming.searchParams.getAll(key))callback.searchParams.append(key,value);
  const tokens=await oidc.authorizationCodeGrant(configuration??await google(),callback,{pkceCodeVerifier:attempt.verifier,expectedState:attempt.state,expectedNonce:attempt.nonce,idTokenExpected:true});
  const authenticated=verifiedIdentity(tokens.claims());
  const scopes=new Set(tokens.scope?.split(' '));
  if(authenticated?.subject!==identity.subject || !calendarScopes.every(scope=>scopes.has(scope)) || !tokens.refresh_token)throw new Error('calendarConsent');
  await tx.query('INSERT INTO relay_private.calendar_connections(owner_subject,refresh_cipher) VALUES($1,$2) ON CONFLICT(owner_subject) DO UPDATE SET refresh_cipher=excluded.refresh_cipher,connected_at=now()',[identity.subject,seal(tokens.refresh_token,identity.subject)]);
  headers.set('Location','/?calendar=connected#today');
 }catch{/* Consent errors contain provider secrets; do not return them to the browser. */}
 return new Response(null,{status:303,headers});
 });
}
export async function disconnectCalendar(identity:Identity,db:Database=database()){
 await db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['calendar:'+identity.subject]);
  await tx.query('DELETE FROM relay_private.calendar_connections WHERE owner_subject=$1',[identity.subject]);
  await tx.query('DELETE FROM relay_private.calendar_oauth WHERE owner_subject=$1',[identity.subject]);
  await tx.query("DELETE FROM relay_private.schedule_proposals WHERE owner_subject=$1 AND state='proposed'",[identity.subject]);
 });
}
export interface GoogleCalendar {
 busy(start:string,end:string,timeZone:string):Promise<Busy[]>;
 get(id:string):Promise<CalendarEvent|null>;
 insert(event:CalendarEvent):Promise<CalendarEvent>;
}
export type CalendarEvent={id:string;status?:string;summary?:string;start?:{dateTime?:string;timeZone?:string};end?:{dateTime?:string;timeZone?:string};extendedProperties?:{private?:{relayProposal?:string}}};
export async function calendarClient(identity:Identity,db:Database=database(),configuration?:oidc.Configuration,send:typeof fetch=fetch):Promise<GoogleCalendar>{
 const [connection]=await db.query<{refresh_cipher:string}>('SELECT refresh_cipher FROM relay_private.calendar_connections WHERE owner_subject=$1',[identity.subject]);
 if(!connection)throw new ApiError(409,'calendarConnect');
 let access:string;
 try{
  const tokens=await oidc.refreshTokenGrant(configuration??await google(),unseal(connection.refresh_cipher,identity.subject));
  access=tokens.access_token;
  if(tokens.refresh_token)await db.query('UPDATE relay_private.calendar_connections SET refresh_cipher=$2 WHERE owner_subject=$1 AND refresh_cipher=$3',[identity.subject,seal(tokens.refresh_token,identity.subject),connection.refresh_cipher]);
 }catch{throw new ApiError(409,'calendarReconnect')}
 async function call(path:string,body?:unknown):Promise<Response>{
  const response=await send('https://www.googleapis.com/calendar/v3/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+access,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(10000)});
  if(response.status===401)throw new ApiError(409,'calendarReconnect');
  return response;
 }
 const client:GoogleCalendar = {
  async busy(start,end,timeZone){
   const response=await call('freeBusy',{timeMin:start,timeMax:end,timeZone,items:[{id:'primary'}]});
   if(!response.ok)throw new ApiError(502,'calendarUnavailable');
   const payload=await response.json() as {calendars?:Record<string,{busy?:Busy[];errors?:unknown[]}>};
   const calendar=payload.calendars?.primary;
   if(!calendar || calendar.errors?.length || !Array.isArray(calendar.busy))throw new ApiError(502,'calendarUnavailable');
   return z.array(z.object({start:z.string().datetime({offset:true}),end:z.string().datetime({offset:true})}).refine(item=>Date.parse(item.end)>Date.parse(item.start))).max(10000).parse(calendar.busy);
  },
  async get(id){
   const response=await call('calendars/primary/events/'+encodeURIComponent(id));
   if(response.status===404)return null;
   if(response.status===410)throw new ApiError(409,'calendarChanged');
   if(!response.ok)throw new ApiError(502,'calendarUnavailable');
   return await response.json() as CalendarEvent;
  },
  async insert(event){
   const response=await call('calendars/primary/events?sendUpdates=none',{...event,reminders:{useDefault:false},visibility:'private',transparency:'opaque'});
   if(response.status===409){const existing=await client.get(event.id);if(existing)return existing;}
   if(!response.ok)throw new ApiError(502,'calendarRetry');
   return await response.json() as CalendarEvent;
  },
 };
 return client;
}
export async function integrationLimit(identity:Identity,db:Database=database()){
 const [row]=await db.query<{count:number}>("INSERT INTO relay_private.integration_usage(owner_subject,window_start,count) VALUES($1,date_trunc('hour',now()),1) ON CONFLICT(owner_subject,window_start) DO UPDATE SET count=relay_private.integration_usage.count+1 RETURNING count",[identity.subject]);
 if(row.count>120)throw new ApiError(429,'rateLimit');
}
export async function availableSlots(identity:Identity,input:unknown,db:Database=database(),client?:GoogleCalendar,now=nowISO()){
 const criteria=searchSchema.parse(input),window=searchWindow(criteria,now);
 const api=client??await calendarClient(identity,db);
 const busy=await api.busy(window.start,window.end,criteria.timeZone);
 return {slots:findSlots(criteria,busy,now),timeZone:criteria.timeZone,checkedAt:now};
}
export async function proposeSchedule(identity:Identity,input:Record<string,unknown>,db:Database=database(),client?:GoogleCalendar,now=nowISO()){
 const {title,search}=parseProposal(input);
 const found=await availableSlots(identity,search,db,client,now);
 const proposals=await db.transaction(async tx=>{
  await tx.query("DELETE FROM relay_private.schedule_proposals WHERE owner_subject=$1 AND state='proposed' AND expires_at<now()",[identity.subject]);
  const result=[];
  for(const slot of found.slots){
   const id=randomUUID();
   await tx.query("INSERT INTO relay_private.schedule_proposals(id,owner_subject,title,starts_at,ends_at,time_zone,buffer_minutes,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()+interval '15 minutes')",[id,identity.subject,title,slot.start,slot.end,slot.timeZone,search.bufferMinutes]);
   result.push({...slot,id,title});
  }
  return result;
 });
 return {proposals,expiresIn:900};
}
export async function bookSlot(identity:Identity,input:unknown,db:Database=database(),client?:GoogleCalendar,now=nowISO()){
 const id=z.uuid().parse(input);
 // Shared per-account lock serializes Relay writes. Google does not expose an
 // atomic free/busy-and-insert operation; external simultaneous writes can race.
 return db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['calendar:'+identity.subject]);
  const [proposal]=await tx.query<{id:string;title:string;starts_at:Date;ends_at:Date;time_zone:string;buffer_minutes:number;state:string;expires_at:Date}>('SELECT * FROM relay_private.schedule_proposals WHERE id=$1 AND owner_subject=$2 FOR UPDATE',[id,identity.subject]);
  if(!proposal)throw new ApiError(404,'missing');
  const api=client??await calendarClient(identity,tx);
  const eventId=hash('relay:'+identity.subject+':'+id);
  const existing=await api.get(eventId);
  const start=proposal.starts_at.toISOString(),end=proposal.ends_at.toISOString();
  function verify(event:CalendarEvent){
   if(event.id!==eventId || event.summary!==proposal.title || event.status==='cancelled' || event.extendedProperties?.private?.relayProposal!==id || Date.parse(event.start?.dateTime??'')!==Date.parse(start) || Date.parse(event.end?.dateTime??'')!==Date.parse(end))throw new ApiError(409,'calendarChanged');
  }
  if(existing){verify(existing);await tx.query("UPDATE relay_private.schedule_proposals SET state='booked' WHERE id=$1",[id]);return {id,start,end,timeZone:proposal.time_zone,title:proposal.title,state:'booked' as const};}
  if(proposal.state==='booked')throw new ApiError(409,'calendarChanged');
  if(proposal.expires_at.getTime()<Date.parse(now) || Date.parse(start)<Date.parse(now)+30000)throw new ApiError(409,'proposalExpired');
  const padding=proposal.buffer_minutes*60000;
  const busy=await api.busy(new Date(Date.parse(start)-padding).toISOString(),new Date(Date.parse(end)+padding).toISOString(),proposal.time_zone);
  if(busy.some(item=>Date.parse(item.start)<Date.parse(end)+padding && Date.parse(item.end)>Date.parse(start)-padding))throw new ApiError(409,'calendarConflict');
  const created=await api.insert({id:eventId,summary:proposal.title,start:{dateTime:start,timeZone:proposal.time_zone},end:{dateTime:end,timeZone:proposal.time_zone},extendedProperties:{private:{relayProposal:id}}});
  verify(created);
  await tx.query("UPDATE relay_private.schedule_proposals SET state='booked' WHERE id=$1",[id]);
  return {id,start,end,timeZone:proposal.time_zone,title:proposal.title,state:'booked' as const};
 });
}
