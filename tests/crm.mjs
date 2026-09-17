import assert from 'node:assert/strict';
import {verifyContacts} from './crm-contacts.mjs';
import {verifyContactEdits} from './crm-contact-edit.mjs';
import {randomUUID, createHash} from 'node:crypto';
import {readFile, mkdir} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import {PGlite} from '@electric-sql/pglite';

await mkdir('.vercel/check-crm', {recursive:true});
await build({stdin:{contents:`export * from './src/server/crm'; export * from './src/server/crm-contacts'; export * from './src/server/auth'; export {handle} from './src/server/handler';`,resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.vercel/check-crm/server.mjs'});
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

  // Preserve a real pre-upgrade row while adding lifecycle and contacts tables.
  const legacyId = randomUUID();
  await pg.query(`INSERT INTO relay_crm.customers(id,workspace_id,kind,display_name,name_search,status) VALUES($1,$2,'individual','Legacy synthetic','legacy synthetic','prospect')`,[legacyId,id(12)]);
  const legacyInput = {workspaceId:id(12),key:randomUUID(),customer:{displayName:'Legacy synthetic',kind:'individual'}};
  const legacyHash = createHash('sha256').update(JSON.stringify(legacyInput.customer)).digest('hex');
  await pg.query(`INSERT INTO relay_crm.request_dedup(workspace_id,actor_id,operation,key,payload_hash,response_status,result_id,expires_at)
    VALUES($1,$2,'customer.create',$3,$4,201,$5,now()+interval '7 days')`,[id(12),id(3),legacyInput.key,legacyHash,legacyId]);
  await pg.exec(await readFile('migrations/004_crm_customer_lifecycle.sql','utf8'));
  await pg.exec(await readFile('migrations/005_crm_contacts.sql','utf8'));
  const legacyCustomer = await api.getCustomer(identity(3),id(12),legacyId,db);
  assert.equal(legacyCustomer.displayName,'Legacy synthetic'); assert.equal(legacyCustomer.version,'1');
  const legacyReplay = await api.createCustomer(identity(3),legacyInput,db);
  assert.equal(legacyReplay.replayed,true);assert.equal(legacyReplay.customer.id,legacyId);
  await pg.query('DELETE FROM relay_crm.request_dedup WHERE key=$1',[legacyInput.key]);
  await pg.query('DELETE FROM relay_crm.customers WHERE id=$1',[legacyId]);
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

  // Lifecycle changes preserve identity and atomically increment a string bigint version.
  const customerId = created.customer.id;
  const edit = {workspaceId:id(11),key:randomUUID(),version:'1',action:'edit',customer:{displayName:'Synthetic edited customer',kind:'individual'}};
  const updated = await api.changeCustomer(identity(1),customerId,edit,db);
  assert.equal(updated.customer.version,'2'); assert.equal(updated.appliedVersion,'2');
  assert.equal(updated.customer.id,customerId); assert.equal(updated.customer.displayName,edit.customer.displayName);
  assert.equal((await api.changeCustomer(identity(1),customerId,{...edit,key:edit.key.toUpperCase()},db)).replayed,true);
  await reject(()=>api.changeCustomer(identity(1),customerId,{...edit,customer:{...edit.customer,displayName:'Different'}},db),409,'crmRetryConflict');
  await reject(()=>api.changeCustomer(identity(1),customerId,{...edit,key:randomUUID()},db),409,'crmVersionConflict');
  await reject(()=>api.changeCustomer(identity(2),customerId,edit,db),403);
  await reject(()=>api.changeCustomer(identity(3),customerId,edit,db),404);
  await reject(()=>api.changeCustomer(identity(3),customerId,{...edit,workspaceId:id(12)},db),404);
  const archive = {workspaceId:id(11),key:randomUUID(),version:'2',action:'archive'};
  const archived = await api.changeCustomer(identity(1),customerId,archive,db);
  assert.equal(archived.customer.version,'3'); assert.ok(archived.customer.archivedAt);
  assert.equal((await api.listCustomers(identity(1),id(11),null,db)).customers.length,0);
  assert.equal((await api.listCustomers(identity(1),id(11),null,db,true)).customers[0].id,customerId);
  assert.ok((await api.getCustomer(identity(2),id(11),customerId,db)).archivedAt);
  await reject(()=>api.changeCustomer(identity(1),customerId,{...edit,key:randomUUID(),version:'3'},db),409,'crmStateConflict');
  await reject(()=>api.createCustomer(identity(1),input,db),409,'crmRetryConflict');
  const restore = {...archive,key:randomUUID(),version:'3',action:'restore'};
  const restored = await api.changeCustomer(identity(1),customerId,restore,db);
  assert.equal(restored.customer.version,'4'); assert.equal(restored.customer.archivedAt,null);
  const replay = await api.changeCustomer(identity(1),customerId,archive,db);
  assert.equal(replay.replayed,true); assert.equal(replay.appliedVersion,'3');
  assert.equal(replay.customer.version,'4'); assert.equal(replay.customer.archivedAt,null,'retry never reapplies an old archive');
  const events = (await pg.query("SELECT action,changes FROM relay_crm.audit_events WHERE action IN ('edit','archive','restore') ORDER BY created_at")).rows;
  assert.equal(events.length,3);
  assert.deepEqual(events[0].changes,{fields:['displayName','kind'],fromVersion:'1',toVersion:'2'});
  assert.ok(!JSON.stringify(events).includes(edit.customer.displayName));
  const changesBefore = await count('audit_events'), keysBefore = await count('request_dedup');
  for (const broken of [failing,failedDedup]) {
    await assert.rejects(()=>api.changeCustomer(identity(1),customerId,{...edit,key:randomUUID(),version:'4'},broken));
    assert.equal((await pg.query('SELECT version::text FROM relay_crm.customers WHERE id=$1',[customerId])).rows[0].version,'4');
    assert.equal(await count('audit_events'),changesBefore); assert.equal(await count('request_dedup'),keysBefore);
  }
  await pg.query("UPDATE relay_crm.memberships SET role='viewer' WHERE principal_id=$1",[id(1)]);
  await reject(()=>api.changeCustomer(identity(1),customerId,edit,db),403,'crmReadOnly');
  await pg.query("UPDATE relay_crm.memberships SET role='editor' WHERE principal_id=$1",[id(1)]);

  // Revocation applies to reads AND retries, even when the original save succeeded.
  await pg.query(`UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=$1`,[id(1)]);
  await reject(()=>api.createCustomer(identity(1),input,db),404);
  await reject(()=>api.changeCustomer(identity(1),customerId,edit,db),404);
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
  await reject(()=>api.changeCustomer(identity(1),customerId,edit,db),409,'crmRetryConflict');

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

  await sqlReject(()=>scoped(1,11,tx=>tx.query('UPDATE relay_crm.customers SET workspace_id=$1 WHERE id=$2',[id(12),customerId])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query('UPDATE relay_crm.customers SET owner_id=$1 WHERE id=$2',[id(2),customerId])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query('DELETE FROM relay_crm.customers WHERE id=$1',[customerId])));
  assert.deepEqual(await scoped(2,11,tx=>tx.query("UPDATE relay_crm.customers SET display_name='Unauthorized' RETURNING id")),[]);
  assert.deepEqual(await scoped(3,12,tx=>tx.query("UPDATE relay_crm.customers SET display_name='Unauthorized' WHERE id=$1 RETURNING id",[customerId])),[]);

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
  const changeRoute = 'crm-customer&id='+customerId;
  const patch = {...edit,key:randomUUID(),version:'4'};
  assert.equal((await call(request(changeRoute,'PATCH',patch,{origin:'https://evil.test'}))).status,403);
  for (const version of [0,1,'0','01','-1','1.1','abc','9223372036854775807','9223372036854775808']) {
    assert.equal((await call(request(changeRoute,'PATCH',{...patch,version}))).status,400);
  }
  assert.equal((await call(request(changeRoute,'PATCH',{...patch,ownerId:id(2)}))).status,400);
  assert.equal((await call(request('crm-customers&workspaceId='+id(11)+'&archived=unknown'))).status,400);
  assert.equal((await call(request(changeRoute,'PATCH',patch))).status,200);
  assert.equal((await call(request(changeRoute,'PATCH',{...patch,key:randomUUID()}))).status,409);
  await pg.query('UPDATE relay_crm.customers SET version=9007199254740993 WHERE id=$1',[customerId]);
  const precise = await api.changeCustomer(identity(1),customerId,{...edit,key:randomUUID(),version:'9007199254740993'},db);
  assert.equal(precise.customer.version,'9007199254740994');
  // Search uses literal substrings with the same normalization as saved names.
  const add = (name,person=1,workspace=11)=>api.createCustomer(identity(person),{workspaceId:id(workspace),key:randomUUID(),customer:{displayName:name,kind:'organization'}},db);
  const acme = (await add('ＡＣＭＥ 株式会社')).customer;
  const oldAcme = (await add('Acme West')).customer;
  await api.changeCustomer(identity(1),oldAcme.id,{workspaceId:id(11),key:randomUUID(),version:'1',action:'archive'},db);
  await add('ACME other workspace',3,12);
  const literal = (await add(String.raw`Quota 100%_done\branch`)).customer;
  const search = (query,extra={})=>api.searchCustomers(identity(1),{workspaceId:id(11),query,...extra},db);
  assert.deepEqual((await search('  ａｃｍｅ  ')).customers.map(c=>c.id),[acme.id]);
  assert.deepEqual((await search('ACME',{archived:true})).customers.map(c=>c.id),[oldAcme.id]);
  for (const query of ['%','_',String.fromCharCode(92)]) assert.deepEqual((await search(query)).customers.map(c=>c.id),[literal.id]);
  assert.equal((await search("' OR true --")).customers.length,0);
  assert.equal((await search('absent synthetic name')).customers.length,0);
  assert.equal((await api.searchCustomers(identity(2),{workspaceId:id(11),query:'acme'},db)).customers[0].id,acme.id);
  await reject(()=>api.searchCustomers(identity(3),{workspaceId:id(11),query:'acme'},db),404);
  await reject(()=>api.searchCustomers(identity(4),{workspaceId:id(11),query:''},db),404);
  await assert.rejects(()=>api.searchCustomers(identity(1),{workspaceId:id(11),query:'acme'},failing));
  for (const query of ['x'.repeat(201),'bad\u0000name','bad\nname',42]) {
    await reject(()=>search(query),400,'crmSearchInvalid');
  }
  await reject(()=>search('acme',{role:'admin'}),400,'crmSearchInvalid');
  await reject(()=>search('acme',{archived:'false'}),400,'crmSearchInvalid');
  await api.changeCustomer(identity(1),acme.id,{workspaceId:id(11),key:randomUUID(),version:'1',action:'edit',customer:{displayName:'Changed Unique Name',kind:'organization'}},db);
  assert.equal((await search('acme')).customers.length,0);
  assert.equal((await search('unique')).customers[0].id,acme.id);
  await pg.query("UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=$1",[id(2)]);
  await reject(()=>api.searchCustomers(identity(2),{workspaceId:id(11),query:'unique'},db),404);
  await pg.query("UPDATE relay_crm.memberships SET status='active' WHERE principal_id=$1",[id(2)]);

  // All matching records span pages; filters cannot silently reuse a different cursor.
  for(let n=0;n<51;n++) await pg.query(`INSERT INTO relay_crm.customers(id,workspace_id,kind,display_name,name_search,status,updated_at)
    VALUES($1,$2,'organization',$3,$4,'prospect','2026-09-17T00:00:00.123456Z')`,[randomUUID(),id(11),'Search batch '+n,'search batch '+n]);
  const found1=await search('SEARCH BATCH');
  assert.equal(found1.customers.length,50);assert.ok(found1.nextCursor);
  const found2=await search('ｓｅａｒｃｈ ｂａｔｃｈ',{cursor:found1.nextCursor});
  assert.equal(found2.customers.length,1);assert.equal(found2.nextCursor,null);
  assert.equal(new Set([...found1.customers,...found2.customers].map(c=>c.id)).size,51);
  assert.ok(!Buffer.from(found1.nextCursor,'base64url').toString().includes('search batch'));
  await reject(()=>search('unique',{cursor:found1.nextCursor}),400,'crmCursorInvalid');
  await reject(()=>search('search batch',{cursor:found1.nextCursor,archived:true}),400,'crmCursorInvalid');
  await reject(()=>api.searchCustomers(identity(3),{workspaceId:id(12),query:'search batch',cursor:found1.nextCursor},db),400,'crmCursorInvalid');
  const legacy=Buffer.from(JSON.stringify({updatedAt:page1.customers.at(-1).updatedAt,id:page1.customers.at(-1).id})).toString('base64url');
  await api.listCustomers(identity(1),id(11),legacy,db); // Existing unfiltered client compatibility.
  await reject(()=>search('search batch',{cursor:legacy}),400,'crmCursorInvalid');
  const listAudits=(await pg.query("SELECT changes FROM relay_crm.audit_events WHERE action='list'")).rows;
  assert.ok(listAudits.some(row=>row.changes.searched===true));
  assert.ok(!JSON.stringify(listAudits).toLowerCase().includes('acme'));
  assert.ok(!JSON.stringify(listAudits).includes('search batch'));
  const searchBody={workspaceId:id(11),query:'unique'};
  const searchResponse=await call(request('crm-search','POST',searchBody));
  assert.equal(searchResponse.status,200);assert.equal((await searchResponse.json()).customers[0].id,acme.id);
  assert.equal((await call(request('crm-search','POST',searchBody,{origin:'https://evil.test'}))).status,403);
  assert.equal((await call(request('crm-search','GET'))).status,405);
  assert.equal((await call(new Request('https://relay.test/api/relay?route=crm-search',{method:'POST',body:JSON.stringify(searchBody)}))).status,401);
  assert.equal((await call(request('crm-search','POST',{...searchBody,query:'x'.repeat(201)}))).status,400);
  await verifyContacts({api,pg,db,id,identity,reject,scoped,sqlReject,call,request,failing,failedDedup});
  await verifyContactEdits({api,pg,db,id,identity,reject,scoped,sqlReject,call,request,failing,failedDedup});
  process.env.ALLOWED_GOOGLE_EMAILS=identity(2).email;
  assert.equal((await call(request('crm-workspaces'))).status,401);
  console.log('CRM: runtime-role RLS, tenant isolation, viewer denial, revocation, immutable audit, atomic save/retry, upgrade preservation, edit/archive/restore, bigint conflicts, rollback, filter-bound search pagination, literal matching, search privacy and authenticated routes passed. Synthetic PGlite only.');
} finally { await pg.close(); }
