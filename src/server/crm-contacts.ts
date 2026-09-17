import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Identity} from './auth';
import type {Database, Row} from './database';
import {ApiError} from './line';
import {transaction, access, audit} from './crm';
import {crmId, createContactInput, type CustomerContact, type ContactCreated, type ContactPage} from '../crm/contracts';

const columns = `c.id, c.display_name AS "displayName", c.email, c.phone, r.relationship, r.is_primary AS "isPrimary"`;
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
    return {contact:{...data,id:contactId,email:data.email || null,phone:data.phone || null},replayed:false};
  },db);
}
