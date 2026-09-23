/* DonghuaFlix — SW temporal de LIMPIEZA.
   Se activa, borra TODAS las caches, se desregistra y desaparece.
   El modo offline se reintroducira en la Fase 8 con un SW definitivo. */
self.addEventListener('install', e => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => self.clients.claim())
      .then(() => self.registration.unregister())
  );
});

self.addEventListener('fetch', () => {
  /* sin interceptacion: el navegador habla directo con la red */
});
