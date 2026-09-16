// Service Worker - PWA 离线缓存
// 版本号升级后会自动清理旧缓存（activate 阶段）
const CACHE_VERSION = 'hamboo-ws-v3';

// 预缓存清单
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/auth.js',
  '/db.js',
  '/supabase.js',
  '/supabase.min.js',
  '/chart.umd.min.js',
  '/manifest.json',
  '/data/hotspots.js',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_VERSION)
      .then(c => c.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_VERSION).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // 只处理同源 GET 请求
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  // 导航请求（页面）：network-first，成功更新缓存副本，失败读缓存
  const isNavigation = e.request.mode === 'navigate' ||
    url.pathname === '/' || url.pathname.endsWith('/index.html');

  if (isNavigation) {
    e.respondWith(
      fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() =>
        caches.match(e.request).then(r => r || caches.match('/index.html'))
      )
    );
    return;
  }

  // 其余静态资源：cache-first，未命中走网络并写入缓存
  e.respondWith(
    caches.match(e.request).then(r => {
      if (r) return r;
      return fetch(e.request).then(res => {
        if (res && res.status === 200 && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      });
    })
  );
});
