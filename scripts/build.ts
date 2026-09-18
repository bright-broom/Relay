import {build} from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import {buildModules} from './build-modules.ts';
import {buildPwa} from './pwa.ts';
import {readFile, writeFile, mkdir, copyFile, cp, rm} from 'node:fs/promises';
// The public demo can deploy before OAuth is configured. Private routes fail closed.
// Run check:auth-config -- --deployment separately before enabling real sign-in.
// Build the same token source for browsers and future framework adapters.
const tokenModule = await build({entryPoints:['src/design/tokens.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {tokens,breakpoints,palette}=await import('data:text/javascript;base64,'+Buffer.from(tokenModule.outputFiles[0].text).toString('base64')) as typeof import('../src/design/tokens');
const brandModule=await build({entryPoints:['src/i18n/messages.ts'],bundle:true,write:false,format:'esm',platform:'node'});
const {brand}=await import('data:text/javascript;base64,'+Buffer.from(brandModule.outputFiles[0].text).toString('base64')) as typeof import('../src/i18n/messages');
await rm('prototype',{recursive:true,force:true});
await mkdir('prototype/assets',{recursive:true});
await writeFile('prototype/index.html',(await readFile('src/prototype/index.html','utf8')).replaceAll('__THEME_COLOR__',palette.sub).replaceAll('__APP_NAME__',brand));
let css=await readFile('src/prototype/styles.css','utf8');
for(const [name,width] of Object.entries(breakpoints)) css=css.replaceAll(`__${name.toUpperCase()}__`,width);
const componentCss=await postcss([tailwind()]).process(await readFile('src/design/components.css','utf8'),{from:'src/design/components.css'});
await writeFile('prototype/assets/styles.css','/* Generated from src/design/tokens.ts and src/prototype/styles.css */\n:root {\n'+Object.entries(tokens).map(([k,v])=>`  --${k}: ${v};`).join('\n')+'\n}\n'+componentCss.css+'\n'+css);
const applicationAssets = await buildModules();
// Standalone IIFE remains the file:// preview entry; HTTP uses split ESM modules.
await build({entryPoints:['src/app/main.tsx'],outfile:'prototype/assets/app.js',bundle:true,format:'iife',target:['safari16','chrome110'],minify:true});
await build({entryPoints:['src/prototype/session.ts'],define:{__APP_ASSETS__:JSON.stringify(applicationAssets)},outfile:'prototype/assets/session.js',bundle:true,format:'iife',target:['safari16','chrome110'],minify:true});
await rm('.vercel/server',{recursive:true,force:true});
await mkdir('.vercel/server',{recursive:true});
await build({entryPoints:['src/server/handler.ts'],outfile:'.vercel/server/app.relay-server.mjs',bundle:true,packages:'external',platform:'node',format:'esm',target:'node24',banner:{js:'// Generated from src/server/handler.ts. Do not edit.'}});
await buildPwa(palette,brand);
// Only explicitly public files reach the static CDN. Private app files live in the function bundle.
await rm('public',{recursive:true,force:true});
await mkdir('public/assets',{recursive:true});
for(const name of ['styles.css','session.js'])await copyFile('prototype/assets/'+name,'public/assets/'+name);
for(const name of ['sw.js','manifest.webmanifest'])await copyFile('prototype/'+name,'public/'+name);
for(const name of ['icons'])await cp('prototype/'+name,'public/'+name,{recursive:true});
console.log('Built Relay PWA and authenticated server.');
