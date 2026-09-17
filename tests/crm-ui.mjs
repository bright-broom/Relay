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
const {render,screen,waitFor,cleanup,act} = await import('@testing-library/react');
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
console.log('CRM UI: guest isolation, creation/retry identity, draft retention, viewer mode, empty/error states and late-response session cleanup passed (simulated DOM).');
