import {McpServer,createMcpHandler} from '@modelcontextprotocol/server';
import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {hash,randomToken,type Identity} from './auth';
import {allowed,origin} from './config';
import {database,type Database} from './database';
import {ApiError} from './line';
import {calendarStatus,availableSlots,proposeSchedule,bookSlot,integrationLimit,proposalSchema,type GoogleCalendar} from './calendar';
import {searchSchema} from '../scheduling/slots';
import {translate} from '../i18n/messages';
export type McpIdentity=Identity & {permission:'read'|'book'};
export async function issueMcpToken(identity:Identity,permission:unknown,db:Database=database()){
 if(permission!=='read'&&permission!=='book')throw new ApiError(400,'invalid');
 const token='relay_mcp_'+randomToken(),id=randomUUID();
 await db.transaction(async tx=>{
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))',['mcp:'+identity.subject]);
  await tx.query('DELETE FROM relay_private.mcp_tokens WHERE owner_subject=$1 AND expires_at<now()',[identity.subject]);
  const [count]=await tx.query<{count:string}>('SELECT count(*) FROM relay_private.mcp_tokens WHERE owner_subject=$1',[identity.subject]);
  if(Number(count.count)>=5)throw new ApiError(429,'rateLimit');
  await tx.query("INSERT INTO relay_private.mcp_tokens(id,token_hash,owner_subject,owner_email,permission,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval '30 days')",[id,hash(token),identity.subject,identity.email,permission]);
 });
 return {id,token,endpoint:origin()+'/api/mcp',expiresInDays:30,permission};
}
export async function listMcpTokens(identity:Identity,db:Database=database()){
 return db.query<{id:string;permission:string;expires_at:Date}>('SELECT id,permission,expires_at FROM relay_private.mcp_tokens WHERE owner_subject=$1 AND expires_at>now() ORDER BY created_at DESC',[identity.subject]);
}
export async function revokeMcpToken(identity:Identity,id:unknown,db:Database=database()){
 const rows=await db.query('DELETE FROM relay_private.mcp_tokens WHERE id=$1 AND owner_subject=$2 RETURNING id',[z.uuid().parse(id),identity.subject]);
 if(!rows.length)throw new ApiError(404,'missing');
}
/** @public Invoked by tests/calendar.mjs; source is loaded through esbuild. */
export async function mcpIdentity(request:Request,db:Database=database()):Promise<McpIdentity|null>{
 const match=/^Bearer (relay_mcp_[A-Za-z0-9_-]{43})$/.exec(request.headers.get('authorization')??'');
 if(!match)return null;
 const [token]=await db.query<{owner_email:string;owner_subject:string;permission:'read'|'book'}>('SELECT owner_email,owner_subject,permission FROM relay_private.mcp_tokens WHERE token_hash=$1 AND expires_at>now()',[hash(match[1])]);
 return token&&allowed(token.owner_email)?{email:token.owner_email,subject:token.owner_subject,permission:token.permission}:null;
}
/** @public Invoked by tests/calendar.mjs; source is loaded through esbuild. */
export function schedulingMcp(identity:McpIdentity,db:Database=database(),client?:GoogleCalendar,now?:string){
 const t=(key:Parameters<typeof translate>[1])=>translate('en',key);
 const slot=z.object({start:z.string(),end:z.string(),timeZone:z.string()});
 const read={readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:true};
 return createMcpHandler(()=>{
  const server=new McpServer({name:'relay-mcp-server',version:'0.3.0'});
  const result=async(work:()=>Promise<Record<string,unknown>>)=>{
   try{const data=await work();return {content:[{type:'text' as const,text:JSON.stringify(data)}],structuredContent:data};}
   catch(error){return {content:[{type:'text' as const,text:t(error instanceof ApiError&&['calendarConnect','calendarReconnect'].includes(error.code)?'mcpConnectHelp':'mcpRetryHelp')+' '+(error instanceof ApiError?error.code:'invalidRequest')}],isError:true};}
  };
  server.registerTool('relay_get_calendar_status',{description:t('mcpStatusDescription'),inputSchema:z.object({}).strict(),outputSchema:z.object({ready:z.boolean(),connected:z.boolean()}),annotations:read},()=>result(()=>calendarStatus(identity,db)));
  server.registerTool('relay_find_slots',{description:t('mcpFindDescription'),inputSchema:searchSchema,outputSchema:z.object({slots:z.array(slot),timeZone:z.string(),checkedAt:z.string()}),annotations:read},input=>result(()=>availableSlots(identity,input,db,client,now)));
  if(identity.permission==='book'){
   server.registerTool('relay_propose_schedule',{description:t('mcpProposeDescription'),inputSchema:proposalSchema,outputSchema:z.object({proposals:z.array(slot.extend({id:z.string(),title:z.string()})),expiresIn:z.number()}),annotations:{...read,readOnlyHint:false,idempotentHint:false}},input=>result(()=>proposeSchedule(identity,input,db,client,now)));
   server.registerTool('relay_book_slot',{description:t('mcpBookDescription'),inputSchema:z.object({proposalId:z.uuid()}).strict(),outputSchema:slot.extend({id:z.string(),title:z.string(),state:z.literal('booked')}),annotations:{...read,readOnlyHint:false}},input=>result(()=>bookSlot(identity,input.proposalId,db,client,now)));
  }
  return server;
 },{responseMode:'json',maxSubscriptions:0,keepAliveMs:0});
}
export async function handleMcp(request:Request,raw:string,db:Database=database()){
 if(new URL(request.url).origin!==origin() || (request.headers.has('origin')&&request.headers.get('origin')!==origin()))throw new ApiError(403,'origin');
 const identity=await mcpIdentity(request,db);
 if(!identity)return Response.json({error:'unauthorized'},{status:401,headers:{'WWW-Authenticate':'Bearer realm="Relay"'}});
 await integrationLimit(identity,db);
 const handler=schedulingMcp(identity,db);
 try{
  const response=await handler.fetch(new Request(request.url,{method:'POST',headers:request.headers,body:raw}));
  // Legacy clients receive a finite SSE response. Drain it before closing the request instance.
  const body=response.body?await response.arrayBuffer():null;
  return new Response(body,{status:response.status,headers:response.headers});
 }
 finally{await handler.close();}
}
