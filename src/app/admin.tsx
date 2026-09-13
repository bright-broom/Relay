import { useEffect, useState } from 'react';
import type { UiContext } from '../i18n/context';
import type { AdminOverview } from '../admin/types';
import { hosted } from '../pwa/client';
import { adminSignInHref } from '../prototype/public-links';
import { Action, Notice } from '../ui/controls';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Icon } from '../ui/icons';
import { publicPreview } from '../prototype/access-mode';

type Result = {status:'ready';data:AdminOverview} | {status:'loading'|'login'|'denied'|'failed'};
export function Admin({ui}: {ui:UiContext}) {
  const [result,setResult] = useState<Result>({status:'loading'});
  const [revision,setRevision] = useState(0);
  useEffect(() => {
    if (!hosted() || publicPreview()) {setResult({status:'login'});return;}
    const controller = new AbortController();
    const load = async () => {
      setResult({status:'loading'});
      try {
        const response = await fetch('/api/admin/overview', {cache:'no-store',credentials:'same-origin',signal:controller.signal});
        if (controller.signal.aborted) return;
        if (response.status === 401) {setResult({status:'login'});return;}
        if (response.status === 403) {setResult({status:'denied'});return;}
        if (!response.ok) throw new Error('unavailable');
        const data = await response.json() as AdminOverview;
        if (!controller.signal.aborted) setResult({status:'ready',data});
      } catch {if (!controller.signal.aborted) setResult({status:'failed'});}
    };
    void load();
    // Revalidate on return; never keep a previous successful result after denial.
    const visible = () => {
      if (document.hidden) setResult({status:'loading'});
      else setRevision(value => value + 1);
    };
    document.addEventListener('visibilitychange',visible);
    return () => {controller.abort();document.removeEventListener('visibilitychange',visible);};
  },[revision]);
  const {t} = ui;
  return <>
    <header className="page-head"><h1 id="page-title" tabIndex={-1}>{t("admin")}</h1>
      <Action ui={ui} label="refreshConnections" disabled={result.status==='loading'} onClick={()=>{setResult({status:'loading'});setRevision(value=>value+1);}} />
    </header>
    {result.status === 'loading' && <Notice>{t('loading')}</Notice>}
    {result.status === 'failed' && <Notice error>{t('adminFailure')}</Notice>}
    {(result.status === 'login' || result.status === 'denied') && <section className="stack reading" aria-labelledby="admin-gate-title">
      <div className="row"><Icon name="adminLocked" /><h2 id="admin-gate-title">{t('adminGateTitle')}</h2></div>
      {result.status==='denied' && <Notice>{t('adminDenied')}</Notice>}
      <p>{t('adminLoginHint')}</p>
      <div className="row">
        <Button asChild>
          <a href={publicPreview() ? `/admin?lang=${encodeURIComponent(ui.locale)}` : adminSignInHref(hosted(), ui.locale)} rel="noreferrer" aria-describedby={!hosted() ? 'admin-online-required' : undefined}>
            {t('googleSignIn')}
          </a>
        </Button>
        <Button variant="ghost" asChild><a href="#today"><Icon name="home" />{t('today')}</a></Button>
      </div>
      {!hosted() && <p id="admin-online-required" className="meta">{t('adminContinueOnline')}</p>}
    </section>}
    {result.status==='ready' && <div className="stack">
      <p className="meta">{result.data.viewer}</p>
      <section className="stack" aria-labelledby="admin-accounts">
        <h2 id="admin-accounts">{t('adminAccounts')}</h2>
        <p className="meta">{t('adminReadOnly')}</p>
        <div className="split">
          {result.data.accounts.map(account=><Card className="panel stack" key={account.email}>
            <div className="row space-between"><h3>{account.email}</h3><Badge><Icon name={account.role==='admin'?'admin':'user'} />{t(account.role==='admin'?'adminRole':'memberRole')}</Badge></div>
            <dl className="fact"><dt>{t('adminSessions')}</dt><dd>{ui.number(account.sessions)}</dd></dl>
          </Card>)}
        </div>
      </section>
      <section className="stack" aria-labelledby="admin-settings">
        <h2 id="admin-settings">{t('adminSettings')}</h2>
        <div className="split">
          {([['google','adminGoogle'],['database','adminDatabase'],['line','adminLine'],['calendar','adminCalendar']] as const).map(([key,label])=><div className="row space-between panel" key={key}>
            <span>{t(label)}</span><Badge><Icon name={result.data.configuration[key]?'check':'waiting'} />{t(result.data.configuration[key]?'adminConfigured':'adminNotConfigured')}</Badge>
          </div>)}
        </div>
        <p className="meta">{t('adminConfigurationHint')}</p>
      </section>
    </div>}
  </>;
}
