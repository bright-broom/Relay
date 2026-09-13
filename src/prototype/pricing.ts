import {compareCosts,comparisonSchema,type ComparisonResult} from '../pricing/comparison';
import {fixedCostProfile} from '../pricing/profiles';
import {translate,type Locale,type MessageKey} from '../i18n/messages';
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function showPricing(locale:Locale,customer:string,show:(title:MessageKey,body:string)=>void){
 const t=(key:MessageKey,params:Record<string,string|number>={})=>translate(locale,key,params);
 const money=(value:string)=>new Intl.NumberFormat(locale,{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(BigInt(value));
 const field=(id:string,label:MessageKey,value='')=>`<div class="field"><label for="price-${id}">${t(label)}</label><input id="price-${id}" name="${id}" type="text" inputmode="numeric" pattern="[0-9]+" maxlength="10" required value="${value}" aria-describedby="price-validation"></div>`;
 const select=(id:string,label:MessageKey,values:readonly number[],selected:number)=>`<div class="field"><label for="price-${id}">${t(label)}</label><select id="price-${id}" name="${id}">${values.map(v=>`<option value="${v}" ${v===selected?'selected':''}>${v===0?t('pricingNoPayment'):t('pricingMonths',{count:v})}</option>`).join('')}</select></div>`;
 show('pricing',`<section id="pricing" class="stack">${customer?`<p>${escape(customer)}</p>`:''}<p class="notice">${t('pricingEstimate')}</p><form id="price-form" novalidate><div class="form-grid">${field('currentMonthly','pricingCurrent')}${field('proposedMonthly','pricingRunning')}${field('upfront','pricingUpfront')}${select('horizonMonths','pricingHorizon',fixedCostProfile.horizonOptions,120)}</div><details class="disclosure"><summary>${t('pricingPayment')}</summary><div class="form-grid disclosure-body">${field('installmentMonthly','pricingPayment','0')}${select('installmentMonths','pricingTerm',fixedCostProfile.installmentOptions,0)}</div></details><p id="price-validation" class="field-error" role="status"></p><div class="field"><label for="price-source">${t('pricingSource')}</label><input id="price-source" name="source" type="text" maxlength="200"></div><label class="row block-gap pricing-confirm"><input id="price-confirm" type="checkbox">${t('pricingConfirm')}</label><p class="meta">${t('pricingSession')}</p></form><div id="price-results" aria-live="polite"></div><p id="price-presentation-hint" class="meta">${t('pricingEvidenceNeeded')}</p><div class="form-actions"><button id="price-present" class="button primary" disabled>${t('pricingPresent')}</button><button id="price-edit" class="button" hidden>${t('pricingEdit')}</button></div></section>`);
 const dialog=document.getElementById('modal') as HTMLDialogElement;
 const panel=document.getElementById('pricing')!;
 const form=document.getElementById('price-form') as HTMLFormElement;
 const results=document.getElementById('price-results')!;
 const validation=document.getElementById('price-validation')!;
 const confirm=document.getElementById('price-confirm') as HTMLInputElement;
 const present=document.getElementById('price-present') as HTMLButtonElement;
 const edit=document.getElementById('price-edit') as HTMLButtonElement;
 const hint=document.getElementById('price-presentation-hint')!;
 let result:ComparisonResult|null=null;
 let presenting=false;
 const row=(label:MessageKey,value:string)=>`<div class="fact"><dt>${t(label)}</dt><dd>${money(value)}</dd></div>`;
 const renderResults=()=>{
  if(!result){results.innerHTML=`<p class="empty">${t('pricingEmpty')}</p>`;return;}
  const r=result,input=r.input,delta=BigInt(r.totalDifference);
  const source=(form.elements.namedItem('source') as HTMLInputElement).value.trim();
  results.innerHTML=`<p class="meta">${t('pricingHorizon')} · ${t('pricingMonths',{count:input.horizonMonths})}</p><div class="split block-gap"><section class="panel"><h3>${t('pricingBefore')}</h3><dl>${row('pricingMonthlyPlain',input.currentMonthly)}${row('pricingTotal',r.currentTotal)}</dl></section><section class="panel"><h3>${t('pricingAfter')}</h3><dl>${row(input.installmentMonths?'pricingMonthly':'pricingMonthlyPlain',r.monthlyDuring)}${input.installmentMonths?row('pricingAfterTerm',r.monthlyAfter):''}${row('pricingTotal',r.proposedTotal)}</dl></section></div><div class="metric"><p class="metric-label">${t(delta>0n?'pricingReduction':delta<0n?'pricingIncrease':'pricingSame')}</p><p class="metric-value">${money((delta<0n?-delta:delta).toString())}</p></div>${BigInt(r.remainingInstallments)>0n?`<div class="notice"><dl>${row('pricingRemaining',r.remainingInstallments)}</dl><p>${t('pricingRemainingHint')}</p></div>`:''}<p>${t('pricingScope')}</p><details class="disclosure" ${presenting?'open':''}><summary>${t('pricingAssumptions')}</summary><div class="disclosure-body"><dl>${row('pricingUpfront',input.upfront)}${row('pricingRunning',input.proposedMonthly)}${row('pricingPayment',input.installmentMonthly)}<div class="fact"><dt>${t('pricingTerm')}</dt><dd>${t('pricingMonths',{count:input.installmentMonths})}</dd></div></dl><h3 class="block-gap">${t('pricingBreakdown')}</h3><dl>${row('pricingRunningTotal',r.runningTotal)}${row('pricingPaymentTotal',r.installmentTotal)}</dl><p>${t('pricingFormulaBefore')}</p><p>${t('pricingFormulaAfter')}</p><p>${t('pricingPrecision')}</p>${source?`<p>${t('pricingSource')}：${escape(source)}</p>`:''}<p class="meta">${t('pricingVersion',{version:r.version})}</p></div></details>`;
 };
 const update=()=>{
  const values=Object.fromEntries(new FormData(form));
  const parsed=comparisonSchema.safeParse({currency:fixedCostProfile.currency,currentMonthly:values.currentMonthly,proposedMonthly:values.proposedMonthly,upfront:values.upfront,installmentMonthly:values.installmentMonthly,installmentMonths:Number(values.installmentMonths),horizonMonths:Number(values.horizonMonths)});
  result=parsed.success?compareCosts(parsed.data):null;
  const hasAmount=Boolean(values.currentMonthly||values.proposedMonthly||values.upfront);
  validation.textContent=!parsed.success&&hasAmount?t('pricingInvalid'):'';
  form.querySelectorAll<HTMLInputElement|HTMLSelectElement>('[name]').forEach(el=>{
   el.setAttribute('aria-invalid',String(!parsed.success&&hasAmount&&parsed.error.issues.some(issue=>issue.path[0]===el.name)));
  });
  present.disabled=!result||!confirm.checked||!String(values.source??'').trim();
  renderResults();
 };
 form.onsubmit=e=>e.preventDefault();
 form.oninput=e=>{if(e.target!==confirm)confirm.checked=false;update();};
 form.onchange=e=>{if(e.target!==confirm)confirm.checked=false;update();};
 present.onclick=()=>{
  update();if(present.disabled)return;
  presenting=true;form.hidden=true;present.hidden=true;edit.hidden=false;hint.hidden=true;
  dialog.classList.add('pricing-presentation');document.body.classList.add('pricing-presenting');
  renderResults();dialog.scrollTop=0;edit.focus();
 };
 edit.onclick=()=>{
  presenting=false;form.hidden=false;present.hidden=false;edit.hidden=true;hint.hidden=false;
  dialog.classList.remove('pricing-presentation');document.body.classList.remove('pricing-presenting');
  renderResults();form.querySelector<HTMLInputElement>('input')?.focus();
 };
 dialog.addEventListener('close',()=>{
  dialog.classList.remove('pricing-presentation');document.body.classList.remove('pricing-presenting');
  form.reset();result=null;panel.remove();
 },{once:true});
 update();
}
