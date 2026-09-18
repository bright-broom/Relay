import {build} from 'esbuild';
import postgres from 'postgres';
const output = await build({stdin:{contents:"export * from './src/server/access'; export * from './src/server/readiness'; export {publicApplicationOrigin} from './src/prototype/public-links';",resolveDir:process.cwd()},bundle:true,write:false,platform:'node',format:'esm'});
const {authConfigurationIssues, loginDatabaseReady, publicApplicationOrigin} = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64')) as typeof import('../src/server/access') & typeof import('../src/server/readiness') & typeof import('../src/prototype/public-links');
const deployment = process.argv.includes('--deployment');
const issues: {field:string;code:string}[] = authConfigurationIssues();
if (deployment && !issues.some(issue => issue.field === 'APP_ORIGIN') && new URL(process.env.APP_ORIGIN!).origin !== publicApplicationOrigin)
  issues.push({field:'APP_ORIGIN',code:'publicOriginMismatch'});
if (issues.length) {
  for (const {field,code} of issues) console.error(`${field}: ${code}`);
  process.exitCode = 1;
}
// OAuth setup and database setup are independent. Report both in one attempt,
// but never connect with a missing or malformed database URL.
if (deployment && !issues.some(issue => issue.field === 'DATABASE_URL')) {
  let sql: ReturnType<typeof postgres> | undefined;
  try {
    sql = postgres(process.env.DATABASE_URL!, {ssl:'verify-full',max:1,prepare:false,connect_timeout:10,connection:{statement_timeout:10000}});
    if (!await loginDatabaseReady({query: <T extends Record<string,unknown>>(text:string) => sql!.unsafe<T[]>(text)})) throw new Error('permissions');
    console.log(issues.length
      ? 'Login database connection, schema and permissions: OK. Other configuration errors still block deployment.'
      : 'Auth deployment preflight: configuration, public origin and login database permissions OK. Live Google sign-in still requires verification.');
  } catch {
    // Do not print provider errors: they can contain connection URLs, addresses or credentials.
    console.error('DATABASE_URL: connectionSchemaOrPermissions');
    process.exitCode = 1;
  } finally { await sql?.end({timeout:1}).catch(() => {}); }
} else if (!deployment && !issues.length) {
  console.log('Auth configuration structure: OK. Google credentials, database connection and deployed behavior still require live verification.');
}
