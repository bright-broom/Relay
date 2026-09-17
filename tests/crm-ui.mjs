import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
// Isolated component DOM, fixture APIs only. No browser or app URL is accessed.
const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://relay.test/",
  pretendToBeVisual: true,
});
for (const key of [
  "window",
  "document",
  "navigator",
  "location",
  "history",
  "localStorage",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "Element",
  "Node",
  "NodeFilter",
  "Event",
  "MouseEvent",
  "CustomEvent",
  "MutationObserver",
  "DocumentFragment",
  "getComputedStyle",
])
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value:
      key === "getComputedStyle"
        ? dom.window.getComputedStyle.bind(dom.window)
        : dom.window[key],
  });
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(
  dom.window,
);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(
  dom.window,
);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.scrollTo=()=>{};
window.matchMedia = () => ({
  matches: false,
  addEventListener() {},
  removeEventListener() {},
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
await mkdir('.vercel/check-crm-ui',{recursive:true});
await build({stdin:{contents:`export * from './src/app/customers';export * from './src/i18n/context';export * from './src/components/ui/tooltip';`,resolveDir:process.cwd()},bundle:true,packages:'external',platform:'node',format:'esm',outfile:'.vercel/check-crm-ui/index.mjs'});
const api = await import(pathToFileURL(process.cwd()+'/.vercel/check-crm-ui/index.mjs'));
const {createElement} = await import('react');
const {render,screen,waitFor,cleanup,act,within} = await import('@testing-library/react');
const {default:userEvent} = await import('@testing-library/user-event');
const user = userEvent.setup({document});
const ui = api.createUiContext('en'), {t} = ui;
const root = document.createElement('div'); root.id='app'; document.body.append(root);
const mount = () => render(createElement(api.TooltipProvider,null,createElement(api.Customers,{ui})));
const workspace = {id:'00000000-0000-4000-8000-000000000011',name:'Synthetic workspace',role:'editor'};
const customer = {id:'00000000-0000-4000-8000-000000000021',displayName:'Synthetic Customer',kind:'organization',status:'prospect',version:'1',updatedAt:'2026-09-17T00:00:00.000000Z'};
let calls=[];
globalThis.fetch = async (path,options)=>{calls.push([path,options]);throw Error('No private calls expected');};
root.dataset.publicPreview='true';
mount();
assert.ok(screen.getByRole('link',{name:t('googleSignIn')}));
assert.equal(calls.length,0);
cleanup(); root.dataset.publicPreview='false';

let posts=[], failSave=true, listing=[];
globalThis.fetch = async (path,options)=>{
  calls.push([path,options]);
  assert.equal(options.cache,'no-store'); assert.equal(options.credentials,'same-origin');
  if(path==='/api/crm/workspaces') return Response.json([workspace]);
  if(options.method==='POST'){
    posts.push(JSON.parse(options.body));
    if(failSave){failSave=false; throw Error('synthetic lost response');}
    listing=[customer]; return Response.json({customer,replayed:true});
  }
  if(path.startsWith('/api/crm/customers/')) return Response.json(customer);
  return Response.json({customers:listing,nextCursor:null});
};
mount();
await screen.findByText(t('crmEmpty'));
await user.type(screen.getByLabelText(t('crmName')),'Synthetic Customer');
await user.click(screen.getByRole('button',{name:t('crmCreate')}));
await screen.findByText(t('crmFailure'));
assert.equal(screen.getByLabelText(t('crmName')).value,'Synthetic Customer');
assert.equal(screen.getByLabelText(t('crmName')).disabled,true);
assert.ok(!screen.queryByText(t('crmSaved')));
await user.click(screen.getByRole('button',{name:t('crmRetry')}));
await screen.findByText(t('crmSaved'));
assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);
assert.equal(screen.getByLabelText(t('crmName')).value,'');
assert.equal(localStorage.length,0,'CRM data must not enter local storage');
assert.equal(window.sessionStorage.length,0);
await user.click(screen.getByRole('button',{name:t('crmDetails')}));
await screen.findByRole('heading',{name:customer.displayName});
await act(async()=>window.dispatchEvent(new Event('relay-session-invalidated')));
assert.equal(screen.queryByText(customer.displayName),null);
assert.equal(screen.queryByLabelText(t('crmName')),null);
assert.ok(screen.getByRole('link',{name:t('googleSignIn')}));
cleanup();

globalThis.fetch = async path=>Response.json(path.endsWith('workspaces')?[{...workspace,role:'viewer'}]:{customers:[],nextCursor:null});
mount(); await screen.findByText(t('crmReadOnly'));
assert.equal(screen.queryByRole('button',{name:t('crmCreate')}),null);
cleanup();

// Editing, uncertain-save retries, conflict review, archive cancellation and restoration.
let record={...customer,archivedAt:null}, losePatch=true, patches=[], savedPatches=new Map();
globalThis.fetch=async(path,options)=>{
  if(path.endsWith('workspaces')) return Response.json([workspace]);
  if(options.method==='PATCH'){
    const body=JSON.parse(options.body); patches.push(body);
    if(savedPatches.has(body.key))return Response.json({customer:record,replayed:true,appliedVersion:savedPatches.get(body.key)});
    if(body.version!==record.version)return Response.json({error:'crmVersionConflict'},{status:409});
    record={...record,...(body.customer??{}),version:String(BigInt(record.version)+1n),archivedAt:body.action==='archive'?'2026-09-17T01:00:00Z':body.action==='restore'?null:record.archivedAt};
    savedPatches.set(body.key,record.version);
    if(losePatch){losePatch=false;throw Error('lost response after commit');}
    return Response.json({customer:record,replayed:false,appliedVersion:record.version});
  }
  if(path.startsWith('/api/crm/customers/'))return Response.json(record);
  const archived=new URL(path,'https://relay.test').searchParams.get('archived')==='true';
  return Response.json({customers:archived===!!record.archivedAt?[record]:[],nextCursor:null});
};
mount();await screen.findByRole('button',{name:t('crmDetails')});
await user.click(screen.getByRole('button',{name:t('crmDetails')}));
await user.click(await screen.findByRole('button',{name:t('crmEdit')}));
await user.clear(screen.getByLabelText(t('crmEditName')));
await user.type(screen.getByLabelText(t('crmEditName')),'Edited synthetic customer');
assert.equal(screen.getByRole('button',{name:t('refreshConnections')}).disabled,true);
await user.click(screen.getByRole('button',{name:t('crmSaveChanges')}));
await screen.findByText(t('crmFailure'));
assert.equal(screen.getByLabelText(t('crmEditName')).disabled,true);
assert.equal(screen.getByLabelText(t('crmEditName')).value,'Edited synthetic customer');
await user.click(screen.getByRole('button',{name:t('crmRetry')}));
await screen.findByText(t('crmUpdated'));
assert.equal(patches.length,2);assert.deepEqual(patches[0],patches[1]);assert.equal(record.version,'2');
await user.click(screen.getByRole('button',{name:t('crmEdit')}));
await user.clear(screen.getByLabelText(t('crmEditName')));
await user.type(screen.getByLabelText(t('crmEditName')),'Retain my draft');
record={...record,displayName:'Concurrent writer',version:'3'};
await user.click(screen.getByRole('button',{name:t('crmSaveChanges')}));
await screen.findByText(t('crmConflict'));
assert.equal(screen.getByLabelText(t('crmEditName')).value,'Retain my draft');
assert.equal(screen.queryByRole('button',{name:t('crmSaveChanges')}),null);
assert.equal(record.displayName,'Concurrent writer');
await user.click(await screen.findByRole('button',{name:t('crmUseLatest')}));
await screen.findByRole('heading',{name:'Concurrent writer'});
await within(screen.getByRole('region',{name:t('crmCustomers')})).findByText('Concurrent writer');
await user.click(screen.getByRole('button',{name:t('crmArchive')}));
let dialog=await screen.findByRole('alertdialog');
await user.click(within(dialog).getByRole('button',{name:t('close')}));
assert.equal(record.archivedAt,null);assert.equal(patches.length,3,'cancel must not send a mutation');
await user.click(screen.getByRole('button',{name:t('crmArchive')}));
dialog=await screen.findByRole('alertdialog');
await user.click(within(dialog).getByRole('button',{name:t('crmArchive')}));
await screen.findByText(t('crmArchiveSaved'));
assert.ok(record.archivedAt);await screen.findByText(t('crmEmpty'));
await user.selectOptions(screen.getByLabelText(t('crmListState')),'archived');
await user.click(await screen.findByRole('button',{name:t('crmDetails')}));
await user.click(await screen.findByRole('button',{name:t('crmRestore')}));
await screen.findByText(t('crmRestoreSaved'));assert.equal(record.archivedAt,null);
assert.equal(localStorage.length,0);assert.equal(window.sessionStorage.length,0);
// A permission change clears draft, selected record and list together.
await user.click(screen.getByRole('button',{name:t('crmEdit')}));
globalThis.fetch=async()=>Response.json({error:'crmReadOnly'},{status:403});
await user.click(screen.getByRole('button',{name:t('crmSaveChanges')}));
await screen.findByText(t('crmReadOnly'));
assert.equal(screen.queryByLabelText(t('crmEditName')),null);
assert.equal(screen.queryByText(record.displayName),null);
cleanup();

// A late body must not repopulate private records after session invalidation.
let resolveBody;
globalThis.fetch = async path=>path.endsWith('workspaces') ? Response.json([workspace]) : {ok:true,status:200,json:()=>new Promise(resolve=>{resolveBody=resolve;})};
mount();await waitFor(()=>assert.ok(resolveBody));
await act(async()=>{
  window.dispatchEvent(new Event('relay-session-invalidated'));
  resolveBody({customers:[customer],nextCursor:null});
});
assert.equal(screen.queryByText(customer.displayName),null);
cleanup();

globalThis.fetch = async ()=>Response.json({error:'crmUnavailable'},{status:503});
mount(); await screen.findByText(t('crmUnavailable'));
assert.equal(screen.queryByText(t('crmEmpty')),null,'unavailable is not an empty CRM');
cleanup();
globalThis.fetch = async ()=>Response.json([]);
mount(); await screen.findByText(t('crmNoWorkspace')); cleanup();
console.log('CRM UI: guest isolation, creation/edit retry identity, retained conflict input, archive/restore, permission loss, viewer mode, empty/error states and late-response session cleanup passed (simulated DOM).');
