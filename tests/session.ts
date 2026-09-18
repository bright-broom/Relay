import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// No browser or external requests: run the actual session entry point with synthetic sessions.
const assets={entry:'app-AAAAAAAA.js',eager:['app-AAAAAAAA.js','chunk-BBBBBBBB.js'],features:{customers:['chunk-CCCCCCCC.js','chunk-BBBBBBBB.js'],scheduling:['chunk-DDDDDDDD.js'],admin:['chunk-EEEEEEEE.js']}};
const output = await build({define:{__APP_ASSETS__:JSON.stringify(assets)},entryPoints:['src/prototype/session.ts'],bundle:true,write:false,format:'iife'});
async function setup({storageDenied=false, guest=false, hash='#today', pathname='/', search='', protocol='https:', initial={subject:'admin-a',isAdmin:true}}: {storageDenied?:boolean;guest?:boolean;hash?:string;pathname?:string;search?:string;protocol?:string;initial?:unknown}={}) {
  const root={hidden:false,dataset:{admin:'true',publicPreview:String(guest)} as Record<string,string>,after(){}}, values=new Map<string,string>();
  type ElementFixture={tagName:string;src:string;href:string;type?:string;rel?:string;setAttribute:()=>void};
  const timers:Array<()=>void>=[], listeners=new Map<string,(event:Event)=>void>(), redirects:string[]=[], scripts:ElementFixture[]=[], preloads:ElementFixture[]=[];
  let response=initial, status=200, offline=false, invalidations=0, requests=0;
  const window={
    addEventListener:(name:string,fn:(event:Event)=>void)=>listeners.set(name,fn),
    dispatchEvent:(event:Event)=>{if(event.type==='relay-session-invalidated') invalidations++;listeners.get(event.type)?.(event);},
    setInterval:(fn:()=>void)=>timers.push(fn),
  };
  const document={hidden:false,cookie:'',getElementById:()=>root,head:{append:(element:ElementFixture)=>(element.tagName === 'script' ? scripts : preloads).push(element)},
    createElement:(tagName:string)=>({tagName,src:'',href:'',setAttribute(){}}),addEventListener:(name:string,fn:(event:Event)=>void)=>listeners.set(name,fn)};
  const storage={getItem:(key:string)=>{if(storageDenied)throw Error('denied');return values.get(key)??null;},
    setItem:(key:string,value:string)=>{if(storageDenied)throw Error('denied');values.set(key,value);},
    removeItem:(key:string)=>{if(storageDenied)throw Error('denied');values.delete(key);}};
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  runInNewContext(output.outputFiles[0].text,{window,document,localStorage:storage,Event,
    location:{protocol,hash,pathname,search,replace:(path:string)=>redirects.push(path),reload:()=>redirects.push('reload')},
    navigator:{language:'en'},URLSearchParams,Intl,
    fetch:async()=>{requests++;if(offline)throw Error('offline');return {ok:status===200,json:async()=>response};},
  });
  await flush();
  return {root,values,redirects,scripts,preloads,document,timers,get requests(){return requests;},get invalidations(){return invalidations;},
    change:(value:unknown)=>{response=value;},fail:()=>{status=401;},offline:()=>{offline=true;},online:()=>{offline=false;},
    tick:async()=>{timers[0]();await flush();}};
}
for(const storageDenied of [false,true]) {
 const gate=await setup({storageDenied});
 assert.equal(gate.scripts.length,1);
 await gate.tick();assert.equal(gate.invalidations,0,'Unchanged sessions must preserve user input');
 // Another window has already updated the shared account marker.
 gate.values.set('relay-account','member-b');
 gate.change({subject:'member-b',isAdmin:false});
 await gate.tick();
 assert.equal(gate.root.hidden,true);
 assert.equal(gate.root.dataset.sessionBlocked,'true');
 assert.equal(gate.invalidations,1);
 assert.deepEqual(gate.redirects,['/']);
 if(!storageDenied)assert.equal(gate.values.get('relay-account'),'member-b','Do not erase the other window account marker');
 await gate.tick();assert.equal(gate.invalidations,1,'A stopped gate cannot reopen');
}
for(const [before,after] of [[true,false],[false,true]]) {
 const gate=await setup({initial:{subject:'same-user',isAdmin:before}});
 gate.change({subject:'same-user',isAdmin:after});await gate.tick();
 assert.equal(gate.invalidations,1,'Role-only changes must invalidate the mounted application');
}
const initialMember=await setup({initial:{subject:'member',isAdmin:false}});
assert.equal(initialMember.root.dataset.admin,'false','Ignore stale admin flag in server HTML');
for(const payload of [null,{}, {subject:'a'}, {subject:'a',isAdmin:'true'}, {subject:'',isAdmin:true}]) {
 const gate=await setup({initial:payload});
 assert.equal(gate.scripts.length,0,'Malformed session must never start the app');
 assert.equal(gate.preloads.length,0,'Malformed sessions must not preload modules');
 assert.equal(gate.root.dataset.sessionBlocked,'true');
}
const expired=await setup();expired.fail();await expired.tick();assert.equal(expired.invalidations,1);
const disconnected=await setup();disconnected.offline();await disconnected.tick();
assert.equal(disconnected.root.hidden,true);assert.equal(disconnected.invalidations,1);
disconnected.online();await disconnected.tick();
assert.deepEqual(disconnected.redirects,['reload']);assert.equal(disconnected.root.dataset.sessionBlocked,'true');
const oldStorage=await setup();oldStorage.change({subject:'member-b',isAdmin:false});await oldStorage.tick();
assert.equal(oldStorage.values.has('relay-account'),false,'Remove storage still owned by the prior account');
for(const storageDenied of [false,true]) {
 const guest=await setup({guest:true,storageDenied});
 assert.equal(guest.scripts.length,1,'Public workspace starts without a session');
 assert.equal(guest.requests,0,'Public mode makes no identity request');
 assert.equal(guest.timers.length,0,'Public mode must not enter a session redirect loop');
 assert.equal(guest.root.dataset.admin,'false','Public mode never inherits an admin HTML flag');
 assert.deepEqual(guest.redirects,[]);
}
const modeOutput=await build({entryPoints:['src/prototype/access-mode.ts'],bundle:true,write:false,format:'cjs'});
const shared={getItem:()=> 'private draft'},tab={getItem:()=> 'public draft'};
for(const guest of [true,false]) {
 const context={exports:{},module:{exports:{}},document:{getElementById:()=>({dataset:{publicPreview:String(guest)}})},localStorage:shared,sessionStorage:tab};
 runInNewContext(modeOutput.outputFiles[0].text,context);
 assert.equal((context.module.exports as typeof import('../src/prototype/access-mode')).workspaceStorage(),guest?tab:shared,'Guest drafts and signed-in drafts use separate storage');
}
console.log('Session gate: account/role changes, shared or denied storage, stale HTML, malformed/expired sessions, disposal and reconnect: OK.');

const split=await setup();
assert.equal(split.scripts[0].type,'module');assert.equal(split.scripts[0].src,'assets/modules/'+assets.entry);
assert.deepEqual(split.preloads.map(link=>link.href),assets.eager.map(file=>'assets/modules/'+file));
assert.ok(split.preloads.every(link=>link.rel==='modulepreload'));
const direct=await setup({hash:'#customers'});
assert.deepEqual(direct.preloads.map(link=>link.href),[...new Set([...assets.eager,...assets.features.customers])].map(file=>'assets/modules/'+file));
const callback=await setup({search:'?calendar=connected'});assert.ok(callback.preloads.some(link=>link.href.endsWith('chunk-DDDDDDDD.js')));
const adminEntry=await setup({hash:'',pathname:'/admin'});assert.ok(adminEntry.preloads.some(link=>link.href.endsWith('chunk-EEEEEEEE.js')));
const prototypeRoute=await setup({hash:'#constructor'});assert.equal(prototypeRoute.preloads.length,assets.eager.length);
const local=await setup({protocol:'file:'});assert.equal(local.scripts[0].src,'assets/app.js');assert.equal(local.scripts[0].type,undefined);assert.equal(local.preloads.length,0);
console.log('Loading gate: eager import graph, direct-route preloads, no preloads on rejection and standalone preview fallback passed.');
