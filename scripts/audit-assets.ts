import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';
import {posix} from 'node:path';
import {JSDOM} from 'jsdom';
import {createHash} from 'node:crypto';
import {tokens} from '../src/design/tokens.ts';

// These are deployment inputs, not a general exemption for generated directories.
const generated = [
  'dist/server/app.relay-server.mjs', 'prototype/index.html', 'prototype/assets/app.js',
  'prototype/assets/session.js', 'prototype/assets/styles.css', 'prototype/sw.js',
  'prototype/manifest.webmanifest', ...[180,192,512].map(size=>`prototype/icons/icon-${size}.png`),
];
const modules = JSON.parse(await readFile('prototype/assets/module-manifest.json','utf8')) as {
  entry:string;eager:string[];features:Record<string,string[]>;
  files:Record<string,{bytes:number;sha256:string;imports:string[];inputs:string[]}>;
};
const closure = (entry:string) => {
  const visited = new Set<string>();
  const visit = (file:string) => {
    assert.ok(Object.hasOwn(modules.files,file),'Missing module dependency');
    if (visited.has(file)) return;
    visited.add(file);for (const child of modules.files[file]!.imports) visit(child);
  };
  visit(entry);return [...visited];
};
assert.deepEqual(modules.eager,closure(modules.entry),'Incorrect eager loading graph');
assert.deepEqual(Object.keys(modules.features).sort(),['admin','customers','mypage','pricing','scheduling']);
for (const files of Object.values(modules.features)) assert.deepEqual(files,closure(files[0]!),'Incorrect feature loading graph');
assert.deepEqual([...new Set([...modules.eager,...Object.values(modules.features).flat()])].sort(),Object.keys(modules.files).sort(),'Orphan module');
for (const [file,metadata] of Object.entries(modules.files)) {
  assert.match(file,/^(app|chunk)-[A-Z0-9]{8}\.js$/);
  const path = 'prototype/assets/modules/'+file;
  const content = await readFile(path);
  assert.equal(content.length,metadata.bytes);
  assert.equal(createHash('sha256').update(content).digest('hex'),metadata.sha256,'Stale module manifest');
  generated.push(path);
}
generated.push('prototype/assets/module-manifest.json');
const tracked = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
assert.deepEqual((await readdir('api')).sort(),['relay.ts'],'Unexpected API entry or generated JavaScript');
const htmlFiles = [...new Set(tracked.filter(file=>/\.html?$/i.test(file)))].sort();
assert.deepEqual(htmlFiles,['src/prototype/index.html'],'Unreviewed HTML: connect it to an entry point or remove it');
for (const directory of ['dist/server','prototype']) {
  const files = (await readdir(directory,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile())
    .map(entry=>posix.relative(process.cwd(),posix.join(entry.parentPath,entry.name))).sort();
  assert.deepEqual(files,generated.filter(file=>file.startsWith(directory+'/')).sort(),'Unexpected or missing generated asset');
}
const publicFiles = (await readdir('public',{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile())
  .map(entry=>posix.relative(posix.join(process.cwd(),'public'),posix.join(entry.parentPath,entry.name))).sort();
assert.deepEqual(publicFiles,['assets/session.js','assets/styles.css','manifest.webmanifest','sw.js',
  ...[180,192,512].map(size=>`icons/icon-${size}.png`)].sort(),'Only selected public assets may bypass the function');
const html = await readFile('prototype/index.html','utf8');
assert.ok(!/__\w+__/.test(html),'Unresolved HTML placeholder');
const dom = new JSDOM(html);
try {
  const document = dom.window.document;
  assert.equal(document.body.children.length,1,'Legacy HTML screen outside the React root');
  const root = document.getElementById('app');
  assert.ok(root && root.parentElement === document.body && !root.hasChildNodes(),'Legacy HTML inside the React root');
  assert.deepEqual([...document.scripts].map(script=>script.getAttribute('src')),['assets/session.js'],'Session bootstrap must own application loading');
  for (const element of document.querySelectorAll('[src],[href]')) {
    for (const attribute of ['src','href']) {
      const value = element.getAttribute(attribute);
      if (value) assert.ok(generated.includes(posix.normalize('prototype/'+value)),`Unknown HTML asset: ${value}`);
    }
  }
} finally {dom.window.close();}

// Reject obsolete output variables while retaining shared scales used to define roles.
const css = await readFile('prototype/assets/styles.css','utf8');
const tokenSource = await readFile('src/design/tokens.ts','utf8');
for (const name of Object.keys(tokens)) {
  assert.ok(css.includes(`var(--${name})`) || tokenSource.includes(`primitives['${name}']`),`Unreferenced design token: ${name}`);
}
console.log('Asset audit: HTML entry, session bootstrap, generated inventory and design-token references passed.');
