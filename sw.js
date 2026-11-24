const VERSION = 'tavrimo-v12.4.0-branded-startup-cache-20261124';
const SHELL = [
  './', './index.html', './style.css?v=12.4.0', './spotify-dark.css?v=12.4.0',
  './calendar-update.css?v=12.4.0', './app.js?v=12.4.0', './config.js?v=12.4.0',
  './manifest.webmanifest', './404.html',
  './assets/branding/tavrimo-cup-mark.png', './assets/icons/apple-touch-icon-v17.png',
  './assets/icons/icon-180.png', './assets/icons/icon-192.png', './assets/icons/icon-512.png',
  './assets/icons/favicon-32.png', './assets/icons/source-icon-1024.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => (key.startsWith('flowday-') || key.startsWith('tavrimo-')) && key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHES') {
    event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => (key.startsWith('flowday-') || key.startsWith('tavrimo-')) && key !== VERSION).map((key) => caches.delete(key)))));
  }
});

async function fetchAndCache(request, cache, cacheKey = request) {
  const response = await fetch(request, { cache: 'no-store' });
  if (response.ok) await cache.put(cacheKey, response.clone());
  return response;
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Local-only 12.4.0 does not use the former gateway; retain a safe offline response for stale callers.
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request, { cache: 'no-store' }).catch(() => new Response(JSON.stringify({ error: 'Офлайн' }), {
      status: 503, headers: { 'Content-Type': 'application/json' }
    })));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match('./index.html') || await caches.match('./index.html');
      // Serve the already installed shell immediately. A sleeping Render service must not
      // place its platform-level cold-start page in front of the cached Tavrimo splash.
      if (cached) return cached;
      try {
        return await fetchAndCache(request, cache, './index.html');
      } catch {
        return new Response('Tavrimo ещё не было открыто на этом устройстве. Подключись к интернету и попробуй снова.', {
          status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
        });
      }
    })());
    return;
  }

  const cacheableAsset = /\.(?:js|css|json|webmanifest)(?:$|\?)/i.test(url.pathname + url.search);
  if (cacheableAsset) {
    event.respondWith((async () => {
      const cache = await caches.open(VERSION);
      const cached = await cache.match(request);
      // Assets are pre-cached during install, so they can be served without waiting on Render.
      if (cached) return cached;
      try {
        return await fetchAndCache(request, cache, request);
      } catch {
        return new Response('', { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const cached = await cache.match(request);
    if (cached) return cached;
    try {
      return await fetchAndCache(request, cache, request);
    } catch {
      return new Response('', { status: 503 });
    }
  })());
});
