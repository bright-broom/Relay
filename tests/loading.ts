import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync} from 'node:zlib';
import {build} from 'esbuild';
import {runInNewContext} from 'node:vm';

const manifest = JSON.parse(await readFile('prototype/assets/module-manifest.json','utf8')) as {
  eager:string[];files:Record<string,{inputs:string[]}>;
};
let initialBytes = 0, initialGzip = 0;
for (const path of ['prototype/assets/session.js',...manifest.eager.map(file=>'prototype/assets/modules/'+file)]) {
  const bytes = await readFile(path);initialBytes+=bytes.length;initialGzip+=gzipSync(bytes).length;
}
// Baseline was 1,301,621 bytes / 350,945 gzip bytes. Leave headroom without permitting a full bundle regression.
assert.ok(initialBytes < 600_000,`Initial JS exceeds 600 KB: ${initialBytes}`);
assert.ok(initialGzip < 180_000,`Initial gzip JS exceeds 180 KB: ${initialGzip}`);
assert.ok((await readFile('prototype/assets/session.js')).length < 8_000,'Session gate pulled application code back in');
const eagerInputs = manifest.eager.flatMap(file=>manifest.files[file]!.inputs);
for (const deferred of ['src/app/pricing.tsx','src/app/scheduling.tsx','src/app/customers.tsx','src/app/my-page.tsx','src/app/admin.tsx',
  'node_modules/@js-temporal/','node_modules/decimal.js/','node_modules/zod/']) {
  assert.ok(!eagerInputs.some(input=>input.startsWith(deferred)),`Deferred code became eager: ${deferred}`);
}
assert.ok(eagerInputs.includes('src/app/pages.tsx'),'Primary workspace must remain eager');

// Instrument only the module boundary; never invoke external services or real customer APIs.
const names:Record<string,string> = {'./pricing':'Pricing','./scheduling':'Scheduling','./customers':'Customers','./my-page':'MyPage','./admin':'Admin'};
const compiled = await build({entryPoints:['src/app/features.ts'],bundle:true,write:false,format:'iife',globalName:'features',plugins:[{
  name:'synthetic-feature-loads',setup(builder) {
    builder.onResolve({filter:/^(react|\.\/(pricing|scheduling|customers|my-page|admin))$/},args=>({path:args.path,namespace:'fixture'}));
    builder.onLoad({filter:/.*/,namespace:'fixture'},args=>({contents:args.path === 'react' ? 'export const lazy=loader=>loader;' :
      `record(${JSON.stringify(args.path)});export function ${names[args.path]}(){throw new Error('Prefetch must not render a feature');}`,loader:'js'}));
  },
}]});
const create = (options:{hidden?:boolean;blocked?:boolean;online?:boolean;saveData?:boolean;effectiveType?:string}={}) => {
  const loaded:string[] = [];
  const sandbox = {record:(name:string)=>loaded.push(name),
    document:{hidden:options.hidden ?? false,getElementById:()=>({dataset:{sessionBlocked:String(options.blocked ?? false)}})},
    navigator:{onLine:options.online ?? true,connection:{saveData:options.saveData,effectiveType:options.effectiveType}},
    features:undefined as unknown as {warmFeature:(name:string)=>void},
  };
  runInNewContext(compiled.outputFiles[0]!.text,sandbox);
  return {loaded,warm:sandbox.features.warmFeature};
};
const flush = async () => {for(let i=0;i<10;i++)await Promise.resolve();};
const normal=create();assert.deepEqual(normal.loaded,[],'No background feature import before intent');
normal.warm('pricing');normal.warm('pricing');await flush();assert.deepEqual(normal.loaded,['./pricing'],'Repeated intent deduplicates code loading');
normal.warm('customers');await flush();assert.deepEqual(normal.loaded,['./pricing','./customers']);
normal.warm('constructor');normal.warm('unknown');await flush();assert.equal(normal.loaded.length,2);
for(const options of [{hidden:true},{blocked:true},{online:false},{saveData:true},{effectiveType:'2g'},{effectiveType:'slow-2g'}]) {
  const constrained=create(options);constrained.warm('pricing');await flush();assert.deepEqual(constrained.loaded,[],'Speculative preload must respect session/network constraints');
}
console.log(`Loading: ${initialBytes} initial JS bytes / ${initialGzip} gzip bytes; isolated lazy dependencies, eager workspace and safe intent prefetch passed.`);
