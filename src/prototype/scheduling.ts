import type {MessageKey} from '../i18n/messages';
import {type UiContext} from '../i18n/context';
import {choiceField,bindChoice,readChoice} from '../ui/choice';
import {relativeDate} from '../ui/input-values';
import {actionClass,actionLabel,actionContent} from '../ui/icons';
type Proposal={id:string;title:string;start:string;end:string;timeZone:string};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function showScheduling(ui:UiContext,title:string,show:(title:MessageKey,body:string)=>void,initialNotice?:MessageKey){
 const {t}=ui;
 if(location.protocol==='file:'){show('scheduling',`<p>${t('authOnline')}</p>`);return;}
 const request=async(path:string,body?:Record<string,unknown>)=>{
  const response=await fetch('/api/'+path,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(response.status===401){location.replace('/');throw new Error('unauthorized');}
  const value=await response.json();if(!response.ok)throw new Error(value.error);return value;
 };
 const today=relativeDate('Asia/Tokyo',0);
 const titles=[...new Set([title||t('scheduleDefaultTitle'),...(['scheduleVisit','scheduleOnline','scheduleCall','scheduleReview'] as const).map(key=>t(key))])];
 const zones=[...new Set(['Asia/Tokyo','UTC',Intl.DateTimeFormat().resolvedOptions().timeZone,'America/New_York','Europe/London',...Intl.supportedValuesOf('timeZone')])];
 let permission='read';
 let customTitle='';
 let optionsOpen=false;
 let form={title:title||t('scheduleDefaultTitle'),fromDate:today,days:7,durationMinutes:60,bufferMinutes:15,startHour:9,endHour:18,timeZone:'Asia/Tokyo',weekdays:[1,2,3,4,5]};
 let proposals:Proposal[]=[];
 let key:{token:string;endpoint:string}|null=null;
 const button=(label:MessageKey,action:string,id='',primary=false)=>`<button class="${actionClass(label)} ${primary?'primary':''}" data-schedule="${action}" data-id="${id}" ${actionLabel(ui,label)}>${actionContent(ui,label)}</button>`;
 const options=(values:number[],value:number,kind:'minutes'|'days'|'hour')=>values.map(v=>`<option value="${v}" ${v===value?'selected':''}>${kind==='hour'?String(v).padStart(2,'0')+':00':t(kind==='days'?'scheduleDayCount':'scheduleMinutes',{count:v})}</option>`).join('');
 const field=(id:string,label:MessageKey,body:string)=>`<div class="field"><label for="schedule-${id}">${t(label)}</label>${body}</div>`;
 const select=(id:string,label:MessageKey,body:string)=>field(id,label,`<select id="schedule-${id}">${body}</select>`);
 const time=(slot:Proposal)=>ui.dateRange(new Date(slot.start),new Date(slot.end),{timeZone:slot.timeZone,dateStyle:'medium',timeStyle:'short'});
 function readForm(){
  const value=(id:string)=>(document.getElementById('schedule-'+id) as HTMLInputElement|HTMLSelectElement).value;
  if(!document.getElementById('schedule-title'))return;
  customTitle=value('title-custom');
  optionsOpen=(document.getElementById('schedule-options') as HTMLDetailsElement).open;
  form={title:readChoice(document,'schedule-title'),fromDate:value('date'),days:Number(value('days')),durationMinutes:Number(value('duration')),bufferMinutes:Number(value('buffer')),startHour:Number(value('start')),endHour:Number(value('end')),timeZone:value('zone'),weekdays:value('weekdays')==='all'?[1,2,3,4,5,6,7]:[1,2,3,4,5]};
 }
 async function refresh(notice=''){
  const status=await request('calendar/status') as {ready:boolean;connected:boolean};
  const keys=await request('mcp/tokens') as {id:string;permission:string;expires_at:string}[];
  show('scheduling',`<div class="stack">${!status.ready?`<p>${t('calendarSetup')}</p>`:!status.connected?button('calendarConnect','connect','',true):`<p class="meta">${t('calendarReady')}</p><div id="schedule-conditions" class="stack">${choiceField(ui,{id:'schedule-title',label:'scheduleTitle',choices:titles.map(value=>({value,label:value})),value:form.title,customValue:customTitle})}<div class="form-grid">${field('date','scheduleDate',`<input id="schedule-date" type="date" min="${relativeDate(form.timeZone,0)}" max="${relativeDate(form.timeZone,60)}" value="${escape(form.fromDate)}">`)}${select('duration','scheduleDuration',options([15,30,45,60,90,120],form.durationMinutes,'minutes'))}</div><div class="row">${([[0,'dateToday'],[1,'dateTomorrow'],[7,'dateNextWeek']] as const).map(([days,label])=>`<button type="button" class="button" data-schedule-date="${days}" aria-controls="schedule-date">${t(label)}</button>`).join('')}</div><details id="schedule-options" class="disclosure" ${optionsOpen?'open':''}><summary>${t('scheduleOptions')}</summary><div class="disclosure-body stack">${select('days','scheduleDays',options([3,7,14],form.days,'days'))}${select('buffer','scheduleBuffer',options([0,15,30,60],form.bufferMinutes,'minutes'))}${select('zone','scheduleZone',zones.map(zone=>`<option ${zone===form.timeZone?'selected':''}>${escape(zone)}</option>`).join(''))}${select('weekdays','scheduleWorkingDays',`<option value="week" ${form.weekdays.length===5?'selected':''}>${t('scheduleWeekdays')}</option><option value="all" ${form.weekdays.length===7?'selected':''}>${t('scheduleEveryDay')}</option>`)}<div class="form-grid" aria-label="${t('scheduleHours')}">${select('start','scheduleStart',options(Array.from({length:24},(_,i)=>i),form.startHour,'hour'))}${select('end','scheduleEnd',options(Array.from({length:24},(_,i)=>i+1),form.endHour,'hour'))}</div></div></details></div><p class="meta">${t('scheduleHint')}</p>${button('scheduleFind','find','',true)}<div id="schedule-proposals" class="stack">${proposals.map(proposal=>`<section class="panel stack"><h3>${escape(time(proposal))}</h3><p class="meta">${escape(proposal.timeZone)}</p><p>${escape(proposal.title)}</p>${button('scheduleBook','book',proposal.id)}</section>`).join('')}</div>${button('calendarDisconnect','disconnect')}`}<p id="schedule-notice" role="status">${escape(notice)}</p><details class="disclosure" ${key?'open':''}><summary>${t('mcpSettings')}</summary><div class="disclosure-body stack"><p class="meta">${t('mcpHint')}</p><label for="mcp-permission">${t('mcpSettings')}</label><select id="mcp-permission"><option value="read" ${permission==='read'?'selected':''}>${t('mcpRead')}</option><option value="book" ${permission==='book'?'selected':''}>${t('mcpBook')}</option></select>${button('mcpIssue','issue')}${key?`<label for="mcp-key">${t('mcpTokenLabel')}</label><textarea id="mcp-key" readonly>${escape(key.token)}</textarea><p>${t('mcpEndpointLabel')}: ${escape(key.endpoint)}</p>${button('mcpCopy','copy-key')}`:''}${keys.map(item=>`<div class="row space-between"><span>${t(item.permission==='book'?'mcpBook':'mcpRead')} · ${escape(ui.date(new Date(item.expires_at),{dateStyle:'medium'}))}</span>${button('mcpRevoke','revoke',item.id)}</div>`).join('')}</div></details></div>`);
  const panel=document.getElementById('modal-body')!;
  if(document.getElementById('schedule-title'))bindChoice(panel,'schedule-title');
  const invalidate=()=>{
   if(!panel.querySelector('#schedule-conditions'))return;
   readForm();
   proposals=[];
   panel.querySelector('#schedule-proposals')!.replaceChildren();
   panel.querySelector('#schedule-notice')!.textContent=t('scheduleRecalculate');
   const date=panel.querySelector<HTMLInputElement>('#schedule-date')!;
   date.min=relativeDate(form.timeZone,0);date.max=relativeDate(form.timeZone,60);
  };
  const changed=(event:Event)=>{if((event.target as Element).closest('#schedule-conditions'))invalidate();};
  panel.oninput=changed;panel.onchange=changed;
  panel.onclick=async event=>{
   const shortcut=(event.target as Element).closest<HTMLButtonElement>('[data-schedule-date]');
   if(shortcut&&!shortcut.disabled){
    readForm();
    panel.querySelector<HTMLInputElement>('#schedule-date')!.value=relativeDate(form.timeZone,Number(shortcut.dataset.scheduleDate));
    invalidate();return;
   }
   const target=(event.target as Element).closest<HTMLButtonElement>('[data-schedule]');if(!target||target.disabled)return;
   readForm();permission=(document.getElementById('mcp-permission') as HTMLSelectElement).value;const action=target.dataset.schedule,id=target.dataset.id;
   const controls=[...panel.querySelectorAll<HTMLInputElement|HTMLSelectElement|HTMLButtonElement>('button,input,select')].filter(control=>!control.disabled);
   controls.forEach(control=>control.disabled=true);
   try{
    if(action==='connect'){const result=await request('calendar/connect',{});location.assign(result.url);return;}
    if(action==='disconnect'){await request('calendar/disconnect',{});proposals=[];}
    if(action==='find'){proposals=(await request('schedule/propose',form)).proposals;await refresh(proposals.length?'':t('scheduleEmpty'));return;}
    if(action==='book'){await request('schedule/book',{proposalId:id});proposals=[];await refresh(t('scheduleBooked'));return;}
    if(action==='issue')key=await request('mcp/token',{permission});
    if(action==='revoke'){await request('mcp/revoke',{id});key=null;}
    if(action==='copy-key'&&key){await navigator.clipboard.writeText(JSON.stringify({url:key.endpoint,headers:{Authorization:'Bearer '+key.token}},null,2));await refresh(t('copied'));return;}
    await refresh();
   }catch(error){
    const messages:Record<string,MessageKey>={calendarConnect:'scheduleReconnect',calendarReconnect:'scheduleReconnect',calendarConflict:'scheduleConflict',proposalExpired:'scheduleExpired',calendarChanged:'scheduleChanged',rateLimit:'lineRateLimit'};
    const notice=document.getElementById('schedule-notice');if(notice)notice.textContent=t(messages[error instanceof Error?error.message:'']??'scheduleFailure');
    controls.forEach(control=>control.disabled=false);
   }
  };
 }
 try{await refresh(initialNotice?t(initialNotice):'');}catch{show('scheduling',`<p>${t('scheduleFailure')}</p>`);}
}
