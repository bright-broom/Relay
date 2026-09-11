/// <reference lib="webworker" />
export {};
const worker = self as unknown as ServiceWorkerGlobalScope;
const prefix = `relay-shell-${new URL(worker.registration.scope).pathname}-`;
// Authentication supersedes the offline demo. All requests now use the network.
worker.addEventListener('install', event => { event.waitUntil(worker.skipWaiting()); });
worker.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(prefix)).map(key => caches.delete(key)));
    await worker.clients.claim();
    const windows = await worker.clients.matchAll({type: 'window'});
    await Promise.all(windows.map(client => (client as WindowClient).navigate(client.url)));
  })());
});
