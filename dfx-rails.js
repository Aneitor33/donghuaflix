/* ============================================================
 * DonghuaFlix — dfx-rails.js  (v3 · compatible con Modo Cine)
 * Filas horizontales de exploración para la portada.
 *
 * ORDEN EN index.html (importante):
 *   app.js → dfx-cine.js → dfx-urlstate.js → dfx-rails.js
 *
 * v3: en Modo Cine inyecta filas estilo cx5 entre los pills de
 *     género y el grid; en la web clásica usa home() como antes.
 * ============================================================ */
(function () {
  'use strict';

  const g = n => (0, eval)(n);
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const CFG = {
    recientes: 15,
    estrenos: 15,
    porGenero: 14,
    generosSeries: 6,
    generosPelis: 3,
  };

  const CSS = `
  #dfxRails { margin-top: 8px; }
  .dfx-rail { margin: 22px 0 4px; }
  .dfx-rail-head { display: flex; align-items: baseline; justify-content: space-between;
    padding: 0 16px; margin-bottom: 10px; }
  .dfx-rail-head h2 { font-size: 15px; font-weight: 700; color: #fff;
    display: flex; align-items: center; gap: 6px; }
  .dfx-rail-head h2::before { content: ''; width: 4px; height: 13px;
    background: #ff2e2e; border-radius: 99px; }
  .dfx-rail-head a { font-size: 11px; color: #a1a1aa; white-space: nowrap; text-decoration: none; }
  .dfx-rail-wrap { position: relative; }
  .dfx-rail-track { display: grid; grid-auto-flow: column; grid-auto-columns: 122px;
    gap: 10px; overflow-x: auto; padding: 2px 16px 12px;
    scroll-snap-type: x mandatory; scrollbar-width: none; }
  .dfx-rail-track::-webkit-scrollbar { display: none; }
  .dfx-rail-track > * { scroll-snap-align: start; min-width: 0; }
  .dfx-rail-nav { position: absolute; top: 40%; transform: translateY(-50%);
    width: 32px; height: 32px; border-radius: 999px; border: 1px solid rgba(255,255,255,.14);
    background: rgba(8,8,10,.8); color: #fff; font-size: 16px; cursor: pointer; z-index: 5; }
  .dfx-rail-nav.prev { left: 4px; }
  .dfx-rail-nav.next { right: 4px; }
  @media (min-width: 760px) { .dfx-rail-track { grid-auto-columns: 148px; } }
  /* tarjeta clásica (web original) */
  .dfx-card { display: block; border-radius: 10px; overflow: hidden;
    background: #151823; text-decoration: none; }
  .dfx-card .im { aspect-ratio: 2/3; background: #0d0f15 center/cover no-repeat; width: 100%; }
  .dfx-card .tt { font-size: 11.5px; color: #c5c9d4; padding: 6px 8px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dfx-cats { display: flex; gap: 10px; overflow-x: auto; scrollbar-width: none; padding: 4px 16px 16px; }
  .dfx-cats::-webkit-scrollbar { display: none; }
  .dfx-cat { flex-shrink: 0; padding: 9px 16px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.16); background: rgba(255,255,255,.04);
    color: #f2f4f8; font-size: 12.5px; font-weight: 600; cursor: pointer; font-family: inherit; }
  .dfx-cat:hover { background: rgba(255,255,255,.1); }
  .dfx-cat.on { background: #ff2e2e; border-color: #ff2e2e; }
  `;
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- tarjetas ---------- */
  function railCardCine(s) {
    const img = (window.getSeriesImage ? getSeriesImage(s) : s.image) || '';
    const ref = s.slug || s.id;
    const t = (window.cleanTitle ? cleanTitle(s) : s.title) || '';
    const st = s.status || '';
    const badge = /emisi/i.test(st)
      ? '<span class="cx5-bdg live" style="top:5px;left:5px">EN EMISIÓN</span>'
      : (/finaliz/i.test(st) ? '<span class="cx5-bdg off" style="top:5px;left:5px">FINALIZADO</span>' : '');
    const inner = img
      ? `<img loading="lazy" src="${esc(img)}" data-fb="${esc(img)}" data-t="${esc(t)}" alt="" onerror="dfxImgFb(this)">`
      : `<div class="cx5-ph">${esc((t.charAt(0) || '?').toUpperCase())}</div>`;
    return `<a class="cxx-card" href="#/series/${encodeURIComponent(ref)}">` +
      `<div class="cx5-po2">${inner}${badge}</div>` +
      `<div class="cx5-ct">${esc(t)}</div></a>`;
  }
  function railCardClassic(s) {
    try {
      if (typeof window.card === 'function') {
        const html = window.card(s);
        if (html && html.indexOf('<') >= 0) return html;
      }
    } catch (e) {}
    const img = (window.getSeriesImage ? getSeriesImage(s) : s.image) || '';
    const ref = s.slug || s.id;
    const t = (window.cleanTitle ? cleanTitle(s) : s.title) || '';
    return `<a class="dfx-card" href="#/series/${encodeURIComponent(ref)}">` +
      `<div class="im" style="background-image:url('${esc(img)}')"></div>` +
      `<div class="tt">${esc(t)}</div></a>`;
  }

  /* ---------- filas ---------- */
  function buildRails(cine) {
    const DBv = g('DB');
    const series = (DBv && DBv.series) || [];
    if (!series.length) return [];

    const yearNow = new Date().getFullYear();
    const used = new Set();
    const rails = [];
    const genresOf = s => (window.seriesGenres ? seriesGenres(s) : (s.genres || []));
    const typeOf = s => (window.contentTypeOf ? contentTypeOf(s) : 'series');
    const yearOf = s => parseInt((window.getYear ? getYear(s) : s.year) || s.year, 10) || null;

    const take = (list, n) => {
      const out = [];
      for (const s of list) {
        if (out.length >= n) break;
        if (used.has(s.id)) continue;
        used.add(s.id); out.push(s);
      }
      return out;
    };

    /* "Seguir viendo": en Modo Cine ya existe, no duplicar */
    if (!cine) {
      try {
        const hist = Object.entries(window.getHistory ? getHistory() : {})
          .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
        const items = [];
        for (const [sid] of hist) {
          const s = window.findSeries ? findSeries(sid) : series.find(x => x.id === sid);
          if (s) items.push(s);
          if (items.length >= 12) break;
        }
        if (items.length) {
          rails.push({ title: 'Seguir viendo', items, href: '#/mylist' });
          items.forEach(s => used.add(s.id));
        }
      } catch (e) {}
    }

    const rec = take(series.slice()
      .sort((a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0)),
      CFG.recientes);
    if (rec.length) rails.push({ title: 'Recién actualizados', items: rec, href: '#/series' });

    const est = take(series.filter(s => yearOf(s) === yearNow), CFG.estrenos);
    if (est.length) rails.push({ title: 'Estrenos ' + yearNow, items: est, href: '#/series' });

    const pelis = series.filter(s => typeOf(s) === 'movie');
    if (pelis.length) {
      const byG = new Map();
      for (const s of pelis) for (const gg of genresOf(s)) {
        if (!byG.has(gg)) byG.set(gg, []);
        byG.get(gg).push(s);
      }
      for (const [gg, list] of [...byG.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, CFG.generosPelis)) {
        const items = take(list, CFG.porGenero);
        if (items.length >= 4) rails.push({ title: 'Películas de ' + gg, items, href: '#/genre/' + encodeURIComponent(gg) });
      }
    }

    const byG = new Map();
    for (const s of series) {
      if (typeOf(s) === 'movie' && pelis.length > 30) continue;
      for (const gg of genresOf(s)) {
        if (!byG.has(gg)) byG.set(gg, []);
        byG.get(gg).push(s);
      }
    }
    for (const [gg, list] of [...byG.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, CFG.generosSeries)) {
      const items = take(list, CFG.porGenero);
      if (items.length >= 4) rails.push({ title: gg, items, href: '#/genre/' + encodeURIComponent(gg) });
    }

    return rails;
  }

  function catalogStrip() {
    const CATALOGS = g('CATALOGS');
    if (!Array.isArray(CATALOGS)) return '';
    const AV = g('CATALOG_AVAILABLE') || {};
    const CUR = g('currentCatalog');
    if (CATALOGS.filter(c => c.id !== CUR && AV[c.id]).length < 1) return '';
    return '<section class="dfx-rail"><div class="dfx-rail-head"><h2>Explorar catálogos</h2></div>' +
      '<div class="dfx-cats">' + CATALOGS.map(c =>
        `<button class="dfx-cat ${c.id === CUR ? 'on' : ''}" data-goto="${esc(c.id)}">${esc(c.label)}</button>`
      ).join('') + '</div></section>';
  }

  /* ---------- render ---------- */
  function isCine() { return document.body.classList.contains('dfx-cine-home'); }

  function renderRails() {
    injectCSS();
    if (document.getElementById('dfxRails')) return;

    const cine = isCine();
    const rails = buildRails(cine);
    if (!rails.length) return;

    const wrap = document.createElement('div');
    wrap.id = 'dfxRails';
    const cardFn = cine ? railCardCine : railCardClassic;
    wrap.innerHTML = rails.map(r => `
      <section class="dfx-rail">
        <div class="dfx-rail-head">
          <h2>${esc(r.title)}</h2>
          ${r.href ? `<a href="${r.href}">Ver todo →</a>` : ''}
        </div>
        <div class="dfx-rail-wrap">
          <div class="dfx-rail-track">${r.items.map(cardFn).join('')}</div>
          <button class="dfx-rail-nav prev" aria-label="Anterior">‹</button>
          <button class="dfx-rail-nav next" aria-label="Siguiente">›</button>
        </div>
      </section>`).join('') + catalogStrip();

    const appEl = document.getElementById('app');

    if (cine) {
      /* Modo Cine: antes del grid de "Recomendados" */
      const grid = document.getElementById('cx5Grid');
      const anchor = grid ? grid.closest('section') : null;
      if (anchor) { anchor.parentNode.insertBefore(wrap, anchor); }
      else appEl.appendChild(wrap);
      /* ancho fijo de tarjetas cx5 */
      wrap.querySelectorAll('.cxx-card').forEach(a => { a.style.flex = 'none'; a.style.width = '118px'; a.style.textDecoration = 'none'; });
    } else {
      const top10 = [...appEl.querySelectorAll('h2')].find(h => /top\s*10/i.test(h.textContent || ''));
      const anchor = top10 ? top10.closest('section') : appEl.firstElementChild;
      if (anchor && anchor.nextSibling) appEl.insertBefore(wrap, anchor.nextSibling);
      else appEl.appendChild(wrap);
    }

    wrap.querySelectorAll('.dfx-rail-wrap').forEach(w => {
      const track = w.querySelector('.dfx-rail-track');
      w.querySelector('.prev').onclick = () => track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' });
      w.querySelector('.next').onclick = () => track.scrollBy({ left: track.clientWidth * 0.8, behavior: 'smooth' });
    });
    wrap.querySelectorAll('.dfx-cat[data-goto]').forEach(b => {
      b.onclick = () => window.switchCatalog && switchCatalog(b.dataset.goto);
    });
  }

  /* ---------- cuándo pintar ---------- */
  function maybeRender() {
    const h = location.hash || '#/';
    const cine = isCine();
    const home = cine || h === '#/' || /^#\/c\/[^/]+\/?$/.test(h) ||
                 (typeof window.home === 'function' && document.querySelector('#app .home, #app .section'));
    if (!home) return;
    if (document.getElementById('dfxRails')) return;
    try { renderRails(); }
    catch (e) { console.error('[dfx-rails]', e); }
  }

  /* Envolver la route FINAL (la del Modo Cine, si existe) */
  if (typeof window.route === 'function') {
    const _route = window.route;
    window.route = function () {
      const r = _route.apply(this, arguments);
      Promise.resolve(r).then(() => {
        maybeRender();
        setTimeout(maybeRender, 250);
        setTimeout(maybeRender, 800);
      });
      return r;
    };
  }

  const appEl = document.getElementById('app');
  if (appEl) {
    let moT = null;
    new MutationObserver(() => {
      clearTimeout(moT);
      moT = setTimeout(maybeRender, 150);
    }).observe(appEl, { childList: true });
  }
  window.addEventListener('hashchange', () => setTimeout(maybeRender, 150));
  setTimeout(maybeRender, 1200);
  console.log('%c dfx-rails v3 activo (modo cine) ', 'background:#12281a;color:#4ade80');
})();
