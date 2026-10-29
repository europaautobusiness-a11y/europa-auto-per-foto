/* Europa Auto — area clienti. Cache leggera della sola "scocca" dell'app:
   i dati arrivano sempre dal cloud, cosi' non si vedono scadenze vecchie. */
var CACHE='ea-clienti-v2';
var SHELL=['./','./index.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install', function(e){ e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).then(function(){ return self.skipWaiting(); })); });
self.addEventListener('activate', function(e){ e.waitUntil(caches.keys().then(function(ks){ return Promise.all(ks.filter(function(k){ return k!==CACHE; }).map(function(k){ return caches.delete(k); })); }).then(function(){ return self.clients.claim(); })); });
self.addEventListener('fetch', function(e){
  var u=new URL(e.request.url);
  if(e.request.method!=='GET' || u.origin!==location.origin) return;   /* Supabase e CDN: sempre rete */
  e.respondWith(fetch(e.request).then(function(r){ var c=r.clone(); caches.open(CACHE).then(function(x){ x.put(e.request,c); }); return r; }).catch(function(){ return caches.match(e.request); }));
});
