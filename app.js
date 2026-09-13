console.log("%c DonghuaFlix — Creado por @bledark__ ", "background:#111;color:#ff3340;font-size:14px;font-weight:bold;");

let DB = { series: [], seasons: [], episodes: [], genres: [], meta: {} };
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const qs = s => encodeURIComponent(s || '');

// ---------- HELPERS ----------
const cleanTitle = (s) => {
  const title = s?.title;
  if (!title || title.toLowerCase() === 'temporadas') {
    const rawSlug = s?.slug || s?.id || '';
    if (rawSlug) {
      return rawSlug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    }
    return 'Donghua';
  }
  return title;
};

// ✅ Nombre de temporada a partir del slug real del catálogo
// El slug SIEMPRE es la última parte de la URL: donghualife.com/season/doupo-cangqiong-5
const slugFromUrl = u => (u || '').split('?')[0].split('/').filter(Boolean).pop() || '';
const prettySlug = slug => slug.split('-').filter(Boolean)
  .map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

const seasonTitle = (season, index) => {
  // 1) Si el catálogo trae el número explícito, usarlo
  if (Number.isFinite(season.number)) return `Temporada ${season.number}`;

  // 2) Título real (ej: "Temporada 2: El Pilar de la Eternidad")
  const t = (season.title || '').trim();
  if (t && t.toLowerCase() !== 'temporadas') {
    const m = t.match(/(?:temporada|season)\s*(\d{1,3})/i) ||
              t.match(/^(\d{1,3})[ª°.]/);
    if (m) return `Temporada ${parseInt(m[1], 10)}`;
    return t;
  }

  // 3) Slug del catálogo (del campo slug/id o de la URL de origen)
  const slug = (season.slug || season.id || slugFromUrl(season.url || season.sourceUrl) || '').toLowerCase();

  // "serie-1-0" → Temporada 1 (formato temporada-cour, ej: stay-low-profile-sect-chief-1-0)
  let m = slug.match(/-(\d{1,3})-\d{1,3}$/);
  if (m) return `Temporada ${parseInt(m[1], 10)}`;

  // "serie-5" → Temporada 5 (ej: doupo-cangqiong-5)
  m = slug.match(/-(\d{1,3})$/);
  if (m) return `Temporada ${parseInt(m[1], 10)}`;

  // Sin número = especial/OVA/película → nombre legible del slug
  // (ej: "especial" → "Especial", "el-acuerdo-de-3-anos" → "El Acuerdo De 3 Años")
  if (slug) return prettySlug(slug);

  return `Temporada ${index + 1}`;
};

// ✅ Ordena las temporadas según el orden oficial del catálogo (series.seasonUrls)
// Evita que "Especial" aparezca antes que la Temporada 1, etc.
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

// ---------- TOAST (notificaciones) ----------
let toastTimer = null;
function showToast(msg) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- FAVORITOS (Mi lista) ----------
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

// ---------- HISTORIAL (Continuar viendo) ----------
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

// Dailymotion avisa al padre cuando el video termina
window.addEventListener('message', event => {
  const origin = String(event.origin || '');
  if (!/dailymotion|dmcdn/i.test(origin)) return;
  const data = typeof event.data === 'string' ? event.data : JSON.stringify(event.data || {});
  if (/video[_-]?end|ended/i.test(data)) autoNext();
});

// ---------- RECOMENDACIONES (sin repetir lo ya visto) ----------
function getRecommendedSeries(currentSeries, limit = 8) {
  const historyIds = new Set(Object.keys(getHistory()));
  const currentGenres = seriesGenres(currentSeries).map(g => g.toLowerCase());

  const others = DB.series.filter(s => s.id !== currentSeries.id);

  // Puntuar por géneros en común
  const scored = others.map(s => ({
    s,
    score: seriesGenres(s).map(g => g.toLowerCase()).filter(g => currentGenres.includes(g)).length
  }));

  // Prioridad 1: mismos géneros Y no vistos
  const fresh = scored
    .filter(x => x.score > 0 && !historyIds.has(x.s.id))
    .sort((a, b) => b.score - a.score || (b.s.updatedAt || '').localeCompare(a.s.updatedAt || ''));

  // Prioridad 2 (relleno): otros no vistos, los más recientes
  const filler = scored
    .filter(x => x.score === 0 && !historyIds.has(x.s.id))
    .sort((a, b) => (b.s.updatedAt || '').localeCompare(a.s.updatedAt || ''));

  return [...fresh, ...filler].slice(0, limit).map(x => x.s);
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
  return `<article class="card" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
    <div class="poster">
      ${imgUrl
        ? `<img loading="lazy" src="${esc(imgUrl)}" alt="${esc(title)}">`
        : '<div class="no-img">DONGHUAFLIX</div>'}
      <span class="badge">${esc(s.status || 'DONGHUA')}</span>
      <button class="fav-heart ${fav ? 'on' : ''}" title="Mi lista"
        onclick="event.stopPropagation();toggleFav('${esc(s.id)}');refreshFavUI(this,'${esc(s.id)}')">${fav ? '❤️' : '🤍'}</button>
    </div>
    <h3>${esc(title)}</h3>
  </article>`;
}

// Actualiza el corazón sin recargar toda la vista
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

// ---------- HERO CON CARRUSEL ----------
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

// ---------- DETALLE DE SERIE ----------
function detail(slug) {
  const s = findSeries(slug);
  if (!s) return notfound();

  const seasons = orderSeasons(s, DB.seasons.filter(x => x.seriesId === s.id));
  const imgUrl = getSeriesImage(s);
  const title = cleanTitle(s);
  const genres = seriesGenres(s);
  const fav = isFav(s.id);

  app.innerHTML = `<section class="detail">
    <div class="detail-top">
      <div class="detail-poster">${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(title)}">` : ''}</div>
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
    <div style="margin-top:34px">
      ${seasons.length ? seasons.map((season, i) => {
        const eps = dedupeEps(DB.episodes.filter(e => e.seasonId === season.id));
        return `<div class="season">
          <h3>${esc(seasonTitle(season, i))} <span class="muted">(${eps.length} episodios)</span></h3>
          <div class="episode-list">
            ${eps.map(e => `<a class="episode" href="#/episode/${qs(e.slug || e.id)}">
              <strong>Ep. ${e.number}</strong>
              <span class="meta">${esc(e.title || '')}</span>
            </a>`).join('')}
          </div>
        </div>`;
      }).join('') : '<div class="empty">No hay episodios disponibles.</div>'}
    </div>
  </section>`;
}

// ---------- REPRODUCTOR ----------
function episode(slug) {
  const e = findEpisode(slug);
  if (!e) return notfound();

  currentEpisode = e;
  saveHistory(e.seriesId, e);

  const seasonEps = dedupeEps(DB.episodes.filter(x => x.seasonId === e.seasonId));
  const idx = seasonEps.findIndex(x => x.id === e.id);
  const prevEp = idx > 0 ? seasonEps[idx - 1] : null;
  const nextEp = idx < seasonEps.length - 1 ? seasonEps[idx + 1] : null;

  const serie = findSeries(e.seriesId);
  const serieRef = serie ? (serie.slug || serie.id) : e.seriesId;

  let current = e.servers?.[0];
  const render = () => {
    const playerEl = document.getElementById('player');
    if (playerEl) {
      playerEl.innerHTML = current?.url
        ? `<iframe src="${esc(current.url)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`
        : '<div class="empty">Servidor no disponible.</div>';
    }
  };

  app.innerHTML = `<section class="detail">
    <div class="eyebrow">EPISODIO ${e.number}</div>
    <h1 style="font-size:26px;margin-bottom:6px">${esc(e.title)}</h1>
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
  const type = p[0], arg = p[1];

  if (!type) home();
  else if (type === 'search') search(arg || '');
  else if (type === 'series' && !arg) listAllSeries();
  else if (type === 'series' && arg) detail(arg);
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

// Sombra sólida en la navbar al hacer scroll
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

  // Botón volver arriba
  document.getElementById('toTop')?.addEventListener('click', () =>
    window.scrollTo({ top: 0, behavior: 'smooth' }));

  // Registrar Service Worker (PWA)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
});

load();
