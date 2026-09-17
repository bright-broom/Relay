// Always creates its own disposable, loopback-only PostgreSQL. Never accepts a DB URL.
import assert from 'node:assert/strict';
import {execFile as callbackExecFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import postgres from 'postgres';
const execFile=promisify(callbackExecFile);
const image='postgres@sha256:4ef4dbc939d61acea57712655ddb4b4ab27419c913f94cca0cd57cb3ea3c2280'; // PostgreSQL 18.6
const name='relay-crm-test-'+randomUUID();
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let started=false,admin,runtime;
try {
  await execFile('docker',['run','--detach','--rm','--name',name,'--publish','127.0.0.1::5432',
    '--tmpfs','/var/lib/postgresql:rw','--env','POSTGRES_PASSWORD=synthetic-admin-only','--env','POSTGRES_DB=relay_test',image],{timeout:120000});
  started=true;
  const {stdout}=await execFile('docker',['port',name,'5432/tcp']);
  const port=Number(stdout.trim().split(':').at(-1));
  assert.ok(Number.isInteger(port)&&port>0);
  admin=postgres({host:'127.0.0.1',port,database:'relay_test',username:'postgres',password:'synthetic-admin-only',max:3,connect_timeout:2,onnotice:()=>{}});
  for(let attempt=0;;attempt++){
    try{await admin`SELECT 1`;break;}catch(error){if(attempt===30)throw error;await pause(200);}
  }
  for(const file of ['001_identity_line.sql','002_calendar_mcp.sql']) await admin.unsafe(await readFile('migrations/'+file,'utf8'));
  await admin`CREATE ROLE relay_fixture_migration NOLOGIN CREATEROLE`;
  await admin`GRANT CREATE ON DATABASE relay_test TO relay_fixture_migration`;
  await admin.begin(async tx=>{
    await tx`SET LOCAL ROLE relay_fixture_migration`;
    await tx.unsafe(await readFile('migrations/003_crm_customers.sql','utf8'));
    await tx`INSERT INTO relay_crm.workspaces(id,name) VALUES(${randomUUID()},'Synthetic provisioner check')`;
  });
  await admin`CREATE ROLE relay_fixture_runtime LOGIN PASSWORD 'synthetic-runtime-only' IN ROLE relay_crm_runtime`;
  runtime=postgres({host:'127.0.0.1',port,database:'relay_test',username:'relay_fixture_runtime',password:'synthetic-runtime-only',max:4,connect_timeout:2});
  const wrap=sql=>({query:(text,values=[])=>sql.unsafe(text,values),transaction:work=>sql.begin(tx=>work(wrap(tx)))});
  const db=wrap(runtime);
  await mkdir('.vercel/check-crm-postgres',{recursive:true});
  await build({entryPoints:['src/server/crm.ts'],bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.vercel/check-crm-postgres/server.mjs'});
  const api=await import(pathToFileURL(process.cwd()+'/.vercel/check-crm-postgres/server.mjs'));
  const person=randomUUID(),other=randomUUID(),workspace=randomUUID(),otherWorkspace=randomUUID();
  const identity={subject:'synthetic-postgres',email:'synthetic@example.invalid'};
  await admin`INSERT INTO relay_crm.principals(id,issuer,subject,display_name,verified_email) VALUES
    (${person},'https://accounts.google.com',${identity.subject},'Synthetic',${identity.email}),
    (${other},'https://accounts.google.com','other-subject','Other synthetic','other@example.invalid')`;
  await admin`INSERT INTO relay_crm.workspaces(id,name) VALUES(${workspace},'Synthetic workspace'),(${otherWorkspace},'Other workspace')`;
  await admin`INSERT INTO relay_crm.memberships(workspace_id,principal_id,role,status) VALUES
    (${workspace},${person},'editor','active'),(${otherWorkspace},${other},'editor','active')`;
  await api.verifyCrmRole(db);
  await assert.rejects(()=>api.verifyCrmRole(wrap(admin)),e=>e.status===503);
  const input={workspaceId:workspace,key:randomUUID(),customer:{displayName:'Concurrent synthetic customer',kind:'organization'}};
  const results=await Promise.all(Array.from({length:4},(_,index)=>api.createCustomer(identity,index%2?{...input,workspaceId:workspace.toUpperCase(),key:input.key.toUpperCase()}:input,db)));
  assert.equal(new Set(results.map(r=>r.customer.id)).size,1);
  assert.equal(results.filter(r=>!r.replayed).length,1);
  assert.equal((await admin`SELECT count(*)::int AS n FROM relay_crm.customers`)[0].n,1);
  assert.equal((await admin`SELECT count(*)::int AS n FROM relay_crm.audit_events WHERE action='create'`)[0].n,1);
  assert.equal((await api.getCustomer(identity,workspace,results[0].customer.id,db)).displayName,input.customer.displayName);
  await assert.rejects(()=>api.getCustomer({subject:'other-subject',email:'other@example.invalid'},workspace,results[0].customer.id,db),e=>e.status===404);
  assert.equal((await runtime`SELECT count(*)::int AS n FROM relay_crm.customers`)[0].n,0,'pooled connections must not retain tenant context');
  await assert.rejects(()=>runtime`TRUNCATE relay_crm.customers`,e=>e.code==='42501');

  // Pause after authorization locks. A concurrent suspension must wait for commit.
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;});
  const locked=new Promise(resolve=>{entered=resolve;});
  const pausedDb={transaction:work=>db.transaction(tx=>work({...tx,query:async(text,values)=>{
    const rows=await tx.query(text,values);
    if(text.includes("set_config('relay.workspace_id', $1")){entered();await gate;}
    return rows;
  }}))};
  const save=api.createCustomer(identity,{...input,key:randomUUID()},pausedDb);
  await locked;
  let suspended=false;
  const suspend=admin`UPDATE relay_crm.memberships SET status='suspended' WHERE workspace_id=${workspace} AND principal_id=${person}`.then(()=>{suspended=true;});
  await pause(100);assert.equal(suspended,false);
  release();await save;await suspend;
  await assert.rejects(()=>api.createCustomer(identity,input,db),e=>e.status===404);
  await assert.rejects(()=>api.listCustomers(identity,workspace,null,db),e=>e.status===404);

  // Suspension that commits first must also reject an already-waiting request.
  await admin`UPDATE relay_crm.memberships SET status='active' WHERE principal_id=${person}`;
  let releaseSuspend,startedSuspend;
  const suspensionGate=new Promise(resolve=>{releaseSuspend=resolve;});
  const suspensionStarted=new Promise(resolve=>{startedSuspend=resolve;});
  const stopping=admin.begin(async tx=>{
    await tx`UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=${person}`;
    startedSuspend();await suspensionGate;
  });
  await suspensionStarted;
  const waiting=api.createCustomer(identity,{...input,key:randomUUID()},db);
  const rejected=assert.rejects(()=>waiting,e=>e.status===404);
  await pause(100);releaseSuspend();await stopping;await rejected;
  console.log('PostgreSQL 18.6: restricted login, real RLS, four concurrent retries, pooled-context cleanup and both membership-revocation orders passed. Disposable synthetic database only.');
} finally {
  await Promise.allSettled([runtime?.end({timeout:1}),admin?.end({timeout:1})]);
  if(started)await execFile('docker',['rm','--force',name]);
}
