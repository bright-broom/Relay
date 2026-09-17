import {createHmac, timingSafeEqual, randomUUID} from 'node:crypto';
import {hash, randomToken, type Identity} from './auth';
import {allowed, origin} from './config';
import {database, type Database} from './database';
import {translate, type Locale} from '../i18n/messages';

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export type Destination = {id: string; kind: 'user' | 'group'; enabled: boolean; line_id: string};
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
/** @public Invoked by tests/server.mjs; source is loaded through esbuild. */
export function validSignature(raw: string, signature: string | null, secret: string): boolean {
  if (!secret || !signature || !/^[A-Za-z0-9+/]{43}=$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest();
  const actual = Buffer.from(signature, 'base64');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function destinations(identity: Identity, db: Database = database()) {
  const rows = await db.query<Destination>('SELECT id,kind,enabled,line_id FROM relay_private.line_destinations WHERE owner_email=$1 ORDER BY kind', [identity.email]);
  return rows.map(({line_id, ...row}) => ({...row, reference: line_id.slice(-6)}));
}
export async function issueCode(identity: Identity, kind: unknown, db: Database = database()) {
  if (kind !== 'user' && kind !== 'group') throw new ApiError(400, 'invalid');
  if (kind === 'group') {
    const [personal] = await db.query('SELECT id FROM relay_private.line_destinations WHERE owner_email=$1 AND kind=\'user\' AND enabled=true', [identity.email]);
    if (!personal) throw new ApiError(409, 'personalFirst');
  }
  const token = randomToken();
  await db.query('INSERT INTO relay_private.line_codes(token_hash,owner_email,kind,expires_at) VALUES($1,$2,$3,now()+interval \'10 minutes\') ON CONFLICT(owner_email,kind) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at', [hash(token),identity.email,kind]);
  return {code: `RELAY ${token}`, expiresIn: 600};
}
export async function changeDestination(identity: Identity, id: unknown, action: unknown, db: Database = database()) {
  if (!uuid(id) || (action !== 'confirm' && action !== 'remove')) throw new ApiError(400, 'invalid');
  await db.transaction(async tx => {
    const [row] = await tx.query<Destination>('SELECT id,kind,enabled,line_id FROM relay_private.line_destinations WHERE id=$1 AND owner_email=$2 FOR UPDATE', [id,identity.email]);
    if (!row) throw new ApiError(404, 'missing');
    if (action === 'confirm') await tx.query('UPDATE relay_private.line_destinations SET enabled=true WHERE id=$1', [id]);
    else {
      await tx.query('DELETE FROM relay_private.line_destinations WHERE id=$1', [id]);
      // A removed personal identity can no longer authorize existing group bindings.
      if (row.kind === 'user') await tx.query('DELETE FROM relay_private.line_destinations WHERE owner_email=$1 AND kind=\'group\'', [identity.email]);
    }
  });
}
type Event = {webhookEventId?: string; type?: string; source?: {type?: string; userId?: string; groupId?: string}; message?: {type?: string; text?: string}};
export async function webhook(raw: string, signature: string | null, db: Database = database()) {
  if (!validSignature(raw, signature, process.env.LINE_CHANNEL_SECRET ?? '')) throw new ApiError(401, 'signature');
  let body: {events?: Event[]};
  try { body = JSON.parse(raw); } catch { throw new ApiError(400, 'invalid'); }
  if (!body || !Array.isArray(body.events) || body.events.length > 100) throw new ApiError(400, 'invalid');
  for (const event of body.events) {
    if (!event || typeof event.webhookEventId !== 'string' || !event.source) continue;
    const {source} = event;
    await db.transaction(async tx => {
      const inserted = await tx.query('INSERT INTO relay_private.line_events(event_id) VALUES($1) ON CONFLICT DO NOTHING RETURNING event_id', [event.webhookEventId!]);
      if (!inserted.length) return;
      const lineId = source.type === 'group' ? source.groupId : source.type === 'user' ? source.userId : undefined;
      if (!lineId) return;
      if (event.type === 'unfollow' || event.type === 'leave') {
        // Remove bindings; delayed confirmation requests cannot re-enable them.
        await tx.query('DELETE FROM relay_private.line_destinations WHERE line_id=$1 OR ($2=\'unfollow\' AND actor_id=$1)', [lineId,event.type]);
        return;
      }
      if (event.type !== 'message' || event.message?.type !== 'text' || typeof event.message.text !== 'string' || !source.userId) return;
      const match = /^RELAY ([A-Za-z0-9_-]{43})$/.exec(event.message.text.trim());
      if (!match) return;
      const [code] = await tx.query<{owner_email: string; kind: string}>('SELECT owner_email,kind FROM relay_private.line_codes WHERE token_hash=$1 AND expires_at > now() FOR UPDATE', [hash(match[1])]);
      if (!code || code.kind !== source.type || !allowed(code.owner_email)) return;
      if (source.type === 'group') {
        const [personal] = await tx.query('SELECT id FROM relay_private.line_destinations WHERE owner_email=$1 AND kind=\'user\' AND line_id=$2 AND enabled=true', [code.owner_email,source.userId]);
        if (!personal) return;
      }
      await tx.query('DELETE FROM relay_private.line_codes WHERE token_hash=$1', [hash(match[1])]);
      // Replace with a fresh id so a stale confirmation cannot approve a different chat.
      await tx.query('DELETE FROM relay_private.line_destinations WHERE owner_email=$1 AND kind=$2', [code.owner_email,code.kind]);
      if (code.kind === 'user') await tx.query('DELETE FROM relay_private.line_destinations WHERE owner_email=$1 AND kind=\'group\'', [code.owner_email]);
      await tx.query('INSERT INTO relay_private.line_destinations(id,owner_email,kind,line_id,actor_id) VALUES($1,$2,$3,$4,$5)', [randomUUID(),code.owner_email,code.kind,lineId,source.userId]);
    });
  }
}
function notificationText(locale: Locale): string {
  return `${translate(locale, 'lineTestMessage')}\n${origin()}`;
}
type Notification = {id: string; line_id: string; locale: Locale; state: string; created_at: Date};
export async function notify(identity: Identity, input: Record<string, unknown>, db: Database = database(), send: typeof fetch = fetch) {
  if (!uuid(input.id) || !uuid(input.destinationId) || (input.locale !== 'ja' && input.locale !== 'en')) throw new ApiError(400, 'invalid');
  const id = input.id, destinationId = input.destinationId, locale = input.locale;
  const job = await db.transaction(async tx => {
    // Per-owner lock also serializes quotas across multiple tabs / server instances.
    await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [identity.email]);
    const [dest] = await tx.query<Destination>('SELECT id,kind,enabled,line_id FROM relay_private.line_destinations WHERE id=$1 AND owner_email=$2 AND enabled=true', [destinationId,identity.email]);
    if (!dest) throw new ApiError(404, 'missing');
    const [existing] = await tx.query<Notification & {owner_email: string; destination_id: string}>('SELECT * FROM relay_private.notifications WHERE id=$1', [id]);
    if (existing && (existing.owner_email !== identity.email || existing.destination_id !== destinationId || existing.locale !== locale)) throw new ApiError(409, 'conflict');
    if (!existing) {
      const [count] = await tx.query<{count: string}>('SELECT count(*) FROM relay_private.notifications WHERE owner_email=$1 AND created_at > now()-interval \'1 hour\'', [identity.email]);
      if (Number(count.count) >= 10) throw new ApiError(429, 'rateLimit');
      await tx.query('INSERT INTO relay_private.notifications(id,owner_email,destination_id,line_id,locale) VALUES($1,$2,$3,$4,$5)', [id,identity.email,destinationId,dest.line_id,locale]);
    }
    if (existing?.state === 'sent') return null;
    // LINE retains retry keys for 24 hours. Never retry beyond that window.
    const [claimed] = await tx.query<Notification>('UPDATE relay_private.notifications SET state=\'sending\',attempts=attempts+1,lease_until=now()+interval \'30 seconds\' WHERE id=$1 AND created_at > now()-interval \'23 hours\' AND attempts < 5 AND state IN (\'pending\',\'sending\') AND (lease_until IS NULL OR lease_until < now()) RETURNING *', [id]);
    if (!claimed) throw new ApiError(409, 'pending');
    return claimed;
  });
  if (!job) return {state: 'sent'};
  try {
    const response = await send('https://api.line.me/v2/bot/message/push', {
      method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`, 'X-Line-Retry-Key': job.id},
      body: JSON.stringify({to: job.line_id, messages: [{type: 'text', text: notificationText(job.locale)}]}), signal: AbortSignal.timeout(10000),
    });
    const accepted = response.ok || (response.status === 409 && Boolean(response.headers.get('x-line-accepted-request-id')));
    await txResult(accepted ? 'sent' : response.status === 429 || response.status >= 500 ? 'pending' : 'failed');
    if (!accepted) throw new ApiError(502, 'delivery');
    return {state: 'sent'};
  } catch (error) {
    if (!(error instanceof ApiError)) await txResult('pending');
    throw error instanceof ApiError ? error : new ApiError(502, 'delivery');
  }
  async function txResult(state: string) {
    await db.query('UPDATE relay_private.notifications SET state=$2,lease_until=NULL WHERE id=$1', [id,state]);
  }
}
