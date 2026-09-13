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
async function verify() {
  if (!root || checking) return;
  checking = true;
  try {
    if (!localPreview) {
      const response = await fetch('/api/session', {cache: 'no-store', credentials: 'same-origin'});
      if (!response.ok) { clearLocal(); location.replace('/'); return; }
      const identity = await response.json() as {subject: string};
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
    root.hidden = false;
  } catch { root.hidden = true; disconnected = true; const notice = document.createElement('p'); notice.textContent = t('authOnline'); notice.setAttribute('role', 'alert'); root.after(notice); }
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
