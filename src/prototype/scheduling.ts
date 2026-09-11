import {translate,type Locale,type MessageKey} from '../i18n/messages';
type Proposal={id:string;title:string;start:string;end:string;timeZone:string};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function showScheduling(locale:Locale,title:string,show:(title:MessageKey,body:string)=>void,initialNotice?:MessageKey){
 const t=(key:MessageKey,params:Record<string,string|number>={})=>translate(locale,key,params);
 if(location.protocol==='file:'){show('scheduling',`<p>${t('authOnline')}</p>`);return;}
 const request=async(path:string,body?:Record<string,unknown>)=>{
  const response=await fetch('/api/'+path,{method:body?'POST':'GET',cache:'no-store',credentials:'same-origin',...(body?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
  if(response.status===401){location.replace('/');throw new Error('unauthorized');}
  const value=await response.json();if(!response.ok)throw new Error(value.error);return value;
 };
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 let form={title:title||t('scheduleDefaultTitle'),fromDate:today,days:7,durationMinutes:60,bufferMinutes:15,startHour:9,endHour:18,timeZone:'Asia/Tokyo',weekdays:[1,2,3,4,5]};
 let proposals:Proposal[]=[];
 let key:{token:string;endpoint:string}|null=null;
 const button=(label:MessageKey,action:string,id='',primary=false)=>`<button class="button ${primary?'primary':''}" data-schedule="${action}" data-id="${id}">${t(label)}</button>`;
 const options=(values:number[],value:number,kind:'minutes'|'days'|'hour')=>values.map(v=>`<option value="${v}" ${v===value?'selected':''}>${kind==='hour'?String(v).padStart(2,'0')+':00':t(kind==='days'?'scheduleDayCount':'scheduleMinutes',{count:v})}</option>`).join('');
 const field=(id:string,label:MessageKey,body:string)=>`<div class="field"><label for="schedule-${id}">${t(label)}</label>${body}</div>`;
 const select=(id:string,label:MessageKey,body:string)=>field(id,label,`<select id="schedule-${id}">${body}</select>`);
 const time=(slot:Proposal)=>new Intl.DateTimeFormat(locale,{timeZone:slot.timeZone,dateStyle:'medium',timeStyle:'short'}).format(new Date(slot.start))+' – '+new Intl.DateTimeFormat(locale,{timeZone:slot.timeZone,timeStyle:'short'}).format(new Date(slot.end));
 function readForm(){
  const value=(id:string)=>(document.getElementById('schedule-'+id) as HTMLInputElement|HTMLSelectElement).value;
  if(!document.getElementById('schedule-title'))return;
  form={title:value('title'),fromDate:value('date'),days:Number(value('days')),durationMinutes:Number(value('duration')),bufferMinutes:Number(value('buffer')),startHour:Number(value('start')),endHour:Number(value('end')),timeZone:value('zone'),weekdays:value('weekdays')==='all'?[1,2,3,4,5,6,7]:[1,2,3,4,5]};
 }
 async function refresh(notice=''){
  const status=await request('calendar/status') as {ready:boolean;connected:boolean};
  const keys=await request('mcp/tokens') as {id:string;permission:string;expires_at:string}[];
  show('scheduling',`<div class="stack">${!status.ready?`<p>${t('calendarSetup')}</p>`:!status.connected?button('calendarConnect','connect','',true):`<p class="meta">${t('calendarReady')}</p>${field('title','scheduleTitle',`<input id="schedule-title" maxlength="120" value="${escape(form.title)}">`)}<div class="form-grid">${field('date','scheduleDate',`<input id="schedule-date" type="date" value="${escape(form.fromDate)}">`)}${select('duration','scheduleDuration',options([15,30,45,60,90,120],form.durationMinutes,'minutes'))}</div><details class="disclosure"><summary>${t('scheduleOptions')}</summary><div class="disclosure-body stack">${select('days','scheduleDays',options([3,7,14],form.days,'days'))}${select('buffer','scheduleBuffer',options([0,15,30,60],form.bufferMinutes,'minutes'))}${select('zone','scheduleZone',['Asia/Tokyo','UTC','America/New_York','Europe/London'].map(zone=>`<option ${zone===form.timeZone?'selected':''}>${zone}</option>`).join(''))}${select('weekdays','scheduleWorkingDays',`<option value="week" ${form.weekdays.length===5?'selected':''}>${t('scheduleWeekdays')}</option><option value="all" ${form.weekdays.length===7?'selected':''}>${t('scheduleEveryDay')}</option>`)}<div class="form-grid" aria-label="${t('scheduleHours')}">${select('start','scheduleStart',options(Array.from({length:24},(_,i)=>i),form.startHour,'hour'))}${select('end','scheduleEnd',options(Array.from({length:24},(_,i)=>i+1),form.endHour,'hour'))}</div></div></details><p class="meta">${t('scheduleHint')}</p>${button('scheduleFind','find','',true)}<div class="stack">${proposals.map(proposal=>`<section class="panel stack"><h3>${escape(time(proposal))}</h3><p class="meta">${escape(proposal.timeZone)}</p><p>${escape(proposal.title)}</p>${button('scheduleBook','book',proposal.id)}</section>`).join('')}</div>${button('calendarDisconnect','disconnect')}`}<p id="schedule-notice" role="status">${escape(notice)}</p><details class="disclosure" ${key?'open':''}><summary>${t('mcpSettings')}</summary><div class="disclosure-body stack"><p class="meta">${t('mcpHint')}</p><label for="mcp-permission">${t('mcpSettings')}</label><select id="mcp-permission"><option value="read">${t('mcpRead')}</option><option value="book">${t('mcpBook')}</option></select>${button('mcpIssue','issue')}${key?`<label for="mcp-key">${t('mcpTokenLabel')}</label><textarea id="mcp-key" readonly>${escape(key.token)}</textarea><p>${t('mcpEndpointLabel')}: ${escape(key.endpoint)}</p>${button('mcpCopy','copy-key')}`:''}${keys.map(item=>`<div class="row space-between"><span>${t(item.permission==='book'?'mcpBook':'mcpRead')} · ${escape(new Intl.DateTimeFormat(locale).format(new Date(item.expires_at)))}</span>${button('mcpRevoke','revoke',item.id)}</div>`).join('')}</div></details></div>`);
  const panel=document.getElementById('modal-body')!;
  panel.onclick=async event=>{
   const target=(event.target as Element).closest<HTMLButtonElement>('[data-schedule]');if(!target||target.disabled)return;
   readForm();const action=target.dataset.schedule,id=target.dataset.id;
   panel.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=true);
   try{
    if(action==='connect'){const result=await request('calendar/connect',{});location.assign(result.url);return;}
    if(action==='disconnect'){await request('calendar/disconnect',{});proposals=[];}
    if(action==='find'){proposals=(await request('schedule/propose',form)).proposals;await refresh(proposals.length?'':t('scheduleEmpty'));return;}
    if(action==='book'){await request('schedule/book',{proposalId:id});proposals=[];await refresh(t('scheduleBooked'));return;}
    if(action==='issue')key=await request('mcp/token',{permission:(document.getElementById('mcp-permission') as HTMLSelectElement).value});
    if(action==='revoke'){await request('mcp/revoke',{id});key=null;}
    if(action==='copy-key'&&key){await navigator.clipboard.writeText(JSON.stringify({url:key.endpoint,headers:{Authorization:'Bearer '+key.token}},null,2));await refresh(t('copied'));return;}
    await refresh();
   }catch(error){
    const messages:Record<string,MessageKey>={calendarConnect:'scheduleReconnect',calendarReconnect:'scheduleReconnect',calendarConflict:'scheduleConflict',proposalExpired:'scheduleExpired',calendarChanged:'scheduleChanged',rateLimit:'lineRateLimit'};
    const notice=document.getElementById('schedule-notice');if(notice)notice.textContent=t(messages[error instanceof Error?error.message:'']??'scheduleFailure');
    panel.querySelectorAll<HTMLButtonElement>('button').forEach(b=>b.disabled=false);
   }
  };
 }
 try{await refresh(initialNotice?t(initialNotice):'');}catch{show('scheduling',`<p>${t('scheduleFailure')}</p>`);}
}
