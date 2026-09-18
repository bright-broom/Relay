import type {Database} from './database';

/** Read-only deployment check: validate required columns and privileges without reading user rows. */
/** @public Invoked by scripts/check-auth-config.ts and tests/server.ts; source is loaded through esbuild. */
export async function loginDatabaseReady(db: Pick<Database, 'query'>): Promise<boolean> {
  await db.query('SELECT token_hash,state,nonce,verifier,expires_at FROM relay_private.oauth_attempts WHERE false');
  await db.query('SELECT token_hash,subject,email,expires_at FROM relay_private.sessions WHERE false');
  const [row] = await db.query<{ready: boolean}>(`
    SELECT has_schema_privilege(current_user, 'relay_private', 'USAGE')
      AND has_table_privilege(current_user, 'relay_private.oauth_attempts', 'SELECT')
      AND has_table_privilege(current_user, 'relay_private.oauth_attempts', 'INSERT')
      AND has_table_privilege(current_user, 'relay_private.oauth_attempts', 'DELETE')
      AND has_table_privilege(current_user, 'relay_private.sessions', 'SELECT')
      AND has_table_privilege(current_user, 'relay_private.sessions', 'INSERT')
      AND has_table_privilege(current_user, 'relay_private.sessions', 'DELETE') AS ready`);
  return row?.ready === true;
}
