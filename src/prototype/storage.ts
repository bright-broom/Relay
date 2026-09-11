import {ja,type Locale} from '../i18n/messages';
import type {CaseRecord} from './data';
import {channels,outcomes,type ReportDraft} from './report';
export const storageKey='relay-demo-v1';
export interface Snapshot {locale:Locale;cases:CaseRecord[];drafts:Record<number,ReportDraft>;review:string;reviewOwner:string;reviewDue:'dueNow'|'futureDate'|'dueUnknown';imported:boolean}
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
export function validSnapshot(value:unknown):value is Snapshot{
 if(!object(value)||!['ja','en'].includes(String(value.locale))||!Array.isArray(value.cases)||value.cases.length!==5||!object(value.drafts))return false;
 if(!['pending','approved','rejected'].includes(String(value.review))||typeof value.reviewOwner!=='string'||!['dueNow','futureDate','dueUnknown'].includes(String(value.reviewDue))||typeof value.imported!=='boolean')return false;
 const ids=new Set<number>();
 for(const c of value.cases){
  if(!object(c)||!Number.isInteger(c.id)||Number(c.id)<1||Number(c.id)>5||ids.has(Number(c.id)))return false;
  ids.add(Number(c.id));
  if(!['name','area','title','owner','waiting','reason','next','evidence'].every(k=>typeof c[k]==='string'))return false;
  if(typeof c.stage!=='string'||!(c.stage in ja)||typeof c.due!=='string'||!(c.due in ja))return false;
  if(!['todo','doing','awaiting','done'].includes(String(c.status))||!['today','overdue','unknown','upcoming'].includes(String(c.level)))return false;
  if(!Number.isInteger(c.version)||Number(c.version)<1||!Array.isArray(c.notes)||!c.notes.every(n=>typeof n==='string'))return false;
  if(!Array.isArray(c.history)||!c.history.every(h=>Array.isArray(h)&&h.length===2&&h.every(v=>typeof v==='string')))return false;
 }
 for(const [id,d] of Object.entries(value.drafts)){
  if(!ids.has(Number(id))||!object(d)||typeof d.note!=='string')return false;
  if(!['',...channels].includes(String(d.channel))||!['',...outcomes].includes(String(d.outcome))||!['record','complete'].includes(String(d.mode)))return false;
 }
 return true;
}
export function restore(storage:Pick<Storage,'getItem'>):Snapshot|null{try{const parsed:unknown=JSON.parse(storage.getItem(storageKey)??'null');if(!validSnapshot(parsed))return null;const {locale,cases,drafts,review,reviewOwner,reviewDue,imported}=parsed;return {locale,cases,drafts,review,reviewOwner,reviewDue,imported}}catch{return null}}
export function persist(storage:Pick<Storage,'setItem'>,state:Snapshot):boolean{
 const {locale,cases,drafts,review,reviewOwner,reviewDue,imported}=state;
 try{storage.setItem(storageKey,JSON.stringify({locale,cases,drafts,review,reviewOwner,reviewDue,imported}));return true}catch{return false}
}
