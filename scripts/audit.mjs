import {readFile,readdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Conservative source-reference audit. Runtime-composed labels must use explicit key maps.
const files=(await readdir('src',{recursive:true})).filter(path=>path.endsWith('.ts')&&!['i18n/messages.ts','design/tokens.ts'].includes(path));
const source=(await Promise.all(files.map(path=>readFile(`src/${path}`,'utf8')))).join('\n');
const output=await build({entryPoints:['src/i18n/messages.ts'],bundle:true,write:false,format:'esm'});
const {ja}=await import('data:text/javascript;base64,'+Buffer.from(output.outputFiles[0].text).toString('base64'));
const unreferenced=Object.keys(ja).filter(key=>!source.includes(`'${key}'`)&&!source.includes(`"${key}"`));
assert.deepEqual(unreferenced,[],'Unreferenced translation keys; inspect dynamic key maps before removal');
const css=await readFile('src/prototype/styles.css','utf8');
const classes=[...new Set([...css.matchAll(/\.([a-z][a-z-]*)/g)].map(match=>match[1]))];
const missing=classes.filter(name=>!new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(source));
assert.deepEqual(missing,[],'CSS classes without a source reference; inspect state variants before removal');
console.log(`Reference audit: ${Object.keys(ja).length} message keys and ${classes.length} CSS classes checked. Dynamic behavior still requires review.`);
