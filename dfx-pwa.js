/* DonghuaFlix — PWA/mobile enhancements, intentionally isolated from app.js */
(() => {
  'use strict';

  const isStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;

  document.documentElement.classList.toggle('dfx-pwa-standalone', isStandalone);
  window.DFX_PWA_STANDALONE = isStandalone;

  // Native Android/iOS share when the browser/PWA supports it.
  window.dfxShare = async (title, text, url) => {
    const data = { title: title || document.title, text: text || '', url: url || location.href };
    if (navigator.share) {
      try { await navigator.share(data); return true; } catch (error) {
        if (error?.name === 'AbortError') return false;
      }
    }
    try {
      await navigator.clipboard.writeText(data.url);
      if (typeof window.showToast === 'function') window.showToast('Enlace copiado');
      return true;
    } catch (_) { return false; }
  };

  // Captura el evento de instalación sin forzar un banner intrusivo.
  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    window.DFX_PWA_INSTALL_AVAILABLE = true;
    window.dispatchEvent(new CustomEvent('dfx:pwa-install-available'));
  });

  window.dfxInstallApp = async () => {
    if (!deferredPrompt) return false;
    deferredPrompt.prompt();
    try { await deferredPrompt.userChoice; } catch (_) {}
    deferredPrompt = null;
    return true;
  };

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    window.DFX_PWA_INSTALL_AVAILABLE = false;
    window.dispatchEvent(new CustomEvent('dfx:pwa-installed'));
  });

  // Actualización del Service Worker: se muestra solo cuando realmente hay una nueva versión.
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', async () => {
      try {
        const registration = await navigator.serviceWorker.register('sw.js');
        await registration.update();

        if (registration.waiting && navigator.serviceWorker.controller) {
          showUpdate(registration);
        }

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          if (!worker) return;
          worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              showUpdate(registration);
            }
          });
        });
      } catch (_) {}
    });
  }

  function showUpdate(registration) {
    if (document.getElementById('dfxPwaUpdate')) return;
    const box = document.createElement('div');
    box.id = 'dfxPwaUpdate';
    box.className = 'dfx-pwa-update';
    box.innerHTML = '<span>Hay una nueva versión de DonghuaFlix disponible.</span><button type="button">Actualizar</button>';
    box.querySelector('button').addEventListener('click', () => {
      if (registration.waiting) registration.waiting.postMessage('SKIP_WAITING');
      window.location.reload();
    });
    document.body.appendChild(box);
  }
})();
