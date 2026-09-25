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
  addEventListener('hashchange', swap);

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

  console.info('DonghuaFlix Renacer Fase 8 activa · DFX8.diag() para diagnóstico');
})();
