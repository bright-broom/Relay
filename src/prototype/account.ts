import {translate, type Locale, type MessageKey} from '../i18n/messages';
import {storageKey} from './storage';
type Destination = {id: string; kind: 'user' | 'group'; enabled: boolean; reference: string};
const escape = (value: string) => value.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const pendingNotifications = new Map<string, string>();
export async function showAccount(locale: Locale, show: (title: MessageKey, body: string) => void) {
  const t = (key: MessageKey) => translate(locale, key);
  if (location.protocol === 'file:') { show('account', `<p>${t('authOnline')}</p>`); return; }
  const button = (key: MessageKey, action: string, id = '') => `<button class="button" data-account="${action}" data-id="${id}">${t(key)}</button>`;
  const request = async (path: string, body?: Record<string, unknown>) => {
    const response = await fetch(`/api/${path}`, {method: body ? 'POST' : 'GET', cache: 'no-store', credentials: 'same-origin', ...(body ? {headers: {'Content-Type':'application/json'}, body: JSON.stringify(body)} : {})});
    const result = await response.json();
    if (response.status === 401) { location.replace('/'); throw new Error('unauthorized'); }
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  let code = '';
  async function refresh(notice = '') {
    const identity = await request('session') as {email: string; lineReady: boolean};
    const rows: Destination[] = identity.lineReady ? await request('line/destinations') : [];
    show('account', `<div class="stack"><div class="row space-between"><p>${escape(identity.email)}</p>${button('signOut','logout')}</div>${identity.lineReady ? `<label for="line-kind">${t('lineConnect')}</label><select id="line-kind"><option value="user">${t('linePersonal')}</option><option value="group">${t('lineGroup')}</option></select><div class="row">${button('lineConnect','code')}${button('refreshConnections','refresh')}</div><p class="meta">${t('lineCodeHint')}</p>${code ? `<p class="pre">${escape(code)}</p>${button('copyLinkCode','copy-code')}` : ''}${rows.map(row => `<section class="panel stack"><h3>${t(row.kind === 'user' ? 'linePersonal' : 'lineGroup')} · ${escape(row.reference)}</h3><p>${t(row.enabled ? 'lineConnected' : 'linePending')}</p><div class="row">${row.enabled ? button('lineTest','notify',row.id) : button('lineConfirm','confirm',row.id)}${button('lineRemove','remove',row.id)}</div></section>`).join('')}` : `<p>${t('lineSetup')}</p>`}<p id="account-notice" role="status">${escape(notice)}</p></div>`);
    const body = document.getElementById('modal-body')!;
    body.onclick = async event => {
      const target = (event.target as Element).closest<HTMLButtonElement>('[data-account]');
      if (!target || target.disabled) return;
      const action = target.dataset.account, id = target.dataset.id!;
      body.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = true);
      try {
        if (action === 'logout') {
          await request('auth/logout', {});
          try { localStorage.removeItem(storageKey); localStorage.removeItem('relay-account'); } catch { /* Optional local storage. */ }
          location.replace('/'); return;
        }
        if (action === 'copy-code') { await navigator.clipboard.writeText(code); await refresh(t('copied')); return; }
        if (action === 'code') code = (await request('line/code', {kind: (document.getElementById('line-kind') as HTMLSelectElement).value})).code;
        if (action === 'confirm' || action === 'remove') await request('line/destination', {id, action});
        if (action === 'notify') {
          const retryId = pendingNotifications.get(id) ?? crypto.randomUUID();
          pendingNotifications.set(id, retryId);
          await request('line/notify', {id: retryId, destinationId: id, locale});
          pendingNotifications.delete(id);
        }
        await refresh(action === 'notify' ? t('lineSent') : '');
      } catch (error) {
        const keys: Record<string, MessageKey> = {personalFirst:'personalFirst',rateLimit:'lineRateLimit',delivery:'lineRetry',pending:'lineRetry'};
        const notice = document.getElementById('account-notice');
        if (notice) notice.textContent = t(keys[error instanceof Error ? error.message : ''] ?? 'integrationFailure');
        body.querySelectorAll<HTMLButtonElement>('button').forEach(b => b.disabled = false);
      }
    };
  }
  try { await refresh(); } catch { show('account', `<p>${t('integrationFailure')}</p>`); }
}
