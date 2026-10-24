/* ============================================================
 * DonghuaFlix — dfx-urlstate.js
 * Todo tiene enlace: catálogo, sección, página y filtros.
 *
 * Formato:  #/c/<catalogo>/<seccion>?pag=3&<filtros...>
 * Ejemplos:
 *   #/c/pelispedia/series?pag=4
 *   #/c/donghualife/genre/accion
 *   #/c/youtubefilms/movies?orden=recientes&anio=2024
 *   #/search/shrouding        (la búsqueda ya era enlazable)
 *
 * AÑADE EN index.html, DESPUÉS de app.js y dfx-rails.js:
 *   <script src="dfx-urlstate.js"></script>
 *
 * No edita app.js: reemplaza route()/switchCatalog() envolviendo
 * las originales y sincronizando paginación y filtros por delegación.
 * ============================================================ */
(function () {
  'use strict';

  if (typeof window.route !== 'function') return;

  /* let/const globales (DB, currentCatalog, CATALOGS, ...) no viven en window */
  const g = n => (0, eval)(n);
  function setG(n, v) { window.__dfx_tmp = v; (0, eval)(n + ' = window.__dfx_tmp'); delete window.__dfx_tmp; }

  /* ---------- CONFIG: ajusta estos selectores si tu maqueta cambia ---------- */
  const CFG = {
    /* Contenedor de la paginación del grid (listAllSeries).
       Se detecta por clase; el primero que exista gana. */
    pagSelectors: ['.pagination', '.pg', '[class*="pagin"]', '[class*="pager"]'],
    /* Selects de filtro (Clasificación / Género / Año / Orden...) */
    filterSelector: '#app select',
  };

  /* ---------- Utilidades de hash con parámetros ---------- */
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

  /* ---------- Sincronización hacia la URL (clics y filtros) ---------- */
  function syncOut() {
    document.addEventListener('click', e => {
      const btn = e.target.closest('button, a');
      if (!btn) return;
      const box = document.querySelector(CFG.pagSelectors.join(', '));
      if (!box || !box.contains(btn)) return;
      /* Página de EPISODIO: usa gotoPage(), que sí vive en window */
      if (btn.closest('.ep-pagination')) return; // ya lo cubre syncEpisodePag
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

    /* Selects de filtro → parámetros */
    document.addEventListener('change', e => {
      const sel = e.target.closest(CFG.filterSelector);
      if (!sel) return;
      const { path, params } = parseHash();
      const key = (sel.name || sel.id || ('f' + [...document.querySelectorAll(CFG.filterSelector)].indexOf(sel))).toLowerCase();
      if (sel.value) params.set(key, sel.value); else params.delete(key);
      writeHash(path, params);
    }, true);
  }

  /* La paginación de episodios (gotoPage es global) se refleja sola:
     reescribimos la URL cada vez que cambia detailState.page */
  function syncEpisodePag() {
    const dp = g('detailState');
    if (!dp) return;
    let last = null;
    setInterval(() => {
      if (typeof dp.page === 'number' && dp.page !== last &&
          location.hash.startsWith('#/episode')) {
        last = dp.page;
        const { path, params } = parseHash();
        if (dp.page > 0) params.set('pag', String(dp.page + 1));
        else params.delete('pag');
        writeHash(path, params);
      }
    }, 400);
  }

  /* ---------- Aplicar parámetros tras pintar la página ---------- */
  function applyParams(params) {
    /* Página de episodio: gotoPage() es función global */
    const pEp = parseInt(params.get('pag'), 10);
    if (location.hash.startsWith('#/episode') && pEp > 0 && typeof window.gotoPage === 'function') {
      window.gotoPage(pEp - 1);
      return;
    }

    /* Paginación del grid: pulsar el botón N (esperamos a que exista) */
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

    /* Filtros: volcar valores en los selects y dispararlos */
    const selects = [...document.querySelectorAll(CFG.filterSelector)];
    for (const [k, v] of params.entries()) {
      if (k === 'pag') continue;
      const sel = selects.find(s =>
        (s.name || '').toLowerCase() === k ||
        (s.id || '').toLowerCase() === k ||
        ('f' + selects.indexOf(s)) === k
      );
      if (sel && sel.value !== v) {
        sel.value = v;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  }

  /* ---------- route() con prefijo de catálogo + parámetros ---------- */
  const _route = window.route;

  window.route = function () {
    let { raw, path, params } = parseHash();

    /* ① Prefijo de catálogo: #/c/<id>/... */
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
      /* Catálogo correcto: dejamos hash limpio para la route original */
      history.replaceState(null, '', '#/' + (rest || ''));
      _route();
      applyParams(params);
      history.replaceState(null, '', raw);   // el enlace compartible conserva c/<id> y parámetros
      return;
    }

    /* ② Hash normal: enrutar y aplicar parámetros si los hay */
    if (params.toString()) history.replaceState(null, '', path);
    _route();
    applyParams(params);
    if (params.toString()) history.replaceState(null, '', raw);
  };

  /* ---------- switchCatalog() que conserva la sección ---------- */
  window.switchCatalog = async function (id) {
    if (id === g('currentCatalog')) return;

    /* Sección actual (sin prefijo ni parámetros) */
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

  /* ---------- Arranque ---------- */
  syncOut();
  syncEpisodePag();
})();
