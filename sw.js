/* DonghuaFlix Service Worker v4 — Network First (siempre fresco cuando hay internet) */
const CACHE = 'donghuaflix-v4';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './manifest.webmanifest', './icon-256.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network First para todo: la página siempre se actualiza al cargar si hay internet.
// El caché solo sirve como respaldo offline.
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // No interceptar peticiones de otros orígenes (Dailymotion, imágenes externas...)
  if (url.origin !== location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then(res => {
        // Guardar copia fresca en caché
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(e.request).then(cached => cached || caches.match('./index.html'))
      )
  );
});
