import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';

export async function verifyContactEdits({api,pg,db,id,identity,reject,scoped,sqlReject,call,request,failing,failedDedup}) {
  const addCustomer = async(person=1,workspace=11)=>(await api.createCustomer(identity(person),{workspaceId:id(workspace),key:randomUUID(),customer:{displayName:'Synthetic edit parent',kind:'organization'}},db)).customer;
  const parent=await addCustomer(),second=await addCustomer(),other=await addCustomer(3,12);
  const create={workspaceId:id(11),customerId:parent.id,key:randomUUID(),contact:{displayName:'Before contact edit',email:'before@example.invalid',phone:'+81 3 0000 0000',relationship:'billing',isPrimary:true}};
  const original=(await api.createContact(identity(1),create,db)).contact;
  const input={workspaceId:id(11),customerId:parent.id,key:randomUUID(),version:'1',contact:{displayName:'After contact edit',email:'after@example.invalid',phone:''}};
  const edit=(body=input,person=1,target=db,contactId=original.id)=>api.editContact(identity(person),contactId,body,target);
  const read=(person=1,workspace=11,customerId=parent.id,target=db)=>api.getContact(identity(person),id(workspace),customerId,original.id,target);
  await assert.rejects(()=>edit(),e=>e.code==='42501','missing migration must not permit an edit');
  await pg.exec(await readFile('migrations/006_crm_contact_edit.sql','utf8'));
  assert.deepEqual((await read()).contact,original,'005 data survives the additive permissions migration');
  const changed=await edit();
  assert.deepEqual(changed,{contact:{...original,...input.contact,phone:null,version:'2'},customerArchived:false,replayed:false,appliedVersion:'2'});
  assert.equal((await read(2)).contact.email,input.contact.email);
  assert.equal((await api.createContact(identity(1),create,db)).contact.version,'2','creation replay returns the current contact');
  const replay=await edit({...input,key:input.key.toUpperCase(),customerId:parent.id.toUpperCase()},1,db,original.id.toUpperCase());
  assert.equal(replay.replayed,true);assert.equal(replay.appliedVersion,'2');
  await reject(()=>edit({...input,key:randomUUID()}),409,'crmVersionConflict');
  await reject(()=>edit({...input,contact:{...input.contact,displayName:'Different'}}),409,'crmRetryConflict');
  await reject(()=>edit({...input,customerId:second.id}),409,'crmRetryConflict');
  await reject(()=>edit(input,2),403,'crmReadOnly');
  for (const person of [3,4]) {await reject(()=>edit(input,person),404);await reject(()=>read(person),404);}
  await reject(()=>edit({...input,key:randomUUID(),workspaceId:id(12),customerId:other.id},3),404);
  await reject(()=>edit({...input,key:randomUUID(),customerId:second.id}),404);
  await reject(()=>read(1,11,second.id),404);
  for (const version of [1,'0','01','-1','9223372036854775807']) await reject(()=>edit({...input,version}),400,'crmContactInvalid');
  for (const contact of [{...input.contact,displayName:''},{...input.contact,email:'bad'},
    {...input.contact,phone:'123\n456'},{...input.contact,isPrimary:false},{...input.contact,relationship:'other'}]) {
    await reject(()=>edit({...input,key:randomUUID(),contact}),400,'crmContactInvalid');
  }
  await reject(()=>edit({...input,actorId:id(3)}),400,'crmContactInvalid');
  const counts=async()=>(await pg.query(`SELECT (SELECT count(*) FROM relay_crm.audit_events)::int AS audit,
    (SELECT count(*) FROM relay_crm.request_dedup)::int AS keys`)).rows[0];
  for (const broken of [failing,failedDedup]) {
    const before=await counts();
    await assert.rejects(()=>edit({...input,key:randomUUID(),version:'2',contact:{displayName:'Rolled back',email:'',phone:'555'}},1,broken));
    assert.deepEqual(await counts(),before);
    const row=(await pg.query('SELECT display_name,email,phone,version::text FROM relay_crm.contacts WHERE id=$1',[original.id])).rows[0];
    assert.deepEqual(row,{display_name:input.contact.displayName,email:input.contact.email,phone:null,version:'2'});
  }
  await assert.rejects(()=>read(1,11,parent.id,failing));
  assert.deepEqual(await scoped(2,11,tx=>tx.query("UPDATE relay_crm.contacts SET display_name='Denied' RETURNING id")),[]);
  assert.deepEqual(await scoped(3,12,tx=>tx.query("UPDATE relay_crm.contacts SET email=NULL WHERE id=$1 RETURNING id",[original.id])),[]);
  for(const column of ['workspace_id','archived_at','created_at','email_search','phone_search']) {
    await sqlReject(()=>scoped(1,11,tx=>tx.query(`UPDATE relay_crm.contacts SET ${column}=${column} WHERE id=$1`,[original.id])));
  }
  await sqlReject(()=>scoped(1,11,tx=>tx.query('UPDATE relay_crm.customer_contacts SET is_primary=false WHERE contact_id=$1',[original.id])));
  await sqlReject(()=>scoped(1,11,tx=>tx.query('DELETE FROM relay_crm.contacts WHERE id=$1',[original.id])));
  // A shared contact has one version across customers, without changing relations.
  await pg.query(`INSERT INTO relay_crm.customer_contacts(workspace_id,customer_id,contact_id,relationship,is_primary) VALUES($1,$2,$3,'contact',false)`,[id(11),second.id,original.id]);
  const shared=await edit({...input,key:randomUUID(),customerId:second.id,version:'2',contact:{displayName:'Shared latest',email:'',phone:'+44 20 0000 0000'}});
  assert.equal(shared.contact.version,'3');assert.equal(shared.contact.isPrimary,false);
  assert.equal((await read()).contact.isPrimary,true);assert.equal((await read()).contact.displayName,'Shared latest');
  const newer=await edit();
  assert.equal(newer.appliedVersion,'2');assert.equal(newer.contact.version,'3');assert.equal(newer.contact.displayName,'Shared latest');
  assert.equal((await api.getCustomer(identity(1),id(11),parent.id,db)).version,'1');
  await api.changeCustomer(identity(1),parent.id,{workspaceId:id(11),key:randomUUID(),version:'1',action:'archive'},db);
  assert.equal((await read(2)).customerArchived,true);
  assert.equal((await edit()).replayed,true);
  await reject(()=>edit({...input,key:randomUUID(),version:'3'}),409,'crmContactEditArchived');
  await api.changeCustomer(identity(1),parent.id,{workspaceId:id(11),key:randomUUID(),version:'2',action:'restore'},db);
  for(const table of ['memberships','principals','workspaces']) {
    const sql=table==='memberships'?"UPDATE relay_crm.memberships SET status=$1 WHERE principal_id=$2":`UPDATE relay_crm.${table} SET ${table==='principals'?'disabled_at':'archived_at'}=$1 WHERE id=$2`;
    const key=table==='workspaces'?id(11):id(1);
    await pg.query(sql,[table==='memberships'?'suspended':'2026-09-17T00:00:00Z',key]);
    await reject(()=>edit(),404);await reject(()=>read(),404);
    await pg.query(sql,[table==='memberships'?'active':null,key]);
  }
  await pg.query(`UPDATE relay_crm.request_dedup SET created_at=now()-interval '9 days',expires_at=now()-interval '1 day' WHERE operation='contact.edit' AND key=$1`,[input.key]);
  await reject(()=>edit(),409,'crmRetryConflict');
  await pg.query('UPDATE relay_crm.contacts SET version=9007199254740993 WHERE id=$1',[original.id]);
  const precise=await edit({...input,key:randomUUID(),version:'9007199254740993'});
  assert.equal(precise.contact.version,'9007199254740994');
  const audits=(await pg.query("SELECT changes FROM relay_crm.audit_events WHERE entity_type='contact' AND action='edit' AND entity_id=$1 ORDER BY created_at",[original.id])).rows;
  assert.deepEqual(audits[0].changes,{customerId:parent.id,fields:['displayName','email','phone'],fromVersion:'1',toVersion:'2'});
  for(const pii of ['Before contact edit','After contact edit','Shared latest','after@example.invalid','+44 20']) assert.ok(!JSON.stringify(audits).includes(pii));
  const route='crm-contact&id='+original.id, body={...input,key:randomUUID(),version:precise.contact.version};
  assert.equal((await call(request(route,'PATCH',body,{origin:'https://evil.test'}))).status,403);
  assert.equal((await call(request(route,'PATCH',{...body,contact:{...body.contact,isPrimary:false}}))).status,400);
  assert.equal((await call(request(route,'PATCH',body))).status,200);
  assert.equal((await call(request(route,'PATCH',body))).status,200);
  assert.equal((await call(request(route+'&workspaceId='+id(11)+'&customerId='+parent.id))).status,200);
  assert.equal((await call(request(route,'POST',body))).status,405);
  assert.equal((await call(new Request('https://relay.test/api/relay?route='+route,{method:'PATCH',body:JSON.stringify(body)}))).status,401);
  assert.equal((await call(new Request('https://relay.test/api/relay?route='+route+'&workspaceId='+id(11)+'&customerId='+parent.id))).status,401);
  await pg.query('UPDATE relay_crm.contacts SET archived_at=now() WHERE id=$1',[original.id]);
  await reject(()=>read(),404);
  await reject(()=>edit(body),404);
  assert.deepEqual(await scoped(1,11,tx=>tx.query("UPDATE relay_crm.contacts SET display_name='Denied' WHERE id=$1 RETURNING id",[original.id])),[]);
  console.log('Contact editing: upgrade, field allowlist, bigint versions, scoped reads, shared-contact conflicts, current-state replay, revocation, archive restrictions, atomic rollback, audit privacy and HTTP passed.');
}
