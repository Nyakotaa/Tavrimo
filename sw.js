const VERSION = 'tavrimo-v12.0.4-rea-live-sync-4';
const SHELL = [
  './', './index.html', './style.css', './app.js', './config.js', './manifest.webmanifest', './404.html',
  './assets/icons/apple-touch-icon-v14.png', './assets/icons/icon-180.png',
  './assets/icons/icon-192.png', './assets/icons/icon-512.png', './assets/icons/favicon-32.png', './assets/icons/source-icon-1024.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith('flowday-') || key.startsWith('tavrimo-')) && key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHES') event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith('flowday-') || key.startsWith('tavrimo-')) && key !== VERSION).map((key) => caches.delete(key)))));
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never cache sync API responses: timetable freshness is handled by Tavrimo's sync layer.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => new Response(JSON.stringify({ error: 'Офлайн' }), { status: 503, headers: { 'Content-Type': 'application/json' } })));
    return;
  }
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request, { cache: 'no-store' }).then((response) => {
        const copy = response.clone(); caches.open(VERSION).then((cache) => cache.put('./index.html', copy)); return response;
      }).catch(() => caches.match('./index.html'))
    );
    return;
  }
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request, { cache: 'no-store' }).then((response) => {
        if (response.ok) { const copy = response.clone(); caches.open(VERSION).then((cache) => cache.put(request, copy)); }
        return response;
      }).catch(() => cached);
      return cached || network;
    })
  );
});
