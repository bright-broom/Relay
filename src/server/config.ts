export function allowed(email: unknown, list = process.env.ALLOWED_GOOGLE_EMAILS ?? ''): email is string {
  return typeof email === 'string' && list.split(',').some(item => item.trim().toLowerCase() === email.toLowerCase() && item.trim() !== '');
}
export function origin(): string {
  const url = new URL(process.env.APP_ORIGIN ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('configuration');
  return url.origin;
}
export function configured(): boolean {
  try { origin(); return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.DATABASE_URL && process.env.ALLOWED_GOOGLE_EMAILS?.trim()); }
  catch { return false; }
}
export function lineConfigured(): boolean {
  return Boolean(process.env.LINE_CHANNEL_SECRET && process.env.LINE_CHANNEL_ACCESS_TOKEN);
}
export function sameOrigin(request: Request): boolean {
  return request.headers.get('origin') === origin();
}
