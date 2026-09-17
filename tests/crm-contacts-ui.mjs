import assert from 'node:assert/strict';

export async function verifyContactsUi({mount,screen,user,waitFor,cleanup,act,t,workspace,customer}) {
  let contacts=[],posts=[],mode='lost',listFailure=true,viewer=false,archived=false,paginate=false;
  const saved=new Map();
  const fixture=async(path,options)=>{
    if(path.endsWith('workspaces'))return Response.json([{...workspace,role:viewer?'viewer':'editor'}]);
    if(path==='/api/crm/contacts') {
      const body=JSON.parse(options.body);posts.push(body);
      if(mode==='primary')return Response.json({error:'crmPrimaryConflict'},{status:409});
      if(mode==='archive')return Response.json({error:'crmContactArchived'},{status:409});
      if(mode==='denied')return Response.json({error:'crmReadOnly'},{status:403});
      if(saved.has(body.key))return Response.json({contact:saved.get(body.key),replayed:true});
      const contact={...body.contact,id:'00000000-0000-4000-8000-'+String(71+contacts.length).padStart(12,'0'),email:body.contact.email||null,phone:body.contact.phone||null};
      contacts.push(contact);saved.set(body.key,contact);
      if(mode==='lost'){mode='saved';throw Error('lost after commit');}
      return Response.json({contact,replayed:false});
    }
    if(path.includes('/contacts?')) {
      if(listFailure)return Response.json({error:'crmUnavailable'},{status:503});
      return Response.json(paginate ? {contacts:path.includes('cursor=contact-next')?contacts.slice(1):contacts.slice(0,1),nextCursor:path.includes('cursor=contact-next')?null:'contact-next'} : {contacts,nextCursor:null});
    }
    const current={...customer,archivedAt:archived?'2026-09-17T00:00:00Z':null};
    if(path.startsWith('/api/crm/customers/'))return Response.json(current);
    return Response.json({customers:[current],nextCursor:null});
  };
  const open=async()=>{
    globalThis.fetch=fixture;mount();
    await user.click(await screen.findByRole('button',{name:t('crmDetails')}));
    await screen.findByRole('button',{name:t('crmLoadContacts')});
  };
  const add=async(name)=>{
    await user.click(screen.getByRole('button',{name:t('crmAddContact')}));
    await user.type(screen.getByLabelText(t('crmContactName')),name);
  };
  await open();
  await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
  await screen.findByText(t('crmUnavailable'));
  assert.equal(screen.queryByText(t('crmNoContacts')),null,'failed read cannot look like an empty contact list');
  listFailure=false;
  await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
  await screen.findByText(t('crmNoContacts'));
  await add('Synthetic private contact');
  await user.type(screen.getByLabelText(t('crmContactEmail')),'synthetic@example.invalid');
  await user.type(screen.getByLabelText(t('crmContactPhone')),'+81 3 1234 5678');
  assert.equal(screen.getByRole('button',{name:t('crmEdit')}).disabled,true);
  assert.equal(screen.getByLabelText(t('crmSearchName')).disabled,true);
  assert.equal(screen.getByLabelText(t('crmWorkspace')).disabled,true);
  await user.click(screen.getByRole('button',{name:t('crmSaveContact')}));
  await screen.findByText(t('crmFailure'));
  assert.equal(screen.getByLabelText(t('crmContactName')).value,'Synthetic private contact');
  assert.equal(screen.getByLabelText(t('crmContactEmail')).disabled,true);
  assert.equal(screen.getByRole('button',{name:t('crmCancelEdit')}).disabled,true);
  listFailure=true;
  await user.click(screen.getByRole('button',{name:t('crmRetry')}));
  await screen.findByText(t('crmContactSaved',{name:'Synthetic private contact'}));
  await screen.findByText(t('crmUnavailable'));
  assert.deepEqual(posts[0],posts[1]);assert.equal(contacts.length,1);
  assert.equal(screen.queryByLabelText(t('crmContactName')),null);
  listFailure=false;
  await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
  await screen.findByRole('heading',{name:'Synthetic private contact'});
  await add('Retained primary draft');
  await user.selectOptions(screen.getByLabelText(t('crmContactPriority')),'primary');
  mode='primary';
  await user.click(screen.getByRole('button',{name:t('crmSaveContact')}));
  await screen.findByText(t('crmPrimaryConflict'));
  assert.equal(screen.getByLabelText(t('crmContactName')).value,'Retained primary draft');
  assert.equal(screen.getByLabelText(t('crmContactPriority')).disabled,false);
  const rejectedKey=posts.at(-1).key;
  await user.selectOptions(screen.getByLabelText(t('crmContactPriority')),'standard');
  mode='saved';
  await user.click(screen.getByRole('button',{name:t('crmSaveContact')}));
  await screen.findByText(t('crmContactSaved',{name:'Retained primary draft'}));
  assert.notEqual(posts.at(-1).key,rejectedKey);
  assert.equal(posts.at(-1).contact.isPrimary,false);
  paginate=true;
  await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
  await screen.findByRole('button',{name:t('crmMoreContacts')});
  await add('Concurrent archive draft');
  await user.click(screen.getByRole('button',{name:t('crmMoreContacts')}));
  await screen.findByRole('heading',{name:'Retained primary draft'});
  assert.equal(screen.getByLabelText(t('crmContactName')).value,'Concurrent archive draft');
  assert.equal(screen.queryByRole('heading',{name:'Synthetic private contact'}),null);
  paginate=false;mode='archive';
  await user.click(screen.getByRole('button',{name:t('crmSaveContact')}));
  await screen.findByText(t('crmContactArchived'));
  assert.equal(screen.getByLabelText(t('crmContactName')).value,'Concurrent archive draft');
  assert.equal(screen.getByRole('button',{name:t('crmSaveContact')}).disabled,true);
  await user.click(screen.getByRole('button',{name:t('crmCancelEdit')}));
  await add('Must disappear on access loss');mode='denied';
  await user.click(screen.getByRole('button',{name:t('crmSaveContact')}));
  await screen.findByText(t('crmReadOnly'));
  assert.equal(screen.queryByRole('heading',{name:'Synthetic private contact'}),null);
  assert.equal(screen.queryByLabelText(t('crmContactName')),null);
  cleanup();
  viewer=true;archived=true;await open();
  assert.equal(screen.queryByRole('button',{name:t('crmAddContact')}),null);
  await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
  await screen.findByRole('heading',{name:'Synthetic private contact'});
  // Late contact reads must not restore private data after identity invalidation.
  let finish;
  globalThis.fetch=async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{finish=resolve;})});
  await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
  await waitFor(()=>assert.ok(finish));
  await act(async()=>{window.dispatchEvent(new Event('relay-session-invalidated'));finish({contacts,nextCursor:null});});
  assert.equal(screen.queryByRole('heading',{name:'Synthetic private contact'}),null);
  assert.ok(!document.body.textContent.includes('synthetic@example.invalid'));
  assert.equal(localStorage.length,0);assert.equal(window.sessionStorage.length,0);
  cleanup();
  console.log('Contact UI: optional fields, save retry identity, atomic failure states, primary conflict, archive conflict, locks, viewer history, access loss and late-response cleanup passed.');
}
