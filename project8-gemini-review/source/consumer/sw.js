'use strict';
const scopeKey = encodeURIComponent(self.registration.scope);
const prefix = 'dispatch-notes-' + scopeKey + '-';
const cacheName = prefix + '20261126-1';
const files = ['index.html','style.css','core.js','card.js','app.js','manifest.webmanifest','icon-192.png','icon-512.png'];
self.addEventListener('install',event => {
  event.waitUntil(caches.open(cacheName).then(c=>c.addAll(files)).then(()=>self.skipWaiting()));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(prefix) && k!==cacheName).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||!url.href.startsWith(self.registration.scope))return;
  const key=event.request.mode==='navigate'?'index.html':event.request;
  event.respondWith(caches.open(cacheName).then(c=>c.match(key)).then(hit=>hit||fetch(event.request)));
});
