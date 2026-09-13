import { useEffect, useState } from 'react';
import type { UiContext } from '../i18n/context';
import { Action, Fold, Notice } from '../ui/controls';
import { Badge } from '@/components/ui/badge';
import { Icon } from '../ui/icons';
import { useRemote } from './remote';
import { LineSettings } from './line-settings';
import { storageKey } from '../prototype/storage';
import { sessionInvalidated } from '../prototype/session-events';
import { publicPreview } from '../prototype/access-mode';
import { Button } from '@/components/ui/button';

type Identity = {email:string;isAdmin:boolean;lineReady:boolean};
export function MyPage({ui,onLanguage}: {ui:UiContext;onLanguage:()=>void}) {
  const [identity,setIdentity] = useState<Identity|null>(null);
  const {busy,notice,run} = useRemote('myPageFailure');
  const guest = publicPreview();
  const online = location.protocol !== 'file:' && !guest;
  const refresh = () => void run(async request => setIdentity(await request<Identity>('session')));
  useEffect(() => {
    if (online) void run(async request => setIdentity(await request<Identity>('session')));
  },[online,run]);
  const logout = () => void run(async request => {
    await request('auth/logout',{});
    try {localStorage.removeItem(storageKey);localStorage.removeItem('relay-account');} catch {}
    const root = document.getElementById('app');
    if(root){root.hidden=true;root.dataset.sessionBlocked='true';}
    window.dispatchEvent(new Event(sessionInvalidated));
    location.replace('/');
  });
  const {t} = ui;
  return <>
    <header className="page-head">
      <h1 id="page-title" tabIndex={-1}>{t('myPage')}</h1>
      {online && <Action ui={ui} label="refreshConnections" disabled={busy} onClick={refresh} />}
    </header>
    <div className="stack reading">
      <section className="stack" aria-labelledby="my-profile">
        <h2 id="my-profile">{t('myProfile')}</h2>
        {identity && <>
          <div className="row space-between">
            <div className="row"><Icon name="user" /><p>{identity.email}</p></div>
            <Action ui={ui} label="signOut" disabled={busy} onClick={logout} />
          </div>
          <div className="row"><p className="meta">{t('myGoogle')}</p><Badge>{t(identity.isAdmin?'adminRole':'memberRole')}</Badge></div>
        </>}
        {!identity && busy && <Notice>{t('loading')}</Notice>}
        {!online && <Notice>{t(guest ? 'publicSignInHint' : 'authOnline')}</Notice>}
        {guest && <Button asChild><a href={`/login?lang=${encodeURIComponent(ui.locale)}`}>{t('googleSignIn')}</a></Button>}
        {notice && <Notice error>{t(notice)}</Notice>}
      </section>
      <section className="stack" aria-labelledby="my-language">
        <h2 id="my-language">{t('myLanguage')}</h2>
        <div className="row space-between"><span>{new Intl.DisplayNames([ui.language],{type:'language'}).of(ui.locale)}</span><Action ui={ui} label="language" iconOnly symbol="language" onClick={onLanguage} /></div>
      </section>
      {identity && <Fold ui={ui} label="myNotifications" deferMount>
        {identity.lineReady ? <LineSettings ui={ui} /> : <Notice>{t('lineSetup')}</Notice>}
      </Fold>}
    </div>
  </>;
}
