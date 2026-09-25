/* ============================================================
   DONGHUAFLIX RENACER — FASE 8: Pulido técnico + móvil
   ------------------------------------------------------------
   - Diagnóstico de rendimiento (DFX8.diag(), DFX8.overlay())
   - Detector de carruseles duplicados (audit B1)
   - Imágenes rotas marcadas + contadas (audit B2)
   - Lazy-loading de imágenes + alt accesible
   - Transiciones suaves entre rutas
   - Modo ahorro de datos / conexión lenta
   - Respecto a prefers-reduced-motion
   - Píldora de stats y toast reubicados (B3, B9)
   No modifica app.js ni datos. Capa aditiva idempotente.
   ============================================================ */
(() => {
  'use strict';
  if (window.__DFX_RENACER_F8__) return;
  window.__DFX_RENACER_F8__ = true;

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const state = { broken: new Set(), longTasks: 0, transitions: 0, errors: 0, t0: Date.now() };

  /* ---------- 1. prefers-reduced-motion ---------- */
  try {
    const rm = matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => document.documentElement.classList.toggle('f8-rm', rm.matches);
    (rm.addEventListener || rm.addListener || (() => {})).call(rm, 'change', apply);
    apply();
  } catch (e) {}

  /* ---------- 2. Modo ahorro (saveData / 2g) ---------- */
  try {
    const c = navigator.connection || {};
    const lite = !!c.saveData || (c.effectiveType === 'slow-2g' || c.effectiveType === '2g');
    document.documentElement.classList.toggle('f8-lite', lite);
  } catch (e) {}

  /* ---------- 3. Imágenes: lazy, alt, rotas ---------- */
  const fixImg = (im) => {
    if (!im || im.__f8) return;
    im.__f8 = true;
    if (!im.getAttribute('loading')) im.setAttribute('loading', 'lazy');
    im.setAttribute('decoding', 'async');
    if (!im.getAttribute('alt')) im.setAttribute('alt', '');
    if (im.complete && im.naturalWidth === 0) markBroken(im);
  };
  const markBroken = (im) => {
    if (im.classList.contains('f8-img-broken')) return;
    im.classList.add('f8-img-broken');
    state.broken.add(im.currentSrc || im.src || '(sin src)');
    im.addEventListener('click', () => { const s = im.dataset.f8src || im.src; im.classList.remove('f8-img-broken'); im.src = ''; im.src = s; }, { once: true });
  };
  document.addEventListener('error', (e) => { if (e.target && e.target.tagName === 'IMG') markBroken(e.target); }, true);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => {
    if (n.tagName === 'IMG') fixImg(n);
    if (n.querySelectorAll) $$('img', n).forEach(fixImg);
  }))).observe(document.documentElement, { childList: true, subtree: true });
  $$('img').forEach(fixImg);

  /* ---------- 4. Transiciones entre rutas ---------- */
  const swap = () => {
    const app = $('#app');
    if (!app || app.classList.contains('f8-swap')) return;
    app.classList.add('f8-swap');
    state.transitions++;
    setTimeout(() => app.classList.remove('f8-swap'), 260);
  };
  addEventListener('hashchange', () => { swap(); if (location.hash.indexOf('#/diag') === 0) renderDiag(); });
  if (location.hash.indexOf('#/diag') === 0) setTimeout(renderDiag, 300);

  /* ---------- 5. Errores de red visibles ---------- */
  let lastToast = 0;
  addEventListener('unhandledrejection', () => {
    state.errors++;
    if (Date.now() - lastToast > 5000) {
      lastToast = Date.now();
      try {
        if (window.DFX && DFX.toast) DFX.toast('⚠️ Falló una carga. Revisa tu conexión.');
        else if (window.showToast) showToast('⚠️ Falló una carga. Revisa tu conexión.');
      } catch (e) {}
    }
  });

  /* ---------- 6. Long tasks ---------- */
  try {
    if ('PerformanceObserver' in window) {
      new PerformanceObserver((l) => { state.longTasks += l.getEntries().length; })
        .observe({ type: 'longtask', buffered: true });
    }
  } catch (e) {}

  /* ---------- 7. Detector de carruseles duplicados (B1) ---------- */
  function dupRails() {
    const map = new Map();
    $$('.rail, [class*="rail"], [class*="dfx4grid"], [class*="dfx7-rail"]').forEach((r) => {
      const cards = $$('a, .card, article', r).filter((c) => c.textContent.trim().length > 2);
      if (cards.length < 3) return;
      const names = cards.map((c) => (c.textContent.trim().split('\n')[0] || '').slice(0, 40));
      const key = names.slice(0, 8).join('|');
      if (!map.has(key)) map.set(key, []);
      const sec = r.closest('section');
      const h = sec ? (sec.querySelector('h2,h3') || {}).textContent : '';
      map.get(key).push(h ? h.trim() : '(sección sin título)');
    });
    const dups = [];
    map.forEach((sections, key) => { if (sections.length > 1) dups.push({ veces: sections.length, secciones: sections.slice(0, 4) }); });
    return dups;
  }

  /* ---------- 8. API pública ---------- */
  window.DFX8 = {
    diag() {
      const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      const imgs = $$('img');
      const report = {
        uptime_s: Math.round((Date.now() - state.t0) / 1000),
        imgs: { total: imgs.length, rotas: state.broken.size, lazy: imgs.filter(i => i.getAttribute('loading') === 'lazy').length },
        carruseles_duplicados: dupRails(),
        long_tasks: state.longTasks,
        transiciones: state.transitions,
        errores_red: state.errors,
        en_linea: navigator.onLine,
        conexion: (navigator.connection && navigator.connection.effectiveType) || '?',
        ahorro_movil: !!(navigator.connection && navigator.connection.saveData),
        service_worker: ('serviceWorker' in navigator && navigator.serviceWorker.controller) ? 'activo' : ('serviceWorker' in navigator ? 'registrado (sin controlar aún)' : 'no soportado'),
        firebase_user: (window.__DFX_FIREBASE_USER__ && (window.__DFX_FIREBASE_USER__.email || 'sí')) || 'sin sesión',
        catalogo_activo: (typeof currentCatalog !== 'undefined' ? currentCatalog : '?'),
        series_cargadas: (() => { try { return (typeof DB !== 'undefined' && DB.series) ? DB.series.length : 0; } catch (e) { return 0; } })(),
        catalogos_ok: (() => { try { const a = CATALOG_AVAILABLE; const ks = Object.keys(a); return ks.filter(k => a[k]).length + '/' + ks.length; } catch (e) { return '?'; } })(),
        localstorage_kb: Math.round(JSON.stringify(localStorage).length / 1024),
        selector_catalogo: (() => {
          try {
            const w = document.getElementById('catalogWrap');
            if (!w) return 'FALTA en el index.html';
            const st = getComputedStyle(w);
            return 'display=' + w.style.display + ' / css=' + st.display + ' / ' + (st.position === 'fixed' ? 'FAB-fijo' : 'inline');
          } catch (e) { return '?'; }
        })(),
        memoria_MB: mem,
        ahorro_datos: document.documentElement.classList.contains('f8-lite'),
        reduccion_movimiento: matchMedia('(prefers-reduced-motion: reduce)').matches,
        fase6: window.DFX6 && DFX6.stats ? DFX6.stats() : null
      };
      console.table && console.table(report.carruseles_duplicados);
      console.info('%cDFX8 diagnóstico', 'font-weight:bold', report);
      return report;
    },
    fps(segundos = 3) {
      return new Promise((res) => {
        let n = 0; const t0 = performance.now();
        const tick = () => { n++; if (performance.now() - t0 < segundos * 1000) requestAnimationFrame(tick); else res(Math.round(n / segundos)); };
        requestAnimationFrame(tick);
      });
    },
    overlay(on) {
      let el = $('#f8hud');
      if (on === false) { el && el.remove(); return; }
      if (!el) {
        el = document.createElement('div'); el.id = 'f8hud';
        document.body.appendChild(el);
        setInterval(async () => {
          if (!document.body.contains(el)) return;
          const f = await window.DFX8.fps(1);
          const d = window.DFX8.diag();
          el.textContent = `⚡ ${f} fps · 📷 ${d.imgs.rotas}/${d.imgs.total} rotas · 🧠 ${d.memoria_MB ?? '?'} MB · ⛓ ${d.long_tasks} long tasks`;
        }, 1500);
      }
    },
    gc() {
      try { if (window.DFX6 && DFX6.clearCache) return DFX6.clearCache(); } catch (e) {}
      return 'La fase 6 no expone clearCache(); el caché es en memoria y se libera al navegar.';
    },
    rotas() { return [...state.broken]; }
  };

  /* ---------- 9. Página de diagnóstico móvil (#/diag) ---------- */
  function renderDiag() {
    const app = $('#app');
    if (!app) return;
    document.title = 'Diagnóstico — DonghuaFlix';
    const d = window.DFX8.diag();
    const li = (k, v) => `<li style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span style="color:#9a9aa5">${k}</span><b>${v}</b></li>`;
    const flag = (on) => on ? '<b style="color:#7CFC9A">✔ activa</b>' : '<b style="color:#ff6b6b">✖ no</b>';
    app.innerHTML = `
      <div style="max-width:640px;margin:0 auto;padding:20px 16px 90px;font:14px/1.5 system-ui;color:#fff;background:#0b0b0f;min-height:100vh">
        <h1 style="font-size:20px;margin:0 0 4px">Diagnóstico DonghuaFlix</h1>
        <p style="color:#9a9aa5;margin:0 0 16px">Renacer · sin consola</p>
        <ul style="list-style:none;margin:0 0 16px;padding:0">
          ${li('Conexión', d.en_linea ? '🟢 en línea (' + d.conexion + ')' : '🔴 sin conexión')}
          ${li('Service Worker', d.service_worker)}
          ${li('Firebase / sesión', d.firebase_user)}
          ${li('Catálogo activo', d.catalogo_activo + ' · ' + d.series_cargadas + ' series')}
          ${li('Catálogos disponibles', d.catalogos_ok)}
          ${li('Fase 6 (rendimiento)', flag(!!window.DFX6))}
          ${li('Fase 7 (descubrir)', flag(!!window.DFX7))}
          ${li('Fase 8 (pulido)', flag(!!window.DFX8))}
          ${li('Núcleo Pro (dfx-core)', flag(!!window.DFX))}
          ${li('Imágenes rotas', `${d.imgs.rotas} / ${d.imgs.total}`)}
          ${li('Carruseles duplicados (B1)', d.carruseles_duplicados.length ? `<b style="color:#ffb84d">${d.carruseles_duplicados.length} grupos</b>` : 'ninguno')}
          ${li('Long tasks / Errores de red', d.long_tasks + ' / ' + d.errores_red)}
          ${li('Memoria JS', (d.memoria_MB ?? '?') + ' MB · localStorage ' + d.localstorage_kb + ' KB')}
          ${li('Ahorro de datos', d.ahorro_datos || d.ahorro_movil ? 'sí' : 'no')}
          ${li('Reducción de movimiento', d.reduccion_movimiento ? 'sí' : 'no')}
        </ul>
        <button id="dfxDiagCopy" style="width:100%;padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.2);background:#17171c;color:#fff;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:16px">📋 Copiar informe completo</button>
        ${d.carruseles_duplicados.length ? `<details style="margin-bottom:16px"><summary style="cursor:pointer;color:#ffb84d">Ver secciones duplicadas</summary><pre style="white-space:pre-wrap;font-size:12px;color:#cfcfda;background:#17171c;padding:10px;border-radius:10px">${JSON.stringify(d.carruseles_duplicados, null, 2)}</pre></details>` : ''}
        ${d.imgs.rotas ? `<details><summary style="cursor:pointer;color:#ffb84d">Ver URLs rotas</summary><pre style="white-space:pre-wrap;font-size:11px;color:#cfcfda;background:#17171c;padding:10px;border-radius:10px">${d.imgs.rotas.join('\n')}</pre></details>` : ''}
        <p style="color:#9a9aa5;font-size:12px;margin-top:16px">Esta página la genera dfx-renacer-fase8.js. Refresca con Ctrl+F5 o borra caché si no coincide con lo esperado.</p>
      </div>`;
    const btn = document.getElementById('dfxDiagCopy');
    if (btn) btn.onclick = () => {
      const rep = JSON.stringify(d, null, 2);
      (navigator.clipboard ? navigator.clipboard.writeText(rep) : Promise.reject())
        .then(() => { btn.textContent = '✔ Copiado'; setTimeout(() => { btn.textContent = '📋 Copiar informe completo'; }, 1500); })
        .catch(() => { btn.textContent = 'No se pudo copiar'; });
    };
    window.scrollTo(0, 0);
  }
  function addDiagLink() {
    const more = document.getElementById('moreMenu');
    if (more && !more.querySelector('a[href="#/diag"]')) {
      const m = document.createElement('a');
      m.href = '#/diag'; m.textContent = 'Diagnóstico';
      more.appendChild(m);
    }
  }

  /* Reintento del selector de catálogos: si la sonda inicial falló
     (red lenta en móvil), se reintenta cada 6 s sin molestar. */
  function fixCatalogWrap() {
    try {
      var wrap = document.getElementById('catalogWrap');
      if (!wrap) return;
      var a = CATALOG_AVAILABLE;
      var n = Object.keys(a).filter(function (k) { return a[k]; }).length;
      if (n > 1) wrap.style.display = '';
    } catch (e) {}
  }
  setTimeout(fixCatalogWrap, 2500);
  setInterval(fixCatalogWrap, 6000);

  console.info('DonghuaFlix Renacer Fase 8 activa · DFX8.diag() o #/diag');
  if (document.readyState === 'loading') addEventListener('DOMContentLoaded', addDiagLink); else addDiagLink();
})();
