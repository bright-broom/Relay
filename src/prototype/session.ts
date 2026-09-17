declare const __APP_ASSETS__: {entry:string;eager:string[];features:Record<string,string[]>} | undefined;
import {sessionInvalidated} from './session-events';
import {storageKey} from './storage-key';
import {publicPreview} from './access-mode';
import {browserLocale,persistLocale} from '../i18n/browser';
import {sessionMessages} from '../i18n/locales/session';
const initialLocale=browserLocale();
persistLocale(initialLocale);
const authOnline = sessionMessages[initialLocale.split('-')[0] === 'ja' ? 'ja' : 'en']['authOnline'];
const root = document.getElementById('app');
const localPreview = location.protocol === 'file:';
const guest = publicPreview();
if (guest && root) root.dataset.admin = 'false';
let checking = false;
let started = false;
let disconnected = false;
let stopped = false;
// Per-window authority: shared localStorage may already have been changed by another window.
let principal: {subject: string; isAdmin: boolean} | null = null;
function invalidate() {
  if (!root) return;
  root.hidden = true;
  root.dataset.sessionBlocked = 'true';
  window.dispatchEvent(new Event(sessionInvalidated));
}
function restart(nextSubject?: string) {
  stopped = true;
  invalidate();
  // Do not erase the new user's saved work if another window already changed accounts.
  try { if (!nextSubject || localStorage.getItem('relay-account') !== nextSubject) clearLocal(); } catch {}
  location.replace('/');
}
async function verify() {
  if (!root || checking || stopped) return;
  checking = true;
  try {
    if (!localPreview && !guest) {
      const response = await fetch('/api/session', {cache: 'no-store', credentials: 'same-origin'});
      if (!response.ok) { restart(); return; }
      const identity: unknown = await response.json();
      if (!identity || typeof identity !== 'object' || !('subject' in identity) ||
          typeof identity.subject !== 'string' || !identity.subject ||
          !('isAdmin' in identity) || typeof identity.isAdmin !== 'boolean') {
        restart(); return;
      }
      if (principal && (principal.subject !== identity.subject || principal.isAdmin !== identity.isAdmin)) {
        restart(identity.subject); return;
      }
      principal ??= {subject: identity.subject, isAdmin: identity.isAdmin};
      // The verified session, not a possibly older HTML response, controls initial navigation.
      root.dataset.admin = String(identity.isAdmin);
      try {
        if (localStorage.getItem('relay-account') !== identity.subject) {
          clearLocal(); localStorage.setItem('relay-account', identity.subject);
        }
      } catch { /* Storage may be disabled. */ }
    }
    if (disconnected) { location.reload(); return; }
    if (!started) {
      const script = document.createElement('script');
      const assets = typeof __APP_ASSETS__ === 'undefined' ? undefined : __APP_ASSETS__;
      if (assets && !localPreview) {
        // Only after the session gate: fetch critical imports in parallel, without mounting features.
        const route = location.hash.slice(1) || (location.pathname === '/admin' ? 'admin' : '');
        const initial = new URLSearchParams(location.search).has('calendar') ? 'scheduling' : route;
        const requested = Object.hasOwn(assets.features,initial) ? assets.features[initial]! : [];
        for (const file of new Set([...assets.eager,...requested])) {
          const link = document.createElement('link');link.rel='modulepreload';link.href='assets/modules/'+file;document.head.append(link);
        }
        script.type='module';script.src='assets/modules/'+assets.entry;
      } else script.src = 'assets/app.js';
      script.onerror = () => { root.textContent = authOnline; };
      document.head.append(script); started = true;
    }
    root.hidden = document.hidden;
  } catch { invalidate(); disconnected = true; const notice = document.createElement('p'); notice.textContent = authOnline; notice.setAttribute('role', 'alert'); root.after(notice); }
  finally { checking = false; }
}
function clearLocal() {
  try { localStorage.removeItem(storageKey); localStorage.removeItem('relay-account'); } catch { /* Storage can be disabled. */ }
}
if (!localPreview && 'serviceWorker' in navigator) {
  void navigator.serviceWorker.register('/sw.js', {scope: '/', updateViaCache: 'none'}).catch(() => {});
}
if (root) {
  void verify();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) root.hidden = true;
    else if (started) location.reload();
    else void verify();
  });
  window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
  if (!localPreview && !guest) window.setInterval(() => { if (!document.hidden) void verify(); }, 60000);
}
