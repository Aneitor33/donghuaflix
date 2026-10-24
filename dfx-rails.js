/* ============================================================
 * DonghuaFlix — dfx-rails.js  (v2)
 * Filas horizontales de exploración para la portada.
 *
 * AÑADE EN index.html, DESPUÉS de app.js:
 *   <script src="dfx-rails.js?v=2"></script>
 *
 * v2: se reinyecta solo si home() repinta #app (carga perezosa),
 *     funciona con enlaces #/c/<cat>/ y avisa en consola.
 * ============================================================ */
(function () {
  'use strict';

  if (typeof window.home !== 'function') {
    console.warn('[dfx-rails] no encuentro home() ¿cargado antes que app.js?');
    return;
  }

  /* let/const del ámbito global NO viven en window: accedemos con eval indirecto */
  const g = n => (0, eval)(n);

  /* ---------- CONFIG ---------- */
  const CFG = {
    seguirViendo: 12,
    recientes: 15,
    estrenos: 15,
    porGenero: 14,
    generosSeries: 6,
    generosPelis: 3,
  };

  /* ---------- CSS ---------- */
  const CSS = `
  #dfxRails { margin-top: 8px; }
  .dfx-rail { margin: 26px 0 6px; }
  .dfx-rail-head {
    display: flex; align-items: baseline; justify-content: space-between;
    padding: 0 20px; margin-bottom: 12px;
  }
  .dfx-rail-head h2 { font-size: 17px; font-weight: 700; }
  .dfx-rail-head a { font-size: 12px; color: var(--mut, #98a1b3); white-space: nowrap; }
  .dfx-rail-wrap { position: relative; }
  .dfx-rail-track {
    display: grid; grid-auto-flow: column; grid-auto-columns: 138px;
    gap: 12px; overflow-x: auto; padding: 4px 20px 14px;
    scroll-snap-type: x mandatory; scrollbar-width: none;
  }
  .dfx-rail-track::-webkit-scrollbar { display: none; }
  .dfx-rail-track > * { scroll-snap-align: start; min-width: 0; }
  .dfx-rail-nav {
    position: absolute; top: 50%; transform: translateY(-50%);
    width: 36px; height: 36px; border-radius: 999px; border: none;
    background: rgba(10,12,18,.75); color: #fff; font-size: 18px;
    cursor: pointer; z-index: 5;
  }
  .dfx-rail-nav.prev { left: 6px; }
  .dfx-rail-nav.next { right: 6px; }
  @media (min-width: 760px) { .dfx-rail-track { grid-auto-columns: 158px; } }
  .dfx-card { display: block; border-radius: 10px; overflow: hidden;
    background: #151823; text-decoration: none; }
  .dfx-card .im { aspect-ratio: 2/3; background: #0d0f15 center/cover no-repeat; width: 100%; }
  .dfx-card.wide .im { aspect-ratio: 16/9; }
  .dfx-card .tt { font-size: 11.5px; color: #c5c9d4; padding: 6px 8px;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dfx-cats { display: flex; gap: 10px; overflow-x: auto; scrollbar-width: none; padding: 6px 20px 18px; }
  .dfx-cats::-webkit-scrollbar { display: none; }
  .dfx-cat { flex-shrink: 0; padding: 10px 18px; border-radius: 999px;
    border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.05);
    color: #f2f4f8; font-size: 13px; font-weight: 600; cursor: pointer; }
  .dfx-cat:hover { background: rgba(255,255,255,.12); }
  .dfx-cat.on { background: #d43d2a; border-color: transparent; }
  `;
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return; cssDone = true;
    const st = document.createElement('style');
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  /* ---------- Tarjeta ---------- */
  function railCard(s) {
    try {
      if (typeof window.card === 'function') {
        const html = window.card(s);
        if (html && html.indexOf('<') >= 0) return html;
      }
    } catch (e) { /* respaldo */ }
    const img = (window.getSeriesImage ? getSeriesImage(s) : s.image) || '';
    const ref = s.slug || s.id;
    return `<a class="dfx-card" href="#/series/${encodeURIComponent(ref)}">` +
      `<div class="im" style="background-image:url('${img}')"></div>` +
      `<div class="tt">${(window.cleanTitle ? cleanTitle(s) : s.title) || ''}</div></a>`;
  }

  /* ---------- Filas ---------- */
  function buildRails() {
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

    /* 1 · Seguir viendo */
    try {
      const hist = Object.entries(window.getHistory ? getHistory() : {})
        .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));
      const items = [];
      for (const [sid] of hist) {
        const s = window.findSeries ? findSeries(sid) : series.find(x => x.id === sid);
        if (s) items.push(s);
        if (items.length >= CFG.seguirViendo) break;
      }
      if (items.length) {
        rails.push({ title: 'Seguir viendo', items, href: '#/mylist' });
        items.forEach(s => used.add(s.id));
      }
    } catch (e) {}

    /* 2 · Recién actualizados */
    const rec = take(series.slice()
      .sort((a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0)),
      CFG.recientes);
    if (rec.length) rails.push({ title: 'Recién actualizados', items: rec, href: '#/series' });

    /* 3 · Estrenos del año */
    const est = take(series.filter(s => yearOf(s) === yearNow), CFG.estrenos);
    if (est.length) rails.push({ title: 'Estrenos ' + yearNow, items: est, href: '#/series' });

    /* 4 · Películas por género */
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

    /* 5 · Series por género */
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
        `<button class="dfx-cat ${c.id === CUR ? 'on' : ''}" data-goto="${c.id}">${c.label}</button>`
      ).join('') + '</div></section>';
  }

  /* ---------- Render (idempotente) ---------- */
  function renderRails() {
    injectCSS();
    if (document.getElementById('dfxRails')) return;

    const rails = buildRails();
    if (!rails.length) return;

    const wrap = document.createElement('div');
    wrap.id = 'dfxRails';
    wrap.innerHTML = rails.map(r => `
      <section class="dfx-rail">
        <div class="dfx-rail-head">
          <h2>${r.title}</h2>
          ${r.href ? `<a href="${r.href}">Ver todo →</a>` : ''}
        </div>
        <div class="dfx-rail-wrap">
          <div class="dfx-rail-track">${r.items.map(railCard).join('')}</div>
          <button class="dfx-rail-nav prev" aria-label="Anterior">‹</button>
          <button class="dfx-rail-nav next" aria-label="Siguiente">›</button>
        </div>
      </section>`).join('') + catalogStrip();

    const appEl = document.getElementById('app');
    const top10 = [...appEl.querySelectorAll('h2')]
      .find(h => /top\s*10/i.test(h.textContent || ''));
    const anchor = top10 ? top10.closest('section') : appEl.firstElementChild;
    if (anchor && anchor.nextSibling) appEl.insertBefore(wrap, anchor.nextSibling);
    else appEl.appendChild(wrap);

    wrap.querySelectorAll('.dfx-rail-wrap').forEach(w => {
      const track = w.querySelector('.dfx-rail-track');
      w.querySelector('.prev').onclick = () => track.scrollBy({ left: -track.clientWidth * 0.8, behavior: 'smooth' });
      w.querySelector('.next').onclick = () => track.scrollBy({ left: track.clientWidth * 0.8, behavior: 'smooth' });
    });
    wrap.querySelectorAll('.dfx-cat[data-goto]').forEach(b => {
      b.onclick = () => window.switchCatalog && switchCatalog(b.dataset.goto);
    });
  }

  /* ---------- Cuándo pintar ---------- */
  function isHomeRoute() {
    const h = location.hash || '#/';
    return h === '#/' || /^#\/c\/[^/]+\/?$/.test(h);
  }
  function maybeRender() {
    if (!isHomeRoute()) return;
    if (document.getElementById('dfxRails')) return;
    try { renderRails(); }
    catch (e) { console.error('[dfx-rails] error al pintar:', e); }
  }

  /* Envolver home() */
  const _home = window.home;
  window.home = function () {
    const r = _home.apply(this, arguments);
    Promise.resolve(r).then(() => {
      maybeRender();
      setTimeout(maybeRender, 300);
      setTimeout(maybeRender, 900);
    });
    return r;
  };

  /* Si home() repinta #app después (carga perezosa), reinyectar */
  const appEl = document.getElementById('app');
  if (appEl) {
    let moT = null;
    new MutationObserver(() => {
      clearTimeout(moT);
      moT = setTimeout(maybeRender, 150);
    }).observe(appEl, { childList: true });
  }

  window.addEventListener('hashchange', () => setTimeout(maybeRender, 150));
  console.log('%c dfx-rails v2 activo ', 'background:#12281a;color:#4ade80');
})();
