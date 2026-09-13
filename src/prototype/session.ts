import {sessionInvalidated} from './session-events';
import {storageKey} from './storage';
import {createUiContext,browserLocale,persistLocale} from '../i18n/context';
const initialLocale=browserLocale();
persistLocale(initialLocale);
const {t}=createUiContext(initialLocale);
const root = document.getElementById('app');
const localPreview = location.protocol === 'file:';
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
    if (!localPreview) {
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
      const script = document.createElement('script'); script.src = 'assets/app.js';
      script.onerror = () => { root.textContent = t('authOnline'); };
      document.head.append(script); started = true;
    }
    root.hidden = document.hidden;
  } catch { invalidate(); disconnected = true; const notice = document.createElement('p'); notice.textContent = t('authOnline'); notice.setAttribute('role', 'alert'); root.after(notice); }
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
  if (!localPreview) window.setInterval(() => { if (!document.hidden) void verify(); }, 60000);
}
