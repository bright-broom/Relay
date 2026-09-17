/** Public entry points only. Credentials and access lists remain server-side. */
/** @public Invoked by scripts/check-auth-config.mjs; source is loaded through esbuild. */
export const publicApplicationOrigin = 'https://relay-chi-ecru.vercel.app';

export function adminSignInHref(isHosted: boolean, locale: string): string {
  if (isHosted) return '/api/auth/start?destination=admin';
  // Enter through the server-rendered page so canonical-origin redirects and
  // configuration/permission states are handled before Google authentication.
  const target = new URL('/admin', publicApplicationOrigin);
  target.searchParams.set('lang', locale);
  return target.href;
}
