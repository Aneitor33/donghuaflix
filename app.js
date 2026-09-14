console.log("%c DonghuaFlix — Creado por @bledark__ ", "background:#000;color:#e50914;font-size:14px;font-weight:bold;");

let DB = { series: [], seasons: [], episodes: [], genres: [], meta: {} };

/* ---------- MULTI-CATÁLOGO (Donghuas / Cdramas / ...) ---------- */
const CATALOGS = [
  { id: 'donghua', file: './public/data/catalog.json', label: 'Donghuas' },
  { id: 'cdrama', file: './public/data/catalog-cdrama.json', label: 'Cdramas' },
  { id: 'anime', file: './public/data/catalog-anime.json', label: 'Animación' },
  { id: 'cine', file: './public/data/catalog-cine.json', label: 'Cine' }
];
let DB_CACHE = {};
let currentCatalog = localStorage.getItem('donghuaflix_catalog') || 'donghua';
const CATALOG_AVAILABLE = { donghua: true };

async function ensureCatalog(id) {
  if (DB_CACHE[id]) return DB_CACHE[id];
  const cat = CATALOGS.find(c => c.id === id);
  const r = await fetch(cat.file + '?ts=' + Date.now(), { cache: 'reload' });
  if (!r.ok) throw new Error('No se pudo cargar ' + cat.file);
  const data = await r.json();
  DB_CACHE[id] = data;
  CATALOG_AVAILABLE[id] = true;
  return data;
}

async function probeCatalogs() {
  for (const c of CATALOGS) {
    if (DB_CACHE[c.id]) { CATALOG_AVAILABLE[c.id] = true; continue; }
    try {
      const r = await fetch(c.file, { cache: 'no-store' });
      CATALOG_AVAILABLE[c.id] = r.ok;
    } catch { CATALOG_AVAILABLE[c.id] = false; }
  }
  renderCatBar();
}

function renderCatBar() {
  const bar = document.getElementById('catBar');
  if (!bar) return;
  const available = CATALOGS.filter(c => CATALOG_AVAILABLE[c.id]);
  bar.style.display = available.length > 1 ? '' : 'none';
  bar.querySelectorAll('button').forEach(b => {
    const id = b.dataset.cat;
    b.classList.toggle('on', id === currentCatalog);
    b.style.display = CATALOG_AVAILABLE[id] ? '' : 'none';
  });
}

async function switchCatalog(id) {
  if (id === currentCatalog) return;
  app.innerHTML = '<section class="section page-top"><div class="grid">' +
    Array(8).fill('<div class="skeleton"></div>').join('') + '</div></section>';
  try {
    DB = await ensureCatalog(id);
    currentCatalog = id;
    localStorage.setItem('donghuaflix_catalog', id);
    setAmbience('');
    location.hash = '#/';
    renderCatBar();
    route();
  } catch (e) {
    showToast('Catálogo no disponible todavía');
    load();
  }
}
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const qs = s => encodeURIComponent(s || '');

/* ---------- ICONOS SVG (estilo Netflix, sin emojis) ---------- */
const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9A5.3 5.3 0 0 1 12 6.6a5.3 5.3 0 0 1 9.3 4.9c-1.8 4.4-9.3 9-9.3 9z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',
  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10"/><path d="M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',
  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="M7 4v16M17 4v16"/></svg>',
  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></svg>',
  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',
  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
};

/* ---------- HELPERS ---------- */
const cleanTitle = (s) => {
  let title = s?.title;
  if (title) title = title.replace(/\s*\|\s*Donghualife.*$/i, '').trim();
  if (!title || title.toLowerCase() === 'temporadas') {
    const rawSlug = s?.slug || s?.id || '';
    if (rawSlug) return rawSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return 'Donghua';
  }
  return title;
};

const cleanEpisodeTitle = (e) => {
  let t = (e.title || '').replace(/\s*\|\s*Donghualife.*$/i, '').trim();
  const m = t.match(/(?:^|[-–—])\s*\d*\s*(?:Episodio|Episode)\s*x?(\d+)\s*$/i);
  if (m) return `Episodio ${parseInt(m[1], 10)}`;
  return t || `Episodio ${e.number}`;
};

const slugFromUrl = u => (u || '').split('?')[0].split('/').filter(Boolean).pop() || '';
const prettySlug = slug => slug.split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const seasonTitle = (season, index) => {
  if (Number.isFinite(season.number)) return `Temporada ${season.number}`;
  const t = (season.title || '').trim();
  if (t && t.toLowerCase() !== 'temporadas') {
    const m = t.match(/(?:temporada|season)\s*(\d{1,3})/i) || t.match(/^(\d{1,3})[ª°.]/);
    if (m) return `Temporada ${parseInt(m[1], 10)}`;
    return t;
  }
  const slug = (season.slug || season.id || slugFromUrl(season.url || season.sourceUrl) || '').toLowerCase();
  let m = slug.match(/-(\d{1,3})-\d{1,3}$/);
  if (m) return `Temporada ${parseInt(m[1], 10)}`;
  m = slug.match(/-(\d{1,3})$/);
  if (m) return `Temporada ${parseInt(m[1], 10)}`;
  if (slug) return prettySlug(slug);
  return `Temporada ${index + 1}`;
};

function orderSeasons(s, seasons) {
  const urls = s.seasonUrls || [];
  if (!urls.length) return seasons;
  const rank = seas => {
    const key = (seas.slug || seas.id || slugFromUrl(seas.url || seas.sourceUrl) || '').toLowerCase();
    const i = urls.findIndex(u => slugFromUrl(u).toLowerCase() === key || u === (seas.url || seas.sourceUrl));
    return i === -1 ? 999 : i;
  };
  return seasons.slice().sort((a, b) => rank(a) - rank(b));
}

const getSeriesImage = (s) => {
  if (s?.posterLocal) return s.posterLocal;
  if (s?.image && !s.image.includes('IcoPrueba.png')) return s.image;
  const seasons = DB.seasons.filter(seas => seas.seriesId === s.id);
  for (const seas of seasons) {
    if (seas.image && !seas.image.includes('IcoPrueba.png')) return seas.image;
  }
  return '';
};

const findSeries = ref => DB.series.find(x => (x.slug || x.id) === ref || x.id === ref);
const findEpisode = ref => DB.episodes.find(x => (x.slug || x.id) === ref || x.id === ref);

const dedupeEps = eps => {
  const map = new Map();
  eps.forEach(e => { if (!map.has(e.number)) map.set(e.number, e); });
  return [...map.values()].sort((a, b) => a.number - b.number);
};

const seriesGenres = s => {
  if (Array.isArray(s.genres)) return s.genres;
  if (s.genre) return [s.genre];
  return [];
};

// Portadas inteligentes: las horizontales cubren el cuadro centrando el recorte
function imgLoaded(img) {
  img.classList.toggle('wide', img.naturalWidth > img.naturalHeight);
}

/* ---------- FONDO AMBIENTE (cristal líquido) ---------- */
function setAmbience(url) {
  const el = document.getElementById('bgAmbience');
  if (!el) return;
  el.style.backgroundImage = url ? `url('${url}')` : 'none';
}

/* ---------- VISTOS ---------- */
function getWatched() {
  try { return JSON.parse(localStorage.getItem('donghuaflix_watched') || '{}'); }
  catch (e) { return {}; }
}
function isWatched(seasonId, num) { return Boolean(getWatched()[seasonId]?.[num]); }
function markWatchedUpTo(seasonId, num) {
  const all = getWatched();
  all[seasonId] = all[seasonId] || {};
  for (let n = 1; n <= num; n++) if (!all[seasonId][n]) all[seasonId][n] = Date.now();
  localStorage.setItem('donghuaflix_watched', JSON.stringify(all));
}
function toggleWatched(seasonId, num) {
  const all = getWatched();
  all[seasonId] = all[seasonId] || {};
  if (all[seasonId][num]) delete all[seasonId][num];
  else all[seasonId][num] = Date.now();
  localStorage.setItem('donghuaflix_watched', JSON.stringify(all));
  showToast(isWatched(seasonId, num) ? 'Marcado como visto' : 'Marcador quitado');
  const s = findSeries(detailState.seriesId);
  if (s) {
    const seasons = orderSeasons(s, DB.seasons.filter(x => x.seriesId === s.id));
    if (seasons[detailState.seasonIdx]) renderEpisodePage(seasons[detailState.seasonIdx]);
  }
}
function seriesProgress(s) {
  const watched = getWatched();
  const seasons = DB.seasons.filter(x => x.seriesId === s.id);
  let total = 0, seen = 0;
  for (const seas of seasons) {
    const eps = DB.episodes.filter(e => e.seasonId === seas.id);
    total += eps.length;
    const w = watched[seas.id] || {};
    seen += eps.filter(e => w[e.number]).length;
  }
  return total ? Math.round(seen / total * 100) : 0;
}
function seriesEpisodeCount(s) {
  return DB.episodes.filter(e => e.seriesId === s.id).length;
}

/* ---------- TOAST ---------- */
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---------- FAVORITOS ---------- */
function getFavs() {
  try { return JSON.parse(localStorage.getItem('donghuaflix_favs') || '[]'); }
  catch (e) { return []; }
}
function toggleFav(seriesId) {
  let favs = getFavs();
  const was = favs.includes(seriesId);
  favs = was ? favs.filter(id => id !== seriesId) : [...favs, seriesId];
  localStorage.setItem('donghuaflix_favs', JSON.stringify(favs));
  showToast(was ? 'Quitado de Mi lista' : 'Añadido a Mi lista');
  return !was;
}
const isFav = id => getFavs().includes(id);

/* ---------- HISTORIAL ---------- */
function getHistory() {
  try { return JSON.parse(localStorage.getItem('donghuaflix_history') || '{}'); }
  catch (e) { return {}; }
}
function saveHistory(seriesId, episodeData) {
  try {
    const history = getHistory();
    history[seriesId] = {
      episodeId: episodeData.id,
      episodeNumber: episodeData.number,
      episodeTitle: episodeData.title,
      seasonId: episodeData.seasonId,
      timestamp: Date.now()
    };
    localStorage.setItem('donghuaflix_history', JSON.stringify(history));
  } catch (e) {}
}
function lastWatchedEpisode(s) {
  const h = getHistory()[s.id];
  if (h) {
    const ep = findEpisode(h.episodeId);
    if (ep) return ep;
  }
  // Si no hay historial: primer episodio disponible
  const seasons = orderSeasons(s, DB.seasons.filter(x => x.seriesId === s.id));
  for (const seas of seasons) {
    const eps = dedupeEps(DB.episodes.filter(e => e.seasonId === seas.id));
    if (eps.length) return eps[0];
  }
  return null;
}

/* ---------- AUTO SIGUIENTE ---------- */
let currentEpisode = null;
let autoNextEnabled = localStorage.getItem('donghuaflix_autonext') !== 'off';

function toggleAutoNext() {
  autoNextEnabled = !autoNextEnabled;
  localStorage.setItem('donghuaflix_autonext', autoNextEnabled ? 'on' : 'off');
  showToast(autoNextEnabled ? 'Auto-siguiente activado' : 'Auto-siguiente desactivado');
  const b = document.getElementById('autoNextBtn');
  if (b) b.innerHTML = `${ICONS.repeat}<span>Auto: ${autoNextEnabled ? 'ON' : 'OFF'}</span>`;
}
function autoNext() {
  if (!currentEpisode || !autoNextEnabled) return;
  const seasonEps = dedupeEps(DB.episodes.filter(x => x.seasonId === currentEpisode.seasonId));
  const idx = seasonEps.findIndex(x => x.id === currentEpisode.id);
  const next = seasonEps[idx + 1];
  if (next) {
    showToast('Cargando siguiente episodio…');
    setTimeout(() => { location.hash = '#/episode/' + qs(next.slug || next.id); }, 1200);
  } else {
    showToast('¡Has terminado esta temporada!');
  }
}
window.addEventListener('message', event => {
  const origin = String(event.origin || '');
  if (!/dailymotion|dmcdn/i.test(origin)) return;
  const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || {});
  if (/video[_-]?end|ended/i.test(data)) autoNext();
});

/* ---------- RECOMENDACIONES ---------- */
function getRecommendedSeries(currentSeries, limit = 8) {
  const historyIds = new Set(Object.keys(getHistory()));
  const currentGenres = seriesGenres(currentSeries).map(g => g.toLowerCase());
  const others = DB.series.filter(s => s.id !== currentSeries.id);
  const scored = others.map(s => ({
    s,
    score: seriesGenres(s).map(g => g.toLowerCase()).filter(g => currentGenres.includes(g)).length
  }));
  const fresh = scored
    .filter(x => x.score > 0 && !historyIds.has(x.s.id))
    .sort((a, b) => b.score - a.score || (b.s.updatedAt || '').localeCompare(a.s.updatedAt || ''));
  const filler = scored
    .filter(x => x.score === 0 && !historyIds.has(x.s.id))
    .sort((a, b) => (b.s.updatedAt || '').localeCompare(a.s.updatedAt || ''));
  return [...fresh, ...filler].slice(0, limit).map(x => x.s);
}

/* ---------- PANTALLA COMPLETA ---------- */
function togglePlayerFS() {
  const player = document.querySelector('.player');
  if (!player) return;
  if (document.fullscreenElement) document.exitFullscreen();
  else if (player.requestFullscreen) player.requestFullscreen();
  else if (player.webkitRequestFullscreen) player.webkitRequestFullscreen();
}

function toggleMoreMenu() {
  document.getElementById('moreMenu')?.classList.toggle('open');
}

/* ---------- CARGA ---------- */
async function load() {
  app.innerHTML = '<section class="section page-top"><div class="grid">' +
    Array(8).fill('<div class="skeleton"></div>').join('') + '</div></section>';
  try {
    DB = await ensureCatalog(currentCatalog);
    renderCatBar();
    const footerStatus = document.getElementById('footerStatus');
    if (footerStatus) {
      footerStatus.innerHTML = `
        ${DB.meta?.syncedAt ? `Actualizado: ${new Date(DB.meta.syncedAt).toLocaleString('es-ES')}` : 'Catálogo listo'}
        &nbsp;·&nbsp; Desarrollado con amor por
        <a href="https://instagram.com/bledark__" target="_blank" rel="noopener">@bledark__</a>`;
    }
    route();
    probeCatalogs();
  } catch (err) {
    app.innerHTML = `<section class="empty page-top">
      <h2>Error al cargar el catálogo</h2>
      <p class="muted">Revisa tu conexión o el archivo del catálogo</p>
    </section>`;
  }
}

/* ---------- TARJETAS ---------- */
function card(s) {
  const imgUrl = getSeriesImage(s);
  const title = cleanTitle(s);
  const fav = isFav(s.id);
  const progress = seriesProgress(s);
  return `<article class="card" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
    <div class="poster">
      ${imgUrl
        ? `<img loading="lazy" src="${esc(imgUrl)}" alt="${esc(title)}" onload="imgLoaded(this)" onerror="this.parentNode.innerHTML='<div class=&quot;no-img&quot;>DONGHUAFLIX</div>'">`
        : '<div class="no-img">DONGHUAFLIX</div>'}
      <span class="badge">${esc(s.status || 'DONGHUA')}</span>
      <button class="fav-heart ${fav ? 'on' : ''}" title="Mi lista"
        onclick="event.stopPropagation();toggleFav('${esc(s.id)}');refreshFavUI(this,'${esc(s.id)}')">${ICONS.heart}</button>
      ${progress > 0 ? `<div class="progress"><span style="width:${progress}%"></span></div>` : ''}
    </div>
    <h3>${esc(title)}</h3>
  </article>`;
}

function refreshFavUI(btn, seriesId) {
  btn.classList.toggle('on', isFav(seriesId));
}

function rail(items) {
  return `<div class="rail">${items.map(s => `<div class="rail-item">${card(s)}</div>`).join('')}</div>`;
}

/* ---------- CONTINUAR VIENDO (tarjetas apaisadas estilo Netflix) ---------- */
function cwCard(s, hist) {
  const img = getSeriesImage(s);
  const season = DB.seasons.find(x => x.id === hist.seasonId);
  const sn = season && Number.isFinite(season.number) ? season.number : 1;
  const progress = seriesProgress(s);
  return `<div class="cw-card" onclick="location.hash='#/episode/${qs(hist.episodeId)}'">
    ${img ? `<img loading="lazy" src="${esc(img)}" alt="" onerror="this.remove()">` : ''}
    <div class="cw-shade"></div>
    <div class="cw-play">${ICONS.play}</div>
    <div class="cw-info">${esc(cleanTitle(s))} · T${sn}:E${hist.episodeNumber}</div>
    ${progress > 0 ? `<div class="cw-progress"><span style="width:${progress}%"></span></div>` : ''}
  </div>`;
}

/* ---------- TOP 10 ---------- */
function top10Rail(items) {
  if (!items.length) return '';
  return `<div class="top10-row">${items.map((s, i) => `
    <div class="top10-item" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
      <span class="top10-num">${i + 1}</span>
      <div class="top10-poster" style="background-image:url('${esc(getSeriesImage(s))}')"></div>
    </div>`).join('')}</div>`;
}

/* ---------- HERO ---------- */
let heroItems = [], heroIdx = 0, heroTimer = null;

function renderHero() {
  const hero = heroItems[heroIdx];
  const sec = document.getElementById('hero');
  if (!hero || !sec) return;
  const img = getSeriesImage(hero);
  sec.style.setProperty('--hero', `url('${img}')`);
  setAmbience(img);
  document.getElementById('heroTitle').textContent = cleanTitle(hero);
  document.getElementById('heroMeta').textContent = seriesGenres(hero).slice(0, 3).join(' · ');
  document.getElementById('heroSyn').textContent = hero.synopsis || 'Catálogo de animación china en alta calidad.';
  document.getElementById('heroBtn').onclick = () => {
    const ep = lastWatchedEpisode(hero);
    if (ep) location.hash = '#/episode/' + qs(ep.slug || ep.id);
    else location.hash = '#/series/' + qs(hero.slug || hero.id);
  };
  const favBtn = document.getElementById('heroListBtn');
  if (favBtn) {
    const fav = isFav(hero.id);
    favBtn.innerHTML = fav ? `${ICONS.check}<span>Mi lista</span>` : `${ICONS.plus}<span>Mi lista</span>`;
    favBtn.onclick = () => {
      const f = toggleFav(hero.id);
      favBtn.innerHTML = f ? `${ICONS.check}<span>Mi lista</span>` : `${ICONS.plus}<span>Mi lista</span>`;
    };
  }
  document.querySelectorAll('.hero-dots button').forEach((d, i) =>
    d.classList.toggle('active', i === heroIdx));
}

function mountHero(items) {
  clearInterval(heroTimer);
  heroItems = items.slice(0, 5);
  heroIdx = 0;
  if (heroItems.length > 1) {
    heroTimer = setInterval(() => {
      heroIdx = (heroIdx + 1) % heroItems.length;
      renderHero();
    }, 7000);
  }
}

/* ---------- VISTA HOME ---------- */
let homeFilter = 'todo';
function setHomeFilter(f) {
  homeFilter = f;
  document.querySelectorAll('.pills .pill').forEach(p =>
    p.classList.toggle('on', p.dataset.f === f));
  home();
}

function home() {
  const recent = DB.series.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const bySize = DB.series.slice().sort((a, b) => seriesEpisodeCount(b) - seriesEpisodeCount(a));

  const historyData = getHistory();
  const historyList = DB.series
    .filter(s => historyData[s.id])
    .sort((a, b) => historyData[b.id].timestamp - historyData[a.id].timestamp);
  const favList = DB.series.filter(s => isFav(s.id));
  const airingList = DB.series.filter(s => (s.status || '').toLowerCase().includes('emisión'));
  const completedList = DB.series.filter(s => (s.status || '').toLowerCase().includes('finaliz'));
  const moviesList = DB.series.filter(s =>
    (s.type || '').toLowerCase() === 'movie' || (s.title || '').toLowerCase().includes('película'));
  const top10 = bySize.slice(0, 10);

  // Pills filtrables (estilo Netflix)
  const pill = (f, label) => `<div class="pill ${homeFilter === f ? 'on' : ''}" data-f="${f}" onclick="setHomeFilter('${f}')">${label}</div>`;
  const pills = `<div class="pills">
    ${pill('todo', 'Todo')}${pill('emision', 'En emisión')}${pill('finalizados', 'Finalizados')}${pill('peliculas', 'Películas')}
  </div>`;

  let heroPool = recent;
  if (homeFilter === 'emision') heroPool = airingList.length ? airingList : recent;
  if (homeFilter === 'finalizados') heroPool = completedList.length ? completedList : recent;
  if (homeFilter === 'peliculas') heroPool = moviesList.length ? moviesList : recent;

  const sections = [];

  if (historyList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head"><h2>Continuar viendo</h2><span class="muted">${historyList.length}</span></div>
      <div class="cw-rail">${historyList.slice(0, 10).map(s => cwCard(s, historyData[s.id])).join('')}</div>
    </section>`);
  }

  if (favList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head"><h2>Mi lista</h2><span class="muted">${favList.length}</span></div>
      ${rail(favList)}
    </section>`);
  }

  if (homeFilter === 'todo' || homeFilter === 'emision') {
    sections.push(`
    <section class="section">
      <div class="section-head"><h2>Top 10 hoy</h2><span class="muted">serie</span></div>
      ${top10Rail(top10)}
    </section>`);
    if (airingList.length) sections.push(`
    <section class="section">
      <div class="section-head"><h2>En Emisión</h2><span class="muted">${airingList.length}</span></div>
      ${rail(airingList)}
    </section>`);
  }

  if ((homeFilter === 'todo' || homeFilter === 'finalizados') && completedList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head"><h2>Finalizadas</h2><span class="muted">${completedList.length}</span></div>
      ${rail(completedList)}
    </section>`);
  }

  if ((homeFilter === 'todo' || homeFilter === 'peliculas') && moviesList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head"><h2>Películas y Especiales</h2><span class="muted">${moviesList.length}</span></div>
      ${rail(moviesList)}
    </section>`);
  }

  if (homeFilter === 'todo') {
    sections.push(`
    <section class="section">
      <div class="section-head"><h2>Agregados recientemente</h2><span class="muted">${Math.min(recent.length, 15)}</span></div>
      ${rail(recent.slice(0, 15))}
    </section>`);
  }

  app.innerHTML = `
  ${pills}
  <section class="hero" id="hero">
    <div class="hero-shade"></div>
    <div class="hero-content">
      <div class="eyebrow">DONGHUAFLIX EXCLUSIVE</div>
      <h1 id="heroTitle"></h1>
      <div class="hero-meta" id="heroMeta"></div>
      <p id="heroSyn"></p>
      <div class="hero-btns">
        <button class="btn-x play" id="heroBtn">${ICONS.play}<span>Ver serie</span></button>
        <button class="btn-x glass" id="heroListBtn">${ICONS.plus}<span>Mi lista</span></button>
      </div>
    </div>
    ${heroPool.length > 1 ? `<div class="hero-dots">${heroPool.slice(0, 5).map((_, i) =>
      `<button onclick="clearInterval(heroTimer);heroIdx=${i};renderHero()" aria-label="Hero ${i + 1}"></button>`).join('')}</div>` : ''}
  </section>
  ${sections.join('')}
  <section class="section center">
    <button class="btn-x glass" onclick="location.hash='#/series'">Ver catálogo completo (${DB.series.length} series)</button>
  </section>`;

  mountHero(heroPool);
  renderHero();
}

/* ---------- LISTADOS ---------- */
function listAllSeries() {
  app.innerHTML = `
    <section class="section page-top">
      <div class="section-head"><h2>Todas las Series</h2><span class="muted">${DB.series.length}</span></div>
      <div class="grid">${DB.series.map(card).join('')}</div>
    </section>`;
}
function listByStatus(statusKeyword, titleText) {
  const filtered = DB.series.filter(s => (s.status || '').toLowerCase().includes(statusKeyword.toLowerCase()));
  app.innerHTML = `
    <section class="section page-top">
      <div class="section-head"><h2>${titleText}</h2><span class="muted">${filtered.length}</span></div>
      <div class="grid">${filtered.length ? filtered.map(card).join('') : '<p class="muted">No hay elementos en esta categoría.</p>'}</div>
    </section>`;
}
function listMovies() {
  const movies = DB.series.filter(s =>
    (s.type || '').toLowerCase() === 'movie' || (s.title || '').toLowerCase().includes('película'));
  app.innerHTML = `
    <section class="section page-top">
      <div class="section-head"><h2>Películas</h2><span class="muted">${movies.length}</span></div>
      <div class="grid">${movies.length ? movies.map(card).join('') : '<p class="muted">No hay películas disponibles por el momento.</p>'}</div>
    </section>`;
}
function listGenres() {
  const genres = (DB.genres || []).map(g => g.name || g);
  app.innerHTML = `
    <section class="section page-top">
      <div class="section-head"><h2>Géneros</h2><span class="muted">${genres.length}</span></div>
      ${genres.length ? `<div class="chips">${genres.map(g => `<a class="chip" href="#/genre/${qs(g)}">${esc(g)}</a>`).join('')}</div>` : '<p class="muted">Géneros no disponibles en el catálogo.</p>'}
    </section>`;
}
function listByGenre(name) {
  const n = name.toLowerCase();
  const filtered = DB.series.filter(s => seriesGenres(s).some(g => g.toLowerCase() === n));
  app.innerHTML = `
    <section class="section page-top">
      <div class="section-head"><h2>${esc(name)}</h2><span class="muted">${filtered.length}</span></div>
      <div class="grid">${filtered.length ? filtered.map(card).join('') : '<p class="muted">No hay series en este género.</p>'}</div>
    </section>`;
}
function listMyList() {
  const favs = getFavs();
  const filtered = DB.series.filter(s => favs.includes(s.id));
  app.innerHTML = `
    <section class="section page-top">
      <div class="section-head"><h2>Mi lista</h2><span class="muted">${filtered.length}</span></div>
      <div class="grid">${filtered.length ? filtered.map(card).join('') : '<p class="muted">Aún no tienes favoritos. Toca el corazón de cualquier serie para añadirla.</p>'}</div>
    </section>`;
}

/* ---------- BUSCADOR ---------- */
function search(q = '') {
  if (!document.getElementById('q')) {
    app.innerHTML = `
      <section class="search page-top">
        <h1>Buscar</h1>
        <div class="searchbar">${ICONS.search}
          <input id="q" type="text" value="${esc(q)}" autocomplete="off" placeholder="Nombre del donghua...">
        </div>
        <div id="results" class="grid"></div>
      </section>`;
    const input = document.getElementById('q');
    input.addEventListener('input', e => updateSearchResults(e.target.value));
    setTimeout(() => { input.focus(); input.setSelectionRange(input.value.length, input.value.length); }, 50);
  }
  updateSearchResults(q);
}
function updateSearchResults(q = '') {
  const container = document.getElementById('results');
  if (!container) return;
  const query = q.trim().toLowerCase();
  if (!query) {
    container.innerHTML = '<p class="muted" style="grid-column:1/-1">Escribe para ver sugerencias...</p>';
    return;
  }
  const list = DB.series.filter(s => {
    const title = cleanTitle(s).toLowerCase();
    return title.startsWith(query) || title.split(' ').some(w => w.startsWith(query)) || title.includes(query);
  });
  container.innerHTML = list.length ? list.map(card).join('') : '<p class="muted" style="grid-column:1/-1">No se encontraron donghuas con ese nombre.</p>';
}

/* ---------- DETALLE DE SERIE (estilo Netflix) ---------- */
let detailState = { seriesId: null, seasonIdx: 0, page: null };
const EPS_PER_PAGE = 50;

function detail(slug, seasonRef) {
  const s = findSeries(slug);
  if (!s) return notfound();

  const seasons = orderSeasons(s, DB.seasons.filter(x => x.seriesId === s.id));

  if (detailState.seriesId !== s.id) {
    detailState = { seriesId: s.id, seasonIdx: 0, page: null };
  }
  if (seasonRef) {
    const i = seasons.findIndex(x => (x.slug || x.id) === seasonRef || String(x.number) === String(seasonRef));
    if (i !== -1) { detailState.seasonIdx = i; detailState.page = null; }
  }

  const imgUrl = getSeriesImage(s);
  const title = cleanTitle(s);
  const genres = seriesGenres(s);
  const fav = isFav(s.id);
  const epsTotal = seriesEpisodeCount(s);
  const lastEp = lastWatchedEpisode(s);
  const lastSeason = lastEp ? DB.seasons.find(x => x.id === lastEp.seasonId) : null;
  const lastSn = lastSeason && Number.isFinite(lastSeason.number) ? lastSeason.number : 1;

  setAmbience(imgUrl);

  app.innerHTML = `<section class="detail-v2">
    <div class="detail-hero" style="--dhero:url('${esc(imgUrl)}')">
      <button class="detail-close" onclick="location.hash='#/series'" title="Cerrar">${ICONS.close}</button>
      <div class="detail-hero-shade"></div>
      <div class="detail-hero-c">
        <div class="eyebrow">${esc(s.status || '')}</div>
        <h1>${esc(title)}</h1>
        <div class="detail-meta">
          <span>${seasons.length} temporada${seasons.length === 1 ? '' : 's'}</span> ·
          <span>${epsTotal} episodios</span>
          ${genres.length ? ' · <span>' + esc(genres.slice(0, 3).join(' · ')) + '</span>' : ''}
        </div>
        <div class="detail-actions">
          ${lastEp ? `<button class="btn-x play big" onclick="location.hash='#/episode/${qs(lastEp.slug || lastEp.id)}'">${ICONS.play}<span>Reproducir${lastEp.number > 1 ? ` · T${lastSn}:E${lastEp.number}` : ''}</span></button>` : ''}
          <button class="btn-x glass round" id="favBtn" title="Mi lista">${fav ? ICONS.check : ICONS.plus}</button>
        </div>
      </div>
    </div>
    <div class="detail-body">
      ${genres.length ? `<div class="chips">${genres.map(g => `<a class="chip" href="#/genre/${qs(g)}">${esc(g)}</a>`).join('')}</div>` : ''}
      <p class="detail-syn">${esc(s.synopsis || 'Sinopsis no disponible.')}</p>
      <div id="seasonArea"></div>
    </div>
  </section>`;

  document.getElementById('favBtn').onclick = () => {
    const f = toggleFav(s.id);
    document.getElementById('favBtn').innerHTML = f ? ICONS.check : ICONS.plus;
  };

  renderSeasonArea(seasons);
}

function renderSeasonArea(seasons) {
  const area = document.getElementById('seasonArea');
  if (!area) return;
  if (!seasons.length) {
    area.innerHTML = '<div class="empty">No hay episodios disponibles.</div>';
    return;
  }
  area.innerHTML = `
    <div class="season-picker">
      <select id="seasonSelect" onchange="selectSeason(this.value)">
        ${seasons.map((season, i) => {
          const count = dedupeEps(DB.episodes.filter(e => e.seasonId === season.id)).length;
          return `<option value="${i}" ${i === detailState.seasonIdx ? 'selected' : ''}>${esc(seasonTitle(season, i))} · ${count} episodios</option>`;
        }).join('')}
      </select>
    </div>
    <div id="episodeArea"></div>`;
  renderEpisodePage(seasons[detailState.seasonIdx]);
}

function selectSeason(i) {
  detailState.seasonIdx = Number(i);
  detailState.page = null;
  const s = findSeries(detailState.seriesId);
  if (!s) return;
  const seasons = orderSeasons(s, DB.seasons.filter(x => x.seriesId === s.id));
  renderEpisodePage(seasons[detailState.seasonIdx]);
}

function renderEpisodePage(season) {
  const area = document.getElementById('episodeArea');
  if (!area) return;
  const eps = dedupeEps(DB.episodes.filter(e => e.seasonId === season.id));
  if (!eps.length) {
    area.innerHTML = '<div class="empty">No hay episodios disponibles todavía para esta temporada.</div>';
    return;
  }
  const totalPages = Math.ceil(eps.length / EPS_PER_PAGE);
  if (detailState.page == null || detailState.page >= totalPages) {
    const watched = getWatched()[season.id] || {};
    const lastWatched = Math.max(0, ...Object.keys(watched).map(Number));
    detailState.page = lastWatched ? Math.floor((lastWatched - 1) / EPS_PER_PAGE) : 0;
  }
  const page = Math.min(detailState.page, totalPages - 1);
  detailState.page = page;
  const slice = eps.slice(page * EPS_PER_PAGE, (page + 1) * EPS_PER_PAGE);
  const watched = getWatched()[season.id] || {};

  area.innerHTML = `
    <div class="episode-list">
      ${slice.map(e => {
        const w = Boolean(watched[e.number]);
        return `<a class="episode ${w ? 'watched' : ''}" href="#/episode/${qs(e.slug || e.id)}">
          <span class="ep-num">${e.number}</span>
          <span class="ep-info">
            <strong>${esc(cleanEpisodeTitle(e))}</strong>
            <span class="meta">${esc((e.servers || []).map(x => x.name).join(' · ') || (e.releaseDate || ''))}</span>
          </span>
          <button class="watched-btn ${w ? 'on' : ''}" title="${w ? 'Quitar marcador' : 'Marcar como visto'}"
            onclick="event.preventDefault();event.stopPropagation();toggleWatched('${esc(season.id)}',${e.number})">${w ? ICONS.check : ''}</button>
        </a>`;
      }).join('')}
    </div>
    ${totalPages > 1 ? `
    <div class="ep-pagination">
      <button class="btn-x glass" ${page === 0 ? 'disabled' : ''} onclick="gotoPage(${page - 1})">${ICONS.prev}<span>Anterior</span></button>
      <span class="muted">Página ${page + 1} de ${totalPages}</span>
      <button class="btn-x glass" ${page >= totalPages - 1 ? 'disabled' : ''} onclick="gotoPage(${page + 1})"><span>Siguiente</span>${ICONS.next}</button>
    </div>` : ''}`;
}

function gotoPage(p) {
  detailState.page = p;
  const s = findSeries(detailState.seriesId);
  if (!s) return;
  const seasons = orderSeasons(s, DB.seasons.filter(x => x.seriesId === s.id));
  renderEpisodePage(seasons[detailState.seasonIdx]);
  setTimeout(() => document.getElementById('episodeArea')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

/* ---------- REPRODUCTOR ---------- */
function episode(slug) {
  const e = findEpisode(slug);
  if (!e) return notfound();

  currentEpisode = e;
  saveHistory(e.seriesId, e);
  markWatchedUpTo(e.seasonId, e.number);

  const seasonEps = dedupeEps(DB.episodes.filter(x => x.seasonId === e.seasonId));
  const idx = seasonEps.findIndex(x => x.id === e.id);
  const prevEp = idx > 0 ? seasonEps[idx - 1] : null;
  const nextEp = idx < seasonEps.length - 1 ? seasonEps[idx + 1] : null;

  const serie = findSeries(e.seriesId);
  const serieRef = serie ? (serie.slug || serie.id) : e.seriesId;
  const season = DB.seasons.find(x => x.id === e.seasonId);

  setAmbience(getSeriesImage(serie || {}) || (season?.image || ''));

  let current = e.servers?.[0];
  const render = () => {
    const playerEl = document.getElementById('player');
    if (playerEl) {
      playerEl.innerHTML = current?.url
        ? `<iframe src="${esc(current.url)}" allow="autoplay; fullscreen *; encrypted-media; picture-in-picture" allowfullscreen webkitallowfullscreen mozallowfullscreen loading="lazy"></iframe>
           <button class="fs-btn" onclick="togglePlayerFS()" title="Pantalla completa">${ICONS.full}</button>`
        : '<div class="empty">Servidor no disponible.</div>';
    }
  };

  app.innerHTML = `<section class="detail page-top">
    <div class="eyebrow">${esc(season ? seasonTitle(season, 0) : '')} · EPISODIO ${e.number}${isWatched(e.seasonId, e.number) ? ' · VISTO' : ''}</div>
    <h1 class="ep-title">${esc(cleanEpisodeTitle(e))}</h1>
    <div class="player" id="player"></div>
    <div class="server-tabs">
      ${(e.servers || []).map((srv, i) =>
        `<button class="${i === 0 ? 'active' : ''}" data-i="${i}">${esc(srv.name)}</button>`).join('')}
    </div>
    <div class="ep-nav">
      ${prevEp
        ? `<a class="btn-x glass" href="#/episode/${qs(prevEp.slug || prevEp.id)}">${ICONS.prev}<span>Anterior</span></a>`
        : `<button class="btn-x glass" disabled>${ICONS.prev}<span>Anterior</span></button>`}
      <a class="btn-x glass" href="#/series/${qs(serieRef)}">${ICONS.list}<span>Serie</span></a>
      ${nextEp
        ? `<a class="btn-x glass" href="#/episode/${qs(nextEp.slug || nextEp.id)}"><span>Siguiente</span>${ICONS.next}</a>`
        : `<button class="btn-x glass" disabled><span>Siguiente</span>${ICONS.next}</button>`}
    </div>
    <div class="ep-nav" style="margin-top:10px">
      <button class="btn-x glass" id="autoNextBtn" onclick="toggleAutoNext()">${ICONS.repeat}<span>Auto: ${autoNextEnabled ? 'ON' : 'OFF'}</span></button>
    </div>
    ${(() => {
      const recommended = getRecommendedSeries(serie || { id: e.seriesId });
      return recommended.length ? `
        <div style="margin-top:34px">
          <div class="section-head"><h2>También te puede gustar</h2><span class="muted">${recommended.length}</span></div>
          <div class="grid">${recommended.map(card).join('')}</div>
        </div>` : '';
    })()}
  </section>`;

  render();
  document.querySelectorAll('.server-tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.server-tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    current = e.servers[Number(b.dataset.i)];
    render();
  });
}

function notfound() {
  app.innerHTML = `<section class="empty page-top">
    <h2>No encontrado</h2>
    <p class="muted" style="margin-top:10px"><a href="#/" style="color:var(--red)">Volver al inicio</a></p>
  </section>`;
}

/* ---------- NAVEGACIÓN ---------- */
function highlightNav() {
  const hash = location.hash || '#/';
  document.querySelectorAll('[data-nav]').forEach(a => {
    const href = a.getAttribute('href');
    const active = href === hash || (href !== '#/' && hash.startsWith(href));
    a.classList.toggle('active', active);
  });
}

function route() {
  clearInterval(heroTimer);
  document.getElementById('moreMenu')?.classList.remove('open');
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const type = p[0], arg = p[1], extra = p[2];

  if (!type) home();
  else if (type === 'search') search(arg || '');
  else if (type === 'series' && !arg) listAllSeries();
  else if (type === 'series' && arg) detail(arg, extra);
  else if (type === 'airing') listByStatus('emisión', 'Donghuas En Emisión');
  else if (type === 'completed') listByStatus('finaliz', 'Donghuas Finalizados');
  else if (type === 'movies') listMovies();
  else if (type === 'genres') listGenres();
  else if (type === 'genre' && arg) listByGenre(arg);
  else if (type === 'mylist') listMyList();
  else if (type === 'episode') episode(arg);
  else home();

  highlightNav();
  window.scrollTo({ top: 0 });
}

/* ---------- EVENTOS GLOBALES ---------- */
window.addEventListener('hashchange', route);

window.addEventListener('scroll', () => {
  document.querySelector('.nav')?.classList.toggle('scrolled', window.scrollY > 40);
  document.getElementById('toTop')?.classList.toggle('show', window.scrollY > 500);
}, { passive: true });

document.addEventListener('DOMContentLoaded', () => {
  const reloadBtn = document.getElementById('reloadBtn');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      reloadBtn.style.transform = 'rotate(360deg)';
      reloadBtn.style.transition = 'transform .5s ease';
      await load();
      setTimeout(() => { reloadBtn.style.transform = 'none'; }, 500);
    });
  }
  document.getElementById('toTop')?.addEventListener('click', () =>
    window.scrollTo({ top: 0, behavior: 'smooth' }));
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

load();
