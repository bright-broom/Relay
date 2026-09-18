import { z } from 'zod';
import { allowed } from './config';

type Environment = Readonly<Record<string, string | undefined>>;
export type ConfigurationIssue = {
  field: string;
  code: 'missing' | 'invalid' | 'adminNotAllowed';
};
function addresses(raw: string | undefined) {
  return (raw ?? '').split(',').map(value => value.trim().toLowerCase());
}
/** Return field names and codes only; never expose addresses or credentials in diagnostics. */
export function administratorIssues(env: Environment = process.env): ConfigurationIssue[] {
  const issues: ConfigurationIssue[] = [];
  for (const field of ['ALLOWED_GOOGLE_EMAILS', 'ADMIN_GOOGLE_EMAILS']) {
    if (!env[field]?.trim()) issues.push({field, code:'missing'});
    else if (addresses(env[field]).some(value => !z.email().safeParse(value).success))
      issues.push({field, code:'invalid'});
  }
  if (!issues.length && addresses(env.ADMIN_GOOGLE_EMAILS).some(email => !allowed(email, env.ALLOWED_GOOGLE_EMAILS)))
    issues.push({field:'ADMIN_GOOGLE_EMAILS', code:'adminNotAllowed'});
  return issues;
}
export function administratorAllowed(email: unknown): boolean {
  return administratorIssues().length === 0 && allowed(email) && allowed(email, process.env.ADMIN_GOOGLE_EMAILS ?? '');
}
/** @public Invoked by scripts/check-auth-config.ts and tests/server.ts; source is loaded through esbuild. */
export function authConfigurationIssues(env: Environment = process.env): ConfigurationIssue[] {
  const issues = administratorIssues(env);
  for (const field of ['APP_ORIGIN','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','DATABASE_URL']) {
    if (!env[field]?.trim()) { issues.push({field,code:'missing'}); continue; }
    if (field === 'APP_ORIGIN' || field === 'DATABASE_URL') {
      try {
        const url = new URL(env[field]!);
        const valid = field === 'APP_ORIGIN'
          ? url.protocol === 'https:' && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash
          : ['postgres:', 'postgresql:'].includes(url.protocol) && Boolean(url.hostname);
        if (!valid) issues.push({field,code:'invalid'});
      } catch { issues.push({field,code:'invalid'}); }
    }
  }
  return issues;
}
