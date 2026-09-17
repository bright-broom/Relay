import {readFile} from 'node:fs/promises';
import {ApiError} from './line';

// Build-scoped code only. Neither API responses nor user records enter this cache.
let manifest:Promise<{files:Record<string,unknown>}> | undefined;
const contents = new Map<string,Promise<string>>();
export async function appModule(file:string|null):Promise<Response> {
  if (!file || !/^(app|chunk)-[A-Z0-9]{8}\.js$/.test(file)) throw new ApiError(404,'missing');
  manifest ??= readFile('prototype/assets/module-manifest.json','utf8').then(value=>JSON.parse(value) as {files:Record<string,unknown>})
    .catch(error=>{manifest=undefined;throw error;});
  if (!Object.hasOwn((await manifest).files,file)) throw new ApiError(404,'missing');
  let content = contents.get(file);
  if (!content) {
    content=readFile(`prototype/assets/modules/${file}`,'utf8').catch(error=>{contents.delete(file);throw error;});
    contents.set(file,content);
  }
  return new Response(await content,{headers:{'Content-Type':'text/javascript; charset=utf-8'}});
}
