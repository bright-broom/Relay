import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

// Run against the same real SQL/RLS implementation and verified HTTP session as CRM.
export async function verifyContacts({api,pg,db,id,identity,reject,scoped,sqlReject,call,request,failing,failedDedup}) {
  const parent = (await api.createCustomer(identity(1),{workspaceId:id(11),key:randomUUID(),customer:{displayName:'Synthetic contact parent',kind:'organization'}},db)).customer;
  const input = {workspaceId:id(11),customerId:parent.id,key:randomUUID(),contact:{displayName:'Synthetic Person',email:'Person@example.invalid',phone:'+81 (0)3 1234 5678 ext. 9',relationship:'billing',isPrimary:true}};
  const create = (body=input,person=1,target=db)=>api.createContact(identity(person),body,target);
  const list = (cursor=null,person=1,workspace=11,customer=parent.id,target=db)=>api.listContacts(identity(person),id(workspace),customer,cursor,target);
  const counts = async()=> (await pg.query(`SELECT (SELECT count(*) FROM relay_crm.contacts)::int AS contacts,
    (SELECT count(*) FROM relay_crm.customer_contacts)::int AS links,
    (SELECT count(*) FROM relay_crm.audit_events)::int AS audits,
    (SELECT count(*) FROM relay_crm.request_dedup)::int AS keys`)).rows[0];
  const first = await create();
  assert.equal(first.replayed,false);
  assert.deepEqual(first.contact,{id:first.contact.id,...input.contact,version:'1'});
  assert.equal((await create({...input,key:input.key.toUpperCase(),customerId:parent.id.toUpperCase()})).contact.id,first.contact.id);
  assert.equal((await create()).replayed,true);
  assert.deepEqual((await list(null,2)).contacts,[first.contact]);
  const stored = (await pg.query('SELECT email_search,phone_search,version::text FROM relay_crm.contacts WHERE id=$1',[first.contact.id])).rows[0];
  assert.deepEqual(stored,{email_search:null,phone_search:null,version:'1'});
  await reject(()=>create({...input,contact:{...input.contact,displayName:'Different'}}),409,'crmRetryConflict');
  await reject(()=>create(input,2),403,'crmReadOnly');
  for (const person of [3,4]) await reject(()=>create(input,person),404);
  await reject(()=>list(null,3),404);
  await reject(()=>list(null,3,12),404);
  await reject(()=>create({...input,workspaceId:id(12)},3),404);
  const beforeConflict = await counts();
  await reject(()=>create({...input,key:randomUUID()}),409,'crmPrimaryConflict');
  assert.deepEqual(await counts(),beforeConflict,'primary conflict must not leave an orphan contact or audit');
  for (const contact of [
    {...input.contact,displayName:''},{...input.contact,displayName:'x'.repeat(201)},
    {...input.contact,email:'bad'},{...input.contact,email:'x'.repeat(250)+'@example.invalid'},
    {...input.contact,phone:'1'.repeat(65)},{...input.contact,phone:'123\n456'},
    {...input.contact,displayName:'Bad\u0000Name'},{...input.contact,role:'admin'},
    {...input.contact,relationship:'unknown'},{...input.contact,isPrimary:'true'},
  ]) await reject(()=>create({...input,key:randomUUID(),contact}),400,'crmContactInvalid');
  await reject(()=>create({...input,actorId:id(3)}),400,'crmContactInvalid');
  const minimal = {...input,key:randomUUID(),contact:{displayName:"O'Hara <script>synthetic</script>",email:'',phone:'',relationship:'self',isPrimary:false}};
  const noChannels = await create(minimal);
  assert.equal(noChannels.contact.email,null);assert.equal(noChannels.contact.phone,null);
  // Names and channels never serve as a uniqueness constraint or implicit merge.
  assert.notEqual((await create({...minimal,key:randomUUID()})).contact.id,noChannels.contact.id);
  for (const broken of [failing,failedDedup,{transaction:work=>db.transaction(tx=>work({...tx,query:(text,values)=>{
    if(text.includes('INSERT INTO relay_crm.customer_contacts')) throw Error('Synthetic link outage');
    return tx.query(text,values);
  }}))}]) {
    const before = await counts();
    await assert.rejects(()=>create({...minimal,key:randomUUID()},1,broken));
    assert.deepEqual(await counts(),before,'contact, relation, audit and retry record commit atomically');
  }
  await assert.rejects(()=>list(null,1,11,parent.id,failing));
  const otherParent = (await api.createCustomer(identity(3),{workspaceId:id(12),key:randomUUID(),customer:{displayName:'Other contact parent',kind:'individual'}},db)).customer;
  await sqlReject(()=>scoped(2,11,tx=>tx.query(`INSERT INTO relay_crm.contacts(id,workspace_id,display_name) VALUES($1,$2,'Denied')`,[randomUUID(),id(11)])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query(`INSERT INTO relay_crm.customer_contacts(workspace_id,customer_id,contact_id,relationship) VALUES($1,$2,$3,'contact')`,[id(12),otherParent.id,first.contact.id])));
  await assert.rejects(()=>scoped(1,11,tx=>tx.query(`INSERT INTO relay_crm.customer_contacts(workspace_id,customer_id,contact_id,relationship) VALUES($1,$2,$3,'contact')`,[id(11),otherParent.id,first.contact.id])),e=>['42501','23503'].includes(e.code));
  for (const table of ['contacts','customer_contacts']) {
    assert.deepEqual(await scoped(3,12,tx=>tx.query(`SELECT * FROM relay_crm.${table}`)),[]);
    await sqlReject(()=>scoped(1,11,tx=>tx.query(`DELETE FROM relay_crm.${table}`)));
    await sqlReject(()=>scoped(1,11,tx=>tx.query(`UPDATE relay_crm.${table} SET workspace_id=$1`,[id(12)])));
    await sqlReject(()=>scoped(1,11,tx=>tx.query(`TRUNCATE relay_crm.${table}`)));
  }
  await pg.query("UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=$1",[id(1)]);
  await reject(()=>create(),404);await reject(()=>list(),404);
  await pg.query("UPDATE relay_crm.memberships SET status='active' WHERE principal_id=$1",[id(1)]);
  const archived = await api.changeCustomer(identity(1),parent.id,{workspaceId:id(11),key:randomUUID(),version:'1',action:'archive'},db);
  assert.ok(archived.customer.archivedAt);
  assert.equal((await list(null,2)).contacts.length,3,'archived history remains readable');
  assert.equal((await create()).replayed,true,'confirmed earlier creation can be replayed after archiving');
  await reject(()=>create({...minimal,key:randomUUID()}),409,'crmContactArchived');
  await api.changeCustomer(identity(1),parent.id,{workspaceId:id(11),key:randomUUID(),version:'2',action:'restore'},db);
  await pg.query(`UPDATE relay_crm.request_dedup SET created_at=now()-interval '9 days',expires_at=now()-interval '1 day' WHERE operation='contact.create' AND key=$1`,[input.key]);
  await reject(()=>create(),409,'crmRetryConflict');
  // Stable UUID cursor, bound to the parent and workspace, without contact PII.
  for(let n=0;n<48;n++) await create({...minimal,key:randomUUID()});
  const page1 = await list(), page2 = await list(page1.nextCursor);
  assert.equal(page1.contacts.length,50);assert.equal(page2.contacts.length,1);assert.equal(page2.nextCursor,null);
  assert.equal(new Set([...page1.contacts,...page2.contacts].map(c=>c.id)).size,51);
  assert.ok(!Buffer.from(page1.nextCursor,'base64url').toString().includes('Synthetic'));
  await reject(()=>list('garbage'),400,'crmCursorInvalid');
  await reject(()=>list(page1.nextCursor,1,11,randomUUID()),400,'crmCursorInvalid');
  await reject(()=>list(page1.nextCursor,3,12),400,'crmCursorInvalid');
  const audits = (await pg.query("SELECT changes FROM relay_crm.audit_events WHERE entity_type='contact'")).rows;
  assert.ok(audits.length > 0);assert.ok(audits.every(row=>Object.keys(row.changes).join() === 'customerId'));
  for(const secret of [input.contact.displayName,input.contact.email,input.contact.phone]) assert.ok(!JSON.stringify(audits).includes(secret));
  const body = {...minimal,key:randomUUID()};
  assert.equal((await call(request('crm-contacts','POST',body))).status,201);
  assert.equal((await call(request('crm-contacts','POST',body))).status,200);
  assert.equal((await call(request('crm-contacts','POST',{...body,actorId:id(3)}))).status,400);
  assert.equal((await call(request('crm-contacts','POST',body,{origin:'https://evil.test'}))).status,403);
  assert.equal((await call(request('crm-contacts','GET'))).status,405);
  assert.equal((await call(request(`crm-customer-contacts&id=${parent.id}&workspaceId=${id(11)}`))).status,200);
  assert.equal((await call(request(`crm-customer-contacts&id=${parent.id}&workspaceId=${id(11)}`,'POST',body))).status,405);
  assert.equal((await call(new Request('https://relay.test/api/relay?route=crm-contacts',{method:'POST',body:JSON.stringify(body)}))).status,401);
  console.log('Contacts: optional channels, tenant/RLS boundaries, primary uniqueness, atomic rollback, archive policy, replay/revocation, pagination, PII-free audit and authenticated HTTP passed.');
}
