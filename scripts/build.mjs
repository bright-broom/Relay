import {build} from 'esbuild';
import {buildPwa} from './pwa.mjs';
import {readFile, writeFile, mkdir} from 'node:fs/promises';
// Build the same token source for browsers and future framework adapters.
const tokenModule = await build({entryPoints:['src/design/tokens.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {tokens,breakpoints,palette}=await import('data:text/javascript;base64,'+Buffer.from(tokenModule.outputFiles[0].text).toString('base64'));
await mkdir('prototype/assets',{recursive:true});
await writeFile('prototype/index.html',(await readFile('src/prototype/index.html','utf8')).replaceAll('__THEME_COLOR__',palette.sub));
let css=await readFile('src/prototype/styles.css','utf8');
for(const [name,width] of Object.entries(breakpoints)) css=css.replaceAll(`__${name.toUpperCase()}__`,width);
await writeFile('prototype/assets/styles.css','/* Generated from src/design/tokens.ts and src/prototype/styles.css */\n:root {\n'+Object.entries(tokens).map(([k,v])=>`  --${k}: ${v};`).join('\n')+'\n}\n'+css);
await build({entryPoints:['src/prototype/app.ts'],outfile:'prototype/assets/app.js',bundle:true,format:'iife',target:['safari16','chrome110'],minify:true});
await buildPwa(palette);
console.log('Built Relay PWA.');
