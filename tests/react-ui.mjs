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
await mkdir(".vercel/check-react", { recursive: true });
await build({
  stdin: {
    contents: `export * from './src/app/feature-boundary';export * from './src/app/app';export * from './src/app/root';export * from './src/app/admin';export * from './src/app/store';export * from './src/app/scheduling';export * from './src/app/pricing-results';export * from './src/pricing/comparison';export * from './src/app/my-page';export * from './src/i18n/context';export * from './src/components/ui/tooltip';`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
  outfile: ".vercel/check-react/index.mjs",
});
const api = await import(
  pathToFileURL(process.cwd() + "/.vercel/check-react/index.mjs")
);
const { createElement, lazy, useEffect } = await import("react");
const { render, screen, fireEvent, waitFor, cleanup, within, act } =
  await import("@testing-library/react");
const { default: userEvent } = await import("@testing-library/user-event");
const user = userEvent.setup({ document });
const ui = api.createUiContext("en"),
  { t } = ui;
const memory = new Map();
const storage = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
};
const workspace = api.createWorkspace(storage, "en", true, "#case/1");
render(createElement(api.App, { workspace }));
await user.selectOptions(
  screen.getByLabelText(t("recordMethod")),
  "channelPhone",
);
await user.selectOptions(
  screen.getByLabelText(t("recordOutcome")),
  "resultAgreed",
);
await user.click(
  screen.getByRole("button", { name: t("saveRecord"), exact: true }),
);
assert.equal(workspace.getSnapshot().cases[0].status, "doing");
assert.equal(workspace.getSnapshot().cases[0].notes.length, 1);
assert.ok(memory.size > 0);
const pricingTrigger = screen.getByRole("button", {
  name: t("pricing"),
  exact: true,
});
await user.click(pricingTrigger);
let dialog = screen.getByRole("dialog", { name: t("pricing") });
assert.equal(dialog.dataset.slot, "dialog-content");
const field = (label) => within(dialog).getByLabelText(t(label));
const input = (label, value) =>
  fireEvent.change(field(label), { target: { value } });
await within(dialog).findByLabelText(t("pricingCurrent"));
assert.equal(field("pricingCurrent").value, "");
assert.equal(
  within(dialog).getByRole("button", { name: t("pricingPresent") }).disabled,
  true,
);
input("pricingCurrent", "20000");
input("pricingRunning", "8000");
await user.click(
  within(dialog).getByRole("button", {
    name: t("amountZeroFor", { field: t("pricingUpfront") }),
  }),
);
await user.click(
  within(dialog).getByRole("button", {
    name: t("pricingPayment"),
    exact: true,
  }),
);
const term = field("pricingTerm");
await user.selectOptions(
  term,
  within(term).getByRole("option", {
    name: t("pricingMonths", { count: 60 }),
    exact: true,
  }),
);
assert.equal(
  field("pricingPayment").value,
  "",
  "Unknown installment amount stays empty",
);
input("pricingPayment", "5000");
await user.selectOptions(
  term,
  within(term).getByRole("option", {
    name: t("pricingNoPayment"),
    exact: true,
  }),
);
assert.equal(within(dialog).queryByLabelText(t("pricingPayment")), null);
await user.selectOptions(
  term,
  within(term).getByRole("option", {
    name: t("pricingMonths", { count: 60 }),
    exact: true,
  }),
);
assert.equal(field("pricingPayment").value, "5000");
await user.selectOptions(field("pricingSource"), "quote");
input("sourceDate", "2026-09-13");
await user.click(field("pricingConfirm"));
assert.equal(
  within(dialog).getByRole("button", { name: t("pricingPresent") }).disabled,
  false,
);
input("pricingCurrent", "");
assert.equal(
  within(dialog).getByRole("button", { name: t("pricingPresent") }).disabled,
  true,
);
assert.equal(field("pricingConfirm").getAttribute("data-state"), "unchecked");
input("pricingCurrent", "20000");
await user.click(field("pricingConfirm"));
await user.click(within(dialog).getByRole('button',{name:t('pricingAssumptions')}));
document.querySelector('.dialog-body').scrollTop = 600;
await user.click(
  within(dialog).getByRole("button", { name: t("pricingPresent") }),
);
assert.ok(document.querySelector(".app.pricing-presenting"));
assert.equal(document.activeElement.id,'price-monthly-title','Presenting starts at the monthly comparison');
assert.equal(document.querySelector('.dialog-body').scrollTop,0);
assert.equal(within(dialog).getByRole('button',{name:t('pricingAssumptions')}).getAttribute('aria-expanded'),'false','Presentation initially hides detailed formulas');
assert.ok(within(dialog).getByRole('heading',{name:t('pricingConditionsHeading')}));
await user.click(
  within(dialog).getByRole("button", { name: t("pricingEdit") }),
);
assert.equal(field("pricingCurrent").value, "20000");
await user.keyboard("{Escape}");
await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
assert.equal(document.activeElement, pricingTrigger);
await user.click(pricingTrigger);
dialog = screen.getByRole("dialog");
assert.equal(field("pricingCurrent").value, "");
await user.keyboard("{Escape}");
await user.click(
  screen.getByRole("button", { name: t("language"), exact: true }),
);
await user.selectOptions(
  screen.getByRole("combobox", { name: t("language") }),
  "ar",
);
await user.click(
  within(screen.getByRole("dialog")).getAllByRole("button", {
    name: t("applyLanguage"),
  })[0],
);
await waitFor(() => assert.equal(document.documentElement.dir, "rtl"));
assert.equal(workspace.getSnapshot().locale, "ar");
cleanup();
// A denied save retains the input and cannot display a successful persisted record.
const denied = api.createWorkspace(
  {
    getItem: () => null,
    setItem() {
      throw new Error("denied");
    },
  },
  "en",
  true,
  "#case/1",
);
act(() =>
  denied.edit((draft) => {
    draft.drafts[1] = {
      channel: "channelPhone",
      outcome: "resultAgreed",
      note: "retained",
      mode: "record",
    };
  }),
);
assert.equal(denied.getSnapshot().drafts[1].note, "retained");
assert.equal(denied.getSnapshot().storageError, "localFailure");
console.log(
  "React: controlled reports, shadcn Dialog/Escape/focus, checkbox evidence gate, payment draft retention, presentation reset, RTL switching and failed-storage retention passed.",
);

const calls = [];
let failFind = false;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace("/api/", "");
  const body = options.body ? JSON.parse(options.body) : undefined;
  calls.push({ path, body });
  const data =
    path === "calendar/status"
      ? { ready: true, connected: true }
      : path === "mcp/tokens"
        ? []
        : path === "schedule/propose"
          ? {
              proposals: [
                {
                  id: "fixture-slot",
                  title: body.title,
                  start: "2026-09-14T00:00:00Z",
                  end: "2026-09-14T01:00:00Z",
                  timeZone: body.timeZone,
                },
              ],
            }
          : path === "mcp/token"
            ? { token: "fixture-token", endpoint: "https://relay.test/api/mcp" }
            : {};
  return {
    ok: !(failFind && path === "schedule/propose"),
    status: failFind && path === "schedule/propose" ? 500 : 200,
    json: async () =>
      failFind && path === "schedule/propose"
        ? { error: "fixtureFailure" }
        : data,
  };
};
render(
  createElement(
    api.TooltipProvider,
    null,
    createElement(api.Scheduling, { ui, title: "Fixture appointment" }),
  ),
);
await screen.findByText(t("calendarReady"));
await user.click(screen.getByRole("button", { name: t("scheduleFind") }));
await screen.findByRole("button", { name: t("scheduleBook") });
await user.selectOptions(screen.getByLabelText(t("scheduleDuration")), "30");
assert.equal(
  screen.queryByRole("button", { name: t("scheduleBook") }),
  null,
  "Changing conditions removes stale proposals",
);
failFind = true;
await user.click(screen.getByRole("button", { name: t("scheduleFind") }));
await screen.findByText(t("scheduleFailure"));
assert.equal(screen.getByLabelText(t("scheduleDuration")).value, "30");
assert.equal(
  screen.getByRole("button", { name: t("scheduleFind") }).disabled,
  false,
);
assert.equal(
  calls.some((call) => call.path === "schedule/book"),
  false,
  "Editing must not book an event",
);
cleanup();
let failLine = false;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace("/api/", "");
  const body = options.body ? JSON.parse(options.body) : undefined;
  calls.push({ path, body });
  if (failLine && path === "line/destinations") throw new Error("fixtureFailure");
  if (!["session", "line/destinations", "line/code"].includes(path))
    throw new Error("Unexpected fixture request: " + path);
  return {
    ok: true,
    status: 200,
    json: async () =>
      path === "session"
        ? { email: "fixture@example.test", isAdmin: false, lineReady: true }
        : path === "line/destinations"
          ? []
          : { code: "fixture-code" },
  };
};
const profileWorkspace = api.createWorkspace(null, 'en', true, '#mypage');
render(createElement(api.App, { workspace: profileWorkspace }));
await screen.findByRole('heading',{name:t('myPage'),level:1});
assert.equal(screen.getByRole('link',{name:t('myPage')}).getAttribute('aria-current'),'page');
await screen.findByText("fixture@example.test");
assert.equal(calls.some(call=>call.path==='line/destinations'),false,'My page does not fetch notifications until opened');
await user.click(screen.getByRole('button',{name:t('myNotifications')}));
await user.selectOptions(
  screen.getByRole("combobox", { name: t("lineDestination") }),
  "group",
);
await user.click(screen.getByRole("button", { name: t("lineConnect") }));
await screen.findByText("fixture-code");
assert.equal(
  screen.getByRole("combobox", { name: t("lineDestination") }).value,
  "group",
);
assert.deepEqual(calls.find((call) => call.path === "line/code").body, {
  kind: "group",
});
const lineReads = calls.filter(call=>call.path==='line/destinations').length;
await user.click(screen.getByRole('button',{name:t('myNotifications')}));
assert.equal(screen.queryByRole('combobox',{name:t('lineDestination')}),null);
await user.click(screen.getByRole('button',{name:t('myNotifications')}));
assert.equal(screen.getByRole('combobox',{name:t('lineDestination')}).value,'group');
assert.ok(screen.getByText('fixture-code'));
assert.equal(calls.filter(call=>call.path==='line/destinations').length,lineReads,'Reopening keeps state without refetching');
cleanup();
failLine = true;
render(createElement(api.TooltipProvider,null,createElement(api.MyPage,{ui,onLanguage:()=>{}})));
await screen.findByText('fixture@example.test');
await user.click(screen.getByRole('button',{name:t('myNotifications')}));
await screen.findByText(t('integrationFailure'));
assert.ok(screen.getByText('fixture@example.test'));
assert.equal(screen.getByRole('button',{name:t('signOut')}).disabled,false,'Notification failures leave sign-out usable');
failLine = false;
cleanup();
// Administration never grants itself access from local state; denial removes old data.
let adminStatus = 200;
globalThis.fetch = async (url, options) => {
  assert.equal(url, '/api/admin/overview');
  assert.equal(options.cache, 'no-store');
  return {ok:adminStatus===200,status:adminStatus,json:async()=>({viewer:'admin@example.test',accounts:[{email:'member@example.test',role:'member',sessions:2}],configuration:{google:true,database:true,line:false,calendar:false}})};
};
render(createElement(api.TooltipProvider,null,createElement(api.Admin,{ui})));
await screen.findByText('member@example.test');
assert.equal(screen.getAllByText(t('adminNotConfigured'),{exact:true}).length,2);
adminStatus=403;
await user.click(screen.getByRole('button',{name:t('refreshConnections')}));
await screen.findByText(t('adminDenied'));
assert.equal(screen.queryByText('member@example.test'),null);
assert.equal(screen.queryByText('admin@example.test'),null);
adminStatus=401;
await user.click(screen.getByRole('button',{name:t('refreshConnections')}));
await screen.findByRole('link',{name:t('googleSignIn')});
assert.equal(screen.getByRole('link',{name:t('googleSignIn')}).getAttribute('href'),'/api/auth/start?destination=admin');
adminStatus=503;
await user.click(screen.getByRole('button',{name:t('refreshConnections')}));
await screen.findByText(t('adminFailure'));
assert.equal(screen.queryByText('member@example.test'),null);
cleanup();

// General pages expose the authentication gate without exposing administration data.
for (const isAdmin of [false,true]) {
  dom.reconfigure({url:'https://relay.test/'});
  adminStatus=403;
  const entryWorkspace=api.createWorkspace(null,'en',true,'#today');
  render(createElement(api.App,{workspace:entryWorkspace,isAdmin}));
  const entry=screen.getByRole('link',{name:t(isAdmin?'admin':'adminLocked')});
  assert.equal(entry.getAttribute('href'),'#admin');
  assert.equal(entry.classList.contains('nav-restricted'),!isAdmin);
  assert.notEqual(entry.getAttribute('aria-disabled'),'true','The gate must remain keyboard-accessible');
  await user.click(entry);
  await screen.findByRole('heading',{name:t('adminGateTitle')});
  assert.equal(entryWorkspace.getSnapshot().page,'admin');
  assert.ok(screen.getByText(t('adminDenied')));
  assert.equal(screen.queryByRole('heading',{name:t('adminAccounts')}),null);
  assert.equal(screen.queryByText('member@example.test'),null,'An entry or client flag cannot grant access');
  assert.equal(screen.getByRole('link',{name:t('googleSignIn')}).getAttribute('href'),'/api/auth/start?destination=admin');
  await user.click(within(screen.getByRole('region',{name:t('adminGateTitle')})).getByRole('link',{name:t('today')}));
  await waitFor(()=>assert.equal(entryWorkspace.getSnapshot().page,'today'));
  cleanup();
}
dom.reconfigure({url:'file:///fixture/index.html?origin=https://untrusted.test&next=https://untrusted.test#admin'});
let localAdminRequests=0;
globalThis.fetch=async()=>{localAdminRequests++;throw new Error('Local preview must not authenticate');};
render(createElement(api.TooltipProvider,null,createElement(api.Admin,{ui})));
await screen.findByRole('heading',{name:t('adminGateTitle')});
const publicLogin=screen.getByRole('link',{name:t('googleSignIn')});
assert.equal(publicLogin.getAttribute('href'),'https://relay-chi-ecru.vercel.app/admin?lang=en');
assert.equal(publicLogin.hasAttribute('disabled'),false);
assert.notEqual(publicLogin.getAttribute('aria-disabled'),'true');
assert.equal(publicLogin.getAttribute('rel'),'noreferrer');
assert.ok(screen.getByText(t('adminContinueOnline')));
publicLogin.focus();
assert.equal(document.activeElement,publicLogin,'The public login link is keyboard-focusable');
assert.equal(localAdminRequests,0);
cleanup();
for(const locale of ['ja','ar-EG']) {
 const localUi=api.createUiContext(locale);
 render(createElement(api.TooltipProvider,null,createElement(api.Admin,{ui:localUi})));
 const link=await screen.findByRole('link',{name:localUi.t('googleSignIn')});
 const target=new URL(link.href);
 assert.equal(target.origin,'https://relay-chi-ecru.vercel.app');
 assert.equal(target.pathname,'/admin');
 assert.deepEqual([...target.searchParams],[['lang',locale]],'Only display language is passed to the public page');
 assert.equal(localAdminRequests,0,'Local rendering must not fetch private APIs or start OAuth');
 cleanup();
}
dom.reconfigure({url:'https://relay.test/'});

// Exercise the real root lifecycle: invalidation removes already rendered data,
// and aborts a pending request so a late response cannot restore it.
let host=document.createElement('div');host.dataset.admin='true';document.body.append(host);
const adminWorkspace=api.createWorkspace(null,'en',true,'#admin');
let pendingResolve, pendingSignal, dispose;
globalThis.fetch=async()=>({ok:true,status:200,json:async()=>({viewer:'admin@example.test',accounts:[{email:'private@example.test',role:'member',sessions:1}],configuration:{google:true,database:true,line:false,calendar:false}})});
await act(async()=>{dispose=api.mountWorkspace(host,adminWorkspace);});
await screen.findByText('private@example.test');
await act(async()=>{host.dataset.sessionBlocked='true';window.dispatchEvent(new window.Event('relay-session-invalidated'));});
assert.equal(screen.queryByText('private@example.test'),null,'Already displayed admin data must be discarded');
assert.equal(host.childElementCount,0);
host.remove();
host=document.createElement('div');host.dataset.admin='true';document.body.append(host);
await act(async()=>{dispose=api.mountWorkspace(host,adminWorkspace);});
await screen.findByText('private@example.test');
globalThis.fetch=async(url,options)=>{pendingSignal=options.signal;return new Promise(resolve=>{pendingResolve=resolve;});};
await user.click(screen.getByRole('button',{name:t('refreshConnections')}));
assert.ok(pendingSignal);
await act(async()=>{host.dataset.sessionBlocked='true';window.dispatchEvent(new window.Event('relay-session-invalidated'));});
assert.equal(pendingSignal.aborted,true);
assert.equal(host.childElementCount,0);
await act(async()=>{pendingResolve({ok:true,status:200,json:async()=>({viewer:'late-private@example.test',accounts:[],configuration:{}})});});
assert.equal(host.childElementCount,0,'A stale response must not restore private data');
await act(async()=>{api.mountWorkspace(host,adminWorkspace);dispose();});
assert.equal(host.childElementCount,0,'A late bundle must not mount after session invalidation');
host.remove();
console.log(
  "React: mocked scheduling/LINE input retention and admin loading, permission loss, login and failure states passed. No external API calls.",
);

// Presentation semantics: a monthly saving must not conceal a higher total or remaining debt.
for (const locale of ['ja','en','ar-EG']) {
  const display=api.createUiContext(locale);
  const source={kind:'quote',date:'2026-09-13',reference:'Fixture-42'};
  for (const scenario of [
    {currentMonthly:'20000',proposedMonthly:'8000',upfront:'100000',installmentMonthly:'5000',installmentMonths:60,horizonMonths:12,monthly:'decrease',total:'increase'},
    {currentMonthly:'20000',proposedMonthly:'8000',upfront:'100000',installmentMonthly:'5000',installmentMonths:60,horizonMonths:120,monthly:'decrease',total:'decrease'},
    {currentMonthly:'1000',proposedMonthly:'2000',upfront:'0',installmentMonthly:'0',installmentMonths:0,horizonMonths:12,monthly:'increase',total:'increase'},
    {currentMonthly:'0',proposedMonthly:'0',upfront:'0',installmentMonthly:'0',installmentMonths:0,horizonMonths:12,monthly:'equal',total:'equal'},
    {currentMonthly:'9999999999',proposedMonthly:'9999999999',upfront:'9999999999',installmentMonthly:'9999999999',installmentMonths:420,horizonMonths:420,monthly:'increase',total:'increase'},
  ]) {
    const {monthly,total,...input}=scenario;
    const result=api.compareCosts({currency:'JPY',...input});
    const {container}=render(createElement(api.TooltipProvider,null,createElement(api.PricingResults,{ui:display,result,source})));
    assert.equal(container.querySelector('.price-option[data-phase=before] .price-amount').textContent,display.money(input.currentMonthly));
    assert.equal(container.querySelector('.price-option[data-phase=after] .price-amount').textContent,display.money(result.monthlyDuring));
    const later=container.querySelector('.price-later .price-secondary');
    assert.equal(Boolean(later),input.installmentMonths>0);
    if(later) assert.equal(later.textContent,display.money(result.monthlyAfter));
    assert.equal(container.querySelector('.price-change').dataset.direction,monthly);
    assert.equal(container.querySelector('.price-total-difference').dataset.direction,total);
    const rows=container.querySelectorAll('.price-bar-row');
    assert.equal(rows[0].querySelector('dd').textContent,display.money(result.currentTotal));
    assert.equal(rows[1].querySelector('dd').textContent,display.money(result.proposedTotal));
    const widths=[...container.querySelectorAll('.price-bar-fill')].map(el=>parseFloat(el.style.getPropertyValue('--comparison-share')));
    assert.ok(widths.every(value=>Number.isFinite(value)&&value>=0&&value<=100));
    assert.equal(Math.max(...widths),result.currentTotal==='0'&&result.proposedTotal==='0'?0:100);
    assert.equal(widths[0]>widths[1],total==='decrease','Bars use the same zero baseline and scale');
    const remaining=screen.queryByRole('complementary',{name:display.t('pricingRemaining')});
    assert.equal(Boolean(remaining),BigInt(result.remainingInstallments)>0n);
    if(remaining) assert.equal(remaining.querySelector('bdi').textContent,display.money(result.remainingInstallments));
    assert.equal(container.querySelector('.price-source').hidden,false);
    assert.ok(screen.getByText(display.t('pricingEstimate')));
    assert.ok(screen.getByText(display.t('pricingScope')));
    const disclosure=screen.getByRole('button',{name:display.t('pricingAssumptions')});
    assert.equal(disclosure.getAttribute('aria-expanded'),'false');
    await user.click(disclosure);
    assert.ok(screen.getByText(display.t('pricingFormulaAfter')));
    cleanup();
  }
}
console.log('Pricing presentation: exact amounts, independent monthly/total directions, zero and maximum amounts, residual debt, shared bar scale and localized disclosures passed (simulated DOM).');

// Anonymous visitors can use fixtures and pricing without probing private APIs.
dom.reconfigure({url:'https://relay.test/'});
let guestRequests=0;
globalThis.fetch=async()=>{guestRequests++;throw Error('Guest view must not request private APIs');};
for(const page of ['today','cases','reviews','imports','mypage','admin']) {
 const container=document.createElement('div');container.id='app';container.dataset.publicPreview='true';document.body.append(container);
 render(createElement(api.App,{workspace:api.createWorkspace(null,'en',true,'#'+page)}),{container});
 if(page==='admin') {
  await screen.findByRole('heading',{name:t('adminGateTitle')});
  assert.equal(screen.getByRole('link',{name:t('googleSignIn')}).getAttribute('href'),'/admin?lang=en');
  assert.equal(screen.queryByText('member@example.test'),null);
 } else if(page==='mypage') {
  assert.equal(screen.getByRole('link',{name:t('googleSignIn')}).getAttribute('href'),'/login?lang=en');
 } else assert.ok(screen.getByText(t('publicPreviewHint')));
 if(page==='today') {
  await user.click(screen.getByRole('button',{name:t('pricing'),exact:true}));
  assert.ok(screen.getByRole('dialog'));
 }
 assert.equal(guestRequests,0);
 cleanup();
}
console.log('Public workspace: general pages, pricing, sign-in links and no private API requests: OK.');
// A slow or failed feature must leave its surrounding navigation usable.
let finish;
let mounts=0;
const Slow=lazy(()=>new Promise(resolve=>{finish=resolve;}));
const boundary=(child,key='feature')=>createElement('div',null,
 createElement('button',null,'Synthetic navigation'),
 createElement(api.FeatureBoundary,{ui,key},child));
const slowView=render(boundary(createElement(Slow)));
assert.ok(screen.getByText(t('loading')));
assert.ok(screen.getByRole('button',{name:'Synthetic navigation'}));
// Closing the feature before its code arrives must not mount it or run API effects.
slowView.rerender(boundary(null));
await act(async()=>{finish({default:()=>{useEffect(()=>{mounts++;},[]);return createElement('p',null,'Synthetic loaded feature');}});});
assert.equal(mounts,0);
assert.equal(screen.queryByText('Synthetic loaded feature'),null);
slowView.rerender(boundary(createElement(Slow)));
await screen.findByText('Synthetic loaded feature');
assert.equal(mounts,1);
cleanup();
let fail;
const Failed=lazy(()=>new Promise((_,reject)=>{fail=reject;}));
const failedView=render(boundary(createElement(Failed)));
assert.ok(screen.getByText(t('loading')));
const captured=[];const previousError=console.error;
console.error=(...args)=>captured.push(args);
try {
 await act(async()=>{fail(Error('Synthetic chunk download failure'));});
 assert.ok(screen.getByText(t('featureLoadFailed')));
 assert.ok(screen.getByRole('button',{name:t('reloadPage')}));
 assert.ok(screen.getByRole('button',{name:'Synthetic navigation'}));
 assert.equal(screen.queryByText('Synthetic chunk download failure'),null);
 assert.ok(captured.some(args=>args.some(value=>String(value).includes('Synthetic chunk download failure'))));
 failedView.rerender(boundary(createElement('p',null,'Other destination'),'other'));
 assert.ok(screen.getByText('Other destination'));
 assert.equal(screen.queryByText(t('featureLoadFailed')),null);
} finally {console.error=previousError;cleanup();}
console.log('Lazy boundary: loading, close-before-resolution, single mount, localized failure, usable shell and destination recovery passed.');
dom.window.close();
