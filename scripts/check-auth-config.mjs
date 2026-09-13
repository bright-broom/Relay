import {build} from 'esbuild';
const output = await build({entryPoints:['src/server/access.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {authConfigurationIssues} = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));
const issues = authConfigurationIssues();
if (issues.length) {
  for (const {field,code} of issues) console.error(`${field}: ${code}`);
  process.exitCode = 1;
} else {
  console.log('Auth configuration structure: OK. Google credentials, database connection and deployed behavior still require live verification.');
}
