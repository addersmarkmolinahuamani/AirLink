const CACHE_NAME = 'airlink-gh-v2';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './icon.svg',
  './manifest.json'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  // Solo interceptar recursos locales propios
  const url = new URL(e.request.url);
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(e.request).catch(() => caches.match(e.request))
    );
  }
});
