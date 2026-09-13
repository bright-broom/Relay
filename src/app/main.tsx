import { mountWorkspace } from "./root";
import { createWorkspace } from "./store";
import { browserLocale, hasLocalePreference } from "../i18n/context";
import { initViewport } from "../prototype/viewport";
import { initPwa } from "../pwa/client";
import { workspaceStorage } from "../prototype/access-mode";
initPwa();
initViewport();
const storage = workspaceStorage();
const workspace = createWorkspace(
  storage,
  browserLocale(),
  hasLocalePreference(),
  location.hash || (location.pathname === "/admin" ? "#admin" : ""),
);
const root = document.getElementById("app");
if (!root) throw new Error("Missing app root");
mountWorkspace(root, workspace);
