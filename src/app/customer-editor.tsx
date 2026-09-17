import {useEffect, useState} from 'react';
import type {UiContext} from '../i18n/context';
import type {MessageKey} from '../i18n/messages';
import {customerInput, type Customer, type CustomerChange, type CustomerChanged, type CustomerInput} from '../crm/contracts';
import {Action, Notice, SelectField} from '../ui/controls';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';
import {AlertDialog, AlertDialogTrigger, AlertDialogContent, AlertDialogTitle, AlertDialogDescription,
  AlertDialogFooter, AlertDialogCancel, AlertDialogAction} from '@/components/ui/alert-dialog';

export type CrmRequest = <T>(path: string, body?: object, method?: 'POST' | 'PATCH') => Promise<T>;
export type CrmRun = (task: (request: CrmRequest) => Promise<void>) => Promise<void>;
export const customerKinds: Record<CustomerInput['kind'], MessageKey> = {
  individual:'crmIndividual', organization:'crmOrganization', household:'crmHousehold',
};

export function CustomerEditor({ui, customer, workspaceId, readOnly, busy, run, onLock, onStart, onChanged, onReviewed}: {
  ui: UiContext; customer: Customer; workspaceId: string; readOnly: boolean; busy: boolean; run: CrmRun;
  onLock: (locked: boolean) => void; onStart: () => void; onChanged: (result: CustomerChanged, action: CustomerChange['action'], request: CrmRequest) => Promise<void>;
  onReviewed: (customer: Customer) => void;
}) {
  const {t} = ui;
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(customer.displayName);
  const [kind, setKind] = useState(customer.kind);
  const [pending, setPending] = useState<CustomerChange | null>(null);
  const [conflict, setConflict] = useState(false), [latest, setLatest] = useState<Customer | null>(null);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => { onLock(editing || !!pending || conflict); return () => onLock(false); }, [editing,pending,conflict,onLock]);
  const path = `customers/${customer.id}`;
  const loadLatest = async (request: CrmRequest) => setLatest(await request<Customer>(`${path}?workspaceId=${encodeURIComponent(workspaceId)}`));
  const submit = (action: CustomerChange['action']) => {
    if (busy || readOnly || conflict) return;
    const parsed = customerInput.safeParse({displayName,kind});
    if (!pending && action === 'edit' && !parsed.success) { setInvalid(true); return; }
    const common = {workspaceId,key:crypto.randomUUID(),version:customer.version};
    const attempt: CustomerChange = pending ?? (action === 'edit' ? {...common,action,customer:parsed.data!} : {...common,action});
    setPending(attempt); setInvalid(false); onStart();
    void run(async request => {
      let result: CustomerChanged;
      try { result = await request<CustomerChanged>(path, attempt, 'PATCH'); }
      catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (code === 'crmVersionConflict' || code === 'crmStateConflict') {
          setPending(null); setConflict(true);
          await loadLatest(request);
          return;
        }
        if (code === 'invalid') setPending(null);
        throw cause;
      }
      setPending(null); setEditing(false);
      await onChanged(result,attempt.action,request);
    });
  };
  return <section className="stack" aria-label={t('crmDetails')}>
    <h2>{customer.displayName}</h2>
    <p>{t(customerKinds[customer.kind])}</p>
    {!!customer.archivedAt && <Notice>{t('crmArchived')}</Notice>}
    {!readOnly && <>
      {editing && <form className="stack" aria-busy={busy} onSubmit={event=>{event.preventDefault();submit('edit');}}>
        <div className="field">
          <Label htmlFor="crm-edit-name">{t('crmEditName')}</Label>
          <Input id="crm-edit-name" value={displayName} maxLength={200} required autoComplete="off"
            disabled={busy || !!pending || conflict} aria-invalid={invalid} aria-describedby={invalid ? 'crm-edit-error' : undefined}
            onChange={event=>setDisplayName(event.target.value)} />
        </div>
        <SelectField ui={ui} label="crmKind" value={kind} disabled={busy || !!pending || conflict}
          options={Object.entries(customerKinds).map(([value,label])=>({value,label:t(label)}))}
          onChange={event=>setKind(event.target.value as CustomerInput['kind'])} />
        {invalid && <Notice error id="crm-edit-error">{t('crmInvalid')}</Notice>}
        {!pending && !conflict && <div className="row">
          <Button type="submit" disabled={busy}>{t('crmSaveChanges')}</Button>
          <Action ui={ui} label="crmCancelEdit" variant="outline" disabled={busy} onClick={()=>{
            setDisplayName(customer.displayName); setKind(customer.kind); setInvalid(false); setEditing(false);
          }} />
        </div>}
      </form>}
      {pending && <>
        <Notice>{t('crmPending')}</Notice>
        <Action ui={ui} label="crmRetry" disabled={busy} onClick={()=>submit(pending.action)} />
      </>}
      {conflict && <div className="stack">
        <Notice error>{t('crmConflict')}</Notice>
        {latest ? <>
          <h3>{t('crmLatest')}</h3>
          <p>{latest.displayName} · {t(customerKinds[latest.kind])} · {t(latest.archivedAt ? 'crmArchived' : 'crmCurrent')}</p>
          <Action ui={ui} label="crmUseLatest" variant="outline" disabled={busy} onClick={()=>{
            setDisplayName(latest.displayName); setKind(latest.kind); setEditing(false); setConflict(false);
            onReviewed(latest);
          }} />
        </> : <Action ui={ui} label="crmLoadLatest" variant="outline" disabled={busy} onClick={()=>void run(loadLatest)} />}
      </div>}
      {!editing && !pending && !conflict && <div className="row">
        {customer.archivedAt ? <Action ui={ui} label="crmRestore" disabled={busy} onClick={()=>submit('restore')} /> : <>
          <Action ui={ui} label="crmEdit" symbol="edit" iconOnly variant="outline" disabled={busy} onClick={()=>setEditing(true)} />
          <AlertDialog>
            <AlertDialogTrigger asChild><Button variant="outline" disabled={busy}>{t('crmArchive')}</Button></AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogTitle>{t('crmArchiveTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('crmArchiveHint')}</AlertDialogDescription>
              <AlertDialogFooter>
                <AlertDialogCancel>{t('close')}</AlertDialogCancel>
                <AlertDialogAction onClick={()=>submit('archive')}>{t('crmArchive')}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>}
      </div>}
    </>}
  </section>;
}
