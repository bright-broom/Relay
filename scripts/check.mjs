import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {build,transform} from 'esbuild';
async function load(path){const output=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))}
const {tokens,palette,colorRecipes,colorTokens}=await load('src/design/tokens.ts');
const {ja,en,translate}=await load('src/i18n/messages.ts');
assert.deepEqual(Object.keys(ja).sort(),Object.keys(en).sort());
assert.equal(translate('en','count',{count:5}),'5 cases');
assert.equal(translate('ja','count',{count:5}),'5件の案件');
for(const key of Object.keys(ja))assert.deepEqual(ja[key].match(/\{\w+\}/g)??[],en[key].match(/\{\w+\}/g)??[],key);
const css=await readFile('src/prototype/styles.css','utf8');
for(const [,name] of css.matchAll(/var\(--([\w-]+)\)/g))assert.ok(name in tokens,`Undefined token: ${name}`);
assert.ok(!/#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|ms)\b/i.test(css),'Raw design value in component CSS');
const app=await readFile('src/app/app.tsx','utf8');
assert.ok(!/style=/.test(app),'Inline style in UI source');
assert.ok(!/[\u3040-\u30ff\u3400-\u9fff]/u.test(app),'Japanese UI literals outside message catalog or fixtures');
const luminance=hex=>{const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};
const contrast=(a,b)=>{const [low,high]=[luminance(tokens[a]),luminance(tokens[b])].sort((x,y)=>x-y);return (high+.05)/(low+.05)};
for(const [a,b] of [['accent','on-accent'],['accent-hover','on-accent'],['accent-pressed','on-accent'],['ink','surface'],['ink','subtle'],['muted','surface'],['muted','subtle'],['muted','input']]){
 assert.ok(contrast(a,b)>=4.5,`${a}/${b} text contrast`);
}
for(const [a,b] of [['control','input'],['control','subtle'],['accent','surface'],['accent','subtle']]){
 assert.ok(contrast(a,b)>=3,`${a}/${b} control/focus contrast`);
}
// Design constraints: source colors stay limited even when component variants grow.
assert.deepEqual(Object.keys(palette).sort(),['accent','main','sub']);
const tokenSource=await readFile('src/design/tokens.ts','utf8');
assert.deepEqual(tokenSource.match(/#[0-9a-f]{6}\b/gi)?.sort(),Object.values(palette).sort(),'Only palette may define source colors');
assert.deepEqual(Object.keys(colorTokens).sort(),Object.keys(colorRecipes).sort());
for(const [base,overlay,amount] of Object.values(colorRecipes)){
 assert.ok(base in palette && overlay in palette && amount>=0 && amount<=1,'Invalid color recipe');
}
assert.ok(!/var\(--(?:success|warning|error|selected)(?:-surface)?\)/.test(css),'Independent status color reintroduced');
assert.equal(tokens['type-body'],'1rem');
assert.equal(tokens['type-section'],'1.125rem');
assert.equal(tokens['type-page'],'1.5rem');
assert.equal(tokens['type-page-mobile'],'1.5rem');
assert.ok(!/var\(--text-(?:xs|sm|base|md|lg|xl)\)/.test(css),'Component bypasses type role');
const generatedCss=await readFile('prototype/assets/styles.css','utf8');
assert.ok(!/__\w+__/.test(generatedCss),'Unresolved breakpoint');
const parsedCss=await transform(generatedCss,{loader:'css',logLevel:'silent'});
assert.equal(parsedCss.warnings.length,0,'Generated CSS syntax warnings');
const html=await readFile('prototype/index.html','utf8');
for(const [,file] of html.matchAll(/(?:src|href)="([^"#]+)"/g))await readFile('prototype/'+file);
console.log('Locale parity, interpolation, three-color recipes, semantic typography, token references, text/control contrast and build assets: OK.');

// A selected response must never silently mark a task complete.
const {emptyReport,validateReport,saveReport}=await load('src/prototype/report.ts');
const {initialCases}=await load('src/prototype/data.ts');
const fresh=()=>structuredClone(initialCases[0]);
const initial=fresh();
assert.equal(validateReport(emptyReport()).field,'report-channel');
assert.equal(saveReport(initial,emptyReport(),'ja'),false);
assert.deepEqual(initial,fresh(),'Invalid draft changed the case');
for(const outcome of ['resultAgreed','resultNoAnswer','resultFollowup']){
 const c=fresh();const d={channel:'channelPhone',outcome,note:'',mode:'record'};
 assert.equal(saveReport(c,d,'ja'),true,'Preset report should require no typed text');
 assert.equal(c.notes.length,1);assert.equal(c.status,'doing');assert.equal(c.next,initial.next);assert.equal(c.waiting,initial.waiting);
 const blocked=fresh();assert.equal(saveReport(blocked,{...d,mode:'complete'},'ja'),false);
 assert.deepEqual(blocked,fresh(),'A response was incorrectly treated as task completion');
}
const completed=fresh();const completeDraft={channel:'channelEmail',outcome:'resultCompleted',note:'',mode:'complete'};
assert.equal(saveReport(completed,completeDraft,'en'),true);
assert.equal(completed.status,'done');assert.equal(completed.notes.length,1);
assert.equal(completed.notes[0],'Email: This action completed');
assert.equal(saveReport(completed,completeDraft,'en'),false,'Duplicate completion');
assert.equal(completed.notes.length,1);
const recordOnly=fresh();assert.equal(saveReport(recordOnly,{...completeDraft,mode:'record'},'en'),true);assert.equal(recordOnly.status,'doing');
const other={channel:'channelOther',outcome:'resultOther',note:' ',mode:'record'};
assert.equal(validateReport(other).field,'report');
assert.equal(validateReport({...other,note:'Specific outcome'}),null);
assert.ok(validateReport({...other,channel:'unknown'}));
console.log('Zero-typing reports, validation, explicit completion, duplicate completion and unchanged appointments: OK.');

const {restore,createSnapshotWriter,validSnapshot,storageKey}=await load('src/prototype/storage.ts');
const snapshot={locale:'ja',cases:structuredClone(initialCases),drafts:{4:{channel:'channelPhone',outcome:'resultAgreed',note:'draft',mode:'record'}},review:'pending',reviewOwner:'Owner',reviewDue:'dueNow',imported:false};
const memory=new Map();const storage={getItem:key=>memory.get(key)??null,setItem:(key,value)=>memory.set(key,value)};
const writer=createSnapshotWriter(storage,snapshot);
assert.equal(writer(snapshot),'unchanged');assert.equal(memory.size,0,'Navigation must not rewrite storage');
snapshot.locale='en';assert.equal(writer(snapshot),'saved');assert.deepEqual(restore(storage),snapshot);
assert.equal(writer(snapshot),'unchanged');
const staleWriter=createSnapshotWriter(storage,structuredClone(snapshot));
const newer=structuredClone(snapshot);newer.cases[0].notes.push('Newer report');assert.equal(writer(newer),'saved');
const stale=structuredClone(snapshot);stale.cases[0].notes.push('Older tab edit');assert.equal(staleWriter(stale),'conflict');assert.deepEqual(restore(storage),newer);
assert.equal(validSnapshot({...snapshot,cases:[snapshot.cases[0]]}),false);
assert.equal(validSnapshot({...snapshot,drafts:{4:{channel:'bad',outcome:'bad',note:'',mode:'complete'}}}),false);
assert.equal(validSnapshot({...snapshot,cases:snapshot.cases.map(c=>({...c,notes:[42]}))}),false);
memory.set(storageKey,'{broken');assert.equal(restore(storage),null);
const unavailable=createSnapshotWriter({getItem:()=>null,setItem(){throw new Error('quota')}},snapshot);
assert.equal(unavailable({...snapshot,imported:true}),'unavailable');
for(const stage of ['constructor','toString','app'])assert.equal(validSnapshot({...snapshot,cases:snapshot.cases.map(c=>({...c,stage}))}),false);
assert.equal(validSnapshot({...snapshot,locale:['ja']}),false);
assert.equal(validSnapshot({...snapshot,drafts:{'04':snapshot.drafts[4]}}),false);
const manifest=JSON.parse(await readFile('prototype/manifest.webmanifest','utf8'));
assert.equal(manifest.display,'standalone');assert.equal(manifest.start_url,'./');assert.equal(manifest.scope,'./');
assert.equal(manifest.theme_color,palette.sub);
for(const size of [180,192,512]){const bytes=await readFile(`prototype/icons/icon-${size}.png`);assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size)}
assert.ok(manifest.icons.some(i=>i.purpose.includes('maskable')));
const config=JSON.parse(await readFile('vercel.json','utf8'));assert.equal(config.outputDirectory,'public');
assert.ok(config.routes.some(rule=>rule.src==='/sw.js'&&rule.headers?.['Cache-Control']==='no-cache'));
for(const path of ['/','/index.html','/assets/app.js'])assert.ok(config.routes.find(rule=>rule.src===path)?.dest.startsWith('/api/relay?route='));
// The migration worker removes legacy private caches and never intercepts requests.
const {runInNewContext}=await import('node:vm');
const events={};const keys=new Set(['unrelated-cache','relay-shell-/-old']);let claimed=false,skipped=false,navigated=false,job;
runInNewContext(await readFile('prototype/sw.js','utf8'),{self:{registration:{scope:'https://relay.test/'},addEventListener:(name,fn)=>events[name]=fn,skipWaiting:async()=>{skipped=true},clients:{claim:async()=>{claimed=true},matchAll:async()=>[{url:'https://relay.test/',navigate:async()=>{navigated=true}}]}},caches:{keys:async()=>[...keys],delete:async key=>keys.delete(key)},URL});
events.install({waitUntil:value=>job=value});await job;
events.activate({waitUntil:value=>job=value});await job;
assert.ok(skipped&&claimed&&navigated);assert.ok(keys.has('unrelated-cache'));assert.ok(!keys.has('relay-shell-/-old'));assert.equal(events.fetch,undefined);
console.log('Device persistence, invalid storage, PWA metadata, PNG sizes and legacy cache retirement: OK.');

for(const file of ['public/index.html','public/assets/app.js'])await assert.rejects(readFile(file));

const {navigationItems,visibleNavigation,activeNavigation,resolveRoute}=await load('src/prototype/navigation.ts');
assert.equal(new Set(navigationItems.map(item=>item.id)).size,navigationItems.length,'Navigation ids must be unique');
for(const item of navigationItems){
 assert.ok(ja[item.label]&&en[item.label],'Every destination needs localized names');
 if(item.kind==='page')assert.equal(resolveRoute('#'+item.id,[1,4]).page,item.id);
 else assert.equal(resolveRoute('#'+item.id,[1,4]).page,'today','Dialogs must not become undocumented page routes');
}
assert.deepEqual(resolveRoute('#case/4',[1,4]),{page:'detail',caseId:4});
assert.equal(activeNavigation('detail'),'cases');
for(const hash of ['#case/2','#case/0','#case/01','#case/4/extra','#case/1e0','#case/9007199254740992'])assert.deepEqual(resolveRoute(hash,[1,4]),{page:'cases'},'Invalid case URLs must not silently open another customer');
for(const hash of ['','#system','#unknown'])assert.deepEqual(resolveRoute(hash,[1,4]),{page:'today'});
assert.equal(resolveRoute('#main',[1,4]),null,'Skip link must not remount the page');
assert.deepEqual(visibleNavigation().map(item=>item.id),['today','cases','pricing','scheduling','reviews','imports','mypage','admin','preview-info']);
assert.equal(visibleNavigation().find(item=>item.id==='admin').label,'adminLocked');
assert.equal(visibleNavigation().find(item=>item.id==='admin').icon,'adminLocked');
assert.equal(visibleNavigation(true).find(item=>item.id==='admin').label,'admin');
assert.equal(navigationItems.some(item=>['account','install-info'].includes(item.id)),false);
console.log('Navigation: priority order, admin visibility, routes and removed install/account destinations: OK.');
