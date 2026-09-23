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
    container.innerHTML = emptyStateHTML(emptyText);
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
    container.innerHTML = emptyStateHTML(emptyText);
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
  )}">
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

/* ---------- LISTADOS ---------- */

function listAllSeries() {
  const genres =
    [
      ...new Set(
        DB.series.flatMap(
          seriesGenres
        )
      )
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          'es'
        )
    );

  const years =
    [
      ...new Set(
        DB.series
          .map(getYear)
          .filter(Boolean)
      )
    ]
      .sort()
      .reverse();

  const countries =
    [
      ...new Set(
        DB.series
          .map(getCountry)
          .filter(Boolean)
      )
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          'es'
        )
    );

  const state = {
    type: '',
    genre: '',
    year: '',
    country: '',
    sort: 'recent'
  };

  const applyFilters = () => {
    let list =
      DB.series.slice();

    if (state.type) {
      list =
        list.filter(
          s =>
            contentTypeOf(
              s
            ) === state.type
        );
    }

    if (state.genre) {
      list =
        list.filter(
          s =>
            seriesGenres(
              s
            ).some(
              g =>
                fold(g) ===
                fold(
                  state.genre
                )
            )
        );
    }

    if (state.year) {
      list =
        list.filter(
          s =>
            String(
              getYear(s)
            ) ===
            state.year
        );
    }

    if (state.country) {
      list =
        list.filter(
          s =>
            fold(
              getCountry(s)
            ) ===
            fold(
              state.country
            )
        );
    }

    if (
      state.sort ===
      'az'
    ) {
      list.sort(
        (a, b) =>
          cleanTitle(
            a
          ).localeCompare(
            cleanTitle(b),
            'es'
          )
      );
    } else {
      list.sort(
        (a, b) =>
          (
            b.updatedAt || ''
          ).localeCompare(
            a.updatedAt || ''
          )
      );
    }

    return list;
  };

  const renderGrid = () => {
    const el =
      document.getElementById(
        'catalogGrid'
      );

    const count =
      document.getElementById(
        'catalogCount'
      );

    const list =
      applyFilters();

    if (count) {
      count.textContent =
        list.length;
    }

    if (el) {
      renderPagedGrid({
        container: el,
        items: list,
        emptyText:
          'Nada coincide con esos filtros.'
      });
    }
  };

  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">
        <h2>Catálogo completo</h2>
        <span
          class="muted"
          id="catalogCount"
        >${DB.series.length}</span>
      </div>

      <div class="filters">

        <select id="fType">
          <option value="">
            Clasificación
          </option>

          <option
            value="movie"
            ${
              state.type ===
              'movie'
                ? 'selected'
                : ''
            }
          >
            Películas
          </option>

          <option
            value="series"
            ${
              state.type ===
              'series'
                ? 'selected'
                : ''
            }
          >
            Series
          </option>
        </select>

        ${
          genres.length
            ? `<select id="fGenre">
                <option value="">
                  Género
                </option>

                ${genres
                  .map(
                    g =>
                      `<option>${esc(
                        g
                      )}</option>`
                  )
                  .join('')}
              </select>`
            : ''
        }

        ${
          years.length
            ? `<select id="fYear">
                <option value="">
                  Año
                </option>

                ${years
                  .map(
                    y =>
                      `<option>${y}</option>`
                  )
                  .join('')}
              </select>`
            : ''
        }

        ${
          countries.length
            ? `<select id="fCountry">
                <option value="">
                  País
                </option>

                ${countries
                  .map(
                    c =>
                      `<option>${esc(
                        c
                      )}</option>`
                  )
                  .join('')}
              </select>`
            : ''
        }

        <select id="fSort">
          <option value="recent">
            Más recientes
          </option>

          <option value="az">
            A – Z
          </option>
        </select>

      </div>

      <div
        class="grid"
        id="catalogGrid"
      ></div>

    </section>`;

  const bind = (
    id,
    key
  ) => {
    const el =
      document.getElementById(
        id
      );

    if (el) {
      el.onchange = () => {
        state[key] =
          el.value;

        renderGrid();
      };
    }
  };

  bind(
    'fType',
    'type'
  );

  bind(
    'fGenre',
    'genre'
  );

  bind(
    'fYear',
    'year'
  );

  bind(
    'fCountry',
    'country'
  );

  bind(
    'fSort',
    'sort'
  );

  /* Primer lote */
  renderGrid();
}

function listByStatus(
  statusKeyword,
  titleText
) {
  const filtered =
    DB.series.filter(
      s =>
        (
          s.status || ''
        )
          .toLowerCase()
          .includes(
            statusKeyword.toLowerCase()
          )
    );

  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">
        <h2>${titleText}</h2>
        <span class="muted">
          ${filtered.length}
        </span>
      </div>

      <div
        class="grid"
        id="statusGrid"
      ></div>

    </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'statusGrid'
      ),
    items: filtered,
    emptyText:
      'No hay elementos en esta categoría.'
  });
}

function listMovies() {
  const movies =
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
        <h2>Películas</h2>
        <span class="muted">
          ${movies.length}
        </span>
      </div>

      <div
        class="grid"
        id="moviesGrid"
      ></div>

    </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'moviesGrid'
      ),
    items: movies,
    emptyText:
      'No hay películas disponibles por el momento.'
  });
}

function listGenres() {
  const genres =
    (DB.genres || [])
      .map(
        g =>
          g.name || g
      );

  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">
        <h2>Géneros</h2>
        <span class="muted">
          ${genres.length}
        </span>
      </div>

      ${
        genres.length
          ? `<div class="chips">
              ${genres
                .map(
                  g =>
                    `<a
                      class="chip"
                      href="#/genre/${qs(
                        g
                      )}"
                    >
                      ${esc(g)}
                    </a>`
                )
                .join('')}
            </div>`
          : '<p class="muted">Géneros no disponibles en el catálogo.</p>'
      }

    </section>`;
}

function listByGenre(name) {
  const n =
    name.toLowerCase();

  const filtered =
    DB.series.filter(
      s =>
        seriesGenres(
          s
        ).some(
          g =>
            g.toLowerCase() ===
            n
        )
    );

  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">
        <h2>${esc(name)}</h2>
        <span class="muted">
          ${filtered.length}
        </span>
      </div>

      <div
        class="grid"
        id="genreGrid"
      ></div>

    </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'genreGrid'
      ),
    items: filtered,
    emptyText:
      'No hay series en este género.'
  });
}

function listMyList() {
  const favs =
    getFavs();

  const filtered =
    DB.series.filter(
      s =>
        favs.includes(
          s.id
        )
    );

  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">
        <h2>Mi lista</h2>
        <span class="muted">
          ${filtered.length}
        </span>
      </div>

      <div
        class="grid"
        id="myListGrid"
      ></div>

    </section>`;

  renderPagedGrid({
    container:
      document.getElementById(
        'myListGrid'
      ),
    items: filtered,
    emptyText:
      '<strong>Aún no tienes favoritos.</strong><br>' +
      'Toca el corazón de cualquier serie para añadirla.<br>' +
      '<a class="btn-x glass" style="margin-top:14px" href="#/series">Explorar contenido</a>'
  });
}

/* ---------- BUSCADOR ---------- */

let searchState = {
  genre: '',
  year: '',
  country: '',
  pool: null
};

function search(q = '') {
  if (
    !document.getElementById(
      'q'
    )
  ) {
    searchState = {
      genre: '',
      year: '',
      country: '',
      pool: null
    };

    const genres =
      [
        ...new Set(
          DB.series.flatMap(
            seriesGenres
          )
        )
      ].sort(
        (a, b) =>
          a.localeCompare(
            b,
            'es'
          )
      );

    const years =
      [
        ...new Set(
          DB.series
            .map(getYear)
            .filter(Boolean)
        )
      ]
        .sort()
        .reverse();

    const countries =
      [
        ...new Set(
          DB.series
            .map(getCountry)
            .filter(Boolean)
        )
      ].sort(
        (a, b) =>
          a.localeCompare(
            b,
            'es'
          )
      );

    app.innerHTML = `
      <section class="search page-top">

        <h1>Buscar</h1>

        <div class="searchbar">
          ${ICONS.search}

          <input
            id="q"
            type="text"
            value="${esc(q)}"
            autocomplete="off"
            placeholder="Nombre..."
          >
        </div>

        <div class="filters">

          ${
            genres.length
              ? `<select id="sfGenre">
                  <option value="">
                    Género
                  </option>

                  ${genres
                    .map(
                      g =>
                        `<option>${esc(
                          g
                        )}</option>`
                    )
                    .join('')}
                </select>`
              : ''
          }

          ${
            years.length
              ? `<select id="sfYear">
                  <option value="">
                    Año
                  </option>

                  ${years
                    .map(
                      y =>
                        `<option>${y}</option>`
                    )
                    .join('')}
                </select>`
              : ''
          }

          ${
            countries.length
              ? `<select id="sfCountry">
                  <option value="">
                    País
                  </option>

                  ${countries
                    .map(
                      c =>
                        `<option>${esc(
                          c
                        )}</option>`
                    )
                    .join('')}
                </select>`
              : ''
          }

        </div>

        <div
          id="results"
          class="grid"
        ></div>

      </section>`;

    const bindF = (
      id,
      key
    ) => {
      const el =
        document.getElementById(
          id
        );

      if (el) {
        el.onchange = () => {
          searchState[key] =
            el.value;

          updateSearchResults(
            document.getElementById(
              'q'
            ).value
          );
        };
      }
    };

    bindF(
      'sfGenre',
      'genre'
    );

    bindF(
      'sfYear',
      'year'
    );

    bindF(
      'sfCountry',
      'country'
    );

    const input =
      document.getElementById(
        'q'
      );

    input.addEventListener(
      'input',
      e =>
        updateSearchResults(
          e.target.value
        )
    );

    setTimeout(() => {
      input.focus();

      input.setSelectionRange(
        input.value.length,
        input.value.length
      );
    }, 50);
  }

  updateSearchResults(q);
}

async function updateSearchResults(
  q = ''
) {
  if (!searchState.pool) {
    searchState.pool = await getSearchPool();
  }
  const container =
    document.getElementById(
      'results'
    );

  if (!container) return;

  const query =
    q.trim().toLowerCase();

  if (!query) {
    stopProgressiveGrid();

    container.innerHTML =
      '<p class="muted" style="grid-column:1/-1">Escribe para ver sugerencias...</p>';

    return;
  }

  let list =
    (searchState.pool || DB.series).filter(
      s => {
        const title =
          cleanTitle(
            s
          ).toLowerCase();

        return (
          title.startsWith(
            query
          ) ||
          title
            .split(' ')
            .some(
              w =>
                w.startsWith(
                  query
                )
            ) ||
          title.includes(
            query
          )
        );
      }
    );

  if (searchState.genre) {
    list =
      list.filter(
        s =>
          seriesGenres(
            s
          ).some(
            g =>
              fold(g) ===
              fold(
                searchState.genre
              )
          )
      );
  }

  if (searchState.year) {
    list =
      list.filter(
        s =>
          String(
            getYear(s)
          ) ===
          searchState.year
      );
  }

  if (searchState.country) {
    list =
      list.filter(
        s =>
          fold(
            getCountry(s)
          ) ===
          fold(
            searchState.country
          )
      );
  }

  renderProgressiveGrid({
    container,
    items: list,
    emptyText:
      'No se encontraron donghuas con ese nombre.<br>' +
      '<a class="btn-x glass" style="margin-top:14px" href="#/series">Ver catálogo completo</a>'
  });

  /* Cada resultado abre su catálogo de origen */
  const cardsEl =
    container.querySelectorAll(
      '.card'
    );
  list.forEach((s, i) => {
    const el = cardsEl[i];
    if (el) {
      el.onclick = () =>
        openSeries(s);
    }
  });
}

/* Búsqueda conjunta: los 3 catálogos de donghua a la vez
   (más el catálogo activo si es otro). Cada resultado lleva
   _cat = su catálogo de origen. */
async function getSearchPool() {
  const pool = [];

  for (const id of DONGHUA_CATS) {
    try {
      const d =
        await ensureCatalog(id);
      CATALOG_AVAILABLE[id] = true;
      for (const s of d.series || []) {
        pool.push({
          ...s,
          _cat: id
        });
      }
    } catch {}
  }

  if (
    !DONGHUA_CATS.includes(
      currentCatalog
    )
  ) {
    try {
      const d =
        await ensureCatalog(
          currentCatalog
        );
      for (const s of d.series || []) {
        pool.push({
          ...s,
          _cat: currentCatalog
        });
      }
    } catch {}
  }

  renderCatBar();
  return pool;
}

/* Abre una serie cambiando antes a su catálogo si hace falta */
async function openSeries(s) {
  if (
    s._cat &&
    s._cat !== currentCatalog
  ) {
    try {
      DB =
        await ensureCatalog(s._cat);
      currentCatalog = s._cat;
      localStorage.setItem(
        'donghuaflix_catalog',
        s._cat
      );
      setAmbience('');
      renderCatBar();
    } catch {
      showToast(
        'Catálogo no disponible todavía'
      );
      return;
    }
  }

  location.hash =
    '#/series/' +
    qs(s.slug || s.id);
}

/* Descarga la ficha completa de UN título (sinopsis + temporadas + servidores) */
async function ensureDetail(slug) {
  if (!DB.lite) return;                         // catálogo completo: nada que pedir
  const key = String(slug || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  const dir = DETAILS_BASE[currentCatalog];
  if (!key || !dir) return;

  const cacheKey = currentCatalog + '/' + key;
  if (DETAIL_CACHE[cacheKey]) return;

  try {
    const d = await fetchCatalogFile(`${dir}/${key}.json`);
    if (!d || !d.series) return;

    const i = DB.series.findIndex(s => (s.slug || s.id) === (d.series.slug || d.series.id));
    if (i !== -1) DB.series[i] = { ...DB.series[i], ...d.series };
    else DB.series.push(d.series);

    const have = new Set(DB.seasons.map(x => x.id));
    (d.seasons || []).forEach(x => { if (!have.has(x.id)) DB.seasons.push(x); });

    const haveEp = new Set(DB.episodes.map(x => x.id));
    (d.episodes || []).forEach(x => { if (!haveEp.has(x.id)) DB.episodes.push(x); });

    DETAIL_CACHE[cacheKey] = true;
  } catch (e) {
    console.warn('No se pudo cargar la ficha', slug, e);
  }
}

/* ---------- DETALLE DE SERIE ---------- */

let detailState = {
  seriesId: null,
  seasonIdx: 0,
  page: null
};

const EPS_PER_PAGE = 50;

async function detail(slug, seasonRef) {
  await ensureDetail(slug);
  return detailSync(slug, seasonRef);
}

function detailSync(
  slug,
  seasonRef
) {
  const s =
    findSeries(slug);

  if (!s) {
    return notfound();
  }

  const seasons =
    orderSeasons(
      s,
      DB.seasons.filter(
        x =>
          x.seriesId ===
          s.id
      )
    );

  if (
    detailState.seriesId !==
    s.id
  ) {
    detailState = {
      seriesId: s.id,
      seasonIdx: 0,
      page: null
    };
  }

  if (seasonRef) {
    const i =
      seasons.findIndex(
        x =>
          (x.slug ||
            x.id) ===
            seasonRef ||
          String(
            x.number
          ) ===
            String(
              seasonRef
            )
      );

    if (i !== -1) {
      detailState.seasonIdx =
        i;

      detailState.page =
        null;
    }
  }

  const imgUrl =
    getSeriesImage(s);

  const title =
    cleanTitle(s);

  const genres =
    seriesGenres(s);

  const fav =
    isFav(s.id);

  const epsTotal =
    seriesEpisodeCount(
      s
    );

  const lastEp =
    lastWatchedEpisode(
      s
    );

  const lastSeason =
    lastEp
      ? DB.seasons.find(
          x =>
            x.id ===
            lastEp.seasonId
        )
      : null;

  const lastSn =
    lastSeason &&
    Number.isFinite(
      lastSeason.number
    )
      ? lastSeason.number
      : 1;

  const singleSeason =
    seasons.length === 1
      ? seasons[0]
      : null;

  const singleEps =
    singleSeason
      ? dedupeEps(
          DB.episodes.filter(
            e =>
              e.seasonId ===
              singleSeason.id
          )
        )
      : [];

  const allEpsCount =
    DB.episodes.filter(
      e =>
        e.seriesId ===
        s.id
    ).length;

  const isMovieEntry =
    s.contentType ===
      'movie' ||
    (s.sourceUrl || '')
      .includes(
        '/peliculas/'
      ) ||
    allEpsCount === 1;

  setAmbience(imgUrl);

  app.innerHTML = `
  <section class="detail-v2">

    <div
      class="detail-hero"
      style="--dhero:url('${esc(
        imgUrl
      )}')"
    >

      <button
        class="detail-close"
        onclick="location.hash='#/series'"
        title="Cerrar"
      >
        ${ICONS.close}
      </button>

      <div class="detail-hero-shade"></div>

      <div class="detail-hero-c">

        <div class="eyebrow">
          ${esc(
            s.status || ''
          )}
        </div>

        <h1>
          ${esc(title)}
        </h1>

        <div class="detail-meta">

          ${
            isMovieEntry
              ? `<span class="movie-tag">PELÍCULA</span> ·`
              : ''
          }

          ${
            s.year
              ? `<span>${s.year}</span> ·`
              : ''
          }

          ${
            s.country
              ? `<span>${esc(
                  s.country
                )}</span> ·`
              : ''
          }

          ${
            !isMovieEntry
              ? `<span>${seasons.length} temporada${
                  seasons.length ===
                  1
                    ? ''
                    : 's'
                }</span> ·
                <span>${epsTotal} episodios</span>`
              : ''
          }

          ${
            genres.length
              ? ' · <span>' +
                esc(
                  genres
                    .slice(
                      0,
                      3
                    )
                    .join(' · ')
                ) +
                '</span>'
              : ''
          }

        </div>

        <div class="detail-actions">

          ${
            lastEp
              ? `<button class="btn-x play big" onclick="location.hash='#/episode/${qs(
                  lastEp.slug ||
                    lastEp.id
                )}'">
                  ${ICONS.play}
                  <span>${
                    isMovieEntry
                      ? 'Reproducir'
                      : `Reproducir${
                          lastEp.number >
                          1
                            ? ` · T${lastSn}:E${lastEp.number}`
                            : ''
                        }`
                  }</span>
                </button>`
              : ''
          }

          <button
            class="btn-x glass round"
            id="favBtn"
            title="Mi lista"
          >
            ${
              fav
                ? ICONS.check
                : ICONS.plus
            }
          </button>

        </div>

      </div>
    </div>

    <div class="detail-body">

      ${
        genres.length
          ? `<div class="chips">
              ${genres
                .map(
                  g =>
                    `<a class="chip" href="#/genre/${qs(
                      g
                    )}">
                      ${esc(g)}
                    </a>`
                )
                .join('')}
            </div>`
          : ''
      }

      <p class="detail-syn">
        ${esc(
          s.synopsis ||
            'Sinopsis no disponible.'
        )}
      </p>

      ${
        isMovieEntry
          ? `
            <div class="movie-cta">
              <button
                class="btn-x play big"
                onclick="location.hash='#/episode/${qs(
                  singleEps[0]?.slug ||
                  singleEps[0]?.id ||
                  ''
                )}'"
              >
                ${ICONS.play}
                <span>▶ Reproducir ahora</span>
              </button>
            </div>
          `
          : '<div id="seasonArea"></div>'
      }

    </div>

  </section>`;

  document.getElementById(
    'favBtn'
  ).onclick = () => {
    const f =
      toggleFav(s.id);

    document.getElementById(
      'favBtn'
    ).innerHTML =
      f
        ? ICONS.check
        : ICONS.plus;
  };

  if (!isMovieEntry) {
    renderSeasonArea(
      seasons
    );
  }
}

function renderSeasonArea(
  seasons
) {
  const area =
    document.getElementById(
      'seasonArea'
    );

  if (!area) return;

  if (!seasons.length) {
    area.innerHTML =
      '<div class="empty">No hay episodios disponibles.</div>';

    return;
  }

  area.innerHTML = `
    <div class="season-picker">

      <select
        id="seasonSelect"
        onchange="selectSeason(this.value)"
      >

        ${seasons
          .map(
            (season, i) => {
              const count =
                dedupeEps(
                  DB.episodes.filter(
                    e =>
                      e.seasonId ===
                      season.id
                  )
                ).length;

              return `<option
                value="${i}"
                ${
                  i ===
                  detailState.seasonIdx
                    ? 'selected'
                    : ''
                }
              >
                ${esc(
                  seasonTitle(
                    season,
                    i
                  )
                )} · ${count} episodios
              </option>`;
            }
          )
          .join('')}

      </select>

    </div>

    <div
      id="episodeArea"
    ></div>`;

  renderEpisodePage(
    seasons[
      detailState.seasonIdx
    ]
  );
}

function selectSeason(i) {
  detailState.seasonIdx =
    Number(i);

  detailState.page =
    null;

  const s =
    findSeries(
      detailState.seriesId
    );

  if (!s) return;

  const seasons =
    orderSeasons(
      s,
      DB.seasons.filter(
        x =>
          x.seriesId ===
          s.id
      )
    );

  renderEpisodePage(
    seasons[
      detailState.seasonIdx
    ]
  );
}

function renderEpisodePage(
  season
) {
  const area =
    document.getElementById(
      'episodeArea'
    );

  if (!area) return;

  const eps =
    dedupeEps(
      DB.episodes.filter(
        e =>
          e.seasonId ===
          season.id
      )
    );

  if (!eps.length) {
    area.innerHTML =
      '<div class="empty">No hay episodios disponibles todavía para esta temporada.</div>';

    return;
  }

  const totalPages =
    Math.ceil(
      eps.length /
        EPS_PER_PAGE
    );

  if (
    detailState.page ==
      null ||
    detailState.page >=
      totalPages
  ) {
    const watched =
      getWatched()[
        season.id
      ] || {};

    const lastWatched =
      Math.max(
        0,
        ...Object.keys(
          watched
        ).map(Number)
      );

    detailState.page =
      lastWatched
        ? Math.floor(
            (lastWatched - 1) /
              EPS_PER_PAGE
          )
        : 0;
  }

  const page =
    Math.min(
      detailState.page,
      totalPages - 1
    );

  detailState.page =
    page;

  const slice =
    eps.slice(
      page *
        EPS_PER_PAGE,
      (page + 1) *
        EPS_PER_PAGE
    );

  const watched =
    getWatched()[
      season.id
    ] || {};

  area.innerHTML = `
    <div class="episode-list">

      ${slice
        .map(e => {
          const w =
            Boolean(
              watched[
                e.number
              ]
            );

          return `
          <a
            class="episode ${
              w
                ? 'watched'
                : ''
            }"
            href="#/episode/${qs(
              e.slug ||
                e.id
            )}"
          >

            <span class="ep-num">
              ${e.number}
            </span>

            <span class="ep-info">

              <strong>
                ${esc(
                  cleanEpisodeTitle(
                    e
                  )
                )}
              </strong>

              <span class="meta">
                ${esc(
                  (
                    e.servers ||
                    []
                  )
                    .map(
                      x =>
                        x.name
                    )
                    .join(
                      ' · '
                    ) ||
                  (
                    e.releaseDate ||
                    ''
                  )
                )}
              </span>

            </span>

            <button
              class="watched-btn ${
                w
                  ? 'on'
                  : ''
              }"
              title="${
                w
                  ? 'Quitar marcador'
                  : 'Marcar como visto'
              }"
              onclick="event.preventDefault();event.stopPropagation();toggleWatched('${esc(
                season.id
              )}',${e.number})"
            >
              ${
                w
                  ? ICONS.check
                  : ''
              }
            </button>

          </a>`;
        })
        .join('')}

    </div>

    ${
      totalPages > 1
        ? `
      <div class="ep-pagination">

        <button
          class="btn-x glass"
          ${
            page === 0
              ? 'disabled'
              : ''
          }
          onclick="gotoPage(${
            page - 1
          })"
        >
          ${ICONS.prev}
          <span>Anterior</span>
        </button>

        <span class="muted">
          Página ${
            page + 1
          } de ${totalPages}
        </span>

        <button
          class="btn-x glass"
          ${
            page >=
            totalPages - 1
              ? 'disabled'
              : ''
          }
          onclick="gotoPage(${
            page + 1
          })"
        >
          <span>Siguiente</span>
          ${ICONS.next}
        </button>

      </div>`
        : ''
    }`;
}

function gotoPage(p) {
  detailState.page =
    p;

  const s =
    findSeries(
      detailState.seriesId
    );

  if (!s) return;

  const seasons =
    orderSeasons(
      s,
      DB.seasons.filter(
        x =>
          x.seriesId ===
          s.id
      )
    );

  renderEpisodePage(
    seasons[
      detailState.seasonIdx
    ]
  );

  setTimeout(
    () =>
      document
        .getElementById(
          'episodeArea'
        )
        ?.scrollIntoView({
          behavior:
            'smooth',
          block: 'start'
        }),
    50
  );
}

/* ---------- REPRODUCTOR ---------- */

function episode(slug) {
  const e =
    findEpisode(slug);

  if (!e) {
    return notfound();
  }

  currentEpisode =
    e;

  saveHistory(
    e.seriesId,
    e
  );

  /* Marca solo ESTE episodio (antes se marcaban del 1 al N) */
  markWatchedSingle(
    e.seasonId,
    e.number
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
      x =>
        x.id ===
        e.id
    );

  const prevEp =
    idx > 0
      ? seasonEps[
          idx - 1
        ]
      : null;

  const nextEp =
    idx <
    seasonEps.length - 1
      ? seasonEps[
          idx + 1
        ]
      : null;

  const serie =
    findSeries(
      e.seriesId
    );

  const serieRef =
    serie
      ? serie.slug ||
        serie.id
      : e.seriesId;

  const season =
    DB.seasons.find(
      x =>
        x.id ===
        e.seasonId
    );

  setAmbience(
    getSeriesImage(
      serie || {}
    ) ||
      (season?.image ||
        '')
  );

  const langLabel = {
    latino: 'Latino',
    castellano:
      'Castellano',
    subtitulado:
      'Subtitulado'
  };

  const groups = [];

  for (const l of [
    'latino',
    'castellano',
    'subtitulado'
  ]) {
    const sv =
      (e.servers || [])
        .filter(
          s =>
            s.lang === l
        );

    if (sv.length) {
      groups.push({
        key: l,
        label:
          langLabel[l],
        servers: sv
      });
    }
  }

  const untagged =
    (e.servers || [])
      .filter(
        s => !s.lang
      );

  if (untagged.length) {
    groups.push({
      key: 'none',
      label: 'Servidores',
      servers:
        untagged
    });
  }

  let current =
    e.servers?.[0];

  let activeGroup =
    Math.max(
      0,
      groups.findIndex(
        g =>
          g.servers.includes(
            current
          )
      )
    );

  const selectServer =
    srv => {
      current = srv;
      render();
    };

  const renderServers =
    () => {
      const wrap =
        document.getElementById(
          'serverGroups'
        );

      if (
        !wrap ||
        !groups.length
      ) {
        return;
      }

      const g =
        groups[
          activeGroup
        ];

      wrap.innerHTML = `
        <div class="lang-tabs">

          ${groups
            .map(
              (x, i) =>
                `<button
                  class="${
                    i ===
                    activeGroup
                      ? 'on'
                      : ''
                  }"
                  data-g="${i}"
                >
                  ${x.label}
                </button>`
            )
            .join('')}

        </div>

        <div class="server-tabs">

          ${g.servers
            .map(
              srv =>
                `<button
                  class="${
                    srv ===
                    current
                      ? 'active'
                      : ''
                  }"
                  data-url="${esc(
                    srv.url
                  )}"
                >
                  ${esc(
                    srv.name
                  )}
                </button>`
            )
            .join('')}

        </div>`;

      wrap
        .querySelectorAll(
          '[data-g]'
        )
        .forEach(
          b =>
            (b.onclick = () => {
              activeGroup =
                Number(
                  b.dataset
                    .g
                );

              selectServer(
                groups[
                  activeGroup
                ].servers[0]
              );

              renderServers();
            })
        );

      wrap
        .querySelectorAll(
          '[data-url]'
        )
        .forEach(
          b =>
            (b.onclick = () => {
              const srv =
                g.servers.find(
                  s =>
                    s.url ===
                    b.dataset
                      .url
                );

              if (srv) {
                selectServer(
                  srv
                );

                renderServers();
              }
            })
        );
    };

  const render = () => {
    const playerEl =
      document.getElementById(
        'player'
      );

    if (playerEl) {
      playerEl.innerHTML =
        current?.url
          ? `<iframe
              src="${esc(
                current.url
              )}"
              allow="autoplay; fullscreen *; encrypted-media; picture-in-picture"
              allowfullscreen
              webkitallowfullscreen
              mozallowfullscreen
              loading="lazy"
            ></iframe>

            <button
              class="fs-btn"
              onclick="togglePlayerFS()"
              title="Pantalla completa"
            >
              ${ICONS.full}
            </button>`
          : '<div class="empty">Servidor no disponible.</div>';
    }
  };

  app.innerHTML = `
  <section class="detail page-top">

    <div class="eyebrow">
      ${(() => {
        const epsSerie =
          DB.episodes.filter(
            x =>
              x.seriesId ===
              e.seriesId
          ).length;

        const esPeli =
          serie &&
          (
            serie.contentType ===
              'movie' ||
            (
              serie.sourceUrl ||
              ''
            ).includes(
              '/peliculas/'
            ) ||
            epsSerie === 1
          );

        return esPeli
          ? `PELÍCULA${
              isWatched(
                e.seasonId,
                e.number
              )
                ? ' · VISTO'
                : ''
            }`
          : `${esc(
              season
                ? seasonTitle(
                    season,
                    0
                  )
                : ''
            )} · EPISODIO ${
              e.number
            }${
              isWatched(
                e.seasonId,
                e.number
              )
                ? ' · VISTO'
                : ''
            }`;
      })()}
    </div>

    <h1 class="ep-title">
      ${esc(
        cleanEpisodeTitle(e)
      )}
    </h1>

    <div
      class="player"
      id="player"
    ></div>

    <div
      id="serverGroups"
    ></div>

    <div class="ep-nav">

      ${
        prevEp
          ? `<a
              class="btn-x glass"
              href="#/episode/${qs(
                prevEp.slug ||
                  prevEp.id
              )}"
            >
              ${ICONS.prev}
              <span>Anterior</span>
            </a>`
          : `<button
              class="btn-x glass"
              disabled
            >
              ${ICONS.prev}
              <span>Anterior</span>
            </button>`
      }

      <a
        class="btn-x glass"
        href="#/series/${qs(
          serieRef
        )}"
      >
        ${ICONS.list}
        <span>Serie</span>
      </a>

      ${
        nextEp
          ? `<a
              class="btn-x glass"
              href="#/episode/${qs(
                nextEp.slug ||
                  nextEp.id
              )}"
            >
              <span>Siguiente</span>
              ${ICONS.next}
            </a>`
          : `<button
              class="btn-x glass"
              disabled
            >
              <span>Siguiente</span>
              ${ICONS.next}
            </button>`
      }

    </div>

    <div
      class="ep-nav"
      style="margin-top:10px"
    >
      <button
        class="btn-x glass"
        id="autoNextBtn"
        onclick="toggleAutoNext()"
      >
        ${ICONS.repeat}
        <span>
          Auto:
          ${
            autoNextEnabled
              ? 'ON'
              : 'OFF'
          }
        </span>
      </button>
    </div>

    ${(() => {
      const recommended =
        getRecommendedSeries(
          serie || {
            id:
              e.seriesId
          }
        );

      return recommended.length
        ? `
          <div style="margin-top:34px">

            <div class="section-head">
              <h2>
                También te puede gustar
              </h2>

              <span class="muted">
                ${recommended.length}
              </span>
            </div>

            <div class="grid">
              ${recommended
                .map(card)
                .join('')}
            </div>

          </div>`
        : '';
    })()}

  </section>`;

  render();
  renderServers();
}

function notfound() {
  stopProgressiveGrid();

  app.innerHTML = `
    <section class="empty page-top">

      <h2>
        No encontrado
      </h2>

      <p
        class="muted"
        style="margin-top:10px"
      >
        <a
          href="#/"
          style="color:var(--red)"
        >
          Volver al inicio
        </a>
      </p>

    </section>`;
}

/* ---------- NAVEGACIÓN ---------- */

function highlightNav() {
  const hash =
    location.hash ||
    '#/';

  document
    .querySelectorAll(
      '[data-nav]'
    )
    .forEach(a => {
      const href =
        a.getAttribute(
          'href'
        );

      const active =
        href === hash ||
        (
          href !== '#/' &&
          hash.startsWith(
            href
          )
        );

      a.classList.toggle(
        'active',
        active
      );
    });
}

function pageTransition() {
  app.classList.remove(
    'page-anim'
  );
  void app.offsetWidth;
  app.classList.add(
    'page-anim'
  );
}

function route() {
  clearInterval(
    heroTimer
  );
  heroHold = false;

  stopProgressiveGrid();

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

  const p =
    location.hash
      .replace(
        /^#\/?/,
        ''
      )
      .split('/')
      .filter(Boolean)
      .map(
        decodeURIComponent
      );

  const type =
    p[0];

  const arg =
    p[1];

  const extra =
    p[2];

  if (!type) {
    home();

  } else if (
    type === 'search'
  ) {
    search(
      arg || ''
    );

  } else if (
    type === 'series' &&
    !arg
  ) {
    listAllSeries();

  } else if (
    type === 'movies'
  ) {
    listMovies();

  } else if (
    type === 'series' &&
    arg
  ) {
    detail(
      arg,
      extra
    );

  } else if (
    type === 'airing'
  ) {
    listByStatus(
      'emisión',
      'Donghuas En Emisión'
    );

  } else if (
    type === 'completed'
  ) {
    listByStatus(
      'finaliz',
      'Donghuas Finalizados'
    );

  } else if (
    type === 'genres'
  ) {
    listGenres();

  } else if (
    type === 'genre' &&
    arg
  ) {
    listByGenre(
      arg
    );

  } else if (
    type === 'mylist'
  ) {
    listMyList();

  } else if (
    type === 'episode'
  ) {
    episode(
      arg
    );

  } else {
    home();
  }

  highlightNav();

  pageTransition();

  window.scrollTo({
    top: 0
  });
}

/* ---------- EVENTOS GLOBALES ---------- */

window.addEventListener(
  'hashchange',
  route
);

window.addEventListener(
  'scroll',
  () => {
    document
      .querySelector(
        '.nav'
      )
      ?.classList.toggle(
        'scrolled',
        window.scrollY > 40
      );

    document
      .getElementById(
        'toTop'
      )
      ?.classList.toggle(
        'show',
        window.scrollY > 500
      );
  },
  {
    passive: true
  }
);

document.addEventListener(
  'DOMContentLoaded',
  () => {
    const reloadBtn =
      document.getElementById(
        'reloadBtn'
      );

    if (reloadBtn) {
      reloadBtn.addEventListener(
        'click',
        async () => {
          reloadBtn.style.transform =
            'rotate(360deg)';

          reloadBtn.style.transition =
            'transform .5s ease';

          await load();

          setTimeout(
            () => {
              reloadBtn.style.transform =
                'none';
            },
            500
          );
        }
      );
    }

    document
      .getElementById(
        'toTop'
      )
      ?.addEventListener(
        'click',
        () =>
          window.scrollTo({
            top: 0,
            behavior:
              'smooth'
          })
      );

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

/* Estado vacío con acción: caja .empty-state (admite HTML/CTA) */
function emptyStateHTML(msg) {
  return (
    '<div class="empty-state"><p>' + msg + '</p></div>'
  );
}

load();
