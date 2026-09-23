/* DonghuaFlix Service Worker v11 — a prueba de fallos */
const CACHE = 'donghuaflix-v11';
const ASSETS = ['./', './index.html', './styles.css', './app.js',
  './dfx-core.js', './dfx-polish.js', './dfx-boot.js', './firebase-sync.js',
  './manifest.webmanifest', './icon-192.png', './icon-256.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      /* precache archivo a archivo: un 404 ya no tumba la instalación */
      .then(c => Promise.allSettled(ASSETS.map(a => c.add(a))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      /* borra TODAS las cachés viejas (v7..v10 y fantasmas) */
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  const isCatalog =
    url.pathname.includes('catalog') && url.pathname.endsWith('.json');

  const isShell =
    e.request.mode === 'navigate' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css') ||
    url.pathname === '/';

  const offline = () =>
    new Response('DonghuaFlix: sin conexion y sin cache.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });

  /* Catálogos y código: RED primero (los cambios llegan al instante).
     Si la red falla, se sirve la copia de caché. Nunca undefined. */
  if (isCatalog || isShell) {
    e.respondWith(
      fetch(e.request)
        .then(res => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            caches.open(CACHE)
              .then(c => c.put(e.request, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() =>
          caches.match(e.request).then(hit => hit || offline())
        )
    );
    return;
  }

  /* Resto (imágenes, iconos...): caché primero */
  e.respondWith(
    caches.match(e.request).then(hit =>
      hit ||
      fetch(e.request)
        .then(res => {
          if (res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE)
              .then(c => c.put(e.request, copy))
              .catch(() => {});
          }
          return res;
        })
        .catch(() => offline())
    )
  );
});
