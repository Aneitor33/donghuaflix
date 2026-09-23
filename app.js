console.log("%c DonghuaFlix — Creado por @bledark__ ", "background:#000;color:#e50914;font-size:14px;font-weight:bold;");

let DB = { series: [], seasons: [], episodes: [], genres: [], meta: {} };

/* ---------- MULTI-CATÁLOGO (Donghuas / Cdramas / ...) ---------- */
const DONGHUA_CATS = ['donghualife', 'donghuasub', 'donghuaworld'];
const CATALOGS = [
  { id: 'donghualife',   file: './public/data/catalog-donghualife.json',   index: './public/data/catalog-donghualife-index.json',   label: 'DonghuaLife' },
  { id: 'donghuasub',    file: './public/data/catalog-donghuasub.json',    index: './public/data/catalog-donghuasub-index.json',    label: 'DonghuaSub' },
  { id: 'donghuaworld',  file: './public/data/catalog-donghuaworld.json',  index: './public/data/catalog-donghuaworld-index.json',  label: 'DonghuaWorld' },
  { id: 'peliculas', file: './public/data/catalog-peliculas.json',  index: './public/data/catalog-peliculas-index.json',  label: 'Películas' },
  { id: 'doramas',   file: './public/data/catalog-doramas.json',    index: './public/data/catalog-doramas-index.json',    label: 'Doramas' }
];
const SRC_LABEL = {
  donghualife: 'DonghuaLife',
  donghuasub: 'DonghuaSub',
  donghuaworld: 'DonghuaWorld',
  tiodonghua: 'TioDonghua',
  peliculas: 'Películas',
  doramas: 'Doramas'
};

/* Carpeta de fichas del catálogo activo (se rellena al cargar el índice) */
let DETAILS_BASE = {};
const DETAIL_CACHE = {};

let DB_CACHE = {};
let currentCatalog = localStorage.getItem('donghuaflix_catalog') || 'donghualife';
if (!CATALOGS.some(c => c.id === currentCatalog)) currentCatalog = 'donghualife';
const CATALOG_AVAILABLE = { donghua: true };

/* Une las partes de un catálogo dividido */
function mergeCatalogParts(manifest, parts) {
  const db = {
    meta: manifest.meta || {},
    series: [],
    seasons: [],
    episodes: [],
    genres: []
  };

  const gset = new Set(manifest.genres || []);

  for (const p of parts) {
    if (!p) continue;

    if (Array.isArray(p.series)) {
      db.series.push(...p.series);
    }

    if (Array.isArray(p.seasons)) {
      db.seasons.push(...p.seasons);
    }

    if (Array.isArray(p.episodes)) {
      db.episodes.push(...p.episodes);
    }

    if (Array.isArray(p.genres)) {
      p.genres.forEach(g => gset.add(g));
    }
  }

  db.genres = [...gset];

  return db;
}

/* ---------- CACHE ---------- */
/*
 * Antes:
 *   ?ts=Date.now()
 *   cache: 'reload'
 *
 * Eso obligaba a descargar de nuevo el catálogo.
 *
 * Ahora dejamos que navegador/CDN utilicen su caché normal.
 */
async function fetchCatalogFile(file) {
  const r = await fetch(file, {
    cache: 'default'
  });

  if (!r.ok) {
    throw new Error('No se pudo cargar ' + file);
  }

  return r.json();
}

async function ensureCatalog(id) {
  if (DB_CACHE[id]) return DB_CACHE[id];

  const cat = CATALOGS.find(c => c.id === id);
  if (!cat) throw new Error('Catálogo desconocido: ' + id);

  // ① Intentar el índice LITE (≈1 MB en vez de 15-30 MB)
  if (cat.index) {
    try {
      const lite = await fetchCatalogFile(cat.index);
      if (lite && Array.isArray(lite.series)) {
        // El índice viene comprimido (claves cortas + géneros numerados):
        // lo devolvemos al formato de siempre para no tocar el resto de la app.
        const gl = lite.genres || [];
        const ib = lite.imageBase || '';
        const rows = lite.compact
          ? lite.series.map(r => ({
              id: r.i,
              slug: r.s,
              title: r.t,
              image: r.p ? (r.p.startsWith('http') || r.p.startsWith('./') || r.p.startsWith('/') ? r.p : ib + r.p) : null,
              status: r.st || null,
              type: r.ty || null,
              year: r.y || null,
              country: r.c || null,
              genres: (r.g || []).map(n => gl[n]).filter(Boolean),
              totalEpisodes: r.e ?? null,
              updatedAt: r.u || null
            }))
          : lite.series;

        const db = {
          meta: lite.meta || {},
          series: rows,
          seasons: [],
          episodes: [],
          genres: lite.genres || [],
          lite: true
        };
        DETAILS_BASE[id] =
          './public/data/' + (lite.detailsBase || '');
        DB_CACHE[id] = db;
        CATALOG_AVAILABLE[id] = true;
        return db;
      }
    } catch { /* sin índice → seguimos con el catálogo completo */ }
  }

  // ② Compatibilidad: catálogo completo / sharded (código original)
  const data = await fetchCatalogFile(cat.file);
  let merged = data;

  if (data && data.sharded && Array.isArray(data.parts) && data.parts.length) {
    const parts = await Promise.all(
      data.parts.map(f => fetchCatalogFile(f).catch(() => null))
    );
    if (parts.some(p => p === null)) throw new Error('Falta alguna parte del catálogo');
    merged = mergeCatalogParts(data, parts);
  }

  DB_CACHE[id] = merged;
  CATALOG_AVAILABLE[id] = true;
  return merged;
}

async function probeCatalogs() {
  for (const c of CATALOGS) {
    if (DB_CACHE[c.id]) {
      CATALOG_AVAILABLE[c.id] = true;
      continue;
    }

    try {
      const r = await fetch(c.file, {
        cache: 'default'
      });

      if (!r.ok) {
        CATALOG_AVAILABLE[c.id] = false;
        continue;
      }

      const parsed = await r.json().catch(() => null);

      if (parsed && parsed.sharded) {
        CATALOG_AVAILABLE[c.id] =
          Array.isArray(parsed.parts) &&
          parsed.parts.length > 0;
      } else {
        CATALOG_AVAILABLE[c.id] =
          Boolean(parsed && Array.isArray(parsed.series));
      }

    } catch {
      CATALOG_AVAILABLE[c.id] = false;
    }
  }

  renderCatBar();
}

function renderCatBar() {
  const menu = document.getElementById('catalogMenu');
  const wrap = document.getElementById('catalogWrap');

  if (!menu || !wrap) return;

  const available = CATALOGS.filter(
    c => CATALOG_AVAILABLE[c.id]
  );

  wrap.style.display =
    available.length > 1 ? '' : 'none';

  menu.querySelectorAll('button').forEach(b => {
    const id = b.dataset.cat;

    b.classList.toggle(
      'on',
      id === currentCatalog
    );

    b.style.display =
      CATALOG_AVAILABLE[id] ? '' : 'none';
  });
}

function toggleCatalogMenu() {
  document
    .getElementById('catalogMenu')
    ?.classList.toggle('open');
}

/* Cerrar menú al tocar fuera */
document.addEventListener('click', e => {
  const m = document.getElementById('catalogMenu');

  if (
    m?.classList.contains('open') &&
    !e.target.closest('.catalog-wrap')
  ) {
    m.classList.remove('open');
  }
});

async function switchCatalog(id) {
  if (id === currentCatalog) return;

  app.innerHTML =
    '<section class="section page-top"><div class="grid">' +
    Array(8)
      .fill('<div class="skeleton"></div>')
      .join('') +
    '</div></section>';

  try {
    DB = await ensureCatalog(id);

    currentCatalog = id;

    localStorage.setItem(
      'donghuaflix_catalog',
      id
    );

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

const esc = s =>
  String(s ?? '').replace(
    /[&<>"']/g,
    m =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m])
  );

const qs = s => encodeURIComponent(s || '');

/* ---------- ICONOS SVG ---------- */
const ICONS = {
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',

  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',

  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',

  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9A5.3 5.3 0 0 1 12 6.6a5.3 5.3 0 0 1 9.3 4.9c-1.8 4.4-9.3 9-9.3 9z"/></svg>',

  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',

  reload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 4v6h-6"/><path d="M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10"/><path d="M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>',

  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10.5L12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>',

  tv: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2.5"/><path d="M8 3l4 4 4-4"/></svg>',

  dots: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',

  full: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',

  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></svg>',

  prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',

  next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',

  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',

  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M18 15l-6-6-6 6"/></svg>',

  film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M3 16h18M8 3v18M16 3v18"/></svg>',

  repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>'
};

/* ---------- HELPERS ---------- */

const cleanTitle = s => {
  let title = s?.title;

  if (title) {
    title = title
      .replace(/\s*\|\s*Donghualife.*$/i, '')
      .trim();
  }

  if (
    !title ||
    title.toLowerCase() === 'temporadas'
  ) {
    const rawSlug = s?.slug || s?.id || '';

    if (rawSlug) {
      return rawSlug
        .split('-')
        .map(
          w =>
            w.charAt(0).toUpperCase() +
            w.slice(1)
        )
        .join(' ');
    }

    return 'Donghua';
  }

  return title;
};

const cleanEpisodeTitle = e => {
  let t = (e.title || '')
    .replace(/\s*\|\s*Donghualife.*$/i, '')
    .trim();

  const m = t.match(
    /(?:^|[-–—])\s*\d*\s*(?:Episodio|Episode)\s*x?(\d+)\s*$/i
  );

  if (m) {
    return `Episodio ${parseInt(m[1], 10)}`;
  }

  return t || `Episodio ${e.number}`;
};

const slugFromUrl = u =>
  (u || '')
    .split('?')[0]
    .split('/')
    .filter(Boolean)
    .pop() || '';

const prettySlug = slug =>
  slug
    .split('-')
    .filter(Boolean)
    .map(
      w =>
        w.charAt(0).toUpperCase() +
        w.slice(1)
    )
    .join(' ');

const seasonTitle = (season, index) => {
  if (Number.isFinite(season.number)) {
    return `Temporada ${season.number}`;
  }

  const t = (season.title || '').trim();

  if (
    t &&
    t.toLowerCase() !== 'temporadas'
  ) {
    const m =
      t.match(
        /(?:temporada|season)\s*(\d{1,3})/i
      ) ||
      t.match(/^(\d{1,3})[ª°.]/);

    if (m) {
      return `Temporada ${parseInt(m[1], 10)}`;
    }

    return t;
  }

  const slug = (
    season.slug ||
    season.id ||
    slugFromUrl(
      season.url ||
      season.sourceUrl
    ) ||
    ''
  ).toLowerCase();

  let m = slug.match(/-(\d{1,3})-\d{1,3}$/);

  if (m) {
    return `Temporada ${parseInt(m[1], 10)}`;
  }

  m = slug.match(/-(\d{1,3})$/);

  if (m) {
    return `Temporada ${parseInt(m[1], 10)}`;
  }

  if (slug) return prettySlug(slug);

  return `Temporada ${index + 1}`;
};

function orderSeasons(s, seasons) {
  const urls = s.seasonUrls || [];

  if (!urls.length) return seasons;

  const rank = seas => {
    const key = (
      seas.slug ||
      seas.id ||
      slugFromUrl(
        seas.url ||
        seas.sourceUrl
      ) ||
      ''
    ).toLowerCase();

    const i = urls.findIndex(
      u =>
        slugFromUrl(u).toLowerCase() === key ||
        u ===
          (seas.url ||
            seas.sourceUrl)
    );

    return i === -1 ? 999 : i;
  };

  return seasons
    .slice()
    .sort(
      (a, b) => rank(a) - rank(b)
    );
}

const getSeriesImage = s => {
  if (s?.posterLocal) {
    return s.posterLocal;
  }

  if (
    s?.image &&
    !s.image.includes('IcoPrueba.png')
  ) {
    return s.image;
  }

  const seasons = DB.seasons.filter(
    seas => seas.seriesId === s.id
  );

  for (const seas of seasons) {
    if (
      seas.image &&
      !seas.image.includes('IcoPrueba.png')
    ) {
      return seas.image;
    }
  }

  return '';
};

const findSeries = ref =>
  DB.series.find(
    x =>
      (x.slug || x.id) === ref ||
      x.id === ref
  );

const findEpisode = ref =>
  DB.episodes.find(
    x =>
      (x.slug || x.id) === ref ||
      x.id === ref
  );

const dedupeEps = eps => {
  const map = new Map();

  eps.forEach(e => {
    if (!map.has(e.number)) {
      map.set(e.number, e);
    }
  });

  return [...map.values()].sort(
    (a, b) => a.number - b.number
  );
};

const seriesGenres = s => {
  if (Array.isArray(s.genres)) {
    return s.genres;
  }

  if (s.genre) {
    return [s.genre];
  }

  return [];
};

/* Portadas inteligentes */
function imgLoaded(img) {
  img.classList.toggle(
    'wide',
    img.naturalWidth > img.naturalHeight
  );
}

/* ---------- FONDO AMBIENTE ---------- */

function setAmbience(url) {
  const el =
    document.getElementById('bgAmbience');

  if (!el) return;

  el.style.backgroundImage = url
    ? `url('${url}')`
    : 'none';
}

/* ---------- VISTOS ---------- */

function getWatched() {
  try {
    return JSON.parse(
      localStorage.getItem(
        'donghuaflix_watched'
      ) || '{}'
    );
  } catch (e) {
    return {};
  }
}

function isWatched(seasonId, num) {
  return Boolean(
    getWatched()[seasonId]?.[num]
  );
}

/* Marca SOLO el episodio que se está viendo */
function markWatchedSingle(
  seasonId,
  num
) {
  const all = getWatched();

  all[seasonId] =
    all[seasonId] || {};

  all[seasonId][num] =
    Date.now();

  localStorage.setItem(
    'donghuaflix_watched',
    JSON.stringify(all)
  );
}

function markWatchedUpTo(
  seasonId,
  num
) {
  const all = getWatched();

  all[seasonId] =
    all[seasonId] || {};

  for (
    let n = 1;
    n <= num;
    n++
  ) {
    if (!all[seasonId][n]) {
      all[seasonId][n] = Date.now();
    }
  }

  localStorage.setItem(
    'donghuaflix_watched',
    JSON.stringify(all)
  );
}

function toggleWatched(
  seasonId,
  num
) {
  const all = getWatched();

  all[seasonId] =
    all[seasonId] || {};

  if (all[seasonId][num]) {
    delete all[seasonId][num];
  } else {
    all[seasonId][num] =
      Date.now();
  }

  localStorage.setItem(
    'donghuaflix_watched',
    JSON.stringify(all)
  );

  showToast(
    isWatched(seasonId, num)
      ? 'Marcado como visto'
      : 'Marcador quitado'
  );

  const s =
    findSeries(detailState.seriesId);

  if (s) {
    const seasons =
      orderSeasons(
        s,
        DB.seasons.filter(
          x => x.seriesId === s.id
        )
      );

    if (
      seasons[detailState.seasonIdx]
    ) {
      renderEpisodePage(
        seasons[
          detailState.seasonIdx
        ]
      );
    }
  }
}

function seriesProgress(s) {
  const watched =
    getWatched();

  const seasons =
    DB.seasons.filter(
      x => x.seriesId === s.id
    );

  let total = 0;
  let seen = 0;

  for (const seas of seasons) {
    const eps =
      DB.episodes.filter(
        e =>
          e.seasonId === seas.id
      );

    total += eps.length;

    const w =
      watched[seas.id] || {};

    seen += eps.filter(
      e => w[e.number]
    ).length;
  }

  return total
    ? Math.round(
        seen / total * 100
      )
    : 0;
}

function seriesEpisodeCount(s) {
  return DB.episodes.filter(
    e => e.seriesId === s.id
  ).length;
}

/* ---------- TOAST ---------- */

let toastTimer = null;

function showToast(msg) {
  const t =
    document.getElementById('toast');

  if (!t) return;

  t.textContent = msg;
  t.classList.add('show');

  clearTimeout(toastTimer);

  toastTimer = setTimeout(
    () =>
      t.classList.remove('show'),
    2200
  );
}

/* ---------- FAVORITOS ---------- */

function getFavs() {
  try {
    return JSON.parse(
      localStorage.getItem(
        'donghuaflix_favs'
      ) || '[]'
    );
  } catch (e) {
    return [];
  }
}

function toggleFav(seriesId) {
  let favs = getFavs();

  const was =
    favs.includes(seriesId);

  favs = was
    ? favs.filter(
        id => id !== seriesId
      )
    : [...favs, seriesId];

  localStorage.setItem(
    'donghuaflix_favs',
    JSON.stringify(favs)
  );

  showToast(
    was
      ? 'Quitado de Mi lista'
      : 'Añadido a Mi lista'
  );

  return !was;
}

const isFav = id =>
  getFavs().includes(id);

/* Comparación sin acentos */
const fold = s =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const getYear = s =>
  s.year ||
  (
    String(
      s.releaseDate || ''
    ).match(/\d{4}/) || []
  )[0] ||
  (
    cleanTitle(s).match(
      /\b((?:19|20)\d{2})\b/
    ) || []
  )[0] ||
  null;

const getCountry = s =>
  s.country || null;

const contentTypeOf = s => {
  if (s.contentType) {
    return s.contentType;
  }

  if (
    (s.sourceUrl || '').includes(
      '/peliculas/'
    )
  ) {
    return 'movie';
  }

  return 'series';
};

/* ---------- HISTORIAL ---------- */

function getHistory() {
  try {
    return JSON.parse(
      localStorage.getItem(
        'donghuaflix_history'
      ) || '{}'
    );
  } catch (e) {
    return {};
  }
}

function saveHistory(
  seriesId,
  episodeData
) {
  try {
    const history =
      getHistory();

    history[seriesId] = {
      episodeId:
        episodeData.id,
      episodeNumber:
        episodeData.number,
      episodeTitle:
        episodeData.title,
      seasonId:
        episodeData.seasonId,
      timestamp:
        Date.now()
    };

    localStorage.setItem(
      'donghuaflix_history',
      JSON.stringify(history)
    );
  } catch (e) {}
}

function lastWatchedEpisode(s) {
  const h =
    getHistory()[s.id];

  if (h) {
    const ep =
      findEpisode(h.episodeId);

    if (ep) return ep;
  }

  const seasons =
    orderSeasons(
      s,
      DB.seasons.filter(
        x => x.seriesId === s.id
      )
    );

  for (const seas of seasons) {
    const eps =
      dedupeEps(
        DB.episodes.filter(
          e =>
            e.seasonId === seas.id
        )
      );

    if (eps.length) {
      return eps[0];
    }
  }

  return null;
}

/* ---------- AUTO SIGUIENTE ---------- */

let currentEpisode = null;

let autoNextEnabled =
  localStorage.getItem(
    'donghuaflix_autonext'
  ) !== 'off';

function toggleAutoNext() {
  autoNextEnabled =
    !autoNextEnabled;

  localStorage.setItem(
    'donghuaflix_autonext',
    autoNextEnabled
      ? 'on'
      : 'off'
  );

  showToast(
    autoNextEnabled
      ? 'Auto-siguiente activado'
      : 'Auto-siguiente desactivado'
  );

  const b =
    document.getElementById(
      'autoNextBtn'
    );

  if (b) {
    b.innerHTML =
      `${ICONS.repeat}<span>Auto: ${
        autoNextEnabled
          ? 'ON'
          : 'OFF'
      }</span>`;
  }
}

function autoNext() {
  if (
    !currentEpisode ||
    !autoNextEnabled
  ) {
    return;
  }

  const seasonEps =
    dedupeEps(
      DB.episodes.filter(
        x =>
          x.seasonId ===
          currentEpisode.seasonId
      )
    );

  const idx =
    seasonEps.findIndex(
      x =>
        x.id ===
        currentEpisode.id
    );

  const next =
    seasonEps[idx + 1];

  if (next) {
    showToast(
      'Cargando siguiente episodio…'
    );

    setTimeout(() => {
      location.hash =
        '#/episode/' +
        qs(
          next.slug ||
          next.id
        );
    }, 1200);

  } else {
    showToast(
      '¡Has terminado esta temporada!'
    );
  }
}

window.addEventListener(
  'message',
  event => {
    const origin =
      String(event.origin || '');

    if (
      !/dailymotion|dmcdn/i.test(
        origin
      )
    ) {
      return;
    }

    const data =
      typeof event.data === 'string'
        ? event.data
        : JSON.stringify(
            event.data || {}
          );

    if (
      /video[_-]?end|ended/i.test(
        data
      )
    ) {
      autoNext();
    }
  }
);

/* ---------- RECOMENDACIONES ---------- */

function getRecommendedSeries(
  currentSeries,
  limit = 8
) {
  const historyIds =
    new Set(
      Object.keys(
        getHistory()
      )
    );

  const currentGenres =
    seriesGenres(
      currentSeries
    ).map(
      g => g.toLowerCase()
    );

  const others =
    DB.series.filter(
      s =>
        s.id !==
        currentSeries.id
    );

  const scored =
    others.map(s => ({
      s,
      score:
        seriesGenres(s)
          .map(
            g => g.toLowerCase()
          )
          .filter(
            g =>
              currentGenres.includes(
                g
              )
          ).length
    }));

  const fresh =
    scored
      .filter(
        x =>
          x.score > 0 &&
          !historyIds.has(
            x.s.id
          )
      )
      .sort(
        (a, b) =>
          b.score - a.score ||
          (
            b.s.updatedAt || ''
          ).localeCompare(
            a.s.updatedAt || ''
          )
      );

  const filler =
    scored
      .filter(
        x =>
          x.score === 0 &&
          !historyIds.has(
            x.s.id
          )
      )
      .sort(
        (a, b) =>
          (
            b.s.updatedAt || ''
          ).localeCompare(
            a.s.updatedAt || ''
          )
      );

  return [
    ...fresh,
    ...filler
  ]
    .slice(0, limit)
    .map(x => x.s);
}

/* ---------- PANTALLA COMPLETA ---------- */

function togglePlayerFS() {
  const player =
    document.querySelector(
      '.player'
    );

  if (!player) return;

  if (
    document.fullscreenElement
  ) {
    document.exitFullscreen();
  } else if (
    player.requestFullscreen
  ) {
    player.requestFullscreen();
  } else if (
    player.webkitRequestFullscreen
  ) {
    player.webkitRequestFullscreen();
  }
}

function toggleMoreMenu() {
  document
    .getElementById('moreMenu')
    ?.classList.toggle('open');
}

/* =========================================================
   CARGA PROGRESIVA DE TARJETAS
   ========================================================= */

const PROGRESSIVE_BATCH = 60;

let activeGridObserver = null;

function stopProgressiveGrid() {
  if (activeGridObserver) {
    activeGridObserver.disconnect();
    activeGridObserver = null;
  }
}

/*
 * Renderiza únicamente un grupo inicial de tarjetas.
 *
 * Cuando el usuario se acerca al final,
 * añade automáticamente otro grupo.
 *
 * Así una lista de 11.000 elementos NO genera
 * 11.000 elementos DOM de golpe.
 */
function renderProgressiveGrid({
  container,
  items,
  emptyText = 'No hay elementos disponibles.',
  batchSize = PROGRESSIVE_BATCH
}) {
  if (!container) return;

  stopProgressiveGrid();

  container.innerHTML = '';

  if (!items.length) {
    container.innerHTML =
      `<p class="muted" style="grid-column:1/-1">${emptyText}</p>`;
    return;
  }

  let index = 0;

  const sentinel =
    document.createElement('div');

  sentinel.className =
    'grid-sentinel';

  sentinel.style.cssText =
    'grid-column:1/-1;width:100%;height:1px;pointer-events:none;';

  const appendBatch = () => {
    if (index >= items.length) {
      sentinel.remove();

      if (activeGridObserver) {
        activeGridObserver.disconnect();
        activeGridObserver = null;
      }

      return;
    }

    const end =
      Math.min(
        index + batchSize,
        items.length
      );

    const batch =
      items.slice(
        index,
        end
      );

    const html =
      batch
        .map(card)
        .join('');

    sentinel.insertAdjacentHTML(
      'beforebegin',
      html
    );

    index = end;

    if (
      index >= items.length
    ) {
      sentinel.remove();

      if (activeGridObserver) {
        activeGridObserver.disconnect();
        activeGridObserver = null;
      }
    }
  };

  /*
   * Primero cargamos solamente 60.
   */
  container.appendChild(
    sentinel
  );

  appendBatch();

  /*
   * Carga el siguiente bloque
   * antes de que el usuario llegue
   * completamente al final.
   */
  activeGridObserver =
    new IntersectionObserver(
      entries => {
        if (
          entries.some(
            entry =>
              entry.isIntersecting
          )
        ) {
          appendBatch();
        }
      },
      {
        root: null,
        rootMargin:
          '1000px 0px',
        threshold: 0
      }
    );

  activeGridObserver.observe(
    sentinel
  );
}

/* ---------- PAGINACIÓN (20 por página) ---------- */
const PER_PAGE = 20;

function renderPagedGrid({ container, items, emptyText = 'No hay elementos disponibles.', perPage = PER_PAGE }) {
  if (!container) return;
  stopProgressiveGrid();

  if (!items.length) {
    container.innerHTML = `<p class="muted" style="grid-column:1/-1">${emptyText}</p>`;
    return;
  }

  const pages = Math.ceil(items.length / perPage);
  let page = 0;

  let pager = container.nextElementSibling;
  if (!pager || !pager.classList.contains('pager')) {
    pager = document.createElement('nav');
    pager.className = 'pager';
    container.after(pager);
  }

  const draw = () => {
    container.innerHTML = items
      .slice(page * perPage, (page + 1) * perPage)
      .map(card)
      .join('');

    const win = [];
    const from = Math.max(0, Math.min(page - 2, pages - 5));
    for (let i = from; i < Math.min(pages, from + 5); i++) win.push(i);

    pager.innerHTML = `
      <button class="pg-btn" data-go="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹</button>
      ${win.map(i => `<button class="pg-btn ${i === page ? 'on' : ''}" data-go="${i}">${i + 1}</button>`).join('')}
      <button class="pg-btn" data-go="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>›</button>
      <span class="pg-info">Página ${page + 1} de ${pages}</span>`;

    pager.querySelectorAll('.pg-btn').forEach(b => {
      b.onclick = () => {
        const go = Number(b.dataset.go);
        if (isNaN(go) || go < 0 || go >= pages || go === page) return;
        page = go;
        draw();
        container.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  };

  draw();
}

/* ---------- CARGA ---------- */

async function load() {
  stopProgressiveGrid();

  app.innerHTML =
    '<section class="section page-top"><div class="grid">' +
    Array(8)
      .fill(
        '<div class="skeleton"></div>'
      )
      .join('') +
    '</div></section>';

  try {
    DB =
      await ensureCatalog(
        currentCatalog
      );

    renderCatBar();

    const footerStatus =
      document.getElementById(
        'footerStatus'
      );

    if (footerStatus) {
      const igIcon =
        '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>';

      footerStatus.innerHTML = `
        ${
          DB.meta?.syncedAt
            ? `Actualizado: ${new Date(
                DB.meta.syncedAt
              ).toLocaleString(
                'es-ES'
              )} · `
            : ''
        }
        Desarrollado por
        <a class="ig-link" href="https://instagram.com/bledark__" target="_blank" rel="noopener">${igIcon} @bledark__</a>`;
    }

    route();

    probeCatalogs();

  } catch (err) {
    console.error(
      'Error cargando catálogo:',
      err
    );

    app.innerHTML =
      `<section class="empty page-top">
        <h2>Error al cargar el catálogo</h2>
        <p class="muted">Revisa tu conexión o el archivo del catálogo</p>
      </section>`;
  }
}

/* ---------- TARJETAS ---------- */

function card(s) {
  const imgUrl =
    getSeriesImage(s);

  const title =
    cleanTitle(s);

  const fav =
    isFav(s.id);

  const progress =
    seriesProgress(s);

  return `<article class="card" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
    <div class="poster">
      ${
        imgUrl
          ? `<img loading="lazy" src="${esc(imgUrl)}" alt="${esc(title)}" onload="imgLoaded(this)" onerror="this.parentNode.innerHTML='<div class=&quot;no-img&quot;>DONGHUAFLIX</div>'">`
          : '<div class="no-img">DONGHUAFLIX</div>'
      }

      <span class="badge">${esc(
        s.status ||
          'DONGHUA'
      )}</span>

      ${
        s._cat || s.src
          ? `<span class="badge src">${esc(
              SRC_LABEL[s._cat || s.src] ||
                s.src ||
                ''
            )}</span>`
          : ''
      }

      <button
        class="fav-heart ${
          fav ? 'on' : ''
        }"
        title="Mi lista"
        onclick="event.stopPropagation();toggleFav('${esc(
          s.id
        )}');refreshFavUI(this,'${esc(
    s.id
  )}')"
      >
        ${ICONS.heart}
      </button>

      ${
        progress > 0
          ? `<div class="progress"><span style="width:${progress}%"></span></div>`
          : ''
      }
    </div>

    <h3>${esc(title)}</h3>
  </article>`;
}

function refreshFavUI(
  btn,
  seriesId
) {
  btn.classList.toggle(
    'on',
    isFav(seriesId)
  );
}

function rail(items) {
  return `<div class="rail">${
    items
      .map(
        s =>
          `<div class="rail-item">${card(
            s
          )}</div>`
      )
      .join('')
  }</div>`;
}

/* ---------- CONTINUAR VIENDO ---------- */

function cwCard(
  s,
  hist
) {
  const img =
    getSeriesImage(s);

  const season =
    DB.seasons.find(
      x =>
        x.id ===
        hist.seasonId
    );

  const sn =
    season &&
    Number.isFinite(
      season.number
    )
      ? season.number
      : 1;

  const progress =
    seriesProgress(s);

  return `<div class="cw-card" onclick="location.hash='#/episode/${qs(
    hist.episodeId
  )}'">
    ${
      img
        ? `<img loading="lazy" src="${esc(
            img
          )}" alt="" onerror="this.remove()">`
        : ''
    }

    <div class="cw-shade"></div>

    <div class="cw-play">
      ${ICONS.play}
    </div>

    <div class="cw-info">
      ${esc(
        cleanTitle(s)
      )} · T${sn}:E${
    hist.episodeNumber
  }
    </div>

    ${
      progress > 0
        ? `<div class="cw-progress"><span style="width:${progress}%"></span></div>`
        : ''
    }
  </div>`;
}

/* ---------- TOP 10 ---------- */

function top10Rail(items) {
  if (!items.length) return '';

  return `<div class="top10-row">${
    items
      .map(
        (s, i) => `
    <div class="top10-item" onclick="location.hash='#/series/${qs(
      s.slug || s.id
    )}'">
      <span class="top10-num">${
        i + 1
      }</span>

      <div
        class="top10-poster"
        style="background-image:url('${esc(
          getSeriesImage(s)
        )}')"
      ></div>
    </div>`
      )
      .join('')
  }</div>`;
}

/* ---------- HERO ---------- */

let heroItems = [];
let heroIdx = 0;
let heroTimer = null;
let heroTouchX = null;
let heroMouseX = null;
let heroHold = false;

const HERO_INTERVAL = 5000;

function heroGo(dir) {
  if (!heroItems.length) return;
  heroIdx =
    (heroIdx + dir + heroItems.length) %
    heroItems.length;
  renderHero(dir);
}

function heroGoTo(i) {
  if (!heroItems.length || i === heroIdx) return;
  const dir = i > heroIdx ? 1 : -1;
  heroIdx = i;
  renderHero(dir);
}

function heroRestartTimer() {
  clearInterval(heroTimer);
  if (heroItems.length > 1 && !heroHold) {
    heroTimer = setInterval(
      () => heroGo(1),
      HERO_INTERVAL
    );
  }
}

function renderHero(dir = 0) {
  const hero =
    heroItems[heroIdx];

  const sec =
    document.getElementById(
      'hero'
    );

  if (!hero || !sec) return;

  const img =
    getSeriesImage(hero);

  sec.style.setProperty(
    '--hero',
    `url('${img}')`
  );

  setAmbience(img);

  document.getElementById(
    'heroTitle'
  ).textContent =
    cleanTitle(hero);

  document.getElementById(
    'heroMeta'
  ).textContent =
    seriesGenres(hero)
      .slice(0, 3)
      .join(' · ');

  document.getElementById(
    'heroSyn'
  ).textContent =
    hero.synopsis ||
    'Catálogo de animación china en alta calidad.';

  document.getElementById(
    'heroBtn'
  ).onclick = () => {
    const ep =
      lastWatchedEpisode(
        hero
      );

    if (ep) {
      location.hash =
        '#/episode/' +
        qs(
          ep.slug ||
            ep.id
        );
    } else {
      location.hash =
        '#/series/' +
        qs(
          hero.slug ||
            hero.id
        );
    }
  };

  const favBtn =
    document.getElementById(
      'heroListBtn'
    );

  if (favBtn) {
    const fav =
      isFav(hero.id);

    favBtn.innerHTML =
      fav
        ? `${ICONS.check}<span>Mi lista</span>`
        : `${ICONS.plus}<span>Mi lista</span>`;

    favBtn.onclick = () => {
      const f =
        toggleFav(
          hero.id
        );

      favBtn.innerHTML =
        f
          ? `${ICONS.check}<span>Mi lista</span>`
          : `${ICONS.plus}<span>Mi lista</span>`;
    };
  }

  document
    .querySelectorAll(
      '.hero-dots button'
    )
    .forEach(
      (d, i) =>
        d.classList.toggle(
          'active',
          i === heroIdx
        )
    );

  /* animación direccional del contenido */
  sec.classList.remove(
    'slide-l',
    'slide-r'
  );
  if (dir) {
    void sec.offsetWidth;
    sec.classList.add(
      dir > 0 ? 'slide-l' : 'slide-r'
    );
  }
}

function mountHero(items) {
  clearInterval(
    heroTimer
  );

  heroItems =
    items.slice(0, 5);

  heroIdx = 0;
  heroHold = false;

  renderHero();
  heroRestartTimer();

  const heroEl =
    document.getElementById(
      'hero'
    );

  if (
    heroEl &&
    !heroEl.dataset
      .swipeBound
  ) {
    heroEl.dataset.swipeBound =
      '1';

    /* táctil: deslizar izquierda/derecha */
    heroEl.addEventListener(
      'touchstart',
      e => {
        heroTouchX =
          e.touches[0].clientX;
        heroHold = true;
        clearInterval(
          heroTimer
        );
      },
      { passive: true }
    );

    heroEl.addEventListener(
      'touchend',
      e => {
        if (
          heroTouchX !=
          null
        ) {
          const dx =
            e.changedTouches[0]
              .clientX -
            heroTouchX;
          if (
            Math.abs(dx) >
            45
          ) {
            heroGo(
              dx < 0
                ? 1
                : -1
            );
          }
        }
        heroTouchX = null;
        heroHold = false;
        heroRestartTimer();
      },
      { passive: true }
    );

    /* ratón: arrastrar en escritorio */
    heroEl.addEventListener(
      'mousedown',
      e => {
        heroMouseX =
          e.clientX;
      }
    );

    window.addEventListener(
      'mouseup',
      e => {
        if (
          heroMouseX ==
          null
        ) {
          return;
        }
        const dx =
          e.clientX -
          heroMouseX;
        if (
          Math.abs(dx) >
          70
        ) {
          heroGo(
            dx < 0
              ? 1
              : -1
          );
        }
        heroMouseX = null;
      }
    );

    /* teclado: flechas izquierda/derecha */
    document.addEventListener(
      'keydown',
      e => {
        if (
          !document.getElementById(
            'hero'
          )
        ) {
          return;
        }
        if (
          e.key ===
          'ArrowRight'
        ) {
          heroGo(1);
        } else if (
          e.key ===
          'ArrowLeft'
        ) {
          heroGo(-1);
        }
      }
    );
  }
}

/* ---------- VISTA HOME ---------- */

function home() {
  stopProgressiveGrid();

  const recent =
    DB.series
      .slice()
      .sort(
        (a, b) =>
          (
            b.updatedAt || ''
          ).localeCompare(
            a.updatedAt || ''
          )
      );

  const bySize =
    DB.series
      .slice()
      .sort(
        (a, b) =>
          seriesEpisodeCount(
            b
          ) -
          seriesEpisodeCount(
            a
          )
      );

  const historyData =
    getHistory();

  const historyList =
    DB.series
      .filter(
        s =>
          historyData[s.id]
      )
      .sort(
        (a, b) =>
          historyData[b.id]
            .timestamp -
          historyData[a.id]
            .timestamp
      );

  const favList =
    DB.series.filter(
      s => isFav(s.id)
    );

  const airingList =
    DB.series.filter(
      s =>
        (
          s.status || ''
        )
          .toLowerCase()
          .includes('emisión')
    );

  const completedList =
    DB.series.filter(
      s =>
        (
          s.status || ''
        )
          .toLowerCase()
          .includes('finaliz')
    );

  const moviesList =
    DB.series.filter(
      s =>
        (
          s.type || ''
        )
          .toLowerCase() ===
          'movie' ||
        (
          s.title || ''
        )
          .toLowerCase()
          .includes(
            'película'
          )
    );

  const top10 =
    bySize.slice(0, 10);

  /* Hero ALEATORIO del catálogo activo (sin mezclar catálogos):
     prioriza títulos con portada y sinopsis para que quede bonito */
  const heroCandidates =
    DB.series.filter(
      s =>
        getSeriesImage(s) &&
        (s.synopsis || '')
          .length > 40
    );
  const heroSource =
    heroCandidates.length >= 5
      ? heroCandidates
      : DB.series;
  const heroPool =
    heroSource
      .slice()
      .sort(
        () =>
          Math.random() - 0.5
      )
      .slice(0, 5);

  const sections = [];

  if (historyList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head">
        <h2>Continuar viendo</h2>
        <span class="muted">${historyList.length}</span>
      </div>

      <div class="cw-rail">
        ${historyList
          .slice(0, 10)
          .map(
            s =>
              cwCard(
                s,
                historyData[s.id]
              )
          )
          .join('')}
      </div>
    </section>`);
  }

  if (favList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head">
        <h2>Mi lista</h2>
        <span class="muted">${favList.length}</span>
      </div>

      ${rail(favList)}
    </section>`);
  }

  /* En Cine */
  if (
    currentCatalog ===
      'series' ||
    currentCatalog ===
      'peliculas'
  ) {
    const cineMovies =
      DB.series.filter(
        s =>
          contentTypeOf(s) ===
          'movie'
      );

    const cineSeries =
      DB.series.filter(
        s =>
          contentTypeOf(s) ===
          'series'
      );

    if (cineMovies.length) {
      sections.push(`
      <section class="section">
        <div class="section-head">
          <h2>🎬 Películas</h2>
          <span class="muted">${cineMovies.length}</span>
        </div>

        ${rail(cineMovies)}
      </section>`);
    }

    if (cineSeries.length) {
      sections.push(`
      <section class="section">
        <div class="section-head">
          <h2>📺 Series</h2>
          <span class="muted">${cineSeries.length}</span>
        </div>

        ${rail(cineSeries)}
      </section>`);
    }
  }

  if (
    airingList.length ||
    top10.length
  ) {
    sections.push(`
    <section class="section">
      <div class="section-head">
        <h2>Top 10 hoy</h2>
        <span class="muted">serie</span>
      </div>

      ${top10Rail(top10)}
    </section>`);

    if (airingList.length) {
      sections.push(`
      <section class="section">
        <div class="section-head">
          <h2>En Emisión</h2>
          <span class="muted">${airingList.length}</span>
        </div>

        ${rail(airingList)}
      </section>`);
    }
  }

  if (completedList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head">
        <h2>Finalizadas</h2>
        <span class="muted">${completedList.length}</span>
      </div>

      ${rail(completedList)}
    </section>`);
  }

  /* ── Nuevos episodios: series con capítulos recién actualizados ── */
  {
    const epLatest =
      new Map();
    for (const e of DB.episodes) {
      const t =
        Date.parse(
          e.updatedAt || 0
        ) || 0;
      if (
        t &&
        (!epLatest.has(
          e.seriesId
        ) ||
          t >
            epLatest.get(
              e.seriesId
            ))
      ) {
        epLatest.set(
          e.seriesId,
          t
        );
      }
    }
    const freshEps =
      DB.series
        .filter(
          s =>
            epLatest.has(
              s.id
            )
        )
        .sort(
          (a, b) =>
            epLatest.get(
              b.id
            ) -
            epLatest.get(
              a.id
            )
        )
        .slice(0, 14);
    if (freshEps.length) {
      sections.push(`
      <section class="section">
        <div class="section-head">
          <h2>🔥 Nuevos episodios</h2>
          <span class="muted">${freshEps.length}</span>
        </div>
        ${rail(freshEps)}
      </section>`);
    }
  }

  /* ── Para maratonear: los títulos más largos ── */
  {
    const marathon =
      DB.series
        .slice()
        .sort(
          (a, b) =>
            seriesEpisodeCount(
              b
            ) -
            seriesEpisodeCount(
              a
            )
        )
        .filter(
          s =>
            seriesEpisodeCount(
              s
            ) >= 50
        )
        .slice(0, 12);
    if (marathon.length) {
      sections.push(`
      <section class="section">
        <div class="section-head">
          <h2>🏃 Para maratonear</h2>
          <span class="muted">${marathon.length}</span>
        </div>
        ${rail(marathon)}
      </section>`);
    }
  }

  /* ── Raíles por género: los 3 géneros con más títulos ── */
  {
    const genreCount =
      new Map();
    for (const s of DB.series) {
      for (const g of seriesGenres(
        s
      )) {
        const k =
          fold(g);
        genreCount.set(
          k,
          (genreCount.get(
            k
          ) || 0) + 1
        );
      }
    }
    const topGenres =
      [
        ...genreCount.entries()
      ]
        .sort(
          (a, b) =>
            b[1] - a[1]
        )
        .slice(0, 3);
    for (const [
      gKey
    ] of topGenres) {
      const inGenre =
        DB.series
          .filter(
            s =>
              seriesGenres(
                s
              ).some(
                g =>
                  fold(
                    g
                  ) ===
                  gKey
              )
          )
          .slice(0, 14);
      if (
        inGenre.length < 4
      ) {
        continue;
      }
      const gName =
        seriesGenres(
          inGenre[0]
        ).find(
          g =>
            fold(g) ===
            gKey
        ) || gKey;
      sections.push(`
      <section class="section">
        <div class="section-head">
          <h2>${esc(gName)}</h2>
          <span class="muted">${inGenre.length}</span>
        </div>
        ${rail(inGenre)}
      </section>`);
    }
  }

  /*
   * Importante:
   * Esta sección puede contener miles de películas.
   *
   * En lugar de meter las 11.000 tarjetas en el DOM,
   * mostramos únicamente una muestra inicial.
   *
   * El catálogo completo sigue estando disponible
   * mediante "Ver catálogo completo".
   */
  if (moviesList.length) {
    sections.push(`
    <section class="section">
      <div class="section-head">
        <h2>Películas y Especiales</h2>
        <span class="muted">${moviesList.length}</span>
      </div>

      ${rail(
        moviesList.slice(0, 20)
      )}
    </section>`);
  }

  sections.push(`
    <section class="section">
      <div class="section-head">
        <h2>Agregados recientemente</h2>
        <span class="muted">${Math.min(
          recent.length,
          15
        )}</span>
      </div>

      ${rail(
        recent.slice(0, 15)
      )}
    </section>`);

  app.innerHTML = `
  <section class="hero" id="hero">
    <div class="hero-shade"></div>

    <div class="hero-content">
      <div class="eyebrow">
        DONGHUAFLIX EXCLUSIVE
      </div>

      <h1 id="heroTitle"></h1>

      <div
        class="hero-meta"
        id="heroMeta"
      ></div>

      <p id="heroSyn"></p>

      <div class="hero-btns">
        <button
          class="btn-x play"
          id="heroBtn"
        >
          ${ICONS.play}
          <span>Ver serie</span>
        </button>

        <button
          class="btn-x glass"
          id="heroListBtn"
        >
          ${ICONS.plus}
          <span>Mi lista</span>
        </button>
      </div>
    </div>

    ${
      heroPool.length > 1
        ? `<div class="hero-dots">
          ${heroPool
            .slice(0, 5)
            .map(
              (_, i) =>
                `<button onclick="heroGoTo(${i})" aria-label="Hero ${
                  i + 1
                }" ${i === heroIdx ? 'class="active"' : ''}></button>`
            )
            .join('')}
          <button class="hero-arrow left" onclick="heroGo(-1)" aria-label="Anterior">‹</button>
          <button class="hero-arrow right" onclick="heroGo(1)" aria-label="Siguiente">›</button>
        </div>`
        : ''
    }
  </section>

  ${sections.join('')}

  <section class="section center">
    <button
      class="btn-x glass"
      onclick="location.hash='#/series'"
    >
      Ver catálogo completo
      (${DB.series.length} series)
    </button>
  </section>`;

  mountHero(
    heroPool
  );

  renderHero();
}

/* ---------- VISTAS ---------- */

function listAllSeries() {
  stopProgressiveGrid();

  let t =
    performance.now();

  const filtered =
    DB.series.slice();

  app.innerHTML = `
  <section class="section page-top">
    <div class="section-head">
      <h1>Catálogo completo</h1>
      <span class="muted">${filtered.length} series</span>
    </div>

    <div class="filters">
      <select id="fType">
        <option value="all">
          Todos los tipos
        </option>
        <option value="series">
          Series
        </option>
        <option value="movie">
          Películas
        </option>
      </select>

      <select id="fYear">
        <option value="all">
          Todos los años
        </option>
      </select>

      <select id="fGenre">
        <option value="all">
          Todos los géneros
        </option>
      </select>

      <select id="fCountry">
        <option value="all">
          Todos los países
        </option>
      </select>

      <select id="fOrder">
        <option value="recent">
          Más recientes
        </option>
        <option value="az">
          A → Z
        </option>
        <option value="episodes">
          Más episodios
        </option>
      </select>
    </div>

    <div class="grid" id="catGrid"></div>
  </section>`;

  const fType =
    document.getElementById(
      'fType'
    );

  const fYear =
    document.getElementById(
      'fYear'
    );

  const fGenre =
    document.getElementById(
      'fGenre'
    );

  const fCountry =
    document.getElementById(
      'fCountry'
    );

  const fOrder =
    document.getElementById(
      'fOrder'
    );

  const catGrid =
    document.getElementById(
      'catGrid'
    );

  const country =
    s =>
      s.country ||
      'Otro';

  const years = [
    ...new Set(
      DB.series.map(
        getYear
      )
    )
  ]
    .filter(Boolean)
    .sort()
    .reverse();

  const genres = [
    ...new Set(
      DB.series.flatMap(
        seriesGenres
      )
    )
  ].sort();

  const countries = [
    ...new Set(
      DB.series.map(
        country
      )
    )
  ].sort();

  years.forEach(
    y =>
      fYear.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(
          y
        )}">${esc(
          y
        )}</option>`
      )
  );

  genres.forEach(
    g =>
      fGenre.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(
          g
        )}">${esc(
          g
        )}</option>`
      )
  );

  countries.forEach(
    c =>
      fCountry.insertAdjacentHTML(
        'beforeend',
        `<option value="${esc(
          c
        )}">${esc(
          c
        )}</option>`
      )
  );

  const apply = () => {
    let list = filtered;

    if (fType.value !== 'all') {
      list =
        list.filter(
          s =>
            contentTypeOf(
              s
            ) ===
            fType.value
        );
    }

    if (fYear.value !== 'all') {
      list =
        list.filter(
          s =>
            getYear(s) ===
            fYear.value
        );
    }

    if (fGenre.value !== 'all') {
      list =
        list.filter(
          s =>
            seriesGenres(
              s
            ).includes(
              fGenre.value
            )
        );
    }

    if (fCountry.value !== 'all') {
      list =
        list.filter(
          s =>
            country(
              s
            ) ===
            fCountry.value
        );
    }

    switch (fOrder.value) {
      case 'az':
        list =
          list.sort(
            (a, b) =>
              cleanTitle(
                a
              ).localeCompare(
                cleanTitle(
                  b
                ),
                'es'
              )
          );
        break;

      case 'episodes':
        list =
          list.sort(
            (a, b) =>
              seriesEpisodeCount(
                b
              ) -
              seriesEpisodeCount(
                a
              )
          );
        break;

      default:
        list =
          list.sort(
            (a, b) =>
              (
                b.updatedAt || ''
              ).localeCompare(
                a.updatedAt || ''
              )
          );
    }

    renderPagedGrid({
      container: catGrid,
      items: list,
      emptyText:
        'Sin resultados.'
    });
  };

  [
    fType,
    fYear,
    fGenre,
    fCountry,
    fOrder
  ].forEach(
    f =>
      f.addEventListener(
        'change',
        apply
      )
  );

  apply();

  console.log(
    'Catalog render:',
    Math.round(
      performance.now() - t
    ),
    'ms'
  );
}

function listMovies() {
  stopProgressiveGrid();

  const items =
    DB.series.filter(
      s =>
        (
          s.type || ''
        )
          .toLowerCase() ===
          'movie' ||
        (
          s.title || ''
        )
          .toLowerCase()
          .includes(
            'película'
          )
    );

  app.innerHTML = `
  <section class="section page-top">
    <div class="section-head">
      <h1>Películas</h1>
      <span class="muted">${items.length}</span>
    </div>
    <div class="grid" id="catGrid"></div>
  </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'catGrid'
      ),
    items
  });
}

function listAiring() {
  stopProgressiveGrid();

  const items =
    DB.series.filter(
      s =>
        (
          s.status || ''
        )
          .toLowerCase()
          .includes('emisión')
    );

  app.innerHTML = `
  <section class="section page-top">
    <div class="section-head">
      <h1>En emisión</h1>
      <span class="muted">${items.length}</span>
    </div>
    <div class="grid" id="catGrid"></div>
  </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'catGrid'
      ),
    items
  });
}

function listCompleted() {
  stopProgressiveGrid();

  const items =
    DB.series.filter(
      s =>
        (
          s.status || ''
        )
          .toLowerCase()
          .includes('finaliz')
    );

  app.innerHTML = `
  <section class="section page-top">
    <div class="section-head">
      <h1>Finalizadas</h1>
      <span class="muted">${items.length}</span>
    </div>
    <div class="grid" id="catGrid"></div>
  </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'catGrid'
      ),
    items
  });
}

function listGenres() {
  stopProgressiveGrid();

  const counts =
    DB.series.reduce(
      (acc, s) => {
        for (const g of seriesGenres(
          s
        )) {
          acc[g] =
            (acc[g] || 0) + 1;
        }
        return acc;
      },
      {}
    );

  const items =
    Object.entries(
      counts
    ).sort(
      (
        [a],
        [b]
      ) =>
        a.localeCompare(
          b
        )
    );

  app.innerHTML = `
  <section class="section page-top">
    <div class="section-head">
      <h1>Géneros</h1>
    </div>

    <div class="genres-grid">
      ${items
        .map(
          ([
            g,
            n
          ]) => `
        <a class="genre-card" href="#/genre/${qs(g)}">
          <span>${esc(g)}</span>
          <small class="muted">${n} títulos</small>
        </a>`
        )
        .join('')}
    </div>
  </section>`;
}

function listByGenre(g) {
  stopProgressiveGrid();

  const items =
    DB.series.filter(
      s =>
        seriesGenres(
          s
        ).includes(g)
    );

  app.innerHTML = `
  <section class="section page-top">
    <div class="section-head">
      <h1>${esc(g)}</h1>
      <span class="muted">${items.length}</span>
    </div>
    <div class="grid" id="catGrid"></div>
  </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'catGrid'
      ),
    items
  });
}

function myList() {
  stopProgressiveGrid();

  const favs = getFavs();

  const items =
    DB.series.filter(
      s =>
        favs.includes(
          s.id
        )
    );

  app.innerHTML = `
  <section class="section page-top">
    <div class="section-head">
      <h1>Mi lista</h1>
      <span class="muted">${items.length}</span>
    </div>
    <div class="grid" id="catGrid"></div>
  </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'catGrid'
      ),
    items,
    emptyText:
      'Tu lista está vacía. Agrega tus series favoritas.'
  });
}

/* ---------- BÚSQUEDA MULTI-CATÁLOGO ---------- */

let searchPool = [];

async function getSearchPool() {
  const list = [
    'donghualife',
    'donghuasub',
    'donghuaworld'
  ];

  if (
    !list.includes(
      currentCatalog
    )
  ) {
    list.push(
      currentCatalog
    );
  }

  const out = [];

  for (
    const id of list
  ) {
    const db =
      await ensureCatalog(
        id
      );

    for (const s of db.series) {
      s._cat = id;
    }

    out.push(...db.series);
  }

  return out;
}

function searchView() {
  stopProgressiveGrid();

  app.innerHTML = `
  <section class="section page-top">
    <div class="search-box">
      <span class="search-ico">${ICONS.search}</span>
      <input
        id="q"
        type="search"
        placeholder="Buscar título…"
        autocomplete="off"
      >
    </div>

    <div class="filters" id="searchFilters" style="display:none">
      <select id="sType">
        <option value="all">Todos los tipos</option>
        <option value="series">Series</option>
        <option value="movie">Películas</option>
      </select>

      <select id="sStatus">
        <option value="all">Cualquier estado</option>
        <option value="emision">En emisión</option>
        <option value="finalizada">Finalizada</option>
      </select>

      <select id="sGenre">
        <option value="all">Todos los géneros</option>
      </select>

      <select id="sOrder">
        <option value="best">Mejor resultado</option>
        <option value="recent">Más recientes</option>
        <option value="az">A → Z</option>
        <option value="episodes">Más episodios</option>
      </select>
    </div>

    <div class="grid" id="resGrid"></div>
  </section>`;

  const input =
    document.getElementById(
      'q'
    );

  const resGrid =
    document.getElementById(
      'resGrid'
    );

  const searchFilters =
    document.getElementById(
      'searchFilters'
    );

  const sType =
    document.getElementById(
      'sType'
    );

  const sStatus =
    document.getElementById(
      'sStatus'
    );

  const sGenre =
    document.getElementById(
      'sGenre'
    );

  const sOrder =
    document.getElementById(
      'sOrder'
    );

  let lastQ = '';

  const isAir =
    s =>
      (
        s.status || ''
      )
        .toLowerCase()
        .includes('emisión');

  const isDone =
    s =>
      (
        s.status || ''
      )
        .toLowerCase()
        .includes('finaliz');

  const filterSearch =
    list =>
      list.filter(
        s => {
          if (
            sType.value !==
              'all' &&
            contentTypeOf(
              s
            ) !==
              sType.value
          ) {
            return false;
          }

          if (
            sStatus.value ===
              'emision' &&
            !isAir(s)
          ) {
            return false;
          }

          if (
            sStatus.value ===
              'finalizada' &&
            !isDone(s)
          ) {
            return false;
          }

          if (
            sGenre.value !==
              'all' &&
            !seriesGenres(
              s
            ).includes(
              sGenre.value
            )
          ) {
            return false;
          }

          return true;
        }
      );

  const orderSearch =
    (list, q) => {
      const calc =
        s =>
          cleanTitle(
            s
          )
            .toLowerCase()
            .startsWith(
              q
            )
            ? 2
            : cleanTitle(
                s
              )
                .toLowerCase()
                .includes(
                  q
                )
            ? 1
            : 0;

      const scored =
        list.map(
          s => [
            s,
            calc(s)
          ]
        );

      switch (
        sOrder.value
      ) {
        case 'az':
          return scored
            .sort(
              (
                [a],
                [b]
              ) =>
                cleanTitle(
                  a
                ).localeCompare(
                  cleanTitle(
                    b
                  ),
                  'es'
                )
            )
            .map(
              ([
                s
              ]) => s
            );

        case 'recent':
          return scored
            .sort(
              (
                [a],
                [b]
              ) =>
                (
                  b.updatedAt ||
                  ''
                ).localeCompare(
                  a.updatedAt ||
                    ''
                )
            )
            .map(
              ([
                s
              ]) => s
            );

        case 'episodes':
          return scored
            .sort(
              (
                [a],
                [b]
              ) =>
                seriesEpisodeCount(
                  b
                ) -
                seriesEpisodeCount(
                  a
                )
            )
            .map(
              ([
                s
              ]) => s
            );

        default:
          return scored
            .sort(
              (
                [a, sa],
                [b, sb]
              ) =>
                sb - sa
            )
            .map(
              ([
                s
              ]) => s
            );
      }
    };

  const run =
    () => {
      const q =
        input.value
          .trim()
          .toLowerCase();

      if (!q) {
        lastQ = '';
        resGrid.innerHTML = '';
        searchFilters.style.display =
          'none';
        return;
      }

      if (q === lastQ) {
        render();
        return;
      }

      lastQ = q;

      searchFilters.style.display =
        'flex';

      const gf =
        fold(q);

      const list =
        searchPool
          .slice()
          .sort(
            () =>
              Math.random() -
              0.5
          )
          .filter(
            s =>
              fold(
                cleanTitle(
                  s
                )
              ).includes(
                gf
              )
          );

      const allGenres =
        [
          ...new Set(
            list.flatMap(
              seriesGenres
            )
          )
        ].sort();

      const current =
        sGenre.value;

      sGenre.innerHTML =
        `<option value="all">Todos los géneros</option>` +
        allGenres
          .map(
            g =>
              `<option value="${esc(
                g
              )}">${esc(
                g
              )}</option>`
          )
          .join('');

      if (
        allGenres.includes(
          current
        )
      ) {
        sGenre.value =
          current;
      }

      window.__lastSearch =
        list;
      render();
    };

  const render =
    () => {
      const q =
        input.value
          .trim()
          .toLowerCase();

      if (!q) {
        resGrid.innerHTML = '';
        return;
      }

      const base =
        window.__lastSearch ||
        [];

      const list =
        orderSearch(
          filterSearch(
            base
          ),
          q
        );

      renderProgressiveGrid({
        container: resGrid,
        items: list,
        emptyText:
          'Sin resultados.'
      });
    };

  [
    sType,
    sStatus,
    sGenre,
    sOrder
  ].forEach(
    f =>
      f.addEventListener(
        'change',
        render
      )
  );

  input.addEventListener(
    'input',
    run
  );

  input.focus();

  getSearchPool()
    .then(
      p => {
        searchPool =
          p;
        run();
      }
    )
    .catch(
      () => {}
    );
}

/* ---------- DETALLES BAJO DEMANDA ---------- */

async function ensureDetail(s, id) {
  if (!s) return s;

  /* Si ya trae temporadas/episodios, es detalle completo */
  if (
    Array.isArray(
      s.seasons
    ) &&
    s.seasons.length
  ) {
    return s;
  }

  const key =
    (id ||
      currentCatalog) +
    ':' +
    (s.slug || s.id);

  if (
    DETAIL_CACHE[key]
  ) {
    return DETAIL_CACHE[
      key
    ];
  }

  const base =
    DETAILS_BASE[
      id ||
      currentCatalog
    ];

  if (!base) return s;

  try {
    const r =
      await fetch(
        `${base}${s.slug || s.id}.json`,
        { cache: 'default' }
      );

    if (!r.ok) return s;

    const d =
      await r.json();

    s.seasons =
      d.seasons || [];
    s.episodes =
      d.episodes || [];
    s.synopsis =
      d.synopsis ||
      s.synopsis ||
      '';

    if (
      Array.isArray(
        d.episodes
      )
    ) {
      DB.episodes.push(
        ...d.episodes
      );
    }

    if (
      Array.isArray(
        d.seasons
      )
    ) {
      DB.seasons.push(
        ...d.seasons
      );
    }

    DETAIL_CACHE[
      key
    ] = s;

    return s;
  } catch {
    return s;
  }
}

async function openSeries(
  ref,
  catalogId
) {
  if (
    catalogId &&
    catalogId !==
      currentCatalog
  ) {
    try {
      const db =
        await ensureCatalog(
          catalogId
        );

      DB = db;

      currentCatalog =
        catalogId;

      localStorage.setItem(
        'donghuaflix_catalog',
        catalogId
      );

      renderCatBar();

      location.hash =
        '#/series/' +
        qs(ref);

      return;
    } catch (e) {}
  }

  const s =
    findSeries(ref);

  if (!s) {
    app.innerHTML =
      '<section class="section page-top"><h2>No encontrado</h2></section>';
    return;
  }

  app.innerHTML = `
  <section class="section page-top">
    <div class="grid">
      ${Array(8)
        .fill(
          '<div class="skeleton"></div>'
        )
        .join('')}
    </div>
  </section>`;

  const detailed =
    await ensureDetail(
      s,
      catalogId ||
        currentCatalog
    );

  renderSeriesDetail(
    detailed
  );
}

/* ---------- PÁGINA DE SERIE ---------- */

let detailState = {
  seriesId: null,
  seasonIdx: 0,
  epsPage: 0,
  per: 50
};

function renderSeriesDetail(
  s
) {
  const img =
    getSeriesImage(s);

  const progress =
    seriesProgress(s);

  const fav =
    isFav(s.id);

  detailState = {
    seriesId: s.id,
    seasonIdx: 0,
    epsPage: 0,
    per: 50
  };

  setAmbience(img);

  const seasons =
    orderSeasons(
      s,
      DB.seasons.filter(
        x => x.seriesId === s.id
      )
    );

  const totalEpisodes =
    seriesEpisodeCount(s);

  const watched =
    getWatched();

  let seen = 0;

  for (const seas of seasons) {
    const eps =
      DB.episodes.filter(
        e =>
          e.seasonId === seas.id
      );
    const w =
      watched[seas.id] || {};
    seen += eps.filter(
      e => w[e.number]
    ).length;
  }

  app.innerHTML = `
  <section class="detail" style="--bg:url('${esc(img)}')">
    <div class="detail-shade"></div>

    <div class="detail-top">
      <div class="detail-info">
        <h1>${esc(cleanTitle(s))}</h1>

        <div class="detail-meta">
          ${
            getYear(s)
              ? `<span class="chip">${esc(
                  getYear(s)
                )}</span>`
              : ''
          }
          ${
            s.status
              ? `<span class="chip">${esc(
                  s.status
                )}</span>`
              : ''
          }
          <span class="chip">
            ${totalEpisodes}
            episodios
          </span>
        </div>

        <p class="muted">
          ${
            s.synopsis ||
            'Sin descripción.'
          }
        </p>

        <div class="detail-btns">
          <button
            class="btn-x play"
            id="playBtn"
          >
            ${ICONS.play}
            <span>Ver ahora</span>
          </button>

          <button
            class="btn-x ${
              fav ? 'glass on' : 'glass'
            }"
            id="favBtn"
          >
            ${
              fav
                ? ICONS.check
                : ICONS.plus
            }
            <span>${
              fav
                ? 'En mi lista'
                : 'Mi lista'
            }</span>
          </button>
        </div>

        ${
          progress > 0
            ? `<div class="progress detail-progress">
              <span style="width:${progress}%"></span>
            </div>
            <small class="muted">${seen}/${totalEpisodes} episodios</small>`
            : ''
        }
      </div>
    </div>

    <div class="section detail-seasons">
      <div class="section-head">
        <h2>Temporadas</h2>
        <span class="muted">${seasons.length}</span>
      </div>

      <div class="season-chips" id="seasonChips"></div>

      <div class="section-head">
        <h2>Episodios</h2>
        <span class="muted" id="epsCount"></span>
      </div>

      <div class="eps" id="epsList"></div>

      <nav class="pager" id="epsPager"></nav>
    </div>
  </section>

  <section class="section">
    <div class="section-head">
      <h2>Recomendaciones</h2>
    </div>
    <div id="recGrid" class="grid"></div>
  </section>`;

  const playBtn =
    document.getElementById(
      'playBtn'
    );

  if (playBtn) {
    playBtn.onclick = () => {
      const h =
        getHistory()[s.id];

      const ep =
        h
          ? findEpisode(
              h.episodeId
            )
          : seasons.length
            ? dedupeEps(
                DB.episodes.filter(
                  e =>
                    e.seasonId ===
                    seasons[0].id
                )
              )[0]
            : null;

      if (ep) {
        location.hash =
          '#/episode/' +
          qs(
            ep.slug ||
              ep.id
          );
      } else {
        showToast(
          'No hay episodios disponibles'
        );
      }
    };
  }

  const favBtn =
    document.getElementById(
      'favBtn'
    );

  if (favBtn) {
    favBtn.onclick = () => {
      const f =
        toggleFav(
          s.id
        );

      favBtn.className =
        `btn-x ${
          f ? 'glass on' : 'glass'
        }`;

      favBtn.innerHTML =
        `${
          f ? ICONS.check : ICONS.plus
        }<span>${
          f ? 'En mi lista' : 'Mi lista'
        }</span>`;
    };
  }

  const chips =
    document.getElementById(
      'seasonChips'
    );

  seasons.forEach(
    (seas, i) => {
      const b =
        document.createElement(
          'button'
        );

      b.className =
        `pill ${
          i === 0 ? 'on' : ''
        }`;

      b.textContent =
        seasonTitle(
          seas,
          i
        );

      b.onclick = () => {
        detailState.seasonIdx =
          i;

        detailState.epsPage =
          0;

        chips
          .querySelectorAll(
            '.pill'
          )
          .forEach(
            p =>
              p.classList.remove(
                'on'
              )
          );

        b.classList.add(
          'on'
        );

        renderEpisodePage(
          seas
        );
      };

      chips.appendChild(
        b
      );
    }
  );

  if (seasons.length) {
    renderEpisodePage(
      seasons[0]
    );
  }

  renderProgressiveGrid({
    container:
      document.getElementById(
        'recGrid'
      ),
    items:
      getRecommendedSeries(
        s
      ),
    emptyText:
      'Sin recomendaciones.'
  });
}

function renderEpisodePage(
  season
) {
  const list =
    document.getElementById(
      'epsList'
    );

  if (!list) return;

  const all =
    dedupeEps(
      DB.episodes.filter(
        e =>
          e.seasonId ===
          season.id
      )
    );

  document.getElementById(
    'epsCount'
  ).textContent =
    all.length;

  const pages =
    Math.ceil(
      all.length /
        detailState.per
    );

  const page =
    Math.min(
      detailState.epsPage,
      pages - 1
    );

  const start =
    page *
    detailState.per;

  const slice =
    all.slice(
      start,
      start +
        detailState.per
    );

  list.innerHTML =
    slice
      .map(
        e => `
      <div class="ep-row ${
        isWatched(
          season.id,
          e.number
        )
          ? 'seen'
          : ''
      }">
        <span class="num">
          ${e.number}
        </span>

        <div class="ep-main">
          <span class="ep-title">
            ${esc(
              cleanEpisodeTitle(
                e
              )
            )}
          </span>
        </div>

        <button
          class="ep-check ${
            isWatched(
              season.id,
              e.number
            )
              ? 'on'
              : ''
          }"
          title="Marcar visto"
          onclick="toggleWatched('${
            season.id
          }',${
    e.number
  })"
        >
          ${ICONS.check}
        </button>

        <a
          class="ep-play"
          href="#/episode/${qs(
            e.slug ||
              e.id
          )}"
        >
          ${ICONS.play}
        </a>
      </div>`
      )
      .join('');

  const pager =
    document.getElementById(
      'epsPager'
    );

  if (pages > 1) {
    const win =
      [];

    const from =
      Math.max(
        0,
        Math.min(
          page - 2,
          pages - 5
        )
      );

    for (
      let i = from;
      i <
      Math.min(
        pages,
        from + 5
      );
      i++
    ) {
      win.push(i);
    }

    pager.innerHTML = `
      <button class="pg-btn" data-go="${page - 1}" ${page === 0 ? 'disabled' : ''}>‹</button>
      ${win
        .map(
          i =>
            `<button class="pg-btn ${i === page ? 'on' : ''}" data-go="${i}">${i + 1}</button>`
        )
        .join('')}
      <button class="pg-btn" data-go="${page + 1}" ${page >= pages - 1 ? 'disabled' : ''}>›</button>
      <span class="pg-info">Página ${page + 1} de ${pages}</span>`;

    pager
      .querySelectorAll(
        '.pg-btn'
      )
      .forEach(
        b => {
          b.onclick = () => {
            const go =
              Number(
                b.dataset.go
              );

            if (
              isNaN(
                go
              ) ||
              go < 0 ||
              go >=
                pages ||
              go ===
                page
            ) {
              return;
            }

            detailState.epsPage =
              go;

            renderEpisodePage(
              season
            );

            list.scrollIntoView(
              {
                behavior:
                  'smooth',
                block:
                  'start'
              }
            );
          };
        }
      );
  } else {
    pager.innerHTML = '';
  }
}

/* ---------- PÁGINA DE EPISODIO ---------- */

function episode(ref) {
  const e =
    findEpisode(ref);

  if (!e) {
    app.innerHTML = `
    <section class="empty page-top">
      <h2>Episodio no disponible</h2>
      <button class="btn-x glass" onclick="location.hash='#/'">Volver</button>
    </section>`;

    return;
  }

  const s =
    findSeries(
      e.seriesId
    );

  if (!s) return;

  const season =
    DB.seasons.find(
      x => x.id === e.seasonId
    );

  const seasonEps =
    dedupeEps(
      DB.episodes.filter(
        x =>
          x.seasonId ===
          e.seasonId
      )
    );

  const idx =
    seasonEps.findIndex(
      x => x.id === e.id
    );

  const prev =
    seasonEps[idx - 1];

  const next =
    seasonEps[idx + 1];

  const sn =
    season &&
    Number.isFinite(
      season.number
    )
      ? season.number
      : 1;

  const img =
    getSeriesImage(s);

  currentEpisode = e;

  setAmbience(img);

  markWatchedSingle(
    e.seasonId,
    e.number
  );

  saveHistory(
    s.id,
    e
  );

  const langs = {};

  (
    e.servers ||
    []
  ).forEach((srv, i) => {
    const lang =
      srv.lang ||
      'subtitulado';

    if (
      !langs[lang]
    ) {
      langs[lang] =
        [];
    }

    langs[lang].push({
      ...srv,
      idx
    });
  });

  let currentLang =
    Object.keys(
      langs
    )[0] ||
    '';

  const groupsHTML =
    Object.keys(
      langs
    )
      .map(
        lang => `
      <div class="server-group">
        <div class="group-title">
          ${
            lang ===
            'latino'
              ? '🇲🇽 Audio Latino'
              : lang ===
                'castellano'
                ? '🇪🇸 Castellano'
                : '🌐 Subtitulado'
          }
        </div>

        <div class="servers">
          ${
            langs[lang]
              .map(
                (
                  srv,
                  i
                ) => `
              <button
                class="srv-btn"
                data-lang="${esc(lang)}"
                data-idx="${srv.idx}"
              >
                Opción ${i + 1}
              </button>`
              )
              .join('')
          }
        </div>
      </div>`
      )
      .join('');

  app.innerHTML = `
  <section
    class="section page-top watch"
    style="--bg:url('${esc(img)}')"
  >
    <div class="player">
      <div
        class="player-shell"
        id="playerShell"
      >
        <iframe
          id="playerFrame"
          class="player-frame"
          src=""
          frameborder="0"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowfullscreen
        ></iframe>
      </div>

      <div class="player-bar">
        <a
          class="btn-mini ${
            prev ? '' : 'off'
          }"
          href="${
            prev
              ? '#/episode/' + qs(prev.slug || prev.id)
              : '#'
          }"
          ${
            prev
              ? ''
              : 'onclick="return false"'
          }
        >
          ${ICONS.prev}
          <span>Anterior</span>
        </a>

        <button
          class="btn-mini"
          id="autoNextBtn"
          onclick="toggleAutoNext()"
        >
          ${ICONS.repeat}
          <span>
            Auto: ${
              autoNextEnabled
                ? 'ON'
                : 'OFF'
            }
          </span>
        </button>

        <button
          class="btn-mini"
          onclick="togglePlayerFS()"
        >
          ${ICONS.full}
          <span>
            Pantalla completa
          </span>
        </button>

        <a
          class="btn-mini ${
            next ? '' : 'off'
          }"
          href="${
            next
              ? '#/episode/' + qs(next.slug || next.id)
              : '#'
          }"
          ${
            next
              ? ''
              : 'onclick="return false"'
          }
        >
          ${ICONS.next}
          <span>Siguiente</span>
        </a>
      </div>
    </div>

    <div class="watch-info">
      <h1>
        ${esc(cleanTitle(s))}
      </h1>

      <div class="detail-meta">
        <span class="chip">
          Temporada ${sn}
        </span>

        <span class="chip">
          Episodio ${e.number}
        </span>
      </div>

      <h2 class="ep-name">
        ${esc(
          cleanEpisodeTitle(
            e
          )
        )}
      </h2>
    </div>

    <div class="servers-wrap">
      <div class="section-head">
        <h2>Servidores</h2>
      </div>

      ${groupsHTML}
    </div>

    <section class="section" style="padding:0">
      <div class="section-head">
        <h2>
          También te puede gustar
        </h2>
      </div>

      <div
        id="recGrid"
        class="grid"
      ></div>
    </section>
  </section>`;

  const frame =
    document.getElementById(
      'playerFrame'
    );

  const shell =
    document.getElementById(
      'playerShell'
    );

  const playAt =
    srv =>
      frame.src =
        (
          srv.embed ||
          srv.url ||
          ''
        )
          .replace(
            /(\?|&)autoplay=?\d*/i,
            '$1'
          ) +
        (/\?/.test(
          srv.embed ||
          srv.url ||
          ''
        )
          ? '&'
          : '?') +
        'autoplay=1';

  document
    .querySelectorAll(
      '.srv-btn'
    )
    .forEach(
      b => {
        b.onclick = () => {
          const srv =
            (
              e.servers ||
              []
            )[
              Number(
                b.dataset.idx
              )
            ];

          document
            .querySelectorAll(
              '.srv-btn'
            )
            .forEach(
              x =>
                x.classList.remove(
                  'on'
                )
            );

          b.classList.add(
            'on'
          );

          playAt(
            srv
          );
        };
      }
    );

  const first =
    (
      e.servers ||
      []
    )[0];

  if (first) {
    document
      .querySelector(
        '.srv-btn'
      )
      ?.classList.add(
        'on'
      );

    playAt(
      first
    );
  }

  renderProgressiveGrid({
    container:
      document.getElementById(
        'recGrid'
      ),
    items:
      getRecommendedSeries(
        s
      ),
    emptyText:
      'Sin recomendaciones.'
  });
}

/* ---------- ROUTER ---------- */

function route() {
  const raw =
    location.hash.slice(
      2
    );

  const [
    page,
    ...rest
  ] =
    raw.split(
      '/'
    );

  stopProgressiveGrid();

  document
    .querySelectorAll(
      '[data-nav]'
    )
    .forEach(
      a => {
        a.classList.remove(
          'on'
        );
      }
    );

  const mark =
    href => {
      document
        .querySelectorAll(
          `[data-nav][href="${href}"]`
        )
        .forEach(
          a =>
            a.classList.add(
              'on'
            )
        );
    };

  if (!page) {
    mark('#/');

    home();

  } else if (
    page === 'series' &&
    rest[0]
  ) {
    mark('#/series');

    openSeries(
      decodeURIComponent(
        rest[0]
      ),
      decodeURIComponent(
        rest[1] || ''
      )
    );

  } else if (
    page === 'series'
  ) {
    mark('#/series');

    listAllSeries();

  } else if (
    page === 'movies'
  ) {
    mark('#/movies');

    listMovies();

  } else if (
    page === 'airing'
  ) {
    mark('#/airing');

    listAiring();

  } else if (
    page === 'completed'
  ) {
    mark('#/completed');

    listCompleted();

  } else if (
    page === 'genres'
  ) {
    mark('#/genres');

    listGenres();

  } else if (
    page === 'genre' &&
    rest[0]
  ) {
    mark('#/genres');

    listByGenre(
      decodeURIComponent(
        rest[0]
      )
    );

  } else if (
    page === 'mylist'
  ) {
    mark('#/mylist');

    myList();

  } else if (
    page === 'search'
  ) {
    mark('#/search');

    searchView();

  } else if (
    page === 'episode' &&
    rest[0]
  ) {
    episode(
      decodeURIComponent(
        rest[0]
      )
    );

  } else {
    home();
  }

  window.scrollTo(
    0,
    0
  );

  document
    .getElementById(
      'moreMenu'
    )
    ?.classList.remove(
      'open'
    );

  document
    .getElementById(
      'catalogMenu'
    )
    ?.classList.remove(
      'open'
    );
}

/* ---------- EVENTOS GLOBALES ---------- */

window.addEventListener(
  'hashchange',
  route
);

document
  .getElementById(
    'reloadBtn'
  )
  ?.addEventListener(
    'click',
    async e => {
      e.preventDefault();

      const btn =
        e.currentTarget;

      btn.classList.add(
        'spin'
      );

      DB_CACHE = {};
      DETAIL_CACHE = {};

      await load();

      btn.classList.remove(
        'spin'
      );
    }
  );

document
  .getElementById(
    'toTop'
  )
  ?.addEventListener(
    'click',
    () =>
      window.scrollTo(
        {
          top: 0,
          behavior:
            'smooth'
        }
      )
  );

window.addEventListener(
  'scroll',
  () => {
    document
      .getElementById(
        'toTop'
      )
      ?.classList.toggle(
        'show',
        window.scrollY >
          600
      );
  },
  {
    passive: true
  }
);

document.addEventListener(
  'click',
  e => {
    if (
      !e.target.closest(
        '.more-menu'
      ) &&
      !e.target.closest(
        '[onclick="toggleMoreMenu()"]'
      )
    ) {
      document
        .getElementById(
          'moreMenu'
        )
        ?.classList.remove(
          'open'
        );
    }
  }
);

window.addEventListener(
  'error',
  e => {
    console.error(
      'Error global:',
      e.message
    );
  }
);

window.addEventListener(
  'unhandledrejection',
  e => {
    console.error(
      'Promesa rechazada:',
      e.reason
    );
  }
);

/* ARRANQUE */

document.addEventListener(
  'DOMContentLoaded',
  () => {
    if (
      'serviceWorker' in
      navigator
    ) {
      navigator.serviceWorker
        .register(
          'sw.js'
        )
        .catch(
          () => {}
        );
    }
  }
);

/* =========================================================
   CONTRATO GLOBAL — expone el estado interno a las capas Pro
   (dfx-core.js / dfx-polish.js / firebase-sync.js lo leen
   desde window; let/const no llegan al global por sí solos)
   ========================================================= */
const __expose = (k, get, set) => {
  try {
    Object.defineProperty(window, k, { configurable: true, get, set });
  } catch (e) {}
};

__expose('DB', () => DB);
__expose('DB_CACHE', () => DB_CACHE);
__expose('currentEpisode', () => currentEpisode);
__expose('detailState', () => detailState);

/* autoNextEnabled necesita setter: los ajustes Pro escriben
   window.autoNextEnabled y antes no surtía efecto en caliente */
__expose('autoNextEnabled', () => autoNextEnabled, v => {
  autoNextEnabled = !!v;
  localStorage.setItem('donghuaflix_autonext', autoNextEnabled ? 'on' : 'off');
  const b = document.getElementById('autoNextBtn');
  if (b) b.innerHTML = `${ICONS.repeat}<span>Auto: ${autoNextEnabled ? 'ON' : 'OFF'}</span>`;
});

__expose('SRC_LABEL', () => SRC_LABEL);
__expose('ICONS', () => ICONS);
__expose('esc', () => esc);
__expose('qs', () => qs);
__expose('fold', () => fold);
__expose('getYear', () => getYear);
__expose('getCountry', () => getCountry);
__expose('contentTypeOf', () => contentTypeOf);
__expose('cleanTitle', () => cleanTitle);
__expose('cleanEpisodeTitle', () => cleanEpisodeTitle);
__expose('getSeriesImage', () => getSeriesImage);
__expose('findSeries', () => findSeries);
__expose('findEpisode', () => findEpisode);
__expose('seriesGenres', () => seriesGenres);
__expose('isFav', () => isFav);
__expose('lastWatchedEpisode', () => lastWatchedEpisode);
__expose('getRecommendedSeries', () => getRecommendedSeries);

load();
