import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Identity} from './auth';
import type {Database, Row} from './database';
import {ApiError} from './line';
import {transaction, access, audit} from './crm';
import {crmId, createContactInput, editContactInput, type CustomerContact, type ContactCreated, type ContactPage, type ContactDetails, type ContactEdited} from '../crm/contracts';

const columns = `c.id, c.display_name AS "displayName", c.email, c.phone, c.version::text, r.relationship, r.is_primary AS "isPrimary"`;
const joined = `relay_crm.contacts c JOIN relay_crm.customer_contacts r ON r.workspace_id=c.workspace_id AND r.contact_id=c.id`;
const cursorSchema = z.object({workspaceId:crmId,customerId:crmId,id:crmId}).strict();

export async function listContacts(identity: Identity, workspace: unknown, customer: unknown, cursor: string | null, db?: Database): Promise<ContactPage> {
  const workspaceId = crmId.parse(workspace), customerId = crmId.parse(customer);
  let after: z.infer<typeof cursorSchema> | null = null;
  if (cursor !== null) {
    try {
      if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw Error('cursor');
      after = cursorSchema.parse(JSON.parse(Buffer.from(cursor,'base64url').toString('utf8')));
      if (after.workspaceId !== workspaceId || after.customerId !== customerId) throw Error('scope');
    } catch { throw new ApiError(400,'crmCursorInvalid'); }
  }
  return transaction(identity, async tx => {
    const member = await access(tx,workspaceId,false);
    const [parent] = await tx.query('SELECT id FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2',[workspaceId,customerId]);
    if (!parent) throw new ApiError(404,'missing');
    const rows = await tx.query<CustomerContact & Row>(`SELECT ${columns} FROM ${joined}
      WHERE r.workspace_id=$1 AND r.customer_id=$2 AND c.archived_at IS NULL
      ${after ? 'AND c.id > $3::uuid' : ''} ORDER BY c.id LIMIT 51`, after ? [workspaceId,customerId,after.id] : [workspaceId,customerId]);
    const contacts = rows.slice(0,50), last = contacts.at(-1);
    await audit(tx,workspaceId,member.principalId,customerId,'contacts.list');
    return {contacts,nextCursor:rows.length > 50 && last ? Buffer.from(JSON.stringify({workspaceId,customerId,id:last.id})).toString('base64url') : null};
  },db);
}

export async function createContact(identity: Identity, input: unknown, db?: Database): Promise<ContactCreated> {
  const parsed = createContactInput.safeParse(input);
  if (!parsed.success) throw new ApiError(400,'crmContactInvalid');
  const {workspaceId,customerId,key,contact:data} = parsed.data;
  const payloadHash = createHash('sha256').update(JSON.stringify({customerId,contact:data})).digest('hex');
  return transaction(identity,async tx => {
    const member = await access(tx,workspaceId,true);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`${workspaceId}:${member.principalId}:contact.create:${key}`]);
    const [prior] = await tx.query<{result_id:string;payload_hash:string;expired:boolean}>(
      `SELECT result_id,payload_hash,expires_at <= now() AS expired FROM relay_crm.request_dedup
       WHERE workspace_id=$1 AND actor_id=$2 AND operation='contact.create' AND key=$3`,[workspaceId,member.principalId,key]);
    if (prior && (prior.payload_hash !== payloadHash || prior.expired)) throw new ApiError(409,'crmRetryConflict');
    // Serialize additions with archiving and other primary-contact registrations.
    const [parent] = await tx.query<{archived:boolean}>(`SELECT archived_at IS NOT NULL AS archived FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[workspaceId,customerId]);
    if (!parent) throw new ApiError(404,'missing');
    if (prior) {
      const [contact] = await tx.query<CustomerContact & Row>(`SELECT ${columns} FROM ${joined}
        WHERE r.workspace_id=$1 AND r.customer_id=$2 AND c.id=$3 AND c.archived_at IS NULL`,[workspaceId,customerId,prior.result_id]);
      if (!contact) throw new ApiError(409,'crmRetryConflict');
      await audit(tx,workspaceId,member.principalId,contact.id,'replay',{customerId},'contact');
      return {contact,replayed:true};
    }
    if (parent.archived) throw new ApiError(409,'crmContactArchived');
    if (data.isPrimary && (await tx.query('SELECT contact_id FROM relay_crm.customer_contacts WHERE workspace_id=$1 AND customer_id=$2 AND is_primary',[workspaceId,customerId])).length) throw new ApiError(409,'crmPrimaryConflict');
    const contactId = randomUUID();
    await tx.query(`INSERT INTO relay_crm.contacts(id,workspace_id,display_name,email,phone) VALUES($1,$2,$3,$4,$5)`,[contactId,workspaceId,data.displayName,data.email || null,data.phone || null]);
    await tx.query(`INSERT INTO relay_crm.customer_contacts(workspace_id,customer_id,contact_id,relationship,is_primary) VALUES($1,$2,$3,$4,$5)`,[workspaceId,customerId,contactId,data.relationship,data.isPrimary]);
    await audit(tx,workspaceId,member.principalId,contactId,'create',{customerId},'contact');
    await tx.query(`INSERT INTO relay_crm.request_dedup(workspace_id,actor_id,operation,key,payload_hash,response_status,result_id,expires_at)
      VALUES($1,$2,'contact.create',$3,$4,201,$5,now()+interval '7 days')`,[workspaceId,member.principalId,key,payloadHash,contactId]);
    return {contact:{...data,id:contactId,email:data.email || null,phone:data.phone || null,version:'1'},replayed:false};
  },db);
}

export async function getContact(identity: Identity, workspace: unknown, customer: unknown, id: unknown, db?: Database): Promise<ContactDetails> {
  const workspaceId = crmId.parse(workspace), customerId = crmId.parse(customer), contactId = crmId.parse(id);
  return transaction(identity,async tx=>{
    const member = await access(tx,workspaceId,false);
    const [parent] = await tx.query<{archived:boolean}>(`SELECT archived_at IS NOT NULL AS archived FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2`,[workspaceId,customerId]);
    const [contact] = await tx.query<CustomerContact & Row>(`SELECT ${columns} FROM ${joined}
      WHERE r.workspace_id=$1 AND r.customer_id=$2 AND c.id=$3 AND c.archived_at IS NULL`,[workspaceId,customerId,contactId]);
    if (!parent || !contact) throw new ApiError(404,'missing');
    await audit(tx,workspaceId,member.principalId,contactId,'read',{customerId},'contact');
    return {contact,customerArchived:parent.archived};
  },db);
}

export async function editContact(identity: Identity, id: unknown, input: unknown, db?: Database): Promise<ContactEdited> {
  const contactId = crmId.parse(id), parsed = editContactInput.safeParse(input);
  if (!parsed.success) throw new ApiError(400,'crmContactInvalid');
  const {workspaceId,customerId,key,version,contact:data} = parsed.data;
  const payloadHash = createHash('sha256').update(JSON.stringify({contactId,customerId,version,contact:data})).digest('hex');
  return transaction(identity,async tx=>{
    const member = await access(tx,workspaceId,true);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[`${workspaceId}:${member.principalId}:contact.edit:${key}`]);
    const [prior] = await tx.query<{payload_hash:string;expired:boolean;result_version:string}>(
      `SELECT payload_hash,expires_at <= now() AS expired,result_version::text FROM relay_crm.request_dedup
       WHERE workspace_id=$1 AND actor_id=$2 AND operation='contact.edit' AND key=$3`,[workspaceId,member.principalId,key]);
    if (prior && (prior.payload_hash !== payloadHash || prior.expired || !prior.result_version)) throw new ApiError(409,'crmRetryConflict');
    // Parent first, then the shared contact: serialize with parent archiving and
    // with edits reached through any other customer linked to this contact.
    const [parent] = await tx.query<{archived:boolean}>(`SELECT archived_at IS NOT NULL AS archived FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2 FOR UPDATE`,[workspaceId,customerId]);
    if (!parent) throw new ApiError(404,'missing');
    const [before] = await tx.query<CustomerContact & Row>(`SELECT ${columns} FROM ${joined}
      WHERE r.workspace_id=$1 AND r.customer_id=$2 AND c.id=$3 AND c.archived_at IS NULL FOR UPDATE OF c`,[workspaceId,customerId,contactId]);
    if (!before) throw new ApiError(404,'missing');
    if (prior) {
      await audit(tx,workspaceId,member.principalId,contactId,'replay',{customerId,operation:'contact.edit',appliedVersion:prior.result_version},'contact');
      return {contact:before,customerArchived:parent.archived,replayed:true,appliedVersion:prior.result_version};
    }
    if (parent.archived) throw new ApiError(409,'crmContactEditArchived');
    if (before.version !== version) throw new ApiError(409,'crmVersionConflict');
    const values = {...data,email:data.email || null,phone:data.phone || null};
    const fields = (['displayName','email','phone'] as const).filter(field=>before[field] !== values[field]);
    const [updated] = await tx.query<{version:string}>(`UPDATE relay_crm.contacts SET display_name=$4,email=$5,phone=$6,
      version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 AND version=$3::bigint RETURNING version::text`,
    [workspaceId,contactId,version,values.displayName,values.email,values.phone]);
    if (!updated) throw new ApiError(409,'crmVersionConflict');
    await audit(tx,workspaceId,member.principalId,contactId,'edit',{customerId,fields,fromVersion:version,toVersion:updated.version},'contact');
    await tx.query(`INSERT INTO relay_crm.request_dedup(workspace_id,actor_id,operation,key,payload_hash,response_status,result_id,result_version,expires_at)
      VALUES($1,$2,'contact.edit',$3,$4,200,$5,$6::bigint,now()+interval '7 days')`,[workspaceId,member.principalId,key,payloadHash,contactId,updated.version]);
    return {contact:{...before,...values,version:updated.version},customerArchived:false,replayed:false,appliedVersion:updated.version};
  },db);
}
