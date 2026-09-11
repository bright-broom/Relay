import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
async function load(path){const output=await build({entryPoints:[path],bundle:true,write:false,format:'esm',platform:'node'});return import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'))}
const {tokens}=await load('src/design/tokens.ts');
const {ja,en,translate}=await load('src/i18n/messages.ts');
assert.deepEqual(Object.keys(ja).sort(),Object.keys(en).sort());
assert.equal(translate('en','count',{count:5}),'5 cases');
assert.equal(translate('ja','count',{count:5}),'5件の案件');
for(const key of Object.keys(ja))assert.deepEqual(ja[key].match(/\{\w+\}/g)??[],en[key].match(/\{\w+\}/g)??[],key);
const css=await readFile('src/prototype/styles.css','utf8');
for(const [,name] of css.matchAll(/var\(--([\w-]+)\)/g))assert.ok(name in tokens,`Undefined token: ${name}`);
assert.ok(!/#[0-9a-f]{3,8}\b|\b\d+(?:\.\d+)?(?:px|rem|ms)\b/i.test(css),'Raw design value in component CSS');
const app=await readFile('src/prototype/app.ts','utf8');
assert.ok(!/style=/.test(app),'Inline style in UI source');
assert.ok(!/[\u3040-\u30ff\u3400-\u9fff]/u.test(app),'Japanese UI literals outside message catalog or fixtures');
const luminance=hex=>{const v=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4);return v[0]*.2126+v[1]*.7152+v[2]*.0722};
for(const [a,b] of [['accent','on-accent'],['accent-hover','selected'],['muted','surface'],['muted','subtle'],['error','error-surface'],['warning','warning-surface'],['success','success-surface']]){
 const [low,high]=[luminance(tokens[a]),luminance(tokens[b])].sort((x,y)=>x-y);assert.ok((high+.05)/(low+.05)>=4.5,`${a}/${b} contrast`);
}
const html=await readFile('prototype/index.html','utf8');
for(const [,file] of html.matchAll(/(?:src|href)="([^"#]+)"/g))await readFile('prototype/'+file);
console.log('Locale parity, interpolation, token references, centralized styling, contrast pairs and build assets: OK.');
