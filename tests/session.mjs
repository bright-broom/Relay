import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

// No browser or external requests: run the actual session entry point with synthetic sessions.
const output = await build({entryPoints:['src/prototype/session.ts'],bundle:true,write:false,format:'iife'});
async function setup({storageDenied=false, initial={subject:'admin-a',isAdmin:true}}={}) {
  const root={hidden:false,dataset:{admin:'true'},after(){}}, values=new Map();
  const timers=[], listeners=new Map(), redirects=[], scripts=[];
  let response=initial, status=200, offline=false, invalidations=0;
  const window={
    addEventListener:(name,fn)=>listeners.set(name,fn),
    dispatchEvent:event=>{if(event.type==='relay-session-invalidated') invalidations++;listeners.get(event.type)?.(event);},
    setInterval:fn=>timers.push(fn),
  };
  const document={hidden:false,cookie:'',getElementById:()=>root,head:{append:script=>scripts.push(script)},
    createElement:()=>({setAttribute(){}}),addEventListener:(name,fn)=>listeners.set(name,fn)};
  const storage={getItem:key=>{if(storageDenied)throw Error('denied');return values.get(key)??null;},
    setItem:(key,value)=>{if(storageDenied)throw Error('denied');values.set(key,value);},
    removeItem:key=>{if(storageDenied)throw Error('denied');values.delete(key);}};
  const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
  runInNewContext(output.outputFiles[0].text,{window,document,localStorage:storage,Event,
    location:{protocol:'https:',search:'',replace:path=>redirects.push(path),reload:()=>redirects.push('reload')},
    navigator:{language:'en'},URLSearchParams,Intl,
    fetch:async()=>{if(offline)throw Error('offline');return {ok:status===200,json:async()=>response};},
  });
  await flush();
  return {root,values,redirects,scripts,document,get invalidations(){return invalidations;},
    change:value=>{response=value;},fail:()=>{status=401;},offline:()=>{offline=true;},online:()=>{offline=false;},
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
 assert.equal(gate.root.dataset.sessionBlocked,'true');
}
const expired=await setup();expired.fail();await expired.tick();assert.equal(expired.invalidations,1);
const disconnected=await setup();disconnected.offline();await disconnected.tick();
assert.equal(disconnected.root.hidden,true);assert.equal(disconnected.invalidations,1);
disconnected.online();await disconnected.tick();
assert.deepEqual(disconnected.redirects,['reload']);assert.equal(disconnected.root.dataset.sessionBlocked,'true');
const oldStorage=await setup();oldStorage.change({subject:'member-b',isAdmin:false});await oldStorage.tick();
assert.equal(oldStorage.values.has('relay-account'),false,'Remove storage still owned by the prior account');
console.log('Session gate: account/role changes, shared or denied storage, stale HTML, malformed/expired sessions, disposal and reconnect: OK.');
