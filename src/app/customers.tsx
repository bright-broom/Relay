import {useEffect, useRef, useState} from 'react';
import type {UiContext} from '../i18n/context';
import type {MessageKey} from '../i18n/messages';
import {customerInput, type CustomerInput, type CrmWorkspace, type Customer, type CustomerPage, type CustomerCreated} from '../crm/contracts';
import {publicPreview} from '../prototype/access-mode';
import {sessionInvalidated} from '../prototype/session-events';
import {Action, Heading, Notice, SelectField} from '../ui/controls';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

type Pending = {workspaceId: string; key: string; customer: CustomerInput};
const kinds: Record<CustomerInput['kind'], MessageKey> = {
  individual: 'crmIndividual', organization: 'crmOrganization', household: 'crmHousehold',
};

export function Customers({ui}: {ui: UiContext}) {
  const {t} = ui, guest = publicPreview() || location.protocol === 'file:';
  const [workspaces, setWorkspaces] = useState<CrmWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [page, setPage] = useState<CustomerPage | null>(null);
  const [selected, setSelected] = useState<Customer | null>(null);
  const [displayName, setDisplayName] = useState('');
  const [kind, setKind] = useState<CustomerInput['kind']>('organization');
  const [pending, setPending] = useState<Pending | null>(null);
  const [busy, setBusy] = useState(false), [ready, setReady] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<MessageKey | null>(null);
  const [saved, setSaved] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const member = workspaces.find(w => w.id === workspaceId);

  useEffect(() => {
    const clear = () => {
      generation.current++;
      controller.current?.abort(); controller.current = null;
      setWorkspaces([]); setWorkspaceId(''); setPage(null); setSelected(null);
      setDisplayName(''); setPending(null); setSaved(false); setError(null); setBlocked(true); setBusy(false);
    };
    window.addEventListener(sessionInvalidated, clear);
    return () => {
      generation.current++; controller.current?.abort(); controller.current = null;
      window.removeEventListener(sessionInvalidated, clear);
    };
  }, []);

  async function run(task: (request: <T>(path: string, body?: object) => Promise<T>) => Promise<void>) {
    if (controller.current || blocked) return;
    const abort = new AbortController(), current = generation.current;
    controller.current = abort; setBusy(true); setError(null);
    const timeout = setTimeout(() => {
      if (controller.current === abort) { setError('crmFailure'); abort.abort(); }
    }, 15000);
    abort.signal.addEventListener('abort', () => clearTimeout(timeout), {once:true});
    const request = async <T,>(path: string, body?: object): Promise<T> => {
      const response = await fetch('/api/crm/' + path, {
        method: body ? 'POST' : 'GET', signal: abort.signal, credentials:'same-origin', cache:'no-store',
        ...(body ? {headers:{'Content-Type':'application/json'},body:JSON.stringify(body)} : {}),
      });
      if (abort.signal.aborted || current !== generation.current) throw new Error('cancelled');
      if (response.status === 401) {
        window.dispatchEvent(new Event(sessionInvalidated));
        location.replace('/login?lang='+encodeURIComponent(ui.locale));
        throw new Error('unauthorized');
      }
      if (response.status === 403 || response.status === 404) {
        setPage(null); setSelected(null); setPending(null); setDisplayName('');
        setWorkspaces([]); setWorkspaceId(''); setSaved(false); setReady(false);
      }
      const value = await response.json();
      if (abort.signal.aborted || current !== generation.current) throw new Error('cancelled');
      if (!response.ok) {
        if (response.status === 400) setPending(null);
        throw new Error(value.error);
      }
      return value as T;
    };
    try { await task(request); }
    catch (cause) {
      if (!abort.signal.aborted && current === generation.current) {
        const errors: Record<string,MessageKey> = {crmReadOnly:'crmReadOnly',missing:'crmAccessLost',crmRetryConflict:'crmRetryConflict',invalid:'crmInvalid',crmUnavailable:'crmUnavailable'};
        setError(errors[cause instanceof Error ? cause.message : ''] ?? 'crmFailure');
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  }

  const refresh = () => void run(async request => {
    setPage(null); setSelected(null);
    const memberships = await request<CrmWorkspace[]>('workspaces');
    setWorkspaces(memberships); setReady(true);
    const next = memberships.find(w=>w.id===workspaceId)?.id ?? memberships[0]?.id ?? '';
    if (next !== workspaceId || memberships.find(w=>w.id===next)?.role === 'viewer') { setPending(null); setDisplayName(''); setSaved(false); }
    setWorkspaceId(next);
    if (next) setPage(await request<CustomerPage>('customers?workspaceId='+encodeURIComponent(next)));
  });
  useEffect(() => { if (!guest) refresh(); }, [guest]); // Data lives only in this mounted CRM view.

  const changeWorkspace = (next: string) => {
    setWorkspaceId(next); setPage(null); setSelected(null); setDisplayName(''); setPending(null); setSaved(false);
    void run(async request=>setPage(await request<CustomerPage>('customers?workspaceId='+encodeURIComponent(next))));
  };
  const save = () => {
    if (busy || blocked) return;
    const parsed = customerInput.safeParse({displayName,kind});
    if (!pending && !parsed.success) { setError('crmInvalid'); return; }
    const attempt = pending ?? {workspaceId,key:crypto.randomUUID(),customer:parsed.data!};
    setPending(attempt); setSaved(false);
    void run(async request => {
      const result = await request<CustomerCreated>('customers',attempt);
      setPending(null); setDisplayName(''); setSelected(result.customer); setSaved(true);
      // A subsequent list failure must not undo the confirmed save notification.
      setPage(null);
      setPage(await request<CustomerPage>('customers?workspaceId='+encodeURIComponent(attempt.workspaceId)));
    });
  };

  return <>
    <Heading ui={ui} label="crmCustomers" />
    <div className="stack reading">
      <p className="meta">{t('crmScope')}</p>
      {(guest || blocked) ? <>
        <Notice>{t('publicSignInHint')}</Notice>
        <Button asChild><a href={`/login?lang=${encodeURIComponent(ui.locale)}`}>{t('googleSignIn')}</a></Button>
      </> : <>
        <Action ui={ui} label="refreshConnections" disabled={busy} onClick={refresh} />
        {busy && <Notice>{t('loading')}</Notice>}
        {error && <Notice error id="crm-error">{t(error)}</Notice>}
        {ready && !workspaces.length && <Notice>{t('crmNoWorkspace')}</Notice>}
        {!!workspaces.length && <SelectField ui={ui} label="crmWorkspace" value={workspaceId}
          disabled={busy || !!pending} options={workspaces.map(w=>({value:w.id,label:w.name}))}
          onChange={event=>changeWorkspace(event.target.value)} />}
        {member && <>
          {member.role === 'viewer' ? <Notice>{t('crmReadOnly')}</Notice> :
            <form className="stack" onSubmit={event=>{event.preventDefault();save();}} aria-busy={busy}>
              <h2>{t('crmCreate')}</h2>
              <div className="field">
                <Label htmlFor="crm-name">{t('crmName')}</Label>
                <Input id="crm-name" value={displayName} maxLength={200} required autoComplete="off"
                  disabled={busy || !!pending} aria-invalid={error==='crmInvalid'} aria-describedby={error ? 'crm-error' : undefined}
                  onChange={event=>{setDisplayName(event.target.value);setSaved(false);}} />
              </div>
              <SelectField ui={ui} label="crmKind" value={kind} disabled={busy || !!pending}
                options={Object.entries(kinds).map(([value,label])=>({value,label:t(label)}))}
                onChange={event=>setKind(event.target.value as CustomerInput['kind'])} />
              {pending && <Notice>{t('crmPending')}</Notice>}
              <Button type="submit" disabled={busy}>{t(pending ? 'crmRetry' : 'crmCreate')}</Button>
            </form>}
          {saved && <Notice>{t('crmSaved')}</Notice>}
          {selected && <section className="stack" aria-label={t('crmDetails')}>
            <h2>{selected.displayName}</h2><p>{t(kinds[selected.kind])}</p>
          </section>}
          <section className="stack" aria-label={t('crmCustomers')}>
            {page?.customers.length===0 && <Notice>{t('crmEmpty')}</Notice>}
            {page?.customers.map(customer=><div className="row space-between" key={customer.id}>
              <p>{customer.displayName}</p>
              <Action ui={ui} label="crmDetails" variant="outline" disabled={busy}
                onClick={()=>void run(async request=>setSelected(await request<Customer>(`customers/${customer.id}?workspaceId=${encodeURIComponent(workspaceId)}`)))} />
            </div>)}
            {page?.nextCursor && <Action ui={ui} label="crmNextPage" variant="outline" disabled={busy}
              onClick={()=>void run(async request=>{
                setSelected(null);
                setPage(await request<CustomerPage>(`customers?workspaceId=${encodeURIComponent(workspaceId)}&cursor=${encodeURIComponent(page.nextCursor!)}`));
              })} />}
          </section>
        </>}
      </>}
    </div>
  </>;
}
