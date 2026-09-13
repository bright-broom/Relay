import { configured, lineConfigured } from './config';
import { session } from './auth';
import { database, type Database } from './database';
import { ApiError } from './line';
import type { AdminOverview } from '../admin/types';

import { administratorAllowed as isAdmin } from './access';
export { isAdmin };
export async function adminOverview(request: Request, db: Database = database()): Promise<AdminOverview> {
  const identity = await session(request, db);
  if (!identity) throw new ApiError(401, 'unauthorized');
  if (!isAdmin(identity.email)) throw new ApiError(403, 'forbidden');
  const rows = await db.query<{ email: string; sessions: number }>(
    'SELECT lower(email) AS email, count(*)::int AS sessions FROM relay_private.sessions WHERE expires_at > now() GROUP BY lower(email)',
  );
  const counts = new Map(rows.map(row => [row.email, row.sessions]));
  const emails = [...new Set((process.env.ALLOWED_GOOGLE_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean))].sort();
  return {
    viewer: identity.email,
    accounts: emails.map(email => ({email, role: isAdmin(email) ? 'admin' : 'member', sessions: counts.get(email) ?? 0})),
    // Configuration presence is not evidence of a successful provider connection.
    configuration: {google: configured(), database: true, line: lineConfigured(), calendar: Boolean(process.env.TOKEN_ENCRYPTION_KEY)},
  };
}
