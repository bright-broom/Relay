import {useEffect, useRef, useState} from 'react';
import type {UiContext} from '../i18n/context';
import type {MessageKey} from '../i18n/messages';
import {customerInput, customerSearchTerm, type CustomerInput, type CrmWorkspace, type Customer, type CustomerPage, type CustomerCreated} from '../crm/contracts';
import {CustomerContacts} from './customer-contacts';
import {CustomerEditor, customerKinds as kinds, type CrmRun, type CrmRequest} from './customer-editor';
import {publicPreview} from '../prototype/access-mode';
import {sessionInvalidated} from '../prototype/session-events';
import {Action, Heading, Notice, SelectField} from '../ui/controls';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

type Pending = {workspaceId: string; key: string; customer: CustomerInput};

export function Customers({ui}: {ui: UiContext}) {
  const {t} = ui, guest = publicPreview() || location.protocol === 'file:';
  const [workspaces, setWorkspaces] = useState<CrmWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [page, setPage] = useState<CustomerPage | null>(null);
  const [query, setQuery] = useState(''), [search, setSearch] = useState('');
  const [searchInvalid, setSearchInvalid] = useState(false);
  const [archived, setArchived] = useState(false);
  const [customerLocked, setEditorLocked] = useState(false);
  const [contactsLocked, setContactsLocked] = useState(false);
  const editorLocked = customerLocked || contactsLocked;
  const [changed, setChanged] = useState<MessageKey | null>(null);
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
      setQuery(''); setSearch(''); setSearchInvalid(false);
      setDisplayName(''); setPending(null); setSaved(false); setChanged(null); setEditorLocked(false); setError(null); setBlocked(true); setBusy(false);
    };
    window.addEventListener(sessionInvalidated, clear);
    return () => {
      generation.current++; controller.current?.abort(); controller.current = null;
      window.removeEventListener(sessionInvalidated, clear);
    };
  }, []);

  const run: CrmRun = async task => {
    if (controller.current || blocked) return;
    const abort = new AbortController(), current = generation.current;
    controller.current = abort; setBusy(true); setError(null);
    const timeout = setTimeout(() => {
      if (controller.current === abort) { setError('crmFailure'); abort.abort(); }
    }, 15000);
    abort.signal.addEventListener('abort', () => clearTimeout(timeout), {once:true});
    const request: CrmRequest = async <T,>(path: string, body?: object, method?: 'POST' | 'PATCH'): Promise<T> => {
      const response = await fetch('/api/crm/' + path, {
        method: body ? method ?? 'POST' : 'GET', signal: abort.signal, credentials:'same-origin', cache:'no-store',
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
        setQuery(''); setSearch(''); setSearchInvalid(false);
        setWorkspaces([]); setWorkspaceId(''); setSaved(false); setChanged(null); setReady(false); setEditorLocked(false);
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
        const errors: Record<string,MessageKey> = {crmContactInvalid:'crmContactInvalid',crmContactArchived:'crmContactArchived',crmPrimaryConflict:'crmPrimaryConflict',crmSearchInvalid:'crmSearchInvalid',crmCursorInvalid:'crmSearchRestart',crmReadOnly:'crmReadOnly',missing:'crmAccessLost',crmRetryConflict:'crmRetryConflict',invalid:'crmInvalid',crmUnavailable:'crmUnavailable'};
        setError(errors[cause instanceof Error ? cause.message : ''] ?? 'crmFailure');
      }
    } finally {
      clearTimeout(timeout);
      if (controller.current === abort) { controller.current = null; setBusy(false); }
    }
  }

  const readPage = (request: CrmRequest, id = workspaceId, showArchived = archived, term = search, cursor: string | null = null) => term
    ? request<CustomerPage>('customers/search',{workspaceId:id,query:term,archived:showArchived,cursor})
    : request<CustomerPage>(`customers?workspaceId=${encodeURIComponent(id)}&archived=${showArchived}${cursor ? '&cursor='+encodeURIComponent(cursor) : ''}`);
  const applySearch = (next = query) => {
    if (busy || blocked || pending || editorLocked) return;
    const parsed = customerSearchTerm.safeParse(next);
    if (!parsed.success) { setSearchInvalid(true); return; }
    setSearchInvalid(false); setQuery(parsed.data); setSearch(parsed.data);
    setPage(null); setSelected(null); setSaved(false); setChanged(null);
    void run(async request=>setPage(await readPage(request,workspaceId,archived,parsed.data)));
  };
  const refresh = () => void run(async request => {
    setPage(null); setSelected(null); setChanged(null);
    const memberships = await request<CrmWorkspace[]>('workspaces');
    setWorkspaces(memberships); setReady(true);
    const next = memberships.find(w=>w.id===workspaceId)?.id ?? memberships[0]?.id ?? '';
    if (next !== workspaceId || memberships.find(w=>w.id===next)?.role === 'viewer') { setPending(null); setDisplayName(''); setSaved(false); }
    if (next !== workspaceId) { setQuery(''); setSearch(''); setSearchInvalid(false); }
    setWorkspaceId(next);
    if (next) setPage(await readPage(request,next,archived,next === workspaceId ? search : ''));
  });
  useEffect(() => { if (!guest) refresh(); }, [guest]); // Data lives only in this mounted CRM view.

  const changeWorkspace = (next: string) => {
    setQuery(''); setSearch(''); setSearchInvalid(false);
    setChanged(null); setWorkspaceId(next); setPage(null); setSelected(null); setDisplayName(''); setPending(null); setSaved(false);
    void run(async request=>setPage(await readPage(request,next,archived,'')));
  };
  const save = () => {
    if (busy || blocked || editorLocked) return;
    const parsed = customerInput.safeParse({displayName,kind});
    if (!pending && !parsed.success) { setError('crmInvalid'); return; }
    const attempt = pending ?? {workspaceId,key:crypto.randomUUID(),customer:parsed.data!};
    setPending(attempt); setSaved(false); setChanged(null);
    void run(async request => {
      const result = await request<CustomerCreated>('customers',attempt);
      setPending(null); setDisplayName(''); setSelected(result.customer); setSaved(true); setArchived(false); setQuery(''); setSearch(''); setSearchInvalid(false);
      // A subsequent list failure must not undo the confirmed save notification.
      setPage(null);
      setPage(await readPage(request,attempt.workspaceId,false,''));
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
        <Action ui={ui} label="refreshConnections" disabled={busy || !!pending || editorLocked} onClick={refresh} />
        {busy && <Notice>{t('loading')}</Notice>}
        {error && <Notice error id="crm-error">{t(error)}</Notice>}
        {ready && !workspaces.length && <Notice>{t('crmNoWorkspace')}</Notice>}
        {!!workspaces.length && <SelectField ui={ui} label="crmWorkspace" value={workspaceId}
          disabled={busy || !!pending || editorLocked} options={workspaces.map(w=>({value:w.id,label:w.name}))}
          onChange={event=>changeWorkspace(event.target.value)} />}
        {member && <>
          {member.role === 'viewer' ? <Notice>{t('crmReadOnly')}</Notice> :
            <form className="stack" onSubmit={event=>{event.preventDefault();save();}} aria-busy={busy}>
              <h2>{t('crmCreate')}</h2>
              <div className="field">
                <Label htmlFor="crm-name">{t('crmName')}</Label>
                <Input id="crm-name" value={displayName} maxLength={200} required autoComplete="off"
                  disabled={busy || !!pending || editorLocked} aria-invalid={error==='crmInvalid'} aria-describedby={error ? 'crm-error' : undefined}
                  onChange={event=>{setDisplayName(event.target.value);setSaved(false);}} />
              </div>
              <SelectField ui={ui} label="crmKind" value={kind} disabled={busy || !!pending || editorLocked}
                options={Object.entries(kinds).map(([value,label])=>({value,label:t(label)}))}
                onChange={event=>setKind(event.target.value as CustomerInput['kind'])} />
              {pending && <Notice>{t('crmPending')}</Notice>}
              <Button type="submit" disabled={busy || editorLocked}>{t(pending ? 'crmRetry' : 'crmCreate')}</Button>
            </form>}
          {saved && <Notice>{t('crmSaved')}</Notice>}
          {changed && <Notice>{t(changed)}</Notice>}
          {selected && <CustomerEditor key={`${selected.id}:${selected.version}`} ui={ui} customer={selected}
            workspaceId={workspaceId} readOnly={member.role === 'viewer'} busy={busy || !!pending || contactsLocked} run={run}
            onLock={setEditorLocked} onStart={()=>{setSaved(false);setChanged(null);}} onReviewed={customer=>{
              setSelected(customer); setPage(null);
              void run(async request=>setPage(await readPage(request)));
            }} onChanged={async (result,action,request)=>{
              setSelected(result.customer); setSaved(false);
              setChanged(result.customer.version !== result.appliedVersion ? 'crmReplayedNewer' : action === 'archive' ? 'crmArchiveSaved' : action === 'restore' ? 'crmRestoreSaved' : 'crmUpdated');
              setPage(null);
              setPage(await readPage(request));
            }} />}
          {selected && <CustomerContacts key={`${workspaceId}:${selected.id}:${selected.version}`} ui={ui} customer={selected}
            workspaceId={workspaceId} readOnly={member.role === 'viewer'} busy={busy || !!pending || customerLocked}
            run={run} onLock={setContactsLocked} />}
          <form className="stack" role="search" aria-label={t('crmSearch')} onSubmit={event=>{event.preventDefault();applySearch();}}>
            <div className="field">
              <Label htmlFor="crm-search">{t('crmSearchName')}</Label>
              <Input id="crm-search" type="search" value={query} maxLength={200} autoComplete="off"
                disabled={busy || !!pending || editorLocked} aria-invalid={searchInvalid}
                aria-describedby={searchInvalid ? 'crm-search-error' : 'crm-search-hint'}
                onChange={event=>{setQuery(event.target.value);setSearchInvalid(false);}} />
            </div>
            <p className="meta" id="crm-search-hint">{t('crmSearchHint')}</p>
            {searchInvalid && <Notice error id="crm-search-error">{t('crmSearchInvalid')}</Notice>}
            <div className="row">
              <Action ui={ui} type="submit" label="crmSearch" symbol="search" variant="outline" disabled={busy || !!pending || editorLocked} />
              {(query || search) && <Action ui={ui} label="crmClearSearch" symbol="reset" variant="outline"
                disabled={busy || !!pending || editorLocked} onClick={()=>applySearch('')} />}
            </div>
            {search && <p className="meta">{t('crmSearchApplied',{query:search})}</p>}
          </form>
          <SelectField ui={ui} label="crmListState" value={archived ? 'archived' : 'current'} disabled={busy || !!pending || editorLocked}
            options={[{value:'current',label:t('crmCurrent')},{value:'archived',label:t('crmArchived')}]}
            onChange={event=>{
              const next = event.target.value === 'archived';
              setArchived(next); setSelected(null); setChanged(null); setPage(null);
              void run(async request=>setPage(await readPage(request,workspaceId,next)));
            }} />
          <section className="stack" aria-label={t('crmCustomers')}>
            {!page && !busy && workspaceId && <Action ui={ui} label="crmReloadList" variant="outline" disabled={!!pending || editorLocked} onClick={()=>void run(async request=>setPage(await readPage(request)))} />}
            {page?.customers.length===0 && <Notice>{t(search ? 'crmNoMatches' : archived ? 'crmEmptyArchived' : 'crmEmpty')}</Notice>}
            {page?.customers.map(customer=><div className="row space-between" key={customer.id}>
              <p>{customer.displayName}</p>
              <Action ui={ui} label="crmDetails" variant="outline" disabled={busy || !!pending || editorLocked}
                onClick={()=>void run(async request=>setSelected(await request<Customer>(`customers/${customer.id}?workspaceId=${encodeURIComponent(workspaceId)}`)))} />
            </div>)}
            {page?.nextCursor && <Action ui={ui} label="crmNextPage" variant="outline" disabled={busy || !!pending || editorLocked}
              onClick={()=>void run(async request=>{
                setSelected(null);
                setPage(await readPage(request,workspaceId,archived,search,page.nextCursor));
              })} />}
          </section>
        </>}
      </>}
    </div>
  </>;
}
