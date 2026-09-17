import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

export async function verifyContactEditPostgres({api,admin,db,identity,workspace,person,customerId,contactId,pause}) {
  const customerInput={workspaceId:workspace,key:randomUUID(),customer:{displayName:'Synthetic editing parent',kind:'organization'}};
  const second=(await api.createCustomer(identity,customerInput,db)).customer;
  await admin`INSERT INTO relay_crm.customer_contacts(workspace_id,customer_id,contact_id,relationship) VALUES(${workspace},${second.id},${contactId},'contact')`;
  const input={workspaceId:workspace,customerId,key:randomUUID(),version:'1',contact:{displayName:'Concurrent edited contact',email:'edited@example.invalid',phone:''}};
  const edits=await Promise.allSettled([
    api.editContact(identity,contactId,input,db),
    api.editContact(identity,contactId,{...input,customerId:second.id,key:randomUUID(),contact:{...input.contact,displayName:'Other concurrent edit'}},db),
  ]);
  assert.equal(edits.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(edits.find(r=>r.status==='rejected').reason.code,'crmVersionConflict','one contact version spans both customer relationships');
  const retry={...input,key:randomUUID(),version:'2'};
  const retries=await Promise.all(Array.from({length:4},(_,n)=>api.editContact(identity,n%2?contactId.toUpperCase():contactId,n%2?{...retry,key:retry.key.toUpperCase(),customerId:customerId.toUpperCase()}:retry,db)));
  assert.equal(retries.filter(r=>!r.replayed).length,1);
  assert.ok(retries.every(r=>r.contact.version==='3'&&r.appliedVersion==='3'));
  assert.equal((await admin`SELECT count(*)::int AS n FROM relay_crm.audit_events WHERE entity_type='contact' AND entity_id=${contactId} AND action='edit'`)[0].n,2);
  for (const first of ['edit','archive']) {
    const parent=(await api.createCustomer(identity,{...customerInput,key:randomUUID()},db)).customer;
    const contact=(await api.createContact(identity,{workspaceId:workspace,customerId:parent.id,key:randomUUID(),contact:{...input.contact,relationship:'contact',isPrimary:false}},db)).contact;
    const attempt={...input,customerId:parent.id,key:randomUUID()};
    const archive={workspaceId:workspace,key:randomUUID(),version:'1',action:'archive'};
    let release,entered;
    const gate=new Promise(resolve=>{release=resolve;}),locked=new Promise(resolve=>{entered=resolve;});
    const paused={transaction:work=>db.transaction(tx=>work({...tx,query:async(text,values)=>{
      const rows=await tx.query(text,values);
      if(text.includes('FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2 FOR UPDATE')){entered();await gate;}
      return rows;
    }}))};
    const leading=first==='edit'?api.editContact(identity,contact.id,attempt,paused):api.changeCustomer(identity,parent.id,archive,paused);
    await locked;
    let settled=false;
    const following=(first==='edit'?api.changeCustomer(identity,parent.id,archive,db):api.editContact(identity,contact.id,attempt,db))
      .then(value=>{settled=true;return {value};},error=>{settled=true;return {error};});
    await pause(100);assert.equal(settled,false);release();await leading;
    const result=await following;
    if(first==='edit') {
      assert.ok(result.value.customer.archivedAt);
      const replay=await api.editContact(identity,contact.id,attempt,db);
      assert.equal(replay.replayed,true);assert.equal(replay.customerArchived,true);assert.equal(replay.contact.version,'2');
    } else {
      assert.equal(result.error.code,'crmContactEditArchived');
      assert.equal((await api.getContact(identity,workspace,parent.id,contact.id,db)).contact.version,'1');
    }
  }
  // Membership changes cannot race past an edit that already holds authorization.
  let release,entered;
  const gate=new Promise(resolve=>{release=resolve;}),locked=new Promise(resolve=>{entered=resolve;});
  const paused={transaction:work=>db.transaction(tx=>work({...tx,query:async(text,values)=>{
    const rows=await tx.query(text,values);
    if(text.includes("set_config('relay.workspace_id', $1")){entered();await gate;}
    return rows;
  }}))};
  const save=api.editContact(identity,contactId,{...input,key:randomUUID(),version:'3'},paused);
  await locked;
  let suspended=false;
  const stop=admin`UPDATE relay_crm.memberships SET status='suspended' WHERE workspace_id=${workspace} AND principal_id=${person}`.then(()=>{suspended=true;});
  await pause(100);assert.equal(suspended,false);release();await save;await stop;
  await assert.rejects(()=>api.editContact(identity,contactId,retry,db),e=>e.status===404);
  await assert.rejects(()=>api.getContact(identity,workspace,customerId,contactId,db),e=>e.status===404);
  await admin`UPDATE relay_crm.memberships SET status='active' WHERE principal_id=${person}`;
  let finishStop,started;
  const stoppingGate=new Promise(resolve=>{finishStop=resolve;}),stoppingStarted=new Promise(resolve=>{started=resolve;});
  const stopping=admin.begin(async tx=>{
    await tx`UPDATE relay_crm.memberships SET status='suspended' WHERE principal_id=${person}`;
    started();await stoppingGate;
  });
  await stoppingStarted;
  const denied=assert.rejects(()=>api.editContact(identity,contactId,{...input,key:randomUUID(),version:'4'},db),e=>e.status===404);
  await pause(100);finishStop();await stopping;await denied;
  await admin`UPDATE relay_crm.memberships SET status='active' WHERE principal_id=${person}`;
  assert.equal((await api.getContact(identity,workspace,customerId,contactId,db)).contact.version,'4');
  console.log('PostgreSQL contact editing: shared-contact version race, four same-key retries, both archive/edit orders and both membership-revocation orders passed.');
}
