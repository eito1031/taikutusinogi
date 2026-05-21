/* Service Worker - 退屈しのぎの飼育論 */
const CACHE_NAME = 'taikutusinogi-v2';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './scenario.json',
  './manifest.json',
  './chara_normal.PNG',
  './chara_happy.PNG',
  './chara_tired.PNG',
  './chara_surprised.PNG',
  './chara_intense.PNG',
  './icon-192.svg',
  './icon-512.svg',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(response => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
        return response;
      }).catch(() => cached);
    })
  );
});
