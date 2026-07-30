// Service Worker - PWA 离线缓存
const CACHE = 'hamboo-ws-v1';
const URLS = ['/', '/index.html', '/supabase.js', '/auth.js', '/db.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(URLS)));
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request))
  );
});
