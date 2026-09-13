import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdir,readFile,readdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
await mkdir('.vercel/check-i18n',{recursive:true});
await build({stdin:{contents:`export * from './src/i18n/messages';export * from './src/i18n/context';export * from './src/ui/icons';export * from './src/server/page';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',outfile:'.vercel/check-i18n/index.mjs'});
const api=await import(pathToFileURL(process.cwd()+'/.vercel/check-i18n/index.mjs'));
for(const invalid of ['','en_US','<img>','ar" onload="x',null,12,'x'.repeat(101)])assert.equal(api.canonicalLocale(invalid),null);
assert.equal(api.canonicalLocale('EN-us'),'en-US');
const ja=api.createUiContext('ja-JP'),en=api.createUiContext('en-US'),ar=api.createUiContext('ar-EG'),fr=api.createUiContext('fr-CA');
assert.equal(ja.t('pricing'),api.ja.pricing);assert.equal(en.t('pricing'),api.en.pricing);
assert.equal(ar.t('pricing'),api.en.pricing);assert.equal(ar.language,'en');assert.equal(ar.dir,'rtl');assert.equal(ar.fallback,true);assert.equal(fr.dir,'ltr');assert.equal(ja.fallback,false);
assert.equal(en.t('count',{count:1}),'1 case');assert.equal(en.t('count',{count:2}),'2 cases');
assert.equal(ja.t('count',{count:1}),'1件の案件');
for(const view of [ja,en,ar,fr]){
 assert.equal(view.money('1234567890123'),new Intl.NumberFormat(view.locale,{style:'currency',currency:'JPY',maximumFractionDigits:0}).format(1234567890123n));
 assert.equal(view.date(new Date('2026-09-13T00:00:00Z'),{timeZone:'UTC',dateStyle:'short'}),new Intl.DateTimeFormat(view.locale,{timeZone:'UTC',dateStyle:'short'}).format(new Date('2026-09-13T00:00:00Z')));
 assert.equal(view.normalizeDigits('１２٣٤۵۶'),'123456');
 assert.equal(view.normalizeDigits('-1.5'),'-1.5','Digit normalization must not silently change signs or fractions');
 for(const key of Object.keys(api.ja)){const values=Object.fromEntries([...api.ja[key].matchAll(/\{(\w+)\}/g)].map(m=>[m[1],m[1]==='count'?2:'x']));assert.ok(!view.t(key,values).includes('{'),'No unresolved parameter: '+key);}
}
assert.equal(api.direction('he'),'rtl');assert.equal(api.direction('fa'),'rtl');
assert.match(api.loginPage('ar',true,false),/<html lang="en" dir="rtl">/);
assert.ok(!api.loginPage('<script>',false,false).includes('<script>'));
assert.equal(api.escapeHtml('<img onerror="x">'),'&lt;img onerror=&quot;x&quot;&gt;');
for(let i=0;i<100;i++){assert.equal(ja.t('today'),api.ja.today);assert.equal(ar.t('today'),api.en.today);}
for(const key of ['copy','refreshConnections','lineRemove','mcpRevoke','pricingEdit']){
 assert.equal(api.actionClass(key),'icon-button tip');assert.match(api.actionContent(en,key),/<svg/);assert.match(api.actionLabel(en,key),/aria-label=/);
}
for(const key of ['approve','saveComplete','scheduleBook','lineTest','pricingPresent'])assert.match(api.actionContent(en,key),/<span>/,'Consequential action must keep an explicit label');
assert.match(api.icon('back'),/directional-icon/);
assert.throws(()=>api.icon('missing'));
// Check every view for untranslated literals, rather than only the app shell.
for(const file of (await readdir('src/prototype')).filter(name=>name.endsWith('.ts')&&name!=='data.ts')){
 const source=await readFile('src/prototype/'+file,'utf8');assert.ok(!/[\u3040-\u30ff\u3400-\u9fff]/u.test(source),'UI literal outside catalog: '+file);
}
console.log('i18n: regional locales, plural forms, fallback, RTL, exact currency, localized digits, SSR escaping, isolated contexts and semantic icons passed.');
assert.equal(api.isoDateInZone('Asia/Tokyo',new Date('2026-09-13T23:30:00Z')),'2026-09-14');
assert.equal(api.isoDateInZone('America/New_York',new Date('2026-09-13T00:30:00Z')),'2026-09-12');
// Preference storage failures are isolated from rendering; no actual browser or cookie store is used.
const saved=Object.fromEntries(['document','location','navigator'].map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
try{
 Object.defineProperty(globalThis,'document',{configurable:true,value:{get cookie(){throw new Error('denied');},set cookie(_value){throw new Error('denied');}}});
 Object.defineProperty(globalThis,'location',{configurable:true,value:{search:'?lang=ar-EG',protocol:'https:'}});
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'en-US'}});
 assert.equal(api.browserLocale(),'ar-EG');assert.equal(api.hasLocalePreference(),true);assert.doesNotThrow(()=>api.persistLocale('ar-EG'));
 globalThis.location.search='';assert.equal(api.browserLocale(),'en-US');assert.equal(api.hasLocalePreference(),false);
}finally{for(const [key,descriptor] of Object.entries(saved)){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}
console.log('i18n: ISO date boundaries and denied preference storage passed.');
