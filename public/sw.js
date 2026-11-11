const CACHE_NAME = 'airlink-gh-v9';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=9',
  './app.js?v=9',
  './icon.svg',
  './icon-192.png',
  './icon-512.png',
  './manifest.json'
];

function saveSharedDataToIdb(payload) {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open('airlink_share_db', 1);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('shared_queue')) {
          db.createObjectStore('shared_queue', { keyPath: 'id' });
        }
      };
      req.onsuccess = (ev) => {
        const db = ev.target.result;
        const tx = db.transaction('shared_queue', 'readwrite');
        tx.objectStore('shared_queue').put({
          id: 'latest',
          ...payload,
          createdAt: Date.now()
        });
        tx.oncomplete = () => {
          db.close();
          resolve(true);
        };
        tx.onerror = () => {
          db.close();
          resolve(false);
        };
      };
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
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
  const url = new URL(e.request.url);

  // Recibir archivos o textos compartidos desde WhatsApp u otras apps del celular (Web Share Target)
  if (e.request.method === 'POST' && url.origin === self.location.origin && url.searchParams.has('share-target')) {
    e.respondWith((async () => {
      try {
        const formData = await e.request.formData();
        const files = formData.getAll('files').filter(Boolean);
        const title = formData.get('title') || '';
        const text = formData.get('text') || '';
        const sharedUrl = formData.get('url') || '';

        await saveSharedDataToIdb({
          files,
          title: String(title),
          text: String(text),
          url: String(sharedUrl)
        });
      } catch (err) {}

      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (url.origin === self.location.origin && e.request.method === 'GET') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(e.request))
    );
  }
});
