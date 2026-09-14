console.log("%c DonghuaFlix — Creado por @bledark__ ", "background:#111;color:#ff3340;font-size:14px;font-weight:bold;");

let DB = { series: [], seasons: [], episodes: [], genres: [], meta: {} };
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const qs = s => encodeURIComponent(s || '');

// ---------- HELPERS ----------
const cleanTitle = (s) => {
  let title = s?.title;
  if (title) title = title.replace(/\s*\|\s*Donghualife.*$/i, '').trim();
  if (!title || title.toLowerCase() === 'temporadas') {
    const rawSlug = s?.slug || s?.id || '';
    if (rawSlug) {
      return rawSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return 'Donghua';
  }
  return title;
};

// ✅ Título limpio de episodio: "X - 1 Episodio x245 | Donghualife 2.0" → "Episodio 245"
const cleanEpisodeTitle = (e) => {
  let t = (e.title || '').replace(/\s*\|\s*Donghualife.*$/i, '').trim();
  const m = t.match(/(?:^|[-–—])\s*\d*\s*(?:Episodio|Episode)\s*x?(\d+)\s*$/i);
  if (m) return `Episodio ${parseInt(m[1], 10)}`;
  return t || `Episodio ${e.number}`;
};

const slugFromUrl = u => (u || '').split('?')[0].split('/').filter(Boolean).pop() || '';
const prettySlug = slug => slug.split('-').filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const seasonTitle = (season, index) => {
  if (Number.isFinite(season.number)) return `Temporada ${season.number}`;

  const t = (season.title || '').trim();
  if (t && t.toLowerCase() !== 'temporadas') {
    const m = t.match(/(?:temporada|season)\s*(\d{1,3})/i) ||
              t.match(/^(\d{1,3})[ª°.]/);
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
    const i = urls.findIndex(u =>
      slugFromUrl(u).toLowerCase() === key || u === (seas.url || seas.sourceUrl));
    return i === -1 ? 999 : i;
  };
  return seasons.slice().sort((a, b) => rank(a) - rank(b));
}

const getSeriesImage = (s) => {
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

// ---------- EPISODIOS VISTOS ----------
function getWatched() {
  try { return JSON.parse(localStorage.getItem('donghuaflix_watched') || '{}'); }
  catch (e) { return {}; }
}

function isWatched(seasonId, num) {
  return Boolean(getWatched()[seasonId]?.[num]);
}

function markWatchedUpTo(seasonId, num) {
  const all = getWatched();
  all[seasonId] = all[seasonId] || {};
  for (let n = 1; n <= num; n++) {
    if (!all[seasonId][n]) all[seasonId][n] = Date.now();
  }
  localStorage.setItem('donghuaflix_watched', JSON.stringify(all));
}

function toggleWatched(seasonId, num) {
  const all = getWatched();
  all[seasonId] = all[seasonId] || {};
  if (all[seasonId][num]) delete all[seasonId][num];
  else all[seasonId][num] = Date.now();
  localStorage.setItem('donghuaflix_watched', JSON.stringify(all));
  showToast(isWatched(seasonId, num) ? '✓ Marcado como visto' : '✓ Marcador quitado');
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

// ---------- TOAST ----------
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- FAVORITOS ----------
function getFavs() {
  try { return JSON.parse(localStorage.getItem('donghuaflix_favs') || '[]'); }
  catch (e) { return []; }
}

function toggleFav(seriesId) {
  let favs = getFavs();
  const isFav = favs.includes(seriesId);
  favs = isFav ? favs.filter(id => id !== seriesId) : [...favs, seriesId];
  localStorage.setItem('donghuaflix_favs', JSON.stringify(favs));
  showToast(isFav ? 'Quitado de Mi lista' : 'Añadido a Mi lista ❤️');
  return !isFav;
}

const isFav = id => getFavs().includes(id);

// ---------- HISTORIAL ----------
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
      timestamp: Date.now()
    };
    localStorage.setItem('donghuaflix_history', JSON.stringify(history));
  } catch (e) {}
}

// ---------- AUTO SIGUIENTE EPISODIO ----------
let currentEpisode = null;
let autoNextEnabled = localStorage.getItem('donghuaflix_autonext') !== 'off';

function toggleAutoNext() {
  autoNextEnabled = !autoNextEnabled;
  localStorage.setItem('donghuaflix_autonext', autoNextEnabled ? 'on' : 'off');
  showToast(autoNextEnabled ? '▶️ Auto-siguiente activado' : '⏸️ Auto-siguiente desactivado');
  const b = document.getElementById('autoNextBtn');
  if (b) b.textContent = autoNextEnabled ? '🔁 Auto: ON' : '🔁 Auto: OFF';
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
    showToast('🎉 ¡Has terminado esta temporada!');
  }
}

window.addEventListener('message', event => {
  const origin = String(event.origin || '');
  if (!/dailymotion|dmcdn/i.test(origin)) return;
  const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || {});
  if (/video[_-]?end|ended/i.test(data)) autoNext();
});

// ---------- RECOMENDACIONES ----------
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

// ---------- PANTALLA COMPLETA DEL REPRODUCTOR ----------
function togglePlayerFS() {
  const player = document.querySelector('.player');
  if (!player) return;
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else if (player.requestFullscreen) {
    player.requestFullscreen();
  } else if (player.webkitRequestFullscreen) {
    player.webkitRequestFullscreen();
  }
}

// ---------- CARGA ----------
async function load() {
  app.innerHTML = '<section class="section"><div class="grid">' +
    Array(8).fill('<div class="skeleton"></div>').join('') + '</div></section>';
  try {
    const r = await fetch('./public/data/catalog.json?ts=' + Date.now(), { cache: 'reload' });
    DB = await r.json();
    const footerStatus = document.getElementById('footerStatus');
    if (footerStatus) {
      footerStatus.innerHTML = `
        ${DB.meta?.syncedAt ? `Actualizado: ${new Date(DB.meta.syncedAt).toLocaleString('es-ES')}` : 'Catálogo listo'}
        &nbsp;·&nbsp; Desarrollado con ❤️ por
        <a href="https://instagram.com/bledark__" target="_blank" rel="noopener">@bledark__</a>`;
    }
    route();
  } catch (err) {
    app.innerHTML = `<section class="empty">
      <h2>Error al cargar el catálogo</h2>
      <p class="muted">Revisa tu conexión o el archivo public/data/catalog.json</p>
    </section>`;
  }
}

// ---------- TARJETAS ----------
function card(s) {
  const imgUrl = getSeriesImage(s);
  const title = cleanTitle(s);
  const fav = isFav(s.id);
  const progress = seriesProgress(s);
  return `<article class="card" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
    <div class="poster">
      ${imgUrl
        ? `<img loading="lazy" src="${esc(imgUrl)}" alt="${esc(title)}" onload="this.classList.toggle('wide',this.naturalWidth>this.naturalHeight)" onerror="this.parentNode.innerHTML='<div class=&quot;no-img&quot;>DONGHUAFLIX</div>'">`
        : '<div class="no-img">DONGHUAFLIX</div>'}
      <span class="badge">${esc(s.status || 'DONGHUA')}</span>
      <button class="fav-heart ${fav ? 'on' : ''}" title="Mi lista"
        onclick="event.stopPropagation();toggleFav('${esc(s.id)}');refreshFavUI(this,'${esc(s.id)}')">${fav ? '❤️' : '🤍'}</button>
      ${progress > 0 ? `<div class="progress"><span style="width:${progress}%"></span></div>` : ''}
    </div>
    <h3>${esc(title)}</h3>
  </article>`;
}

function refreshFavUI(btn, seriesId) {
  const fav = isFav(seriesId);
  btn.classList.toggle('on', fav);
  btn.textContent = fav ? '❤️' : '🤍';
}

function rail(items, historyData = null) {
  return `<div class="rail">${items.map(s => {
    const hist = historyData?.[s.id];
    return `<div class="rail-item">${card(s)}${
      hist ? `<div class="hist-tag">▸ Continuas: Ep. ${hist.episodeNumber}</div>` : ''
    }</div>`;
  }).join('')}</div>`;
}

// ---------- HERO ----------
let heroItems = [], heroIdx = 0, heroTimer = null;

function renderHero() {
  const hero = heroItems[heroIdx];
  const sec = document.getElementById('hero');
  if (!hero || !sec) return;
  sec.style.setProperty('--hero', `url('${getSeriesImage(hero)}')`);
  document.getElementById('heroTitle').textContent = cleanTitle(hero);
  document.getElementById('heroSyn').textContent =
    hero.synopsis || 'Catálogo de animación china en alta calidad.';
  document.getElementById('heroBtn').onclick = () =>
    location.hash = '#/series/' + qs(hero.slug || hero.id);
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

// ---------- VISTA HOME ----------
function home() {
  const recent = DB.series.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));

  const historyData = getHistory();
  const historyList = DB.series
    .filter(s => historyData[s.id])
    .sort((a, b) => historyData[b.id].timestamp - historyData[a.id].timestamp);

  const favList = DB.series.filter(s => isFav(s.id));
  const trendingList = recent.slice(0, 15);
  const airingList = DB.series.filter(s => (s.status || '').toLowerCase().includes('emisión'));
  const moviesList = DB.series.filter(s =>
    (s.type || '').toLowerCase() === 'movie' || (s.title || '').toLowerCase().includes('película'));

  app.innerHTML = `
  <section class="hero" id="hero" style="--hero:url('${esc(getSeriesImage(recent[0] || {}))}')">
    <div class="hero-content">
      <div class="eyebrow">DONGHUAFLIX EXCLUSIVE</div>
      <h1 id="heroTitle"></h1>
      <p id="heroSyn"></p>
      <div class="buttons">
        <button class="btn primary" id="heroBtn">▶ Ver serie</button>
        <button class="btn dark" onclick="location.hash='#/series'">Explorar catálogo</button>
      </div>
    </div>
    ${recent.length > 1 ? `<div class="hero-dots">${recent.slice(0, 5).map((_, i) =>
      `<button onclick="clearInterval(heroTimer);heroIdx=${i};renderHero()" aria-label="Hero ${i + 1}"></button>`).join('')}</div>` : ''}
  </section>

  ${historyList.length ? `
  <section class="section">
    <div class="section-head"><h2>Continuar viendo</h2><span class="muted">${historyList.length}</span></div>
    ${rail(historyList, historyData)}
  </section>` : ''}

  ${favList.length ? `
  <section class="section">
    <div class="section-head"><h2>Mi lista</h2><span class="muted">${favList.length}</span></div>
    ${rail(favList)}
  </section>` : ''}

  ${trendingList.length ? `
  <section class="section">
    <div class="section-head"><h2>En Tendencia</h2><span class="muted">${trendingList.length}</span></div>
    ${rail(trendingList)}
  </section>` : ''}

  ${airingList.length ? `
  <section class="section">
    <div class="section-head"><h2>En Emisión</h2><span class="muted">${airingList.length}</span></div>
    ${rail(airingList)}
  </section>` : ''}

  ${moviesList.length ? `
  <section class="section">
    <div class="section-head"><h2>Películas y Especiales</h2><span class="muted">${moviesList.length}</span></div>
    ${rail(moviesList)}
  </section>` : ''}

  <section class="section center">
    <button class="btn dark" onclick="location.hash='#/series'">
      Ver catálogo completo (${DB.series.length} series)
    </button>
  </section>`;

  mountHero(recent);
  renderHero();
}

// ---------- VISTAS DE LISTADO ----------
function listAllSeries() {
  app.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>Todas las Series</h2><span class="muted">${DB.series.length}</span></div>
      <div class="grid">${DB.series.map(card).join('')}</div>
    </section>`;
}

function listByStatus(statusKeyword, titleText) {
  const filtered = DB.series.filter(s => (s.status || '').toLowerCase().includes(statusKeyword.toLowerCase()));
  app.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>${titleText}</h2><span class="muted">${filtered.length}</span></div>
      <div class="grid">${filtered.length ? filtered.map(card).join('') : '<p class="muted">No hay elementos en esta categoría.</p>'}</div>
    </section>`;
}

function listMovies() {
  const movies = DB.series.filter(s =>
    (s.type || '').toLowerCase() === 'movie' || (s.title || '').toLowerCase().includes('película'));
  app.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>Películas</h2><span class="muted">${movies.length}</span></div>
      <div class="grid">${movies.length ? movies.map(card).join('') : '<p class="muted">No hay películas disponibles por el momento.</p>'}</div>
    </section>`;
}

function listGenres() {
  const genres = (DB.genres || []).map(g => g.name || g);
  app.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>Géneros</h2><span class="muted">${genres.length}</span></div>
      ${genres.length
        ? `<div class="chips">${genres.map(g => `<a class="chip" href="#/genre/${qs(g)}">${esc(g)}</a>`).join('')}</div>`
        : '<p class="muted">Géneros no disponibles en el catálogo.</p>'}
    </section>`;
}

function listByGenre(name) {
  const n = name.toLowerCase();
  const filtered = DB.series.filter(s => seriesGenres(s).some(g => g.toLowerCase() === n));
  app.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>${esc(name)}</h2><span class="muted">${filtered.length}</span></div>
      <div class="grid">${filtered.length ? filtered.map(card).join('') : '<p class="muted">No hay series en este género.</p>'}</div>
    </section>`;
}

function listMyList() {
  const favs = getFavs();
  const filtered = DB.series.filter(s => favs.includes(s.id));
  app.innerHTML = `
    <section class="section">
      <div class="section-head"><h2>❤️ Mi lista</h2><span class="muted">${filtered.length}</span></div>
      <div class="grid">${filtered.length ? filtered.map(card).join('') : '<p class="muted">Aún no tienes favoritos. Toca el 🤍 de cualquier serie para añadirla.</p>'}</div>
    </section>`;
}

// ---------- BUSCADOR ----------
function search(q = '') {
  if (!document.getElementById('q')) {
    app.innerHTML = `
      <section class="search">
        <h1>Buscar Donghua</h1>
        <div class="searchbar">
          <input id="q" type="text" value="${esc(q)}" autocomplete="off" placeholder="Escribe el nombre del donghua...">
        </div>
        <div id="results" class="grid"></div>
      </section>`;

    const input = document.getElementById('q');
    input.addEventListener('input', e => updateSearchResults(e.target.value));
    setTimeout(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 50);
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
    return title.startsWith(query) ||
      title.split(' ').some(w => w.startsWith(query)) ||
      title.includes(query);
  });

  container.innerHTML = list.length
    ? list.map(card).join('')
    : '<p class="muted" style="grid-column:1/-1">No se encontraron donghuas con ese nombre.</p>';
}

// ---------- DETALLE DE SERIE (selector de temporadas estilo Netflix) ----------
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
    const i = seasons.findIndex(x =>
      (x.slug || x.id) === seasonRef || String(x.number) === String(seasonRef));
    if (i !== -1) {
      detailState.seasonIdx = i;
      detailState.page = null;
    }
  }

  const imgUrl = getSeriesImage(s);
  const title = cleanTitle(s);
  const genres = seriesGenres(s);
  const fav = isFav(s.id);

  app.innerHTML = `<section class="detail">
    <div class="detail-top">
      <div class="detail-poster">${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(title)}" onload="this.classList.toggle('wide',this.naturalWidth>this.naturalHeight)" onerror="this.parentNode.innerHTML='<div class=&quot;no-img&quot;>DONGHUAFLIX</div>'">` : ''}</div>
      <div>
        <div class="eyebrow">${esc(s.status || '')}</div>
        <h1>${esc(title)}</h1>
        ${genres.length ? `<div class="chips" style="margin:10px 0">${genres.map(g =>
          `<a class="chip" href="#/genre/${qs(g)}">${esc(g)}</a>`).join('')}</div>` : ''}
        <p>${esc(s.synopsis || 'Sinopsis no disponible.')}</p>
        <button class="btn ${fav ? 'primary' : 'dark'} fav-btn" id="favBtn"
          onclick="const f=toggleFav('${esc(s.id)}');const b=document.getElementById('favBtn');
          b.className='btn '+(f?'primary':'dark')+' fav-btn';b.textContent=f?'❤️ En Mi lista':'🤍 Añadir a Mi lista'">
          ${fav ? '❤️ En Mi lista' : '🤍 Añadir a Mi lista'}
        </button>
      </div>
    </div>
    <div id="seasonArea" style="margin-top:30px"></div>
  </section>`;

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

  // Si no hay página definida, abrir en la del último episodio visto
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
            onclick="event.preventDefault();event.stopPropagation();toggleWatched('${esc(season.id)}',${e.number})">${w ? '✓' : ''}</button>
        </a>`;
      }).join('')}
    </div>
    ${totalPages > 1 ? `
    <div class="ep-pagination">
      <button class="btn dark" ${page === 0 ? 'disabled' : ''} onclick="gotoPage(${page - 1})">« Anterior</button>
      <span class="muted">Página ${page + 1} de ${totalPages}</span>
      <button class="btn dark" ${page >= totalPages - 1 ? 'disabled' : ''} onclick="gotoPage(${page + 1})">Siguiente »</button>
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

// ---------- REPRODUCTOR ----------
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

  let current = e.servers?.[0];
  const render = () => {
    const playerEl = document.getElementById('player');
    if (playerEl) {
      playerEl.innerHTML = current?.url
        ? `<iframe src="${esc(current.url)}" allow="autoplay; fullscreen *; encrypted-media; picture-in-picture" allowfullscreen webkitallowfullscreen mozallowfullscreen loading="lazy"></iframe>
           <button class="fs-btn" onclick="togglePlayerFS()" title="Pantalla completa">⛶</button>`
        : '<div class="empty">Servidor no disponible.</div>';
    }
  };

  app.innerHTML = `<section class="detail">
    <div class="eyebrow">${esc(season ? seasonTitle(season, 0) : '')} · EPISODIO ${e.number}${isWatched(e.seasonId, e.number) ? ' · ✓ Visto' : ''}</div>
    <h1 style="font-size:clamp(20px,3.5vw,30px);margin-bottom:6px">${esc(cleanEpisodeTitle(e))}</h1>
    <div class="player" id="player"></div>
    <div class="server-tabs">
      ${(e.servers || []).map((srv, i) =>
        `<button class="${i === 0 ? 'active' : ''}" data-i="${i}">${esc(srv.name)}</button>`).join('')}
    </div>
    <div class="ep-nav">
      ${prevEp
        ? `<a class="btn dark" href="#/episode/${qs(prevEp.slug || prevEp.id)}">◄ Anterior</a>`
        : '<button class="btn dark" disabled>◄ Anterior</button>'}
      <a class="btn primary" href="#/series/${qs(serieRef)}">☰ Serie</a>
      ${nextEp
        ? `<a class="btn dark" href="#/episode/${qs(nextEp.slug || nextEp.id)}">Siguiente ►</a>`
        : '<button class="btn dark" disabled>Siguiente ►</button>'}
    </div>
    <div class="ep-nav" style="margin-top:10px">
      <button class="btn dark" id="autoNextBtn" onclick="toggleAutoNext()">
        ${autoNextEnabled ? '🔁 Auto: ON' : '🔁 Auto: OFF'}
      </button>
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
  app.innerHTML = `<section class="empty">
    <h2>No encontrado</h2>
    <p class="muted" style="margin-top:10px"><a href="#/" style="color:var(--red)">Volver al inicio</a></p>
  </section>`;
}

// ---------- NAVEGACIÓN ----------
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

// ---------- EVENTOS GLOBALES ----------
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
