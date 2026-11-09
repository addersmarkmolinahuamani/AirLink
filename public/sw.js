const CACHE_NAME = 'airlink-v5';
const CONFIG_CACHE = 'airlink-config-v2';
const STATIC_ASSETS = [
  '/conectar.html',
  '/manifest.json',
  '/icon.svg'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME && key !== CONFIG_CACHE)
          .map((key) => caches.delete(key))
      );
    })
  );
  self.clients.claim();
});

// Guardar el Pair ID de vinculación permanente en Cache
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SAVE_PAIR_ID' && e.data.pairId) {
    caches.open(CONFIG_CACHE).then((cache) => {
      cache.put('/saved-pair-id', new Response(String(e.data.pairId)));
    });
  }
});

async function getSavedPairId() {
  try {
    const cache = await caches.open(CONFIG_CACHE);
    const res = await cache.match('/saved-pair-id');
    if (res) {
      const txt = (await res.text()).trim();
      if (txt) return txt;
    }
  } catch (e) {}
  return null;
}

// Determinar la URL activa de la Laptop (mismo origen o nuevo túnel vía Pair ID persistente)
async function resolveActiveServerUrl() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const ping = await fetch('/api/info', { signal: controller.signal });
    clearTimeout(timer);
    if (ping && ping.ok) {
      return self.location.origin;
    }
  } catch (e) {}

  // Si el túnel de Cloudflare cambió, buscar la laptop en su hub permanente
  try {
    const pairId = await getSavedPairId();
    if (pairId) {
      const res = await fetch(`https://ntfy.sh/airlink_hub_${pairId}/json?poll=1&since=24h`);
      if (res.ok) {
        const text = await res.text();
        const lines = text.trim().split('\n').filter(Boolean);
        for (let i = lines.length - 1; i >= 0; i--) {
          try {
            const parsed = JSON.parse(lines[i]);
            if (parsed.message) {
              const data = JSON.parse(parsed.message);
              if (data && (data.publicUrl || data.localUrl)) {
                if (data.localUrl) {
                  try {
                    const c = new AbortController();
                    const t = setTimeout(() => c.abort(), 800);
                    const localPing = await fetch(`${data.localUrl}/api/info`, { signal: c.signal });
                    clearTimeout(t);
                    if (localPing && localPing.ok) return data.localUrl;
                  } catch (err) {}
                }
                if (data.publicUrl) return data.publicUrl;
              }
            }
          } catch (err) {}
        }
      }
    }
  } catch (e) {}

  return self.location.origin;
}

// Procesar archivos/texto compartidos desde WhatsApp u otras apps directamente hacia /api/upload y /api/messages
async function handleShareTarget(request) {
  try {
    const formData = await request.formData();
    const rawFiles = formData.getAll('files') || [];
    const files = rawFiles.filter((f) => f && typeof f.size === 'number' && f.size > 0);

    const sharedTitle = (formData.get('title') || '').toString().trim();
    const sharedText = (formData.get('text') || '').toString().trim();
    const sharedUrl = (formData.get('url') || '').toString().trim();
    const combinedText = [sharedTitle, sharedText, sharedUrl].filter(Boolean).join('\n').trim();

    const targetBaseUrl = await resolveActiveServerUrl();

    if (files.length > 0) {
      const uploadData = new FormData();
      for (const file of files) {
        uploadData.append('files', file, file.name || 'archivo_compartido');
      }
      await fetch(`${targetBaseUrl}/api/upload?sender=mobile`, {
        method: 'POST',
        body: uploadData
      });
    }

    if (combinedText) {
      await fetch(`${targetBaseUrl}/api/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: combinedText,
          sender: 'Celular',
          device: 'mobile'
        })
      });
    }

    const sharedParam = files.length > 0 ? 'files' : (combinedText ? 'text' : '1');
    return Response.redirect(`${targetBaseUrl}/?shared=${sharedParam}`, 303);
  } catch (err) {
    return Response.redirect('/?shared=error', 303);
  }
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Interceptar siempre POST /share-target desde WhatsApp u otras apps del celular
  if (e.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    e.respondWith(handleShareTarget(e.request));
    return;
  }

  // No interceptar el resto de peticiones POST/DELETE (ej. /api/upload)
  if (e.request.method !== 'GET') {
    return;
  }

  // Interceptar navegación principal
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((response) => {
          // Si el túnel de Cloudflare expiró o da error 502/503/404/etc, mostrar pantalla de conexión
          if (!response || response.status >= 400) {
            return caches.match('/conectar.html');
          }
          return response;
        })
        .catch(() => caches.match('/conectar.html'))
    );
    return;
  }

  // Resto de recursos
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
