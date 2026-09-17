import assert from 'node:assert/strict';

export async function verifyContactEditUi({mount,screen,user,waitFor,cleanup,act,t,workspace,customer}) {
  let contact={id:'00000000-0000-4000-8000-000000000091',displayName:'Synthetic contact',email:'original@example.invalid',phone:'+81 3 0000 0000',relationship:'billing',isPrimary:true,version:'1'};
  let archived=false,viewer=false,denied=false,lose=true,failList=false,failLatest=false,patches=[];
  const saved=new Map();
  const fixture=async(path,options)=>{
    if(path.endsWith('workspaces'))return Response.json([{...workspace,role:viewer?'viewer':'editor'}]);
    if(path.startsWith('/api/crm/contacts/')) {
      if(options.method==='PATCH') {
        const body=JSON.parse(options.body);patches.push(body);
        if(denied)return Response.json({error:'crmReadOnly'},{status:403});
        if(saved.has(body.key))return Response.json({contact,customerArchived:archived,replayed:true,appliedVersion:saved.get(body.key)});
        if(archived)return Response.json({error:'crmContactEditArchived'},{status:409});
        if(body.version!==contact.version)return Response.json({error:'crmVersionConflict'},{status:409});
        contact={...contact,...body.contact,email:body.contact.email||null,phone:body.contact.phone||null,version:String(BigInt(contact.version)+1n)};
        saved.set(body.key,contact.version);
        if(lose){lose=false;throw Error('Lost committed response');}
        return Response.json({contact,customerArchived:false,replayed:false,appliedVersion:contact.version});
      }
      return failLatest?Response.json({error:'crmUnavailable'},{status:503}):Response.json({contact,customerArchived:archived});
    }
    if(path.includes('/contacts?'))return failList?Response.json({error:'crmUnavailable'},{status:503}):Response.json({contacts:[contact],nextCursor:null});
    if(path.startsWith('/api/crm/customers/'))return Response.json({...customer,archivedAt:archived?'2026-09-17T00:00:00Z':null});
    return Response.json({customers:[customer],nextCursor:null});
  };
  const open=async()=>{
    globalThis.fetch=fixture;mount();
    await user.click(await screen.findByRole('button',{name:t('crmDetails')}));
    await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
    await screen.findByRole('heading',{name:contact.displayName});
  };
  const edit=async()=>{
    await user.click(screen.getByRole('button',{name:t('crmEditContact')}));
    await screen.findByLabelText(t('crmContactName'));
  };
  await open();await edit();
  assert.equal(screen.getByRole('button',{name:t('crmEdit')}).disabled,true);
  assert.equal(screen.getByRole('button',{name:t('crmAddContact')}).disabled,true);
  assert.equal(screen.getByLabelText(t('crmWorkspace')).disabled,true);
  assert.equal(screen.queryByLabelText(t('crmContactPriority')),null);
  await user.clear(screen.getByLabelText(t('crmContactName')));
  await user.type(screen.getByLabelText(t('crmContactName')),'Edited private contact');
  await user.clear(screen.getByLabelText(t('crmContactEmail')));
  await user.clear(screen.getByLabelText(t('crmContactPhone')));
  await user.click(screen.getByRole('button',{name:t('crmSaveContactChanges')}));
  await screen.findByText(t('crmFailure'));
  assert.equal(screen.getByLabelText(t('crmContactName')).value,'Edited private contact');
  assert.equal(screen.getByLabelText(t('crmContactName')).disabled,true);
  assert.equal(screen.getByRole('button',{name:t('crmCancelEdit')}).disabled,true);
  failList=true;
  await user.click(screen.getByRole('button',{name:t('crmRetry')}));
  await screen.findByText(t('crmContactUpdated'));await screen.findByText(t('crmUnavailable'));
  assert.deepEqual(patches[0],patches[1]);assert.equal(contact.version,'2');assert.equal(contact.email,null);assert.equal(contact.phone,null);
  assert.deepEqual(Object.keys(patches[0].contact).sort(),['displayName','email','phone']);
  assert.equal(contact.isPrimary,true);assert.equal(contact.relationship,'billing');
  failList=false;
  await user.click(screen.getByRole('button',{name:t('crmLoadContacts')}));
  await edit();
  await user.clear(screen.getByLabelText(t('crmContactName')));
  await user.type(screen.getByLabelText(t('crmContactName')),'Keep my conflicting draft');
  contact={...contact,displayName:'Other editor latest',email:'newer@example.invalid',phone:'555 0100',version:'3'};
  failLatest=true;
  await user.click(screen.getByRole('button',{name:t('crmSaveContactChanges')}));
  await screen.findByText(t('crmContactConflict'));await screen.findByText(t('crmUnavailable'));
  assert.equal(screen.getByLabelText(t('crmContactName')).value,'Keep my conflicting draft');
  assert.equal(screen.getByRole('button',{name:t('crmSaveContactChanges')}).disabled,true);
  failLatest=false;
  await user.click(screen.getByRole('button',{name:t('crmLoadLatest')}));
  await screen.findByText('Other editor latest');
  assert.equal(screen.getByLabelText(t('crmContactEmail')).value,'');
  await user.click(screen.getByRole('button',{name:t('crmUseLatest')}));
  assert.equal(screen.getByLabelText(t('crmContactName')).value,'Other editor latest');
  assert.equal(screen.getByLabelText(t('crmContactEmail')).value,'newer@example.invalid');
  assert.ok(screen.getByRole('heading',{name:'Other editor latest'}),'review refreshes the displayed list record');
  await user.clear(screen.getByLabelText(t('crmContactPhone')));
  await user.type(screen.getByLabelText(t('crmContactPhone')),'555 0111');
  await user.click(screen.getByRole('button',{name:t('crmSaveContactChanges')}));
  await screen.findByText(t('crmContactUpdated'));
  assert.equal(patches.at(-1).version,'3');assert.equal(contact.version,'4');
  // Replaying a committed edit must display, not overwrite, a later change.
  await edit();lose=true;
  await user.click(screen.getByRole('button',{name:t('crmSaveContactChanges')}));
  await screen.findByText(t('crmFailure'));
  contact={...contact,displayName:'Later change after save',version:'6'};
  await user.click(screen.getByRole('button',{name:t('crmRetry')}));
  await screen.findByText(t('crmContactReplayedNewer'));
  await screen.findByRole('heading',{name:'Later change after save'});
  assert.equal(contact.version,'6');
  await edit();archived=true;
  await user.click(screen.getByRole('button',{name:t('crmSaveContactChanges')}));
  await screen.findByText(t('crmContactConflict'));await screen.findByText(t('crmContactEditArchived'));
  await user.click(screen.getByRole('button',{name:t('crmUseLatest')}));
  assert.equal(screen.getByRole('button',{name:t('crmSaveContactChanges')}).disabled,true);
  await user.click(screen.getByRole('button',{name:t('crmCancelEdit')}));
  cleanup();archived=false;
  await open();await edit();denied=true;
  await user.click(screen.getByRole('button',{name:t('crmSaveContactChanges')}));
  await screen.findByText(t('crmReadOnly'));
  assert.equal(screen.queryByLabelText(t('crmContactName')),null);
  assert.ok(!document.body.textContent.includes('newer@example.invalid'));
  cleanup();denied=false;viewer=true;await open();
  assert.equal(screen.queryByRole('button',{name:t('crmEditContact')}),null);
  cleanup();viewer=false;await open();await edit();
  let finish;
  globalThis.fetch=async()=>({ok:true,status:200,json:()=>new Promise(resolve=>{finish=resolve;})});
  await user.click(screen.getByRole('button',{name:t('crmSaveContactChanges')}));
  await waitFor(()=>assert.ok(finish));
  await act(async()=>{
    window.dispatchEvent(new Event('relay-session-invalidated'));
    finish({contact,customerArchived:false,replayed:false,appliedVersion:contact.version});
  });
  assert.equal(screen.queryByLabelText(t('crmContactName')),null);
  assert.ok(!document.body.textContent.includes('Later change after save'));
  assert.equal(localStorage.length,0);assert.equal(window.sessionStorage.length,0);
  cleanup();
  console.log('Contact edit UI: locked context, uncertain-save retry, list failure after save, retained conflict draft, latest-read recovery, explicit review, newer replay, archived/viewer restrictions and private-state cleanup passed.');
}
