import type {Database, Row} from '../src/server/database';
import {errorFields} from './support.ts';
// Always creates its own disposable, loopback-only PostgreSQL. Never accepts a DB URL.
import assert from 'node:assert/strict';
import {verifyContactEditPostgres} from './crm-contact-edit-postgres.ts';
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
const pause=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
let started=false;
let admin!: postgres.Sql, runtime!: postgres.Sql;
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
    await tx.unsafe(await readFile('migrations/004_crm_customer_lifecycle.sql','utf8'));
    await tx.unsafe(await readFile('migrations/005_crm_contacts.sql','utf8'));
    await tx.unsafe(await readFile('migrations/006_crm_contact_edit.sql','utf8'));
    await tx`INSERT INTO relay_crm.workspaces(id,name) VALUES(${randomUUID()},'Synthetic provisioner check')`;
  });
  await admin`CREATE ROLE relay_fixture_runtime LOGIN PASSWORD 'synthetic-runtime-only' IN ROLE relay_crm_runtime`;
  runtime=postgres({host:'127.0.0.1',port,database:'relay_test',username:'relay_fixture_runtime',password:'synthetic-runtime-only',max:4,connect_timeout:2});
  const wrap=(sql: postgres.Sql | postgres.TransactionSql): Database => ({
    query:<T extends Row>(text:string,values:(string|number|boolean|null)[]=[])=>sql.unsafe<T[]>(text,values),
    async transaction<T>(work:(db:Database)=>Promise<T>):Promise<T>{
      if ('begin' in sql) return sql.begin(tx=>work(wrap(tx))) as Promise<T>;
      return work(wrap(sql));
    },
  });
  const db=wrap(runtime);
  await mkdir('.vercel/check-crm-postgres',{recursive:true});
  await build({stdin:{contents:`export * from './src/server/crm'; export * from './src/server/crm-contacts';`,resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.vercel/check-crm-postgres/server.mjs'});
  const api=await import(pathToFileURL(process.cwd()+'/.vercel/check-crm-postgres/server.mjs').href) as (typeof import('../src/server/crm') & typeof import('../src/server/crm-contacts'));
  const person=randomUUID(),other=randomUUID(),workspace=randomUUID(),otherWorkspace=randomUUID();
  const identity={subject:'synthetic-postgres',email:'synthetic@example.invalid'};
  await admin`INSERT INTO relay_crm.principals(id,issuer,subject,display_name,verified_email) VALUES
    (${person},'https://accounts.google.com',${identity.subject},'Synthetic',${identity.email}),
    (${other},'https://accounts.google.com','other-subject','Other synthetic','other@example.invalid')`;
  await admin`INSERT INTO relay_crm.workspaces(id,name) VALUES(${workspace},'Synthetic workspace'),(${otherWorkspace},'Other workspace')`;
  await admin`INSERT INTO relay_crm.memberships(workspace_id,principal_id,role,status) VALUES
    (${workspace},${person},'editor','active'),(${otherWorkspace},${other},'editor','active')`;
  await api.verifyCrmRole(db);
  await assert.rejects(()=>api.verifyCrmRole(wrap(admin)),e=>errorFields(e).status===503);
  const input={workspaceId:workspace,key:randomUUID(),customer:{displayName:'Concurrent synthetic customer',kind:'organization'}};
  const results=await Promise.all(Array.from({length:4},(_,index)=>api.createCustomer(identity,index%2?{...input,workspaceId:workspace.toUpperCase(),key:input.key.toUpperCase()}:input,db)));
  assert.equal(new Set(results.map(r=>r.customer.id)).size,1);
  assert.equal(results.filter(r=>!r.replayed).length,1);
  assert.equal((await admin`SELECT count(*)::int AS n FROM relay_crm.customers`)[0].n,1);
  assert.equal((await admin`SELECT count(*)::int AS n FROM relay_crm.audit_events WHERE action='create'`)[0].n,1);
  assert.equal((await api.getCustomer(identity,workspace,results[0].customer.id,db)).displayName,input.customer.displayName);
  assert.equal((await api.searchCustomers(identity,{workspaceId:workspace,query:'ＣＯＮＣＵＲＲＥＮＴ'},db)).customers[0].id,results[0].customer.id);
  assert.equal((await api.searchCustomers(identity,{workspaceId:workspace,query:'%'},db)).customers.length,0);
  await assert.rejects(()=>api.searchCustomers({subject:'other-subject',email:'other@example.invalid'},{workspaceId:workspace,query:'concurrent'},db),e=>errorFields(e).status===404);
  await assert.rejects(()=>api.getCustomer({subject:'other-subject',email:'other@example.invalid'},workspace,results[0].customer.id,db),e=>errorFields(e).status===404);
  assert.equal((await runtime`SELECT count(*)::int AS n FROM relay_crm.customers`)[0].n,0,'pooled connections must not retain tenant context');
  await assert.rejects(()=>runtime`TRUNCATE relay_crm.customers`,e=>errorFields(e).code==='42501');

  // Competing versions: exactly one writer wins; same-key retries apply only once.
  const customerId=results[0].customer.id;
  const edit={workspaceId:workspace,key:randomUUID(),version:'1',action:'edit',customer:{displayName:'Parallel edit',kind:'individual'}};
  const race=await Promise.allSettled([api.changeCustomer(identity,customerId,edit,db),api.changeCustomer(identity,customerId,{...edit,key:randomUUID(),customer:{...edit.customer,displayName:'Other edit'}},db)]);
  assert.equal(race.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(race.find(r=>r.status==='rejected')!.reason.code,'crmVersionConflict');
  const retry={...edit,key:randomUUID(),version:'2'};
  const retryResults=await Promise.all(Array.from({length:4},(_,i)=>api.changeCustomer(identity,i%2?customerId.toUpperCase():customerId,i%2?{...retry,key:retry.key.toUpperCase()}:retry,db)));
  assert.equal(retryResults.filter(r=>!r.replayed).length,1);
  assert.ok(retryResults.every(r=>r.customer.version==='3'&&r.appliedVersion==='3'));
  assert.equal((await admin`SELECT count(*)::int AS n FROM relay_crm.audit_events WHERE action='edit'`)[0].n,2);
  const lifecycleRace=await Promise.allSettled([
    api.changeCustomer(identity,customerId,{workspaceId:workspace,key:randomUUID(),version:'3',action:'archive'},db),
    api.changeCustomer(identity,customerId,{...edit,key:randomUUID(),version:'3'},db),
  ]);
  assert.equal(lifecycleRace.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(lifecycleRace.find(r=>r.status==='rejected')!.reason.code,'crmVersionConflict');
  let current=await api.getCustomer(identity,workspace,customerId,db);
  if(current.archivedAt) current=(await api.changeCustomer(identity,customerId,{workspaceId:workspace,key:randomUUID(),version:current.version,action:'restore'},db)).customer;

  const contactInput={workspaceId:workspace,customerId,key:randomUUID(),contact:{displayName:'Concurrent contact',email:'contact@example.invalid',phone:'+81 3 0000 0000',relationship:'contact',isPrimary:false}};
  const contacts=await Promise.all(Array.from({length:4},(_,i)=>api.createContact(identity,i%2?{...contactInput,key:contactInput.key.toUpperCase()}:contactInput,db)));
  assert.equal(contacts.filter(r=>!r.replayed).length,1);
  assert.equal(new Set(contacts.map(r=>r.contact.id)).size,1);
  assert.equal((await api.listContacts(identity,workspace,customerId,null,db)).contacts.length,1);
  assert.equal((await runtime`SELECT count(*)::int AS n FROM relay_crm.contacts`)[0].n,0);
  const primaryRace=await Promise.allSettled(Array.from({length:2},()=>api.createContact(identity,{...contactInput,key:randomUUID(),contact:{...contactInput.contact,isPrimary:true}},db)));
  assert.equal(primaryRace.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(primaryRace.find(r=>r.status==='rejected')!.reason.code,'crmPrimaryConflict');
  assert.equal((await admin`SELECT count(*)::int AS n FROM relay_crm.contacts`)[0].n,2,'losing primary registration leaves no orphan');
  for(const first of ['contact','archive']) {
    const parent=(await api.createCustomer(identity,{...input,key:randomUUID()},db)).customer;
    const attempt={...contactInput,customerId:parent.id,key:randomUUID()};
    const archive={workspaceId:workspace,key:randomUUID(),version:'1',action:'archive'};
    let unlock!: () => void, entered!: () => void;
    const gate=new Promise<void>(resolve=>{unlock=resolve;}), locked=new Promise<void>(resolve=>{entered=resolve;});
    const pausedDb: Database = {query:db.query,transaction:work=>db.transaction(tx=>work({...tx,query:async <T extends Row>(text: string,values?: (string|number|boolean|null)[])=>{
      const rows=await tx.query<T>(text,values);
      if(text.includes('FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2 FOR UPDATE')){entered();await gate;}
      return rows;
    }}))};
    const leading=first==='contact'?api.createContact(identity,attempt,pausedDb):api.changeCustomer(identity,parent.id,archive,pausedDb);
    await locked;
    let settled=false;
    const following=(first==='contact'?api.changeCustomer(identity,parent.id,archive,db):api.createContact(identity,attempt,db))
      .then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
    await pause(100);assert.equal(settled,false,'the shared parent lock serializes both orders');
    unlock();await leading;const result=await following;
    if(first==='contact') {
      assert.ok('value' in result && 'customer' in result.value);
      assert.ok(result.value.customer.archivedAt);
      assert.equal((await api.createContact(identity,attempt,db)).replayed,true);
      assert.equal((await api.listContacts(identity,workspace,parent.id,null,db)).contacts.length,1);
    } else {
      assert.ok('error' in result);
      assert.equal(errorFields(result.error).code,'crmContactArchived');
      assert.equal((await api.listContacts(identity,workspace,parent.id,null,db)).contacts.length,0);
    }
  }

  await verifyContactEditPostgres({api,admin,db,identity,workspace,person,customerId,contactId:contacts[0].contact.id,pause});

  // Keep the original creation race coverage and add the same contracts for editing.
  for (const operation of ['create','edit','contact']) {
    await admin`UPDATE relay_crm.memberships SET status='active' WHERE principal_id=${person}`;
    current=await api.getCustomer(identity,workspace,customerId,db);
    // Pause after authorization locks. A concurrent suspension must wait for commit.
    let release!: () => void, entered!: () => void;
    const gate=new Promise<void>(resolve=>{release=resolve;});
    const locked=new Promise<void>(resolve=>{entered=resolve;});
    const pausedDb: Database = {query:db.query,transaction:work=>db.transaction(tx=>work({...tx,query:async <T extends Row>(text: string,values?: (string|number|boolean|null)[])=>{
      const rows=await tx.query<T>(text,values);
      if(text.includes("set_config('relay.workspace_id', $1")){entered();await gate;}
      return rows;
    }}))};
    const save=operation==='contact' ? api.createContact(identity,{...contactInput,key:randomUUID()},pausedDb) : operation==='create' ? api.createCustomer(identity,{...input,key:randomUUID()},pausedDb)
      : api.changeCustomer(identity,customerId,{...edit,key:randomUUID(),version:current.version},pausedDb);
    await locked;
    let suspended=false;
    const suspend=admin`UPDATE relay_crm.memberships SET status='suspended' WHERE workspace_id=${workspace} AND principal_id=${person}`.then(()=>{suspended=true;});
    await pause(100);assert.equal(suspended,false);
    release();await save;await suspend;
    await assert.rejects(()=>api.createCustomer(identity,input,db),e=>errorFields(e).status===404);
    await assert.rejects(()=>api.changeCustomer(identity,customerId,retry,db),e=>errorFields(e).status===404);
    await assert.rejects(()=>api.listCustomers(identity,workspace,null,db),e=>errorFields(e).status===404);
    await assert.rejects(()=>api.createContact(identity,contactInput,db),e=>errorFields(e).status===404);
    await assert.rejects(()=>api.listContacts(identity,workspace,customerId,null,db),e=>errorFields(e).status===404);

    // Suspension that commits first must also reject an already-waiting request.
    await admin`UPDATE relay_crm.memberships SET status='active' WHERE principal_id=${person}`;
    let releaseSuspend!: () => void, startedSuspend!: () => void;
    const suspensionGate=new Promise<void>(resolve=>{releaseSuspend=resolve;});
    const suspensionStarted=new Promise<void>(resolve=>{startedSuspend=resolve;});
    const stopping=admin.begin(async tx=>{
      await tx`UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=${person}`;
      startedSuspend();await suspensionGate;
    });
    await suspensionStarted;
    const waiting=operation==='contact' ? api.createContact(identity,{...contactInput,key:randomUUID()},db) : operation==='create' ? api.createCustomer(identity,{...input,key:randomUUID()},db)
      : api.changeCustomer(identity,customerId,{...edit,key:randomUUID(),version:(BigInt(current.version)+1n).toString()},db);
    const rejected=assert.rejects(()=>waiting,e=>errorFields(e).status===404);
    await pause(100);releaseSuspend();await stopping;await rejected;
  }
  console.log('PostgreSQL 18.6: restricted login, real RLS, four concurrent customer/contact/edit retries, primary-contact races, both contact/archive orders, competing edits and archive, normalized literal search, pooled-context cleanup and both membership-revocation orders passed. Disposable synthetic database only.');
} finally {
  await Promise.allSettled([runtime?.end({timeout:1}),admin?.end({timeout:1})]);
  if(started)await execFile('docker',['rm','--force',name]);
}
