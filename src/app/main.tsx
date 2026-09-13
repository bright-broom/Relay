import { mountWorkspace } from "./root";
import { createWorkspace } from "./store";
import { browserLocale, hasLocalePreference } from "../i18n/context";
import { initViewport } from "../prototype/viewport";
import { initPwa } from "../pwa/client";
initPwa();
initViewport();
let storage: Storage | null = null;
try {
  storage = localStorage;
} catch {}
const workspace = createWorkspace(
  storage,
  browserLocale(),
  hasLocalePreference(),
  location.hash || (location.pathname === "/admin" ? "#admin" : ""),
);
const root = document.getElementById("app");
if (!root) throw new Error("Missing app root");
mountWorkspace(root, workspace);
