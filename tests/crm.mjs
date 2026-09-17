import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';

await mkdir('.vercel/check-crm', {recursive:true});
await build({stdin:{contents:`export * from './src/server/crm'; export * from './src/server/auth'; export {handle} from './src/server/handler';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.vercel/check-crm/server.mjs'});
const api = await import(pathToFileURL(process.cwd()+'/.vercel/check-crm/server.mjs'));
const pg = new PGlite();
const wrap = client => ({query:async (text,values) => (await client.query(text,values)).rows, transaction:work=>client.transaction(tx=>work(wrap(tx)))});
const ownerDb = wrap(pg);
const db = {query:()=>{throw Error('CRM must use a transaction');}, transaction:work=>pg.transaction(async tx=>{
  await tx.exec('SET LOCAL ROLE relay_crm_runtime');
  return work(wrap(tx));
})};
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const identity = n => ({subject:`synthetic-${n}`,email:`synthetic${n}@gmail.com`});
const reject = (work,status,code) => assert.rejects(work,e=>e.status===status && (!code || e.code===code));
const sqlReject = work => assert.rejects(work,e=>['42501','55000'].includes(e.code));
try {
  for (const file of ['001_identity_line.sql','002_calendar_mcp.sql','003_crm_customers.sql']) await pg.exec(await readFile('migrations/'+file,'utf8'));
  for (const n of [1,2,3,4]) {
    await pg.query(`INSERT INTO relay_crm.principals(id,issuer,subject,display_name,verified_email) VALUES($1,'https://accounts.google.com',$2,'Synthetic person',$3)`,[id(n),identity(n).subject,identity(n).email]);
  }
  for (const n of [11,12]) await pg.query(`INSERT INTO relay_crm.workspaces(id,name) VALUES($1,$2)`,[id(n),`Synthetic workspace ${n}`]);
  for (const [workspace,person,role] of [[11,1,'editor'],[11,2,'viewer'],[12,3,'admin']]) await pg.query(`INSERT INTO relay_crm.memberships(workspace_id,principal_id,role,status) VALUES($1,$2,$3,'active')`,[id(workspace),id(person),role]);

  await reject(()=>api.listWorkspaces(identity(1),ownerDb),503,'crmUnavailable');
  assert.deepEqual(await api.listWorkspaces(identity(1),db),[{id:id(11),name:'Synthetic workspace 11',role:'editor'}]);
  assert.deepEqual(await api.listWorkspaces(identity(4),db),[]);
  const input = {workspaceId:id(11),key:randomUUID(),customer:{displayName:'Synthetic Customer',kind:'organization'}};
  const created = await api.createCustomer(identity(1),input,db);
  assert.equal(created.replayed,false);
  assert.equal(created.customer.version,'1');
  assert.equal(created.customer.status,'prospect');
  assert.equal((await api.getCustomer(identity(2),id(11),created.customer.id,db)).displayName,input.customer.displayName);
  assert.equal((await api.listCustomers(identity(1),id(11),null,db)).customers.length,1);
  assert.equal((await api.createCustomer(identity(1),input,db)).customer.id,created.customer.id);
  assert.equal((await api.createCustomer(identity(1),input,db)).replayed,true);
  assert.equal((await api.createCustomer(identity(1),{...input,key:input.key.toUpperCase()},db)).customer.id,created.customer.id);
  assert.equal((await api.getCustomer(identity(1),id(11),created.customer.id.toUpperCase(),db)).id,created.customer.id);
  const count = table => pg.query(`SELECT count(*)::int AS n FROM relay_crm.${table}`).then(result=>result.rows[0].n);
  assert.equal(await count('customers'),1);
  assert.equal(await count('request_dedup'),1);
  assert.equal((await pg.query(`SELECT count(*)::int AS n FROM relay_crm.audit_events WHERE action='create'`)).rows[0].n,1);
  assert.ok(!(await pg.query('SELECT changes FROM relay_crm.audit_events')).rows.some(r=>JSON.stringify(r).includes('Synthetic Customer')));
  await reject(()=>api.createCustomer(identity(1),{...input,customer:{...input.customer,displayName:'Changed'}},db),409,'crmRetryConflict');
  await reject(()=>api.createCustomer(identity(2),{...input,key:randomUUID()},db),403,'crmReadOnly');
  await reject(()=>api.getCustomer(identity(3),id(11),created.customer.id,db),404);
  await reject(()=>api.getCustomer(identity(3),id(12),created.customer.id,db),404);
  await reject(()=>api.listCustomers(identity(4),id(11),null,db),404);
  await assert.rejects(()=>api.createCustomer(identity(1),{...input,customer:{...input.customer,owner_id:id(3)}},db));
  await assert.rejects(()=>api.createCustomer(identity(1),{...input,customer:{...input.customer,displayName:' '.repeat(10)}},db));
  await assert.rejects(()=>api.createCustomer(identity(1),{...input,customer:{...input.customer,displayName:'x'.repeat(201)}},db));
  await assert.rejects(()=>api.createCustomer(identity(1),{...input,customer:{...input.customer,displayName:'Bad\u0000Name'}},db));
  await reject(()=>api.listCustomers(identity(1),id(11),'not-a-cursor',db),400);

  // Audit and replay evidence must commit together with the customer, never later.
  const before = await count('customers');
  const failing = {transaction:work=>db.transaction(tx=>work({...tx,query:(text,values)=>{
    if (text.includes('INSERT INTO relay_crm.audit_events')) throw Error('synthetic audit outage');
    return tx.query(text,values);
  }}))};
  await assert.rejects(()=>api.createCustomer(identity(1),{...input,key:randomUUID()},failing));
  assert.equal(await count('customers'),before);
  assert.equal(await count('request_dedup'),1);
  const failedDedup = {transaction:work=>db.transaction(tx=>work({...tx,query:(text,values)=>{
    if (text.includes('INSERT INTO relay_crm.request_dedup')) throw Error('synthetic dedup outage');
    return tx.query(text,values);
  }}))};
  const auditsBefore = await count('audit_events');
  await assert.rejects(()=>api.createCustomer(identity(1),{...input,key:randomUUID()},failedDedup));
  assert.equal(await count('customers'),before);
  assert.equal(await count('audit_events'),auditsBefore);

  // Revocation applies to reads AND retries, even when the original save succeeded.
  await pg.query(`UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=$1`,[id(1)]);
  await reject(()=>api.createCustomer(identity(1),input,db),404);
  assert.deepEqual(await api.listWorkspaces(identity(1),db),[]);
  await pg.query(`UPDATE relay_crm.memberships SET status='active' WHERE principal_id=$1`,[id(1)]);
  await pg.query(`UPDATE relay_crm.principals SET disabled_at=now() WHERE id=$1`,[id(1)]);
  await reject(()=>api.getCustomer(identity(1),id(11),created.customer.id,db),404);
  await pg.query(`UPDATE relay_crm.principals SET disabled_at=NULL WHERE id=$1`,[id(1)]);
  await pg.query(`UPDATE relay_crm.workspaces SET archived_at=now() WHERE id=$1`,[id(11)]);
  await reject(()=>api.getCustomer(identity(1),id(11),created.customer.id,db),404);
  await pg.query(`UPDATE relay_crm.workspaces SET archived_at=NULL WHERE id=$1`,[id(11)]);
  await pg.query(`UPDATE relay_crm.request_dedup SET created_at=now()-interval '8 days',expires_at=now()-interval '1 day'`);
  await reject(()=>api.createCustomer(identity(1),input,db),409,'crmRetryConflict');

  // Bypass the API entirely and exercise real SQL policies using a non-owner role.
  const scoped = (person,workspace,work) => db.transaction(async tx=>{
    await tx.query(`SELECT set_config('relay.subject',$1,true),set_config('relay.principal_id',$2,true),set_config('relay.workspace_id',$3,true)`,[identity(person).subject,id(person),id(workspace)]);
    return work(tx);
  });
  assert.deepEqual(await db.transaction(tx=>tx.query('SELECT id FROM relay_crm.customers')),[],'context does not survive commit');
  assert.deepEqual(await scoped(3,11,tx=>tx.query('SELECT id FROM relay_crm.customers')),[],'forged workspace rejected by RLS');
  await sqlReject(()=>scoped(2,11,tx=>tx.query(`INSERT INTO relay_crm.customers(id,workspace_id,kind,display_name,name_search,status) VALUES($1,$2,'individual','Synthetic','synthetic','prospect')`,[randomUUID(),id(11)])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query(`UPDATE relay_crm.memberships SET status='active' WHERE principal_id=$1`,[id(1)])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query(`UPDATE relay_crm.memberships SET role='admin' WHERE principal_id=$1`,[id(1)])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query(`UPDATE relay_crm.principals SET disabled_at=NULL WHERE id=$1`,[id(1)])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query(`UPDATE relay_crm.workspaces SET archived_at=NULL WHERE id=$1`,[id(11)])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query('DELETE FROM relay_crm.audit_events')));
  await sqlReject(()=>scoped(1,11,tx=>tx.query('TRUNCATE relay_crm.customers')));
  await sqlReject(()=>scoped(1,11,tx=>tx.query(`INSERT INTO relay_crm.audit_events(id,workspace_id,actor_id,request_id,entity_type,entity_id,action,changes) VALUES($1,$2,$3,$4,'customer',$5,'create','{}')`,[randomUUID(),id(11),id(2),randomUUID(),created.customer.id])));

  // More than one page, including microsecond timestamps and a stable UUID tie break.
  for (let n=0;n<52;n++) await pg.query(`INSERT INTO relay_crm.customers(id,workspace_id,kind,display_name,name_search,status,updated_at)
    VALUES($1,$2,'organization','Synthetic page customer','synthetic','prospect','2026-09-17T00:00:00.123456Z')`,[randomUUID(),id(11)]);
  const page1 = await api.listCustomers(identity(1),id(11),null,db);
  assert.equal(page1.customers.length,50); assert.ok(page1.nextCursor);
  const page2 = await api.listCustomers(identity(1),id(11),page1.nextCursor,db);
  assert.equal(page2.customers.length,3); assert.equal(page2.nextCursor,null);
  assert.equal(new Set([...page1.customers,...page2.customers].map(row=>row.id)).size,53);

  // Actual HTTP handler: verified cookie identity, methods, origin and shape.
  Object.assign(process.env,{APP_ORIGIN:'https://relay.test',GOOGLE_CLIENT_ID:'synthetic-client',GOOGLE_CLIENT_SECRET:'synthetic-secret',DATABASE_URL:'postgres://unused:unused@localhost/unused',ALLOWED_GOOGLE_EMAILS:identity(1).email});
  const token = api.randomToken();
  await pg.query(`INSERT INTO relay_private.sessions(token_hash,subject,email,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')`,[api.hash(token),identity(1).subject,identity(1).email]);
  const request = (route,method='GET',body,extra={})=>new Request('https://relay.test/api/relay?route='+route,{method,headers:{cookie:api.cookie(api.sessionCookie,token,100),origin:'https://relay.test',...extra},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  const call = req=>api.handle(req,ownerDb,undefined,db);
  assert.equal((await call(new Request('https://relay.test/api/relay?route=crm-workspaces'))).status,401);
  assert.equal((await call(request('crm-workspaces'))).status,200);
  assert.equal((await call(request('crm-customers','POST',{...input,key:randomUUID()},{origin:'https://evil.test'}))).status,403);
  assert.equal((await call(request('crm-customers','POST',{...input,role:'admin'}))).status,400);
  assert.equal((await call(request('crm-customers','PATCH',{}))).status,405);
  const post = {...input,key:randomUUID()};
  assert.equal((await call(request('crm-customers','POST',post))).status,201);
  assert.equal((await call(request('crm-customers','POST',post))).status,200);
  assert.equal((await call(request('crm-customers&workspaceId='+id(11)))).status,200);
  process.env.ALLOWED_GOOGLE_EMAILS=identity(2).email;
  assert.equal((await call(request('crm-workspaces'))).status,401);
  console.log('CRM: runtime-role RLS, tenant isolation, viewer denial, revocation, immutable audit, atomic save/retry, pagination and authenticated routes passed. Synthetic PGlite only.');
} finally { await pg.close(); }
