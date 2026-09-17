import {createHash, randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Identity} from './auth';
import {connectDatabase, type Database, type Row} from './database';
import {ApiError} from './line';
import {crmId, createCustomerInput, changeCustomerInput, customerSearchTerm, searchCustomersInput, normalizeCustomerName, type CrmWorkspace, type Customer, type CustomerPage, type CustomerCreated, type CustomerChanged} from '../crm/contracts';

let connection: Database | undefined;
function crmDatabase(): Database {
  if (!process.env.CRM_DATABASE_URL) throw new ApiError(503, 'crmUnavailable');
  return connection ??= connectDatabase(process.env.CRM_DATABASE_URL);
}
type Access = {principalId: string; role: CrmWorkspace['role']};
const columns = `id, display_name AS "displayName", kind, status, version::text,
 to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "updatedAt",
 to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "archivedAt"`;

// Refuse owner/admin credentials instead of silently bypassing tenant policies.
export async function verifyCrmRole(db: Database): Promise<void> {
  const [row] = await db.query<{safe: boolean}>(`SELECT
    NOT (r.rolsuper OR r.rolbypassrls OR r.rolcreaterole OR r.rolcreatedb OR r.rolreplication)
    AND pg_has_role(current_user, 'relay_crm_runtime', 'USAGE')
    AND NOT has_schema_privilege(current_user, 'relay_crm', 'CREATE')
    AND (SELECT count(*) = 8 AND bool_and(c.relrowsecurity AND c.relforcerowsecurity
      AND NOT pg_has_role(current_user, c.relowner, 'MEMBER')
      AND NOT has_table_privilege(current_user, c.oid, 'TRUNCATE'))
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'relay_crm' AND c.relkind = 'r')
    AND NOT has_table_privilege(current_user, 'relay_crm.audit_events', 'UPDATE,DELETE')
    AS safe FROM pg_roles r WHERE r.rolname = current_user`);
  if (!row?.safe) throw new ApiError(503, 'crmUnavailable');
}

export async function transaction<T>(identity: Identity, work: (tx: Database) => Promise<T>, db?: Database): Promise<T> {
  return (db ?? crmDatabase()).transaction(async tx => {
    await verifyCrmRole(tx);
    await tx.query(`SELECT set_config('relay.subject', $1, true),
      set_config('relay.workspace_id', '', true), set_config('relay.principal_id', '', true),
      set_config('statement_timeout', '5000', true), set_config('lock_timeout', '2000', true)`, [identity.subject]);
    return work(tx);
  });
}

export async function access(tx: Database, workspaceId: string, writing: boolean): Promise<Access> {
  // Hold all revocable authorization rows until commit. Runtime UPDATE is denied
  // by WITH CHECK(false); narrow UPDATE grants exist solely to allow these locks.
  const [principal] = await tx.query<{id: string}>('SELECT id FROM relay_crm.principals FOR SHARE');
  if (!principal) throw new ApiError(404, 'missing');
  const [member] = await tx.query<{role: CrmWorkspace['role']}>(
    'SELECT role FROM relay_crm.memberships WHERE workspace_id=$1 AND principal_id=$2 FOR SHARE', [workspaceId, principal.id]);
  const [workspace] = await tx.query('SELECT id FROM relay_crm.workspaces WHERE id=$1 FOR SHARE', [workspaceId]);
  if (!member || !workspace) throw new ApiError(404, 'missing');
  if (writing && member.role === 'viewer') throw new ApiError(403, 'crmReadOnly');
  await tx.query(`SELECT set_config('relay.workspace_id', $1, true), set_config('relay.principal_id', $2, true)`, [workspaceId, principal.id]);
  return {principalId: principal.id, role: member.role};
}

export async function audit(tx: Database, workspaceId: string, actor: string, entityId: string, action: string, changes: object = {}, entityType: 'customer' | 'contact' = 'customer') {
  // Record the operation, not customer names, contacts or request bodies.
  await tx.query(`INSERT INTO relay_crm.audit_events(id, workspace_id, actor_id, request_id, entity_type, entity_id, action, changes)
    VALUES($1,$2,$3,$4,$8,$5,$6,$7::text::jsonb)`, [randomUUID(), workspaceId, actor, randomUUID(), entityId, action, JSON.stringify(changes), entityType]);
}

export async function listWorkspaces(identity: Identity, db?: Database): Promise<CrmWorkspace[]> {
  return transaction(identity, async tx => {
    const rows = await tx.query<CrmWorkspace & Row>(`SELECT w.id, w.name, m.role FROM relay_crm.workspaces w
      JOIN relay_crm.memberships m ON m.workspace_id=w.id ORDER BY w.name, w.id LIMIT 101`);
    if (rows.length > 100) throw new ApiError(503, 'crmUnavailable');
    return rows;
  }, db);
}

const cursorSchema = z.object({updatedAt: z.iso.datetime({offset: true}), id: crmId, scope: z.string().regex(/^[a-f0-9]{64}$/).optional()}).strict();
export async function searchCustomers(identity: Identity, input: unknown, db?: Database): Promise<CustomerPage> {
  const parsed = searchCustomersInput.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'crmSearchInvalid');
  const {workspaceId, cursor, archived, query} = parsed.data;
  return listCustomers(identity, workspaceId, cursor, db, archived, query);
}

export async function listCustomers(identity: Identity, workspace: unknown, cursor: string | null, db?: Database, archived = false, query = ''): Promise<CustomerPage> {
  const workspaceId = crmId.parse(workspace);
  const term = normalizeCustomerName(customerSearchTerm.parse(query));
  // Bind paging to the canonical filter, without putting names in the cursor.
  const scope = createHash('sha256').update(JSON.stringify([workspaceId,archived,term])).digest('hex');
  let after: z.infer<typeof cursorSchema> | null = null;
  if (cursor !== null) {
    if (!/^[A-Za-z0-9_-]{1,512}$/.test(cursor)) throw new ApiError(400, 'crmCursorInvalid');
    try { after = cursorSchema.parse(JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))); }
    catch { throw new ApiError(400, 'crmCursorInvalid'); }
    // Older clients can finish an unfiltered listing with their legacy cursor.
    if (after.scope ? after.scope !== scope : !!term) throw new ApiError(400, 'crmCursorInvalid');
  }
  return transaction(identity, async tx => {
    const member = await access(tx, workspaceId, false);
    const rows = await tx.query<Customer & Row>(`SELECT ${columns} FROM relay_crm.customers
      WHERE workspace_id=$1 AND archived_at IS ${archived ? 'NOT NULL' : 'NULL'}
      AND strpos(name_search,$2::text) > 0
      ${after ? 'AND (updated_at,id) < ($3::timestamptz,$4::uuid)' : ''}
      ORDER BY updated_at DESC, id DESC LIMIT 51`, after ? [workspaceId,term,after.updatedAt,after.id] : [workspaceId,term]);
    const customers = rows.slice(0, 50), last = customers.at(-1);
    const nextCursor = rows.length > 50 && last ? Buffer.from(JSON.stringify({updatedAt:last.updatedAt,id:last.id,scope})).toString('base64url') : null;
    await audit(tx, workspaceId, member.principalId, workspaceId, 'list', {searched:!!term,archived});
    return {customers, nextCursor};
  }, db);
}

export async function getCustomer(identity: Identity, workspace: unknown, id: unknown, db?: Database): Promise<Customer> {
  const workspaceId = crmId.parse(workspace), customerId = crmId.parse(id);
  return transaction(identity, async tx => {
    const member = await access(tx, workspaceId, false);
    const [customer] = await tx.query<Customer & Row>(`SELECT ${columns} FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2`, [workspaceId, customerId]);
    if (!customer) throw new ApiError(404, 'missing');
    await audit(tx, workspaceId, member.principalId, customer.id, 'read');
    return customer;
  }, db);
}

export async function changeCustomer(identity: Identity, id: unknown, input: unknown, db?: Database): Promise<CustomerChanged> {
  const customerId = crmId.parse(id), data = changeCustomerInput.parse(input);
  const {workspaceId, key, version, action} = data;
  const operation = 'customer.' + action;
  const payloadHash = createHash('sha256').update(JSON.stringify({customerId, ...data})).digest('hex');
  return transaction(identity, async tx => {
    const member = await access(tx, workspaceId, true);
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${workspaceId}:${member.principalId}:${operation}:${key}`]);
    const [prior] = await tx.query<{payload_hash: string; expired: boolean; result_version: string}>(
      `SELECT payload_hash, expires_at <= now() AS expired, result_version::text FROM relay_crm.request_dedup
       WHERE workspace_id=$1 AND actor_id=$2 AND operation=$3 AND key=$4`, [workspaceId,member.principalId,operation,key]);
    if (prior && (prior.payload_hash !== payloadHash || prior.expired || !prior.result_version)) throw new ApiError(409, 'crmRetryConflict');
    // Serialize edits and lifecycle transitions; authorization locks stay held too.
    const [before] = await tx.query<Customer & Row>(`SELECT ${columns} FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2 FOR UPDATE`, [workspaceId,customerId]);
    if (!before) throw new ApiError(404, 'missing');
    if (prior) {
      await audit(tx, workspaceId, member.principalId, customerId, 'replay', {operation, appliedVersion:prior.result_version});
      return {customer:before, replayed:true, appliedVersion:prior.result_version};
    }
    if (before.version !== version) throw new ApiError(409, 'crmVersionConflict');
    if ((action === 'restore') !== !!before.archivedAt) throw new ApiError(409, 'crmStateConflict');
    const changes = action === 'edit'
      ? (['displayName','kind'] as const).filter(field => before[field] !== data.customer[field])
      : ['archivedAt'];
    const values = action === 'edit' ? [data.customer.displayName, normalizeCustomerName(data.customer.displayName), data.customer.kind] : [];
    const update = action === 'edit' ? 'display_name=$4,name_search=$5,kind=$6' : `archived_at=${action === 'archive' ? 'clock_timestamp()' : 'NULL'}`;
    const [customer] = await tx.query<Customer & Row>(`UPDATE relay_crm.customers SET ${update},version=version+1,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND id=$2 AND version=$3::bigint RETURNING ${columns}`, [workspaceId,customerId,version,...values]);
    if (!customer) throw new ApiError(409, 'crmVersionConflict');
    await audit(tx, workspaceId, member.principalId, customerId, action, {fields:changes,fromVersion:version,toVersion:customer.version});
    await tx.query(`INSERT INTO relay_crm.request_dedup(workspace_id,actor_id,operation,key,payload_hash,response_status,result_id,result_version,expires_at)
      VALUES($1,$2,$3,$4,$5,200,$6,$7::bigint,now()+interval '7 days')`, [workspaceId,member.principalId,operation,key,payloadHash,customerId,customer.version]);
    return {customer, replayed:false, appliedVersion:customer.version};
  }, db);
}

export async function createCustomer(identity: Identity, input: unknown, db?: Database): Promise<CustomerCreated> {
  const {workspaceId, key, customer: data} = createCustomerInput.parse(input);
  const payloadHash = createHash('sha256').update(JSON.stringify(data)).digest('hex');
  return transaction(identity, async tx => {
    const member = await access(tx, workspaceId, true);
    const lock = `${workspaceId}:${member.principalId}:customer.create:${key}`;
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [lock]);
    const [prior] = await tx.query<{result_id: string; payload_hash: string; expired: boolean}>(
      `SELECT result_id, payload_hash, expires_at <= now() AS expired FROM relay_crm.request_dedup
       WHERE workspace_id=$1 AND actor_id=$2 AND operation='customer.create' AND key=$3`, [workspaceId,member.principalId,key]);
    if (prior && (prior.payload_hash !== payloadHash || prior.expired)) throw new ApiError(409, 'crmRetryConflict');
    if (prior) {
      const [customer] = await tx.query<Customer & Row>(`SELECT ${columns} FROM relay_crm.customers WHERE workspace_id=$1 AND id=$2 AND archived_at IS NULL`, [workspaceId,prior.result_id]);
      if (!customer) throw new ApiError(409, 'crmRetryConflict');
      await audit(tx, workspaceId, member.principalId, customer.id, 'replay');
      return {customer, replayed: true};
    }
    const [customer] = await tx.query<Customer & Row>(`INSERT INTO relay_crm.customers
      (id,workspace_id,kind,display_name,name_search,status,owner_id)
      VALUES($1,$2,$3,$4,$5,'prospect',$6) RETURNING ${columns}`,
    [randomUUID(),workspaceId,data.kind,data.displayName,normalizeCustomerName(data.displayName),member.principalId]);
    await audit(tx, workspaceId, member.principalId, customer.id, 'create');
    await tx.query(`INSERT INTO relay_crm.request_dedup(workspace_id,actor_id,operation,key,payload_hash,response_status,result_id,expires_at)
      VALUES($1,$2,'customer.create',$3,$4,201,$5,now()+interval '7 days')`, [workspaceId,member.principalId,key,payloadHash,customer.id]);
    return {customer, replayed: false};
  }, db);
}
