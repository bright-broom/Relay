import {useEffect, useState} from 'react';
import type {UiContext} from '../i18n/context';
import type {MessageKey} from '../i18n/messages';
import {contactInput, type ContactInput, type ContactCreated, type ContactPage, type Customer} from '../crm/contracts';
import type {CrmRun, CrmRequest} from './customer-editor';
import {Action, Notice, SelectField} from '../ui/controls';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

const relationships: Record<ContactInput['relationship'],MessageKey> = {
  contact:'crmContactPerson',self:'crmContactSelf',billing:'crmContactBilling',other:'crmContactOther',
};
const empty: ContactInput = {displayName:'',email:'',phone:'',relationship:'contact',isPrimary:false};
type Pending = {workspaceId:string;customerId:string;key:string;contact:ContactInput};

export function CustomerContacts({ui,customer,workspaceId,readOnly,busy,run,onLock}: {
  ui:UiContext;customer:Customer;workspaceId:string;readOnly:boolean;busy:boolean;run:CrmRun;onLock:(locked:boolean)=>void;
}) {
  const {t} = ui;
  const [page,setPage] = useState<ContactPage | null>(null);
  const [editing,setEditing] = useState(false), [draft,setDraft] = useState<ContactInput>(empty);
  const [pending,setPending] = useState<Pending | null>(null);
  const [invalid,setInvalid] = useState(false), [stale,setStale] = useState(false);
  const [problem,setProblem] = useState<MessageKey | null>(null);
  const [saved,setSaved] = useState<string | null>(null);
  useEffect(()=>{onLock(editing || !!pending);return ()=>onLock(false);},[editing,pending,onLock]);
  const load = async (request:CrmRequest,cursor:string | null = null) => {
    setPage(null);
    setPage(await request<ContactPage>(`customers/${customer.id}/contacts?workspaceId=${encodeURIComponent(workspaceId)}${cursor ? '&cursor='+encodeURIComponent(cursor) : ''}`));
  };
  const save = () => {
    if (busy || readOnly || stale || customer.archivedAt) return;
    const parsed = contactInput.safeParse(draft);
    if (!pending && !parsed.success) {setInvalid(true);return;}
    const attempt = pending ?? {workspaceId,customerId:customer.id,key:crypto.randomUUID(),contact:parsed.data!};
    setPending(attempt);setInvalid(false);setProblem(null);setSaved(null);
    void run(async request=>{
      let result:ContactCreated;
      try {result = await request<ContactCreated>('contacts',attempt);}
      catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (code === 'crmContactInvalid') {setPending(null);setInvalid(true);return;}
        if (code === 'crmPrimaryConflict') {setPending(null);setProblem(code);await load(request);return;}
        if (code === 'crmContactArchived') {setPending(null);setStale(true);setProblem(code);return;}
        throw cause;
      }
      setPending(null);setDraft(empty);setEditing(false);setSaved(result.contact.displayName);
      await load(request);
    });
  };
  return <section className="stack" aria-label={t('crmContacts')}>
    <h3>{t('crmContacts')}</h3>
    <p className="meta">{t('crmContactScope')}</p>
    <Action ui={ui} label="crmLoadContacts" symbol="refresh" variant="outline" disabled={busy || !!pending}
      onClick={()=>void run(request=>load(request))} />
    {page?.contacts.length === 0 && <Notice>{t('crmNoContacts')}</Notice>}
    {page?.contacts.map(contact=><article className="stack" key={contact.id}>
      <h4>{contact.displayName}</h4>
      <p className="meta">{t(relationships[contact.relationship])}{contact.isPrimary ? ' · '+t('crmContactPrimary') : ''}</p>
      <p>{t('crmContactEmail')}: {contact.email ?? t('crmContactUnknown')}</p>
      <p>{t('crmContactPhone')}: {contact.phone ?? t('crmContactUnknown')}</p>
    </article>)}
    {page?.nextCursor && <Action ui={ui} label="crmMoreContacts" variant="outline" disabled={busy || !!pending}
      onClick={()=>void run(request=>load(request,page.nextCursor))} />}
    {saved !== null && <Notice>{t('crmContactSaved',{name:saved})}</Notice>}
    {customer.archivedAt && <Notice>{t('crmContactArchived')}</Notice>}
    {!readOnly && !customer.archivedAt && <>
      {!editing ? <Action ui={ui} label="crmAddContact" variant="outline" disabled={busy} onClick={()=>{setEditing(true);setSaved(null);}} /> :
        <form className="stack" onSubmit={event=>{event.preventDefault();save();}} aria-busy={busy}>
          {(['displayName','email','phone'] as const).map(field=>{
            const label = {displayName:'crmContactName',email:'crmContactEmail',phone:'crmContactPhone'} as const;
            return <div className="field" key={field}>
              <Label htmlFor={`crm-contact-${field}`}>{t(label[field])}</Label>
              <Input id={`crm-contact-${field}`} value={draft[field]} autoComplete="off" type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
                maxLength={field === 'displayName' ? 200 : field === 'email' ? 254 : 64} required={field === 'displayName'}
                disabled={busy || !!pending || stale} aria-invalid={invalid} aria-describedby={invalid ? 'crm-contact-invalid' : 'crm-contact-hint'}
                onChange={event=>{setDraft({...draft,[field]:event.target.value});setInvalid(false);}} />
            </div>;
          })}
          <p className="meta" id="crm-contact-hint">{t('crmContactHint')}</p>
          <SelectField ui={ui} label="crmContactRelationship" value={draft.relationship} disabled={busy || !!pending || stale}
            options={Object.entries(relationships).map(([value,label])=>({value,label:t(label)}))}
            onChange={event=>setDraft({...draft,relationship:event.target.value as ContactInput['relationship']})} />
          <SelectField ui={ui} label="crmContactPriority" value={draft.isPrimary ? 'primary' : 'standard'} disabled={busy || !!pending || stale}
            options={[{value:'standard',label:t('crmContactStandard')},{value:'primary',label:t('crmContactPrimary')}]}
            onChange={event=>setDraft({...draft,isPrimary:event.target.value === 'primary'})} />
          {invalid && <Notice error id="crm-contact-invalid">{t('crmContactInvalid')}</Notice>}
          {problem && <Notice error>{t(problem)}</Notice>}
          {pending && <Notice>{t('crmPending')}</Notice>}
          <div className="row">
            <Button type="submit" disabled={busy || stale}>{t(pending ? 'crmRetry' : 'crmSaveContact')}</Button>
            <Action ui={ui} label="crmCancelEdit" variant="outline" disabled={busy || !!pending}
              onClick={()=>{setDraft(empty);setEditing(false);setInvalid(false);setStale(false);setProblem(null);}} />
          </div>
        </form>}
    </>}
  </section>;
}
