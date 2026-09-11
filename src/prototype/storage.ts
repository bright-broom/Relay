import type {Locale} from '../i18n/messages';
import {initialCases,caseStages,caseDueDates,caseStatuses,caseLevels,type CaseRecord} from './data';
import {channels,outcomes,type ReportDraft} from './report';
export const storageKey='relay-demo-v1';
export interface Snapshot {locale:Locale;cases:CaseRecord[];drafts:Record<number,ReportDraft>;review:string;reviewOwner:string;reviewDue:'dueNow'|'futureDate'|'dueUnknown';imported:boolean}
const member=(value:unknown,values:readonly string[])=>typeof value==='string'&&values.includes(value);
const fixtureIds=new Set(initialCases.map(c=>c.id));
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export function validSnapshot(value:unknown):value is Snapshot{
 if(!object(value)||!member(value.locale,['ja','en'])||!Array.isArray(value.cases)||value.cases.length!==fixtureIds.size||!object(value.drafts))return false;
 if(!member(value.review,['pending','approved','rejected'])||typeof value.reviewOwner!=='string'||!member(value.reviewDue,['dueNow','futureDate','dueUnknown'])||typeof value.imported!=='boolean')return false;
 const ids=new Set<number>();
 for(const c of value.cases){
  if(!object(c)||!Number.isInteger(c.id)||!fixtureIds.has(Number(c.id))||ids.has(Number(c.id)))return false;
  ids.add(Number(c.id));
  if(!['name','area','title','owner','waiting','reason','next','evidence'].every(k=>typeof c[k]==='string'))return false;
  if(!member(c.stage,caseStages)||!member(c.due,caseDueDates))return false;
  if(!member(c.status,caseStatuses)||!member(c.level,caseLevels))return false;
  if(!Number.isInteger(c.version)||Number(c.version)<1||!Array.isArray(c.notes)||!c.notes.every(n=>typeof n==='string'))return false;
  if(!Array.isArray(c.history)||!c.history.every(h=>Array.isArray(h)&&h.length===2&&h.every(v=>typeof v==='string')))return false;
 }
 for(const [id,d] of Object.entries(value.drafts)){
  if(String(Number(id))!==id||!ids.has(Number(id))||!object(d)||typeof d.note!=='string')return false;
  if(!member(d.channel,['',...channels])||!member(d.outcome,['',...outcomes])||!member(d.mode,['record','complete']))return false;
 }
 return true;
}
export function restore(storage:Pick<Storage,'getItem'>):Snapshot|null{try{const parsed:unknown=JSON.parse(storage.getItem(storageKey)??'null');if(!validSnapshot(parsed))return null;const {locale,cases,drafts,review,reviewOwner,reviewDue,imported}=parsed;return {locale,cases,drafts,review,reviewOwner,reviewDue,imported}}catch{return null}}
type DeviceStorage=Pick<Storage,'getItem'|'setItem'>;
function serialize(state:Snapshot){
 const {locale,cases,drafts,review,reviewOwner,reviewDue,imported}=state;
 return JSON.stringify({locale,cases,drafts,review,reviewOwner,reviewDue,imported});
}
export function createSnapshotWriter(storage:DeviceStorage,initial:Snapshot){
 let previousPayload=serialize(initial);
 let previousStored=storage.getItem(storageKey);
 return (state:Snapshot):'saved'|'unchanged'|'conflict'|'unavailable'=>{
  const payload=serialize(state);
  if(payload===previousPayload)return 'unchanged';
  try{
   // Avoid overwriting an intervening save from another app window.
   if(storage.getItem(storageKey)!==previousStored)return 'conflict';
   storage.setItem(storageKey,payload);
   previousStored=payload;previousPayload=payload;
   return 'saved';
  }catch{return 'unavailable'}
 };
}
