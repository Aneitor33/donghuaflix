/* DonghuaFlix Service Worker — PWA v8
 * Mantiene la lógica actual: catálogo con red primero, código con red primero
 * y recursos estáticos con caché primero. Esta versión añade actualización
 * limpia y evita cachear respuestas inválidas.
 */
const CACHE = 'donghuaflix-v8';
const ASSETS = [
  './', './index.html', './styles.css', './dfx.css', './dfx-final.css',
  './dfx-pwa.css', './app.js', './firebase-sync.js', './dfx-core.js',
  './manifest.webmanifest', './icon-192.png', './icon-256.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(key => key !== CACHE).map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  } catch (_) {
    return caches.match(request);
  }
}

async function staleWhileRevalidate(request) {
  const cached = await caches.match(request);
  const network = fetch(request).then(async response => {
    if (response && response.ok && new URL(request.url).origin === location.origin) {
      const cache = await caches.open(CACHE);
      await cache.put(request, response.clone());
    }
    return response;
  }).catch(() => null);
  return cached || network;
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  const sameOrigin = url.origin === location.origin;
  const path = url.pathname.toLowerCase();

  if (!sameOrigin) return;

  // Catálogos: siempre intentan red primero para conservar el botón Recargar.
  if (path.includes('catalog') && path.endsWith('.json')) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // HTML/JS/CSS: red primero para que las actualizaciones lleguen rápido.
  if (
    event.request.mode === 'navigate' ||
    path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css') ||
    path.endsWith('.webmanifest') || path === '/'
  ) {
    event.respondWith(networkFirst(event.request));
    return;
  }

  // Imágenes y recursos propios: respuesta rápida desde caché y actualización
  // en segundo plano. No cachea respuestas de error.
  if (/\.(png|jpg|jpeg|webp|avif|gif|svg|ico|woff2?)$/i.test(path)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});

// Permite que la página solicite activar inmediatamente una actualización.
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});
