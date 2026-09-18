import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, rm, mkdir, copyFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

// Model the native Vercel TypeScript runtime: emit separate ESM files and import
// the actual API entry plus the generated bundle in Node, without source files.
const directory = '.vercel/check-server-runtime';
await rm(directory,{recursive:true,force:true});
execFileSync(resolve('node_modules/.bin/tsc'),['--project','tsconfig.server.json','--noEmit','false','--outDir',directory],{stdio:'inherit'});
await rm(resolve(directory,'src'),{recursive:true,force:true});
await mkdir(resolve(directory,'dist/server'),{recursive:true});
await copyFile('dist/server/app.relay-server.mjs',resolve(directory,'dist/server/app.relay-server.mjs'));
for (const key of ['APP_ORIGIN','DATABASE_URL','CRM_DATABASE_URL','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET',
  'ALLOWED_GOOGLE_EMAILS','ADMIN_GOOGLE_EMAILS','LINE_CHANNEL_SECRET','LINE_CHANNEL_ACCESS_TOKEN','TOKEN_ENCRYPTION_KEY']) delete process.env[key];
const {default:endpoint} = await import(pathToFileURL(resolve(directory,'api/relay.js')).href) as typeof import('../api/relay');
const request = (route:string) => new Request(`https://relay.test/api/relay?route=${route}`);
const page = await endpoint.fetch(request('page'));
assert.equal(page.status,200);
assert.match(await page.text(),/data-public-preview="true"/);
assert.equal(page.headers.get('cache-control'),'private, no-store');
for (const route of ['login-page','admin-page']) {
  const response = await endpoint.fetch(request(route));
  assert.equal(response.status,503);
  assert.match(response.headers.get('content-type')!,/text\/html/);
  assert.ok((await response.text()).includes('<html'));
}
const app = await endpoint.fetch(request('app'));
assert.equal(app.status,200);
assert.equal(await app.text(),await readFile('prototype/assets/app.js','utf8'));
const modules = JSON.parse(await readFile('prototype/assets/module-manifest.json','utf8')) as {entry:string};
const chunk = await endpoint.fetch(request('app-module&file='+modules.entry));
assert.equal(chunk.status,200);
assert.equal(await chunk.text(),await readFile('prototype/assets/modules/'+modules.entry,'utf8'));
assert.equal((await endpoint.fetch(request('session'))).status,503);
console.log('Native server ESM: API startup, public page/assets, server-rendered login/admin and private API fail-closed passed.');
