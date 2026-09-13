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
    contents: `export * from './src/app/app';export * from './src/app/admin';export * from './src/app/store';export * from './src/app/scheduling';export * from './src/app/account';export * from './src/i18n/context';export * from './src/components/ui/tooltip';`,
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
const { createElement } = await import("react");
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
await user.click(
  within(dialog).getByRole("button", { name: t("pricingPresent") }),
);
assert.ok(document.querySelector(".app.pricing-presenting"));
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
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace("/api/", "");
  const body = options.body ? JSON.parse(options.body) : undefined;
  calls.push({ path, body });
  if (!["session", "line/destinations", "line/code"].includes(path))
    throw new Error("Unexpected fixture request: " + path);
  return {
    ok: true,
    status: 200,
    json: async () =>
      path === "session"
        ? { email: "fixture@example.test", lineReady: true }
        : path === "line/destinations"
          ? []
          : { code: "fixture-code" },
  };
};
render(
  createElement(api.TooltipProvider, null, createElement(api.Account, { ui })),
);
await screen.findByText("fixture@example.test");
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
dom.window.close();
console.log(
  "React: mocked scheduling/LINE input retention and admin loading, permission loss, login and failure states passed. No external API calls.",
);
