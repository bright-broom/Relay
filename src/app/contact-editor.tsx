import {useState} from 'react';
import type {UiContext} from '../i18n/context';
import {contactDetailsInput, type ContactDetailsInput, type ContactDetails, type ContactEdit, type ContactEdited} from '../crm/contracts';
import type {CrmRequest, CrmRun} from './customer-editor';
import {Action, Notice} from '../ui/controls';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Label} from '@/components/ui/label';

const values = ({contact}:ContactDetails):ContactDetailsInput => ({displayName:contact.displayName,email:contact.email ?? '',phone:contact.phone ?? ''});
export function ContactEditor({ui,details,workspaceId,customerId,busy,run,onCancel,onSaved,onReviewed}: {
  ui:UiContext;details:ContactDetails;workspaceId:string;customerId:string;busy:boolean;run:CrmRun;
  onCancel:()=>void;onSaved:(result:ContactEdited,request:CrmRequest)=>Promise<void>;onReviewed:(latest:ContactDetails)=>void;
}) {
  const {t} = ui;
  const [base,setBase] = useState(details), [draft,setDraft] = useState(values(details));
  const [pending,setPending] = useState<ContactEdit | null>(null);
  const [conflict,setConflict] = useState(false), [latest,setLatest] = useState<ContactDetails | null>(null);
  const [invalid,setInvalid] = useState(false);
  const path = `contacts/${base.contact.id}`;
  const loadLatest = async (request:CrmRequest) => setLatest(await request<ContactDetails>(`${path}?workspaceId=${encodeURIComponent(workspaceId)}&customerId=${encodeURIComponent(customerId)}`));
  const submit = () => {
    if (busy || conflict || base.customerArchived) return;
    const parsed = contactDetailsInput.safeParse(draft);
    if (!pending && !parsed.success) {setInvalid(true);return;}
    const attempt = pending ?? {workspaceId,customerId,key:crypto.randomUUID(),version:base.contact.version,contact:parsed.data!};
    setPending(attempt);setInvalid(false);
    void run(async request=>{
      let result:ContactEdited;
      try {result = await request<ContactEdited>(path,attempt,'PATCH');}
      catch (cause) {
        const code = cause instanceof Error ? cause.message : '';
        if (code === 'crmVersionConflict' || code === 'crmContactEditArchived') {
          setPending(null);setConflict(true);setLatest(null);await loadLatest(request);return;
        }
        if (code === 'crmContactInvalid') {setPending(null);setInvalid(true);return;}
        throw cause;
      }
      setPending(null);await onSaved(result,request);
    });
  };
  return <section className="stack" aria-label={t('crmEditContact')}>
    <h4>{t('crmEditContact')}</h4>
    <p className="meta">{t('crmContactEditScope')}</p>
    <form className="stack" aria-busy={busy} onSubmit={event=>{event.preventDefault();submit();}}>
      {(['displayName','email','phone'] as const).map(field=>{
        const labels = {displayName:'crmContactName',email:'crmContactEmail',phone:'crmContactPhone'} as const;
        return <div className="field" key={field}>
          <Label htmlFor={`crm-edit-contact-${field}`}>{t(labels[field])}</Label>
          <Input id={`crm-edit-contact-${field}`} value={draft[field]} autoComplete="off" required={field === 'displayName'}
            type={field === 'email' ? 'email' : field === 'phone' ? 'tel' : 'text'}
            maxLength={field === 'displayName' ? 200 : field === 'email' ? 254 : 64}
            disabled={busy || !!pending || conflict || base.customerArchived} aria-invalid={invalid}
            aria-describedby={invalid ? 'crm-edit-contact-invalid' : 'crm-edit-contact-hint'}
            onChange={event=>{setDraft({...draft,[field]:event.target.value});setInvalid(false);}} />
        </div>;
      })}
      <p className="meta" id="crm-edit-contact-hint">{t('crmContactHint')}</p>
      {invalid && <Notice error id="crm-edit-contact-invalid">{t('crmContactInvalid')}</Notice>}
      {base.customerArchived && <Notice>{t('crmContactEditArchived')}</Notice>}
      {pending && <Notice>{t('crmPending')}</Notice>}
      {conflict && <div className="stack">
        <Notice error>{t('crmContactConflict')}</Notice>
        {latest ? <>
          <h4>{t('crmLatest')}</h4>
          <p>{latest.contact.displayName}</p>
          <p>{t('crmContactEmail')}: {latest.contact.email ?? t('crmContactUnknown')}</p>
          <p>{t('crmContactPhone')}: {latest.contact.phone ?? t('crmContactUnknown')}</p>
          {latest.customerArchived && <Notice>{t('crmContactEditArchived')}</Notice>}
          <Action ui={ui} label="crmUseLatest" variant="outline" disabled={busy} onClick={()=>{
            setBase(latest);setDraft(values(latest));setConflict(false);setInvalid(false);setLatest(null);onReviewed(latest);
          }} />
        </> : <Action ui={ui} label="crmLoadLatest" symbol="refresh" variant="outline" disabled={busy} onClick={()=>void run(loadLatest)} />}
      </div>}
      <div className="row">
        <Button type="submit" disabled={busy || conflict || base.customerArchived}>{t(pending ? 'crmRetry' : 'crmSaveContactChanges')}</Button>
        <Action ui={ui} label="crmCancelEdit" variant="outline" disabled={busy || !!pending} onClick={onCancel} />
      </div>
    </form>
  </section>;
}
