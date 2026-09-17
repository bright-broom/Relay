import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, readdir} from 'node:fs/promises';
import {posix} from 'node:path';
import {JSDOM} from 'jsdom';
import {tokens} from '../src/design/tokens.ts';

// These are deployment inputs, not a general exemption for generated directories.
const generated = [
  'api/relay.mjs', 'prototype/index.html', 'prototype/assets/app.js',
  'prototype/assets/session.js', 'prototype/assets/styles.css', 'prototype/sw.js',
  'prototype/manifest.webmanifest', ...[180,192,512].map(size=>`prototype/icons/icon-${size}.png`),
];
const tracked = execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{encoding:'utf8'}).split('\0').filter(Boolean);
const htmlFiles = [...new Set(tracked.filter(file=>/\.html?$/i.test(file)))].sort();
assert.deepEqual(htmlFiles,['prototype/index.html','src/prototype/index.html'],'Unreviewed HTML: connect it to an entry point or remove it');
for (const directory of ['api','prototype']) {
  const files = (await readdir(directory,{recursive:true,withFileTypes:true})).filter(entry=>entry.isFile())
    .map(entry=>posix.relative(process.cwd(),posix.join(entry.parentPath,entry.name))).sort();
  assert.deepEqual(files,generated.filter(file=>file.startsWith(directory+'/')).sort(),'Unexpected or missing generated asset');
}
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
