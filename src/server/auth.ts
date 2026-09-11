import {createHash, randomBytes} from 'node:crypto';
import * as oidc from 'openid-client';
import {allowed, origin} from './config';
import {database, type Database} from './database';

export const sessionCookie = '__Host-relay-session';
export const oauthCookie = '__Host-relay-oauth';
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const randomToken = () => randomBytes(32).toString('base64url');
export function cookie(name: string, value: string, age: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;
}
export function readCookie(request: Request, name: string): string {
  const value = (request.headers.get('cookie') ?? '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : '';
}
export type Identity = {email: string; subject: string};
export async function session(request: Request, db: Database = database()): Promise<Identity | null> {
  const token = readCookie(request, sessionCookie);
  if (!token) return null;
  const [row] = await db.query<Identity>('SELECT email, subject FROM relay_private.sessions WHERE token_hash=$1 AND expires_at > now()', [hash(token)]);
  return row && allowed(row.email) ? row : null;
}
let provider: Promise<oidc.Configuration> | undefined;
function google() {
  return provider ??= oidc.discovery(new URL('https://accounts.google.com'), process.env.GOOGLE_CLIENT_ID!, process.env.GOOGLE_CLIENT_SECRET!, undefined, {execute: [oidc.enableNonRepudiationChecks]}).catch(error => { provider = undefined; throw error; });
}
export async function startLogin(db: Database = database(), configuration?: oidc.Configuration) {
  const config = configuration ?? await google();
  const token = randomToken(), state = oidc.randomState(), nonce = oidc.randomNonce(), verifier = oidc.randomPKCECodeVerifier();
  await db.query('DELETE FROM relay_private.oauth_attempts WHERE expires_at < now()');
  await db.query('INSERT INTO relay_private.oauth_attempts(token_hash,state,nonce,verifier,expires_at) VALUES($1,$2,$3,$4,now()+interval \'10 minutes\')', [hash(token),state,nonce,verifier]);
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: `${origin()}/api/auth/callback`, scope: 'openid email', prompt: 'select_account',
    state, nonce, code_challenge: await oidc.calculatePKCECodeChallenge(verifier), code_challenge_method: 'S256',
  });
  return new Response(null, {status: 303, headers: {Location: url.href, 'Set-Cookie': cookie(oauthCookie, token, 600)}});
}
export function verifiedIdentity(claims: Record<string, unknown> | undefined): Identity | null {
  if (!claims || claims.email_verified !== true || !allowed(claims.email) || typeof claims.sub !== 'string' || !claims.sub) return null;
  // Google is authoritative for Gmail and verified Workspace addresses.
  if (!claims.email.toLowerCase().endsWith('@gmail.com') && !(typeof claims.hd === 'string' && claims.hd)) return null;
  return {email: claims.email.toLowerCase(), subject: claims.sub};
}
export async function finishLogin(request: Request, db: Database = database(), configuration?: oidc.Configuration) {
  const token = readCookie(request, oauthCookie);
  const headers = new Headers({'Set-Cookie': cookie(oauthCookie, '', 0)});
  const failure = () => { headers.set('Location', '/?auth=denied'); return new Response(null, {status: 303, headers}); };
  if (!token) return failure();
  // Atomic consume prevents callback replay, including concurrent attempts.
  const [attempt] = await db.query<{state: string; nonce: string; verifier: string}>('DELETE FROM relay_private.oauth_attempts WHERE token_hash=$1 AND expires_at > now() RETURNING state,nonce,verifier', [hash(token)]);
  if (!attempt) return failure();
  try {
    const callback = new URL(`${origin()}/api/auth/callback`);
    const incoming = new URL(request.url);
    for (const key of ['code','state','error','error_description','iss']) for (const value of incoming.searchParams.getAll(key)) callback.searchParams.append(key, value);
    const tokens = await oidc.authorizationCodeGrant(configuration ?? await google(), callback, {
      pkceCodeVerifier: attempt.verifier, expectedState: attempt.state, expectedNonce: attempt.nonce, idTokenExpected: true,
    });
    const identity = verifiedIdentity(tokens.claims());
    if (!identity) return failure();
    const newToken = randomToken();
    await db.query('DELETE FROM relay_private.sessions WHERE expires_at < now() OR token_hash=$1', [hash(readCookie(request, sessionCookie))]);
    await db.query('INSERT INTO relay_private.sessions(token_hash,subject,email,expires_at) VALUES($1,$2,$3,now()+interval \'8 hours\')', [hash(newToken),identity.subject,identity.email]);
    headers.append('Set-Cookie', cookie(sessionCookie, newToken, 28800));
    headers.set('Location', '/');
    return new Response(null, {status: 303, headers});
  } catch { return failure(); }
}
export async function logout(request: Request, db: Database = database()) {
  await db.query('DELETE FROM relay_private.sessions WHERE token_hash=$1', [hash(readCookie(request, sessionCookie))]);
  const headers = new Headers({'Set-Cookie': cookie(sessionCookie, '', 0)});
  headers.append('Set-Cookie', cookie(oauthCookie, '', 0));
  return Response.json({ok: true}, {headers});
}
