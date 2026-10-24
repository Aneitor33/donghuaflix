/* ============================================================
 * DonghuaFlix — dfx-urlstate.js  (v2)
 * Todo tiene enlace: catálogo, sección, página y filtros.
 * + Deep-links robustos: serie/episodio se resuelven en cualquier
 *   catálogo y sesión nueva (índice LITE sin episodios).
 *
 * AÑADE EN index.html, DESPUÉS de app.js y dfx-rails.js:
 *   <script src="dfx-urlstate.js?v=2"></script>
 * ============================================================ */
(function () {
  'use strict';

  if (typeof window.route !== 'function') {
    console.warn('[dfx-urlstate] no encuentro route() ¿cargado antes que app.js?');
    return;
  }

  const g = n => (0, eval)(n);
  function setG(n, v) { window.__dfx_tmp = v; (0, eval)(n + ' = window.__dfx_tmp'); delete window.__dfx_tmp; }

  const CFG = {
    pagSelectors: ['.pagination', '.pg', '[class*="pagin"]', '[class*="pager"]'],
    filterSelector: '#app select',
  };

  /* ---------- hash con parámetros ---------- */
  function parseHash() {
    const raw = location.hash || '#/';
    const qi = raw.indexOf('?');
    const path = qi >= 0 ? raw.slice(0, qi) : raw;
    const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');
    return { raw, path, params };
  }
  function writeHash(path, params) {
    const q = params && params.toString();
    history.replaceState(null, '', q ? path + '?' + q : path);
  }

  /* ---------- ¿existe la serie/episodio en el DB actual? ---------- */
  function epExists(slug) {
    const db = g('DB');
    return !!(db && db.episodes && db.episodes.some(e => (e.slug || e.id) === slug || e.id === slug));
  }
  function seriesIn(db, slug) {
    if (!db || !db.series) return null;
    let best = null, bestLen = -1;
    for (const s of db.series) {
      const ref = s.slug || s.id;
      if (ref && slug.indexOf(ref) === 0 && ref.length > bestLen) { best = s; bestLen = ref.length; }
    }
    return best;
  }

  /* ---------- Buscar la serie en TODOS los catálogos ---------- */
  async function resolveCatalog(slug) {
    const CATALOGS = g('CATALOGS');
    const AV = g('CATALOG_AVAILABLE') || {};
    if (!Array.isArray(CATALOGS)) return null;

    if (typeof window.ensureCatalog !== 'function') return null;
    for (const c of CATALOGS) {
      if (!AV[c.id]) continue;
      try {
        const db = await window.ensureCatalog(c.id);
        if (seriesIn(db, slug)) {
          setG('DB', db);
          setG('currentCatalog', c.id);
          localStorage.setItem('donghuaflix_catalog', c.id);
          if (window.renderCatBar) renderCatBar();
          return db;
        }
      } catch (e) { /* siguiente catálogo */ }
    }
    return null;
  }

  /* Cargar la ficha de la serie (dispara la carga perezosa de
     temporadas/episodios que hace tu propio detail()) y reintentar */
  function lazyResolve(slug, retry) {
    const appEl = document.getElementById('app');
    if (appEl) appEl.innerHTML =
      '<section class="empty page-top"><h2>Cargando…</h2>' +
      '<p class="muted" style="margin-top:8px">Buscando el episodio en el catálogo</p></section>';

    let tries = 0;
    const t = setInterval(() => {
      tries++;
      if (epExists(slug) || tries > 60) {   /* ~15 s máx. */
        clearInterval(t);
        retry();
      }
    }, 250);

    const s = window.findSeries ? findSeries((seriesIn(g('DB'), slug) || {}).slug || '') : null;
    const ref = s ? (s.slug || s.id) : (seriesIn(g('DB'), slug) || {}).slug;
    if (ref && typeof window.detail === 'function') {
      try { window.detail(ref); } catch (e) {}
    }
  }

  /* ---------- Guardas de episodio y serie ---------- */
  if (typeof window.episode === 'function') {
    const _episode = window.episode;
    window.episode = function (slug) {
      if (epExists(slug)) return _episode(slug);

      const sNow = seriesIn(g('DB'), slug);
      if (sNow) { lazyResolve(slug, () => _episode(slug)); return; }

      /* No está en este catálogo: buscar en los demás */
      resolveCatalog(slug).then(db => {
        if (!db) return _episode(slug);          /* deja el "No encontrado" de siempre */
        if (epExists(slug)) return _episode(slug);
        lazyResolve(slug, () => _episode(slug));
      });
    };
  }

  if (typeof window.detail === 'function') {
    const _detail = window.detail;
    window.detail = function (ref, extra) {
      const db = g('DB');
      const ok = db && db.series && db.series.some(x => (x.slug || x.id) === ref || x.id === ref);
      if (ok) return _detail(ref, extra);
      resolveCatalog(ref).then(db2 => {
        if (db2) _detail(ref, extra);
        else _detail(ref, extra);   /* último recurso: comportamiento original */
      });
    };
  }

  /* ---------- Sincronización hacia la URL ---------- */
  function syncOut() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('button, a');
      if (!btn) return;
      const box = document.querySelector(CFG.pagSelectors.join(', '));
      if (!box || !box.contains(btn)) return;
      if (btn.closest('.ep-pagination')) return;
      setTimeout(() => {
        const bs = [...box.querySelectorAll('button, a')].filter(b => !b.disabled);
        const act = box.querySelector('.on, .active, [aria-current]') || box.querySelector('button[class*="on"]');
        const idx = act ? bs.indexOf(act) : -1;
        if (idx >= 0) {
          const { path, params } = parseHash();
          params.set('pag', String(idx + 1));
          writeHash(path, params);
        }
      }, 60);
    }, true);

    document.addEventListener('change', e => {
      const sel = e.target.closest(CFG.filterSelector);
      if (!sel) return;
      const { path, params } = parseHash();
      const key = (sel.name || sel.id || ('f' + [...document.querySelectorAll(CFG.filterSelector)].indexOf(sel))).toLowerCase();
      if (sel.value) params.set(key, sel.value); else params.delete(key);
      writeHash(path, params);
    }, true);
  }

  /* Paginación de episodios (detailState.page → ?pag=) */
  function syncEpisodePag() {
    const dp = g('detailState');
    if (!dp) return;
    let last = null;
    setInterval(() => {
      if (typeof dp.page === 'number' && dp.page !== last && location.hash.indexOf('#/episode') === 0) {
        last = dp.page;
        const { path, params } = parseHash();
        if (dp.page > 0) params.set('pag', String(dp.page + 1));
        else params.delete('pag');
        writeHash(path, params);
      }
    }, 400);
  }

  /* ---------- Aplicar parámetros tras pintar ---------- */
  function applyParams(params) {
    const pEp = parseInt(params.get('pag'), 10);

    if (location.hash.indexOf('#/episode') === 0 && pEp > 0 && typeof window.gotoPage === 'function') {
      window.gotoPage(pEp - 1);
      return;
    }

    if (pEp > 0) {
      const tryClick = tries => {
        const box = document.querySelector(CFG.pagSelectors.join(', '));
        if (!box) { if (tries > 0) setTimeout(() => tryClick(tries - 1), 150); return; }
        const bs = [...box.querySelectorAll('button, a')].filter(b => !b.disabled);
        const target = bs[pEp - 1];
        if (target) target.click();
      };
      tryClick(20);
    }

    const selects = [...document.querySelectorAll(CFG.filterSelector)];
    for (const [k, v] of params.entries()) {
      if (k === 'pag') continue;
      const sel = selects.find(s =>
        (s.name || '').toLowerCase() === k ||
        (s.id || '').toLowerCase() === k ||
        ('f' + selects.indexOf(s)) === k);
      if (sel && sel.value !== v) {
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  /* ---------- route() con prefijo de catálogo ---------- */
  const _route = window.route;

  window.route = function () {
    const raw = location.hash || '#/';
    const qi = raw.indexOf('?');
    let path = qi >= 0 ? raw.slice(0, qi) : raw;
    const params = new URLSearchParams(qi >= 0 ? raw.slice(qi + 1) : '');

    const cm = path.match(/^#\/c\/([^/]+)\/?(.*)$/);
    if (cm) {
      const cat = cm[1];
      const rest = cm[2];
      if (cat !== g('currentCatalog')) {
        const AV = g('CATALOG_AVAILABLE') || {};
        if (AV[cat] && typeof window.ensureCatalog === 'function') {
          window.ensureCatalog(cat).then(db => {
            setG('DB', db);
            setG('currentCatalog', cat);
            localStorage.setItem('donghuaflix_catalog', cat);
            if (window.renderCatBar) renderCatBar();
            if (window.setAmbience) setAmbience('');
            window.route();
          }).catch(() => { location.hash = '#/'; });
        } else {
          history.replaceState(null, '', '#/' + (rest || ''));
          window.route();
        }
        return;
      }
      history.replaceState(null, '', '#/' + (rest || ''));
      _route();
      applyParams(params);
      history.replaceState(null, '', raw);
      return;
    }

    if (params.toString()) history.replaceState(null, '', path);
    _route();
    applyParams(params);
    if (params.toString()) history.replaceState(null, '', raw);
  };

  /* ---------- switchCatalog() conserva la sección ---------- */
  window.switchCatalog = async function (id) {
    if (id === g('currentCatalog')) return;

    const { path } = parseHash();
    const sec = path.replace(/^#\/?/, '').replace(/^c\/[^/]+\/?/, '');

    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.innerHTML = '<section class="section page-top"><div class="grid">' +
        Array(8).fill('<div class="skeleton"></div>').join('') + '</div></section>';
    }

    try {
      const db = await window.ensureCatalog(id);
      setG('DB', db);
      setG('currentCatalog', id);
      localStorage.setItem('donghuaflix_catalog', id);
      if (window.setAmbience) setAmbience('');
      if (window.renderCatBar) renderCatBar();
      location.hash = '#/c/' + id + (sec ? '/' + sec : '');
    } catch (e) {
      if (window.showToast) showToast('Catálogo no disponible todavía');
      if (typeof window.load === 'function') load();
    }
  };

  syncOut();
  syncEpisodePag();
  console.log('%c dfx-urlstate v2 activo ', 'background:#1a2440;color:#7aa5ff');
})();
