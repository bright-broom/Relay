/// <reference lib="webworker" />
export {};
declare const __CACHE_VERSION__:string;
declare const __PRECACHE__:string[];
const worker=self as unknown as ServiceWorkerGlobalScope;
const prefix=`relay-shell-${new URL(worker.registration.scope).pathname}-`;
const cacheName=prefix+__CACHE_VERSION__;
const shell=new URL('index.html',worker.registration.scope).href;
const assets=new Set(__PRECACHE__.map(path=>new URL(path,worker.registration.scope).href));
worker.addEventListener('install',event=>{
 event.waitUntil(caches.open(cacheName).then(cache=>cache.addAll([...assets].map(url=>new Request(url,{cache:'reload'})))));
});
// Activate after older app windows close; never replace the UI during a report.
worker.addEventListener('activate',event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith(prefix)&&key!==cacheName).map(key=>caches.delete(key)))));
});
worker.addEventListener('fetch',event=>{
 const request=event.request;
 if(request.method!=='GET')return;
 const url=new URL(request.url);
 const root=new URL(worker.registration.scope);
 if(url.origin!==root.origin)return;
 const isShell=request.mode==='navigate'&&(url.pathname===root.pathname||url.pathname===new URL(shell).pathname);
 const target=isShell?shell:url.href;
 // Only the compiled app shell is cached. API responses and user content are excluded.
 if(!assets.has(target))return;
 event.respondWith(caches.open(cacheName).then(async cache=>(await cache.match(target))??fetch(request)));
});
