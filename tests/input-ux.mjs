import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {build} from 'esbuild';
import {mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
await mkdir('.vercel/check-inputs',{recursive:true});
await build({stdin:{contents:`export * from './src/ui/controls';export * from './src/ui/input-values';export * from './src/ui/language';export * from './src/i18n/context';export * from './src/pricing/form';export * from './src/pricing/comparison';`,resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.vercel/check-inputs/index.mjs'});
const api=await import(pathToFileURL(process.cwd()+'/.vercel/check-inputs/index.mjs'));
// Domain dates, source identification and optional notes do not manufacture evidence.
for(const date of ['2024-02-29','2026-12-31'])assert.equal(api.validIsoDate(date),true);
for(const date of ['','0000-01-01','2026-02-29','2026-04-31','2026-9-01','2026-01-01<script>'])assert.equal(api.validIsoDate(date),false);
for(const kind of ['quote','invoice','priceList']){
 assert.equal(api.validCostEvidence({kind,date:'2026-09-13',reference:''}),true);
 assert.equal(api.validCostEvidence({kind,date:'',reference:'Example'}),false);
}
assert.equal(api.validCostEvidence({kind:'',date:'2026-09-13',reference:'Example'}),false);
assert.equal(api.validCostEvidence({kind:'other',date:'2026-09-13',reference:'  '}),false);
assert.equal(api.validCostEvidence({kind:'other',date:'2026-09-13',reference:'Example document'}),true);
assert.equal(api.validCostEvidence({kind:'quote',date:'2026-09-13',reference:'a'.repeat(201)}),false);
const en=api.createUiContext('en-US');
assert.equal(api.costEvidenceText(en,{kind:'other',date:'',reference:'Example'}),'');
assert.equal(api.costEvidenceText(en,{kind:'quote',date:'2026-09-13',reference:'ABC-123'}),'Quote · Sep 13, 2026 · ABC-123');
// Calendar shortcuts follow the selected zone and calendar-day arithmetic across DST.
assert.equal(api.relativeDate('Asia/Tokyo',0,new Date('2026-09-13T23:30:00Z')),'2026-09-14');
assert.equal(api.relativeDate('America/New_York',0,new Date('2026-09-13T00:30:00Z')),'2026-09-12');
assert.equal(api.relativeDate('America/New_York',1,new Date('2026-03-08T04:30:00Z')),'2026-03-08');
assert.equal(api.relativeDate('America/New_York',1,new Date('2026-11-01T04:30:00Z')),'2026-11-02');
assert.equal(api.relativeDate('UTC',7,new Date('2026-12-28T10:00:00Z')),'2027-01-04');
assert.throws(()=>api.relativeDate('Invalid/Zone',0));
// Installment visibility cannot silently turn unknown input into zero; toggling retains work.
const draft=new api.InstallmentDraft();
assert.deepEqual(draft.setTerm('0','0'),{active:false,monthly:'0'});
assert.deepEqual(draft.setTerm('60','0'),{active:true,monthly:''});
assert.deepEqual(draft.setTerm('60','5000'),{active:true,monthly:'5000'});
assert.deepEqual(draft.setTerm('0','5000'),{active:false,monthly:'0'});
assert.deepEqual(draft.setTerm('48','0'),{active:true,monthly:'5000'});
assert.deepEqual(draft.setTerm('','5000'),{active:true,monthly:'5000'});
for(const bad of ['',' ','1e2','-1','1.5','12 months'])assert.ok(Number.isNaN(api.monthInput(bad)));
const base={currency:'JPY',currentMonthly:'20000',proposedMonthly:'8000',upfront:'100000',installmentMonthly:'5000',installmentMonths:48,horizonMonths:18};
assert.equal(api.compareCosts(base).proposedTotal,'334000');
for(const months of ['', '421','0','1e2'])assert.equal(api.comparisonSchema.safeParse({...base,horizonMonths:api.monthInput(months)}).success,false);
assert.equal(api.comparisonSchema.safeParse({...base,installmentMonths:0}).success,false);
for(const locale of ['ja','en-US','ar-EG']){
 const ui=api.createUiContext(locale);
 const markup=renderToStaticMarkup(createElement(api.LanguageForm,{ui}));
 assert.match(markup,/<select[^>]*id="language-tag"[^>]*name="lang"/);
 assert.equal(new JSDOM(markup).window.document.querySelector('#language-tag').value,ui.locale);
 assert.equal((markup.match(/method="get"/g)??[]).length,2,'Both language paths work without JavaScript');
 const choice=renderToStaticMarkup(createElement(api.ChoiceField,{ui,id:'event',label:'scheduleTitle',options:[{value:'Example',label:'Example'}],value:'<img onerror="x">',onChange:()=>{}}));
 assert.ok(!choice.includes('<img'));assert.ok(choice.includes('&lt;img'));assert.equal(new JSDOM(choice).window.document.querySelector('select').value,'custom');
}
console.log('Input UX: explicit payment choices, draft retention, custom periods, source validation, timezone/DST shortcuts, choice bindings, escaping and no-JS language selection passed.');
