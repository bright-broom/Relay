import {build} from 'esbuild';
import {mkdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';

export async function buildModules() {
  const directory = 'prototype/assets/modules';
  // This directory contains only this build's module outputs, never application data.
  await rm(directory,{recursive:true,force:true});
  await mkdir(directory,{recursive:true});
  const result = await build({entryPoints:['src/app/main.tsx'],outdir:directory,entryNames:'app-[hash]',chunkNames:'chunk-[hash]',
    bundle:true,splitting:true,format:'esm',target:['safari16','chrome110'],minify:true,metafile:true,write:false});
  const files:Record<string,{bytes:number;sha256:string;imports:string[];inputs:string[]}> = {};
  const entries:Record<string,string> = {};
  for (const output of result.outputFiles) {
    const name = posix.basename(output.path);
    const metadata = result.metafile.outputs[`${directory}/${name}`]!;
    files[name] = {bytes:output.contents.length,sha256:createHash('sha256').update(output.contents).digest('hex'),
      imports:metadata.imports.filter(item=>item.kind === 'import-statement').map(item=>posix.basename(item.path)),inputs:Object.keys(metadata.inputs)};
    if (metadata.entryPoint) entries[metadata.entryPoint] = name;
    await writeFile(output.path,output.contents);
  }
  const closure = (entry:string) => {
    const visited = new Set<string>();
    const visit = (name:string) => {if (visited.has(name)) return;visited.add(name);for (const next of files[name]!.imports) visit(next);};
    visit(entry);return [...visited];
  };
  const entry = entries['src/app/main.tsx']!;
  const features = Object.fromEntries(Object.entries({pricing:'pricing',scheduling:'scheduling',customers:'customers',mypage:'my-page',admin:'admin'})
    .map(([name,source])=>[name,closure(entries[`src/app/${source}.tsx`]!)]));
  const manifest = {entry,eager:closure(entry),features,files};
  await writeFile('prototype/assets/module-manifest.json',JSON.stringify(manifest,null,2)+'\n');
  return {entry:manifest.entry,eager:manifest.eager,features};
}
