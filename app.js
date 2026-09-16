console.log(
  "%c DonghuaFlix — Creado por @bledark__ ",
  "background:#000;color:#e50914;font-size:14px;font-weight:bold;"
);

/* ============================================================
   DONGHUAFLIX — FRONTEND OPTIMIZADO
   ============================================================

   PRINCIPALES OPTIMIZACIONES

   1. Los catálogos secundarios NO se comprueban al arrancar.
   2. Cada catálogo se carga bajo demanda.
   3. Los catálogos sharded se cargan progresivamente.
   4. Nunca se renderizan miles de tarjetas simultáneamente.
   5. Las películas usan tarjetas ligeras.
   6. Índices de series / temporadas / episodios en memoria.
   7. Renderizado por lotes.
   8. Búsqueda limitada al número de resultados visibles.
   9. Imágenes lazy.
   10. Donghuas mantiene su funcionamiento actual.
   ============================================================ */


/* ============================================================
   ESTADO GLOBAL
   ============================================================ */

let DB = {
  series: [],
  seasons: [],
  episodes: [],
  genres: [],
  meta: {}
};

const EMPTY_DB = {
  series: [],
  seasons: [],
  episodes: [],
  genres: [],
  meta: {}
};


/* ============================================================
   CATÁLOGOS
   ============================================================ */

const CATALOGS = [
  {
    id: "donghua",
    file: "./public/data/catalog.json",
    label: "Donghuas"
  },
  {
    id: "peliculas",
    file: "./public/data/catalog-peliculas.json",
    label: "Películas"
  },
  {
    id: "series",
    file: "./public/data/catalog-series.json",
    label: "Series"
  },
  {
    id: "ultrapeli",
    file: "./public/data/catalog-ultrapeli.json",
    label: "Ultrapeli"
  }
];

const DB_CACHE = {};

const CATALOG_AVAILABLE = {
  donghua: true,
  peliculas: false,
  series: false,
  ultrapeli: false
};

let currentCatalog =
  localStorage.getItem("donghuaflix_catalog") || "donghua";


/* ============================================================
   CARGA PROGRESIVA DE CATÁLOGOS
   ============================================================ */

const CATALOG_STATE = {};


/*
 * Estado individual:
 *
 * manifest
 * parts
 * loadedParts
 * loading
 * complete
 */
function getCatalogState(id) {
  if (!CATALOG_STATE[id]) {
    CATALOG_STATE[id] = {
      manifest: null,
      parts: [],
      loadedParts: [],
      loading: false,
      complete: false,
      error: null
    };
  }

  return CATALOG_STATE[id];
}


/* ------------------------------------------------------------
   FETCH
   ------------------------------------------------------------ */

async function fetchCatalogFile(file) {
  const separator = file.includes("?") ? "&" : "?";

  const response = await fetch(
    file + separator + "v=" + Date.now(),
    {
      cache: "no-store"
    }
  );

  if (!response.ok) {
    throw new Error("No se pudo cargar " + file);
  }

  return response.json();
}


/* ------------------------------------------------------------
   MERGE
   ------------------------------------------------------------ */

function mergeCatalogParts(manifest, parts) {

  const db = {
    meta: manifest?.meta || {},
    series: [],
    seasons: [],
    episodes: [],
    genres: []
  };

  const genres = new Set(
    Array.isArray(manifest?.genres)
      ? manifest.genres
      : []
  );

  for (const part of parts) {

    if (!part) continue;

    if (Array.isArray(part.series)) {
      db.series.push(...part.series);
    }

    if (Array.isArray(part.seasons)) {
      db.seasons.push(...part.seasons);
    }

    if (Array.isArray(part.episodes)) {
      db.episodes.push(...part.episodes);
    }

    if (Array.isArray(part.genres)) {
      for (const g of part.genres) {
        genres.add(
          typeof g === "object"
            ? g.name
            : g
        );
      }
    }
  }

  db.genres = [...genres];

  return db;
}


/* ------------------------------------------------------------
   CONSTRUYE ÍNDICES
   ------------------------------------------------------------ */

let INDEX = {
  seriesById: new Map(),
  seriesBySlug: new Map(),

  seasonsById: new Map(),
  seasonsBySeries: new Map(),

  episodesById: new Map(),
  episodesBySeason: new Map(),
  episodesBySeries: new Map()
};


function rebuildIndexes() {

  INDEX = {
    seriesById: new Map(),
    seriesBySlug: new Map(),

    seasonsById: new Map(),
    seasonsBySeries: new Map(),

    episodesById: new Map(),
    episodesBySeason: new Map(),
    episodesBySeries: new Map()
  };


  /* SERIES */

  for (const series of DB.series || []) {

    INDEX.seriesById.set(
      series.id,
      series
    );

    if (series.slug) {
      INDEX.seriesBySlug.set(
        series.slug,
        series
      );
    }
  }


  /* SEASONS */

  for (const season of DB.seasons || []) {

    INDEX.seasonsById.set(
      season.id,
      season
    );

    if (!INDEX.seasonsBySeries.has(season.seriesId)) {
      INDEX.seasonsBySeries.set(
        season.seriesId,
        []
      );
    }

    INDEX.seasonsBySeries
      .get(season.seriesId)
      .push(season);
  }


  /* EPISODES */

  for (const episode of DB.episodes || []) {

    INDEX.episodesById.set(
      episode.id,
      episode
    );

    if (episode.slug) {
      INDEX.episodesById.set(
        episode.slug,
        episode
      );
    }

    if (!INDEX.episodesBySeason.has(episode.seasonId)) {
      INDEX.episodesBySeason.set(
        episode.seasonId,
        []
      );
    }

    INDEX.episodesBySeason
      .get(episode.seasonId)
      .push(episode);


    if (!INDEX.episodesBySeries.has(episode.seriesId)) {
      INDEX.episodesBySeries.set(
        episode.seriesId,
        []
      );
    }

    INDEX.episodesBySeries
      .get(episode.seriesId)
      .push(episode);
  }


  /* ORDENAR EPISODIOS UNA SOLA VEZ */

  for (const list of INDEX.episodesBySeason.values()) {

    list.sort(
      (a, b) =>
        Number(a.number || 0) -
        Number(b.number || 0)
    );
  }
}


/* ------------------------------------------------------------
   CARGA DEL CATÁLOGO
   ------------------------------------------------------------ */

async function ensureCatalog(id, options = {}) {

  if (DB_CACHE[id]) {
    return DB_CACHE[id];
  }

  const catalog =
    CATALOGS.find(c => c.id === id);

  if (!catalog) {
    throw new Error(
      "Catálogo desconocido: " + id
    );
  }


  const state = getCatalogState(id);


  /*
   * MANIFEST
   */

  if (!state.manifest) {

    state.manifest =
      await fetchCatalogFile(
        catalog.file
      );

    CATALOG_AVAILABLE[id] = true;


    /*
     * CATÁLOGO NORMAL
     */

    if (
      !state.manifest?.sharded ||
      !Array.isArray(state.manifest.parts) ||
      !state.manifest.parts.length
    ) {

      DB_CACHE[id] =
        state.manifest;

      rebuildIndexes();

      state.complete = true;

      return DB_CACHE[id];
    }


    /*
     * CATÁLOGO SHARDED
     */

    state.parts =
      state.manifest.parts.slice();
  }


  /*
   * SI YA TERMINÓ
   */

  if (state.complete && DB_CACHE[id]) {
    return DB_CACHE[id];
  }


  /*
   * CARGA INICIAL:
   *
   * Solo algunas partes.
   *
   * Esto permite que la interfaz aparezca
   * antes de descargar todo el catálogo.
   */

  const initialParts =
    options.initialParts ??
    Math.min(
      2,
      state.parts.length
    );


  if (
    state.loadedParts.length === 0 &&
    state.parts.length
  ) {

    const first =
      state.parts
        .slice(0, initialParts);

    const loaded =
      await Promise.all(
        first.map(
          file =>
            fetchCatalogFile(file)
              .catch(() => null)
        )
      );


    for (
      let i = 0;
      i < loaded.length;
      i++
    ) {

      if (loaded[i]) {
        state.loadedParts.push(
          loaded[i]
        );
      }
    }


    DB_CACHE[id] =
      mergeCatalogParts(
        state.manifest,
        state.loadedParts
      );

    rebuildIndexes();
  }


  /*
   * CARGA RESTANTE EN SEGUNDO PLANO
   */

  if (!state.loading) {

    state.loading = true;

    loadRemainingCatalogParts(
      id
    ).catch(error => {
      console.warn(
        "Error cargando partes restantes:",
        error
      );

      state.error = error;
      state.loading = false;
    });
  }


  return DB_CACHE[id] || EMPTY_DB;
}


/* ------------------------------------------------------------
   RESTO DE PARTES
   ------------------------------------------------------------ */

async function loadRemainingCatalogParts(id) {

  const state =
    getCatalogState(id);


  if (!state.parts.length) {
    state.complete = true;
    state.loading = false;
    return;
  }


  /*
   * Qué partes faltan.
   */

  const alreadyLoaded =
    state.loadedParts.length;


  const remaining =
    state.parts.slice(
      alreadyLoaded
    );


  /*
   * Cargamos de dos en dos.
   *
   * No hacemos Promise.all() de 20/30 archivos.
   */

  const BATCH_SIZE = 2;


  for (
    let i = 0;
    i < remaining.length;
    i += BATCH_SIZE
  ) {

    const batch =
      remaining.slice(
        i,
        i + BATCH_SIZE
      );


    const loaded =
      await Promise.all(
        batch.map(
          file =>
            fetchCatalogFile(file)
              .catch(error => {

                console.warn(
                  "No se pudo cargar parte:",
                  file,
                  error
                );

                return null;
              })
        )
      );


    for (const part of loaded) {

      if (part) {
        state.loadedParts.push(
          part
        );
      }
    }


    /*
     * Actualizar DB después de cada lote.
     */

    DB_CACHE[id] =
      mergeCatalogParts(
        state.manifest,
        state.loadedParts
      );

    rebuildIndexes();


    /*
     * Si estamos viendo este catálogo,
     * refrescamos solo cuando conviene.
     */

    if (id === currentCatalog) {

      const hash =
        location.hash || "#/";

      if (
        hash.startsWith("#/movies") ||
        hash === "#/"
      ) {

        /*
         * No repintamos en cada archivo.
         * Dejamos respirar al navegador.
         */

        await new Promise(
          resolve =>
            setTimeout(resolve, 0)
        );

        if (
          hash.startsWith("#/movies")
        ) {
          renderMoviesPage();
        }
      }
    }


    /*
     * Deja respirar al navegador.
     */

    await new Promise(
      resolve =>
        setTimeout(resolve, 20)
    );
  }


  state.complete = true;
  state.loading = false;

  DB_CACHE[id] =
    mergeCatalogParts(
      state.manifest,
      state.loadedParts
    );

  rebuildIndexes();


  /*
   * Actualizar página una última vez.
   */

  if (
    id === currentCatalog &&
    location.hash.startsWith("#/movies")
  ) {

    renderMoviesPage();
  }
}


/* ============================================================
   CATÁLOGO / MENÚ
   ============================================================ */

const app =
  document.getElementById("app");


function renderCatBar() {

  const menu =
    document.getElementById(
      "catalogMenu"
    );

  const wrap =
    document.getElementById(
      "catalogWrap"
    );

  if (!menu || !wrap) {
    return;
  }


  const available =
    CATALOGS.filter(
      c => CATALOG_AVAILABLE[c.id]
    );


  /*
   * Mostramos el selector
   * si sabemos que hay más de uno.
   */

  wrap.style.display =
    available.length > 1
      ? ""
      : "none";


  menu
    .querySelectorAll("button")
    .forEach(button => {

      const id =
        button.dataset.cat;

      button.classList.toggle(
        "on",
        id === currentCatalog
      );

      /*
       * Si todavía no sabemos si existe,
       * no ocultamos Donghua.
       */

      if (
        CATALOG_AVAILABLE[id] ||
        id === "donghua"
      ) {
        button.style.display = "";
      }
    });
}


function toggleCatalogMenu() {

  document
    .getElementById("catalogMenu")
    ?.classList.toggle("open");
}


document.addEventListener(
  "click",
  event => {

    const menu =
      document.getElementById(
        "catalogMenu"
      );

    if (
      menu?.classList.contains("open") &&
      !event.target.closest(
        ".catalog-wrap"
      )
    ) {

      menu.classList.remove("open");
    }
  }
);


/* ------------------------------------------------------------
   CAMBIAR CATÁLOGO
   ------------------------------------------------------------ */

async function switchCatalog(id) {

  if (id === currentCatalog) {
    return;
  }


  app.innerHTML =
    `<section class="section page-top">
      <div class="grid">
        ${Array(8)
          .fill(
            '<div class="skeleton"></div>'
          )
          .join("")}
      </div>
    </section>`;


  try {

    const newDB =
      await ensureCatalog(
        id,
        {
          initialParts:
            id === "peliculas"
              ? 2
              : 1
        }
      );


    DB = newDB;

    currentCatalog = id;

    localStorage.setItem(
      "donghuaflix_catalog",
      id
    );


    setAmbience("");

    renderCatBar();


    location.hash = "#/";

    route();


  } catch (error) {

    console.error(error);

    showToast(
      "Catálogo no disponible todavía"
    );
  }
}


/* ============================================================
   HELPERS
   ============================================================ */

const esc = value =>
  String(value ?? "")
    .replace(
      /[&<>"']/g,
      char =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;"
        })[char]
    );


const qs =
  value =>
    encodeURIComponent(
      value || ""
    );


const fold =
  value =>
    String(value || "")
      .normalize("NFD")
      .replace(
        /[\u0300-\u036f]/g,
        ""
      )
      .toLowerCase();


/* ============================================================
   ICONOS
   ============================================================ */

const ICONS = {

  play:
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',

  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',

  check:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>',

  heart:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9A5.3 5.3 0 0 1 12 6.6a5.3 5.3 0 0 1 9.3 4.9c-1.8 4.4-9.3 9-9.3 9z"/></svg>',

  search:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></svg>',

  full:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3"/></svg>',

  list:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h13M8 12h13M8 18h13"/><circle cx="4" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4" cy="18" r="1" fill="currentColor" stroke="none"/></svg>',

  prev:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',

  next:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',

  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>',

  repeat:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`
};


/* ============================================================
   TÍTULOS
   ============================================================ */

const cleanTitle = s => {

  let title =
    s?.title;

  if (title) {

    title =
      title
        .replace(
          /\s*\|\s*Donghualife.*$/i,
          ""
        )
        .trim();
  }


  if (
    !title ||
    title.toLowerCase() ===
      "temporadas"
  ) {

    const rawSlug =
      s?.slug ||
      s?.id ||
      "";

    if (rawSlug) {

      return rawSlug
        .split("-")
        .map(
          word =>
            word.charAt(0).toUpperCase() +
            word.slice(1)
        )
        .join(" ");
    }

    return "Donghua";
  }

  return title;
};


const cleanEpisodeTitle = e => {

  let title =
    (e.title || "")
      .replace(
        /\s*\|\s*Donghualife.*$/i,
        ""
      )
      .trim();


  const match =
    title.match(
      /(?:^|[-–—])\s*\d*\s*(?:Episodio|Episode)\s*x?(\d+)\s*$/i
    );


  if (match) {

    return (
      "Episodio " +
      parseInt(
        match[1],
        10
      )
    );
  }


  return (
    title ||
    `Episodio ${e.number}`
  );
};


const slugFromUrl =
  url =>
    (url || "")
      .split("?")[0]
      .split("/")
      .filter(Boolean)
      .pop() || "";


const prettySlug =
  slug =>
    slug
      .split("-")
      .filter(Boolean)
      .map(
        word =>
          word.charAt(0).toUpperCase() +
          word.slice(1)
      )
      .join(" ");


/* ============================================================
   SERIES / TEMPORADAS / EPISODIOS
   ============================================================ */

function findSeries(ref) {

  return (
    INDEX.seriesById.get(ref) ||
    INDEX.seriesBySlug.get(ref) ||
    DB.series.find(
      s =>
        s.id === ref ||
        s.slug === ref
    ) ||
    null
  );
}


function findEpisode(ref) {

  return (
    INDEX.episodesById.get(ref) ||
    DB.episodes.find(
      e =>
        e.id === ref ||
        e.slug === ref
    ) ||
    null
  );
}


function getSeriesSeasons(seriesId) {

  return (
    INDEX.seasonsBySeries.get(
      seriesId
    ) || []
  );
}


function getSeasonEpisodes(seasonId) {

  return (
    INDEX.episodesBySeason.get(
      seasonId
    ) || []
  );
}


function getSeriesEpisodes(seriesId) {

  return (
    INDEX.episodesBySeries.get(
      seriesId
    ) || []
  );
}


const dedupeEps = episodes => {

  const map = new Map();

  for (const episode of episodes) {

    if (
      !map.has(
        episode.number
      )
    ) {

      map.set(
        episode.number,
        episode
      );
    }
  }

  return [...map.values()]
    .sort(
      (a, b) =>
        Number(a.number || 0) -
        Number(b.number || 0)
    );
};


const seriesGenres = s => {

  if (
    Array.isArray(
      s?.genres
    )
  ) {

    return s.genres;
  }

  if (s?.genre) {

    return [s.genre];
  }

  return [];
};


function seasonTitle(
  season,
  index
) {

  if (
    Number.isFinite(
      season.number
    )
  ) {

    return (
      `Temporada ${season.number}`
    );
  }


  const title =
    (season.title || "")
      .trim();


  if (
    title &&
    title.toLowerCase() !==
      "temporadas"
  ) {

    const match =
      title.match(
        /(?:temporada|season)\s*(\d{1,3})/i
      ) ||
      title.match(
        /^(\d{1,3})[ª°.]/
      );


    if (match) {

      return (
        `Temporada ${parseInt(
          match[1],
          10
        )}`
      );
    }

    return title;
  }


  const slug =
    (
      season.slug ||
      season.id ||
      slugFromUrl(
        season.url ||
        season.sourceUrl
      ) ||
      ""
    ).toLowerCase();


  let match =
    slug.match(
      /-(\d{1,3})-\d{1,3}$/
    );


  if (match) {

    return (
      `Temporada ${parseInt(
        match[1],
        10
      )}`
    );
  }


  match =
    slug.match(
      /-(\d{1,3})$/
    );


  if (match) {

    return (
      `Temporada ${parseInt(
        match[1],
        10
      )}`
    );
  }


  return slug
    ? prettySlug(slug)
    : `Temporada ${index + 1}`;
}


function orderSeasons(
  series,
  seasons
) {

  const urls =
    series.seasonUrls || [];


  if (!urls.length) {

    return seasons;
  }


  const rank =
    season => {

      const key =
        (
          season.slug ||
          season.id ||
          slugFromUrl(
            season.url ||
            season.sourceUrl
          ) ||
          ""
        ).toLowerCase();


      const index =
        urls.findIndex(
          url =>
            slugFromUrl(
              url
            ).toLowerCase() ===
              key ||
            url ===
              (
                season.url ||
                season.sourceUrl
              )
        );


      return index === -1
        ? 999
        : index;
    };


  return seasons
    .slice()
    .sort(
      (a, b) =>
        rank(a) -
        rank(b)
    );
}


/* ============================================================
   IMÁGENES
   ============================================================ */

const SERIES_IMAGE_CACHE =
  new Map();


function getSeriesImage(s) {

  if (!s) return "";


  if (
    SERIES_IMAGE_CACHE.has(
      s.id
    )
  ) {

    return SERIES_IMAGE_CACHE.get(
      s.id
    );
  }


  let image = "";


  if (s.posterLocal) {

    image =
      s.posterLocal;
  }

  else if (
    s.image &&
    !s.image.includes(
      "IcoPrueba.png"
    )
  ) {

    image =
      s.image;
  }

  else {

    const seasons =
      getSeriesSeasons(
        s.id
      );


    for (
      const season of seasons
    ) {

      if (
        season.image &&
        !season.image.includes(
          "IcoPrueba.png"
        )
      ) {

        image =
          season.image;

        break;
      }
    }
  }


  SERIES_IMAGE_CACHE.set(
    s.id,
    image
  );

  return image;
}


function imgLoaded(img) {

  img.classList.toggle(
    "wide",
    img.naturalWidth >
      img.naturalHeight
  );
}


/* ============================================================
   TIPO / METADATA
   ============================================================ */

const getYear = s =>
  s.year ||
  (
    String(
      s.releaseDate || ""
    ).match(
      /\d{4}/
    ) || []
  )[0] ||
  (
    cleanTitle(s).match(
      /\b((?:19|20)\d{2})\b/
    ) || []
  )[0] ||
  null;


const getCountry =
  s =>
    s.country ||
    null;


const contentTypeOf =
  s => {

    if (s.contentType) {
      return s.contentType;
    }

    if (
      (s.sourceUrl || "")
        .includes(
          "/peliculas/"
        )
    ) {

      return "movie";
    }

    return "series";
  };


function seriesEpisodeCount(s) {

  return getSeriesEpisodes(
    s.id
  ).length;
}


/* ============================================================
   VISTOS
   ============================================================ */

function getWatched() {

  try {

    return JSON.parse(
      localStorage.getItem(
        "donghuaflix_watched"
      ) || "{}"
    );

  } catch {

    return {};
  }
}


function isWatched(
  seasonId,
  number
) {

  return Boolean(
    getWatched()
      [seasonId]
      ?.[
        number
      ]
  );
}


function markWatchedUpTo(
  seasonId,
  number
) {

  const all =
    getWatched();


  all[seasonId] =
    all[seasonId] || {};


  for (
    let i = 1;
    i <= number;
    i++
  ) {

    if (
      !all[seasonId][i]
    ) {

      all[seasonId][i] =
        Date.now();
    }
  }


  localStorage.setItem(
    "donghuaflix_watched",
    JSON.stringify(all)
  );
}


function toggleWatched(
  seasonId,
  number
) {

  const all =
    getWatched();


  all[seasonId] =
    all[seasonId] || {};


  if (
    all[seasonId][number]
  ) {

    delete all[
      seasonId
    ][number];

  } else {

    all[
      seasonId
    ][number] =
      Date.now();
  }


  localStorage.setItem(
    "donghuaflix_watched",
    JSON.stringify(all)
  );


  showToast(
    isWatched(
      seasonId,
      number
    )
      ? "Marcado como visto"
      : "Marcador quitado"
  );


  const series =
    findSeries(
      detailState.seriesId
    );


  if (series) {

    const seasons =
      orderSeasons(
        series,
        getSeriesSeasons(
          series.id
        )
      );


    if (
      seasons[
        detailState.seasonIdx
      ]
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
    getSeriesSeasons(
      s.id
    );


  let total = 0;
  let seen = 0;


  for (
    const season of seasons
  ) {

    const episodes =
      getSeasonEpisodes(
        season.id
      );


    total +=
      episodes.length;


    const marked =
      watched[
        season.id
      ] || {};


    for (
      const episode
      of episodes
    ) {

      if (
        marked[
          episode.number
        ]
      ) {

        seen++;
      }
    }
  }


  return total
    ? Math.round(
        seen /
        total *
        100
      )
    : 0;
}


/* ============================================================
   FAVORITOS
   ============================================================ */

function getFavs() {

  try {

    return JSON.parse(
      localStorage.getItem(
        "donghuaflix_favs"
      ) || "[]"
    );

  } catch {

    return [];
  }
}


function isFav(id) {

  return getFavs()
    .includes(id);
}


function toggleFav(id) {

  let favs =
    getFavs();


  const was =
    favs.includes(id);


  favs =
    was
      ? favs.filter(
          value =>
            value !== id
        )
      : [
          ...favs,
          id
        ];


  localStorage.setItem(
    "donghuaflix_favs",
    JSON.stringify(favs)
  );


  showToast(
    was
      ? "Quitado de Mi lista"
      : "Añadido a Mi lista"
  );


  return !was;
}


function refreshFavUI(
  button,
  id
) {

  button.classList.toggle(
    "on",
    isFav(id)
  );
}


/* ============================================================
   HISTORIAL
   ============================================================ */

function getHistory() {

  try {

    return JSON.parse(
      localStorage.getItem(
        "donghuaflix_history"
      ) || "{}"
    );

  } catch {

    return {};
  }
}


function saveHistory(
  seriesId,
  episode
) {

  try {

    const history =
      getHistory();


    history[
      seriesId
    ] = {

      episodeId:
        episode.id,

      episodeNumber:
        episode.number,

      episodeTitle:
        episode.title,

      seasonId:
        episode.seasonId,

      timestamp:
        Date.now()
    };


    localStorage.setItem(
      "donghuaflix_history",
      JSON.stringify(
        history
      )
    );

  } catch {}
}


function lastWatchedEpisode(
  series
) {

  const history =
    getHistory();


  const entry =
    history[
      series.id
    ];


  if (entry) {

    const episode =
      findEpisode(
        entry.episodeId
      );


    if (episode) {
      return episode;
    }
  }


  const seasons =
    orderSeasons(
      series,
      getSeriesSeasons(
        series.id
      )
    );


  for (
    const season of seasons
  ) {

    const episodes =
      getSeasonEpisodes(
        season.id
      );


    if (episodes.length) {

      return episodes[0];
    }
  }


  return null;
}


/* ============================================================
   TOAST
   ============================================================ */

let toastTimer = null;


function showToast(message) {

  const toast =
    document.getElementById(
      "toast"
    );


  if (!toast) {
    return;
  }


  toast.textContent =
    message;


  toast.classList.add(
    "show"
  );


  clearTimeout(
    toastTimer
  );


  toastTimer =
    setTimeout(
      () =>
        toast.classList.remove(
          "show"
        ),
      2200
    );
}


/* ============================================================
   TARJETAS
   ============================================================ */

/*
 * TARJETA NORMAL
 *
 * Se usa para Donghuas.
 */

function card(s) {

  const image =
    getSeriesImage(s);

  const title =
    cleanTitle(s);

  const favorite =
    isFav(s.id);

  const progress =
    contentTypeOf(s) === "movie"
      ? 0
      : seriesProgress(s);


  return `
    <article
      class="card"
      onclick="location.hash='#/series/${qs(
        s.slug || s.id
      )}'"
    >

      <div class="poster">

        ${
          image
            ? `
              <img
                loading="lazy"
                decoding="async"
                src="${esc(image)}"
                alt="${esc(title)}"
                onload="imgLoaded(this)"
                onerror="this.parentNode.innerHTML='<div class=&quot;no-img&quot;>DONGHUAFLIX</div>'"
              >
            `
            : `
              <div class="no-img">
                DONGHUAFLIX
              </div>
            `
        }

        <span class="badge">
          ${esc(
            s.status ||
            (
              contentTypeOf(s) ===
              "movie"
                ? "PELÍCULA"
                : "DONGHUA"
            )
          )}
        </span>

        <button
          class="fav-heart ${
            favorite
              ? "on"
              : ""
          }"
          title="Mi lista"
          onclick="
            event.stopPropagation();
            toggleFav('${esc(s.id)}');
            refreshFavUI(this,'${esc(s.id)}')
          "
        >
          ${ICONS.heart}
        </button>

        ${
          progress > 0
            ? `
              <div class="progress">
                <span
                  style="width:${progress}%"
                ></span>
              </div>
            `
            : ""
        }

      </div>

      <h3>
        ${esc(title)}
      </h3>

    </article>
  `;
}


/*
 * TARJETA ULTRALIGERA PARA PELÍCULAS
 *
 * NO calcula progreso.
 * NO busca temporadas.
 * NO busca episodios.
 */

function movieCard(s) {

  const image =
    s.posterLocal ||
    (
      s.image &&
      !s.image.includes(
        "IcoPrueba.png"
      )
        ? s.image
        : ""
    );


  const title =
    cleanTitle(s);


  const favorite =
    isFav(s.id);


  return `
    <article
      class="card movie-card"
      onclick="location.hash='#/series/${qs(
        s.slug || s.id
      )}'"
    >

      <div class="poster">

        ${
          image
            ? `
              <img
                loading="lazy"
                decoding="async"
                src="${esc(image)}"
                alt="${esc(title)}"
                onload="imgLoaded(this)"
                onerror="this.parentNode.innerHTML='<div class=&quot;no-img&quot;>DONGHUAFLIX</div>'"
              >
            `
            : `
              <div class="no-img">
                DONGHUAFLIX
              </div>
            `
        }

        <span class="badge">
          PELÍCULA
        </span>

        <button
          class="fav-heart ${
            favorite
              ? "on"
              : ""
          }"
          title="Mi lista"
          onclick="
            event.stopPropagation();
            toggleFav('${esc(s.id)}');
            refreshFavUI(this,'${esc(s.id)}')
          "
        >
          ${ICONS.heart}
        </button>

      </div>

      <h3>
        ${esc(title)}
      </h3>

    </article>
  `;
}


/* ============================================================
   RAILS
   ============================================================ */

function rail(items) {

  return `
    <div class="rail">
      ${items
        .map(
          item =>
            `<div class="rail-item">
              ${card(item)}
            </div>`
        )
        .join("")}
    </div>
  `;
}


function cwCard(
  series,
  history
) {

  const image =
    getSeriesImage(
      series
    );


  const season =
    INDEX.seasonsById.get(
      history.seasonId
    );


  const number =
    season &&
    Number.isFinite(
      season.number
    )
      ? season.number
      : 1;


  const progress =
    seriesProgress(
      series
    );


  return `
    <div
      class="cw-card"
      onclick="location.hash='#/episode/${qs(
        history.episodeId
      )}'"
    >

      ${
        image
          ? `
            <img
              loading="lazy"
              decoding="async"
              src="${esc(image)}"
              alt=""
              onerror="this.remove()"
            >
          `
          : ""
      }

      <div class="cw-shade"></div>

      <div class="cw-play">
        ${ICONS.play}
      </div>

      <div class="cw-info">
        ${esc(
          cleanTitle(series)
        )}
        · T${number}:E${
          history.episodeNumber
        }
      </div>

      ${
        progress > 0
          ? `
            <div class="cw-progress">
              <span
                style="width:${progress}%"
              ></span>
            </div>
          `
          : ""
      }

    </div>
  `;
}


function top10Rail(items) {

  if (!items.length) {
    return "";
  }


  return `
    <div class="top10-row">

      ${items
        .map(
          (series, index) =>
            `
              <div
                class="top10-item"
                onclick="location.hash='#/series/${qs(
                  series.slug ||
                  series.id
                )}'"
              >

                <span class="top10-num">
                  ${index + 1}
                </span>

                <div
                  class="top10-poster"
                  style="background-image:url('${esc(
                    getSeriesImage(
                      series
                    )
                  )}')"
                ></div>

              </div>
            `
        )
        .join("")}

    </div>
  `;
}


/* ============================================================
   HERO
   ============================================================ */

let heroItems = [];
let heroIdx = 0;
let heroTimer = null;


function renderHero() {

  const hero =
    heroItems[
      heroIdx
    ];


  const section =
    document.getElementById(
      "hero"
    );


  if (!hero || !section) {
    return;
  }


  const image =
    getSeriesImage(
      hero
    );


  section.style.setProperty(
    "--hero",
    `url('${image}')`
  );


  setAmbience(
    image
  );


  document.getElementById(
    "heroTitle"
  ).textContent =
    cleanTitle(hero);


  document.getElementById(
    "heroMeta"
  ).textContent =
    seriesGenres(hero)
      .slice(0, 3)
      .join(" · ");


  document.getElementById(
    "heroSyn"
  ).textContent =
    hero.synopsis ||
    "Catálogo de animación china en alta calidad.";


  document.getElementById(
    "heroBtn"
  ).onclick = () => {

    const episode =
      lastWatchedEpisode(
        hero
      );


    if (episode) {

      location.hash =
        "#/episode/" +
        qs(
          episode.slug ||
          episode.id
        );

    } else {

      location.hash =
        "#/series/" +
        qs(
          hero.slug ||
          hero.id
        );
    }
  };


  const favoriteButton =
    document.getElementById(
      "heroListBtn"
    );


  if (favoriteButton) {

    const favorite =
      isFav(hero.id);


    favoriteButton.innerHTML =
      favorite
        ? `${ICONS.check}<span>Mi lista</span>`
        : `${ICONS.plus}<span>Mi lista</span>`;


    favoriteButton.onclick =
      () => {

        const value =
          toggleFav(
            hero.id
          );


        favoriteButton.innerHTML =
          value
            ? `${ICONS.check}<span>Mi lista</span>`
            : `${ICONS.plus}<span>Mi lista</span>`;
      };
  }


  document
    .querySelectorAll(
      ".hero-dots button"
    )
    .forEach(
      (button, index) =>
        button.classList.toggle(
          "active",
          index === heroIdx
        )
    );
}


function mountHero(items) {

  clearInterval(
    heroTimer
  );


  heroItems =
    items.slice(
      0,
      5
    );


  heroIdx = 0;


  if (
    heroItems.length > 1
  ) {

    heroTimer =
      setInterval(
        () => {

          heroIdx =
            (
              heroIdx + 1
            ) %
            heroItems.length;


          renderHero();

        },
        7000
      );
  }
}


/* ============================================================
   AMBIENCE
   ============================================================ */

function setAmbience(
  url
) {

  const element =
    document.getElementById(
      "bgAmbience"
    );


  if (!element) {
    return;
  }


  element.style.backgroundImage =
    url
      ? `url('${url}')`
      : "none";
}


/* ============================================================
   HOME
   ============================================================ */

function home() {

  const recent =
    DB.series
      .slice()
      .sort(
        (a, b) =>
          (
            b.updatedAt ||
            ""
          ).localeCompare(
            a.updatedAt ||
            ""
          )
      );


  const history =
    getHistory();


  const historyList =
    DB.series
      .filter(
        s =>
          history[s.id]
      )
      .sort(
        (a, b) =>
          history[
            b.id
          ].timestamp -
          history[
            a.id
          ].timestamp
      );


  const favorites =
    DB.series.filter(
      s =>
        isFav(s.id)
    );


  const airing =
    DB.series.filter(
      s =>
        (
          s.status ||
          ""
        )
          .toLowerCase()
          .includes(
            "emisión"
          )
    );


  const completed =
    DB.series.filter(
      s =>
        (
          s.status ||
          ""
        )
          .toLowerCase()
          .includes(
            "finaliz"
          )
    );


  const top10 =
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
      .slice(
        0,
        10
      );


  const sections = [];


  if (
    historyList.length
  ) {

    sections.push(`
      <section class="section">

        <div class="section-head">
          <h2>
            Continuar viendo
          </h2>

          <span class="muted">
            ${historyList.length}
          </span>
        </div>

        <div class="cw-rail">
          ${historyList
            .slice(0, 10)
            .map(
              s =>
                cwCard(
                  s,
                  history[
                    s.id
                  ]
                )
            )
            .join("")}
        </div>

      </section>
    `);
  }


  if (
    favorites.length
  ) {

    sections.push(`
      <section class="section">

        <div class="section-head">
          <h2>
            Mi lista
          </h2>

          <span class="muted">
            ${favorites.length}
          </span>
        </div>

        ${rail(
          favorites.slice(
            0,
            30
          )
        )}

      </section>
    `);
  }


  if (
    airing.length ||
    top10.length
  ) {

    sections.push(`
      <section class="section">

        <div class="section-head">
          <h2>
            Top 10 hoy
          </h2>
        </div>

        ${top10Rail(
          top10
        )}

      </section>
    `);


    if (
      airing.length
    ) {

      sections.push(`
        <section class="section">

          <div class="section-head">
            <h2>
              En Emisión
            </h2>

            <span class="muted">
              ${airing.length}
            </span>
          </div>

          ${rail(
            airing.slice(
              0,
              30
            )
          )}

        </section>
      `);
    }
  }


  if (
    completed.length
  ) {

    sections.push(`
      <section class="section">

        <div class="section-head">
          <h2>
            Finalizadas
          </h2>

          <span class="muted">
            ${completed.length}
          </span>
        </div>

        ${rail(
          completed.slice(
            0,
            30
          )
        )}

      </section>
    `);
  }


  sections.push(`
    <section class="section">

      <div class="section-head">
        <h2>
          Agregados recientemente
        </h2>

        <span class="muted">
          ${Math.min(
            recent.length,
            15
          )}
        </span>
      </div>

      ${rail(
        recent.slice(
          0,
          15
        )
      )}

    </section>
  `);


  app.innerHTML = `
    <section
      class="hero"
      id="hero"
    >

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
            <span>
              Ver serie
            </span>
          </button>

          <button
            class="btn-x glass"
            id="heroListBtn"
          >
            ${ICONS.plus}
            <span>
              Mi lista
            </span>
          </button>

        </div>

      </div>

      ${
        recent.length > 1
          ? `
            <div class="hero-dots">

              ${recent
                .slice(
                  0,
                  5
                )
                .map(
                  (_, index) =>
                    `
                      <button
                        onclick="
                          clearInterval(heroTimer);
                          heroIdx=${index};
                          renderHero()
                        "
                        aria-label="Hero ${
                          index + 1
                        }"
                      ></button>
                    `
                )
                .join("")}

            </div>
          `
          : ""
      }

    </section>

    ${sections.join("")}

    <section class="section center">

      <button
        class="btn-x glass"
        onclick="
          location.hash='#/series'
        "
      >
        Ver catálogo completo
        (${DB.series.length})
      </button>

    </section>
  `;


  mountHero(
    recent
  );

  renderHero();
}


/* ============================================================
   PAGINACIÓN DE CATÁLOGOS
   ============================================================ */

const ITEMS_PER_PAGE = 48;

let catalogViewState = {
  list: [],
  offset: 0,
  renderer: null
};


function renderCatalogBatch(
  container,
  list,
  renderer,
  reset = false
) {

  if (!container) {
    return;
  }


  if (reset) {

    container.innerHTML = "";

    catalogViewState.offset =
      0;
  }


  const start =
    catalogViewState.offset;


  const end =
    Math.min(
      start +
        ITEMS_PER_PAGE,
      list.length
    );


  const batch =
    list.slice(
      start,
      end
    );


  if (!batch.length) {
    return;
  }


  /*
   * DocumentFragment mediante HTML.
   *
   * Solo 48 tarjetas por operación.
   */

  container.insertAdjacentHTML(
    "beforeend",
    batch
      .map(renderer)
      .join("")
  );


  catalogViewState.offset =
    end;


  updateLoadMore(
    list.length,
    end
  );
}


function updateLoadMore(
  total,
  loaded
) {

  const button =
    document.getElementById(
      "loadMoreCatalog"
    );


  const info =
    document.getElementById(
      "catalogLoaded"
    );


  if (info) {

    info.textContent =
      `${loaded} de ${total}`;
  }


  if (!button) {
    return;
  }


  button.style.display =
    loaded < total
      ? ""
      : "none";
}


/* ============================================================
   CATÁLOGO GENERAL
   ============================================================ */

function listAllSeries() {

  const genres =
    [
      ...new Set(
        DB.series.flatMap(
          seriesGenres
        )
      )
    ]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            "es"
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
    ]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            "es"
          )
      );


  const state = {
    type: "",
    genre: "",
    year: "",
    country: "",
    sort: "recent"
  };


  const applyFilters =
    () => {

      let list =
        DB.series.slice();


      if (state.type) {

        list =
          list.filter(
            s =>
              contentTypeOf(
                s
              ) ===
              state.type
          );
      }


      if (
        state.genre
      ) {

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


      if (
        state.year
      ) {

        list =
          list.filter(
            s =>
              String(
                getYear(s)
              ) ===
              state.year
          );
      }


      if (
        state.country
      ) {

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
        "az"
      ) {

        list.sort(
          (a, b) =>
            cleanTitle(
              a
            ).localeCompare(
              cleanTitle(
                b
              ),
              "es"
            )
        );

      } else {

        list.sort(
          (a, b) =>
            (
              b.updatedAt ||
              ""
            ).localeCompare(
              a.updatedAt ||
              ""
            )
        );
      }


      return list;
    };


  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">

        <h2>
          Catálogo completo
        </h2>

        <span
          class="muted"
          id="catalogCount"
        >
          ${DB.series.length}
        </span>

      </div>

      <div class="filters">

        <select id="fType">
          <option value="">
            Clasificación
          </option>

          <option value="movie">
            Películas
          </option>

          <option value="series">
            Series
          </option>
        </select>

        ${
          genres.length
            ? `
              <select id="fGenre">

                <option value="">
                  Género
                </option>

                ${genres
                  .map(
                    g =>
                      `<option>${esc(g)}</option>`
                  )
                  .join("")}

              </select>
            `
            : ""
        }

        ${
          years.length
            ? `
              <select id="fYear">

                <option value="">
                  Año
                </option>

                ${years
                  .map(
                    y =>
                      `<option>${y}</option>`
                  )
                  .join("")}

              </select>
            `
            : ""
        }

        ${
          countries.length
            ? `
              <select id="fCountry">

                <option value="">
                  País
                </option>

                ${countries
                  .map(
                    c =>
                      `<option>${esc(c)}</option>`
                  )
                  .join("")}

              </select>
            `
            : ""
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


      <div
        class="section center"
        style="margin-top:25px"
      >

        <span
          class="muted"
          id="catalogLoaded"
        ></span>

        <br>

        <button
          class="btn-x glass"
          id="loadMoreCatalog"
        >
          Cargar más
        </button>

      </div>

    </section>
  `;


  const render =
    () => {

      const list =
        applyFilters();


      const count =
        document.getElementById(
          "catalogCount"
        );


      if (count) {
        count.textContent =
          list.length;
      }


      catalogViewState.list =
        list;


      catalogViewState.offset =
        0;


      const grid =
        document.getElementById(
          "catalogGrid"
        );


      if (!grid) {
        return;
      }


      grid.innerHTML = "";


      renderCatalogBatch(
        grid,
        list,
        s =>
          contentTypeOf(s) ===
          "movie"
            ? movieCard(s)
            : card(s),
        true
      );
    };


  const bind =
    (
      id,
      key
    ) => {

      const element =
        document.getElementById(
          id
        );


      if (!element) {
        return;
      }


      element.onchange =
        () => {

          state[key] =
            element.value;

          render();
        };
    };


  bind(
    "fType",
    "type"
  );

  bind(
    "fGenre",
    "genre"
  );

  bind(
    "fYear",
    "year"
  );

  bind(
    "fCountry",
    "country"
  );

  bind(
    "fSort",
    "sort"
  );


  document
    .getElementById(
      "loadMoreCatalog"
    )
    ?.addEventListener(
      "click",
      () => {

        renderCatalogBatch(
          document.getElementById(
            "catalogGrid"
          ),
          catalogViewState.list,
          s =>
            contentTypeOf(s) ===
            "movie"
              ? movieCard(s)
              : card(s)
        );
      }
    );


  render();
}


/* ============================================================
   PELÍCULAS
   ============================================================ */

function getMovies() {

  return DB.series.filter(
    s =>
      contentTypeOf(s) ===
      "movie"
  );
}


function renderMoviesPage() {

  const movies =
    getMovies();


  const state =
    getCatalogState(
      "peliculas"
    );


  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">

        <h2>
          Películas
        </h2>

        <span class="muted">
          ${
            state.complete
              ? movies.length
              : `${movies.length}+`
          }
        </span>

      </div>


      <div
        class="grid"
        id="moviesGrid"
      ></div>


      <div
        class="section center"
        style="margin-top:25px"
      >

        <span
          class="muted"
          id="moviesLoaded"
        >
        </span>

        <br>

        <button
          class="btn-x glass"
          id="loadMoreMovies"
        >
          Cargar más
        </button>

      </div>

    </section>
  `;


  const grid =
    document.getElementById(
      "moviesGrid"
    );


  if (!grid) {
    return;
  }


  /*
   * Primera tanda.
   */

  catalogViewState.list =
    movies;

  catalogViewState.offset =
    0;


  renderCatalogBatch(
    grid,
    movies,
    movieCard,
    true
  );


  updateMovieCounter(
    movies.length,
    catalogViewState.offset,
    state.complete
  );


  document
    .getElementById(
      "loadMoreMovies"
    )
    ?.addEventListener(
      "click",
      () => {

        renderCatalogBatch(
          grid,
          getMovies(),
          movieCard
        );


        updateMovieCounter(
          getMovies().length,
          catalogViewState.offset,
          getCatalogState(
            "peliculas"
          ).complete
        );
      }
    );


  /*
   * IntersectionObserver:
   *
   * cuando el usuario llega abajo,
   * cargamos automáticamente.
   */

  const sentinel =
    document.createElement(
      "div"
    );


  sentinel.style.height =
    "1px";


  sentinel.id =
    "movieSentinel";


  grid.parentNode.appendChild(
    sentinel
  );


  if (
    "IntersectionObserver"
    in window
  ) {

    const observer =
      new IntersectionObserver(
        entries => {

          if (
            entries[0].isIntersecting
          ) {

            const current =
              getMovies();


            if (
              catalogViewState.offset <
              current.length
            ) {

              renderCatalogBatch(
                grid,
                current,
                movieCard
              );


              updateMovieCounter(
                current.length,
                catalogViewState.offset,
                getCatalogState(
                  "peliculas"
                ).complete
              );
            }
          }
        },
        {
          rootMargin:
            "900px"
        }
      );


    observer.observe(
      sentinel
    );
  }
}


function updateMovieCounter(
  total,
  loaded,
  complete
) {

  const info =
    document.getElementById(
      "moviesLoaded"
    );


  if (info) {

    info.textContent =
      complete
        ? `${loaded} de ${total}`
        : `${loaded} cargadas · catálogo continúa cargándose`;
  }


  const button =
    document.getElementById(
      "loadMoreMovies"
    );


  if (button) {

    button.style.display =
      loaded < total
        ? ""
        : "none";
  }
}


function listMovies() {

  renderMoviesPage();
}


/* ============================================================
   ESTADOS
   ============================================================ */

function listByStatus(
  keyword,
  title
) {

  const list =
    DB.series.filter(
      s =>
        (
          s.status ||
          ""
        )
          .toLowerCase()
          .includes(
            keyword.toLowerCase()
          )
    );


  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">

        <h2>
          ${title}
        </h2>

        <span class="muted">
          ${list.length}
        </span>

      </div>

      <div
        class="grid"
        id="statusGrid"
      ></div>

    </section>
  `;


  const grid =
    document.getElementById(
      "statusGrid"
    );


  catalogViewState.list =
    list;

  catalogViewState.offset =
    0;


  renderCatalogBatch(
    grid,
    list,
    card,
    true
  );
}


/* ============================================================
   GÉNEROS
   ============================================================ */

function listGenres() {

  const genres =
    (DB.genres || [])
      .map(
        g =>
          g?.name ||
          g
      );


  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">

        <h2>
          Géneros
        </h2>

        <span class="muted">
          ${genres.length}
        </span>

      </div>

      ${
        genres.length
          ? `
            <div class="chips">

              ${genres
                .map(
                  genre =>
                    `
                      <a
                        class="chip"
                        href="#/genre/${qs(
                          genre
                        )}"
                      >
                        ${esc(
                          genre
                        )}
                      </a>
                    `
                )
                .join("")}

            </div>
          `
          : `
            <p class="muted">
              Géneros no disponibles.
            </p>
          `
      }

    </section>
  `;
}


function listByGenre(
  name
) {

  const target =
    fold(name);


  const list =
    DB.series.filter(
      s =>
        seriesGenres(
          s
        ).some(
          genre =>
            fold(
              genre
            ) === target
        )
    );


  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">

        <h2>
          ${esc(name)}
        </h2>

        <span class="muted">
          ${list.length}
        </span>

      </div>

      <div
        class="grid"
        id="genreGrid"
      ></div>

    </section>
  `;


  catalogViewState.list =
    list;

  catalogViewState.offset =
    0;


  renderCatalogBatch(
    document.getElementById(
      "genreGrid"
    ),
    list,
    card,
    true
  );
}


/* ============================================================
   MI LISTA
   ============================================================ */

function listMyList() {

  const favorites =
    getFavs();


  const list =
    DB.series.filter(
      s =>
        favorites.includes(
          s.id
        )
    );


  app.innerHTML = `
    <section class="section page-top">

      <div class="section-head">

        <h2>
          Mi lista
        </h2>

        <span class="muted">
          ${list.length}
        </span>

      </div>

      <div
        class="grid"
        id="myListGrid"
      ></div>

    </section>
  `;


  if (!list.length) {

    document.getElementById(
      "myListGrid"
    ).innerHTML = `
      <p
        class="muted"
        style="grid-column:1/-1"
      >
        Aún no tienes favoritos.
      </p>
    `;

    return;
  }


  catalogViewState.list =
    list;

  catalogViewState.offset =
    0;


  renderCatalogBatch(
    document.getElementById(
      "myListGrid"
    ),
    list,
    card,
    true
  );
}


/* ============================================================
   BUSCADOR
   ============================================================ */

let searchState = {
  genre: "",
  year: "",
  country: ""
};


let searchTimer =
  null;


function search(
  query = ""
) {

  if (
    !document.getElementById(
      "q"
    )
  ) {

    searchState = {
      genre: "",
      year: "",
      country: ""
    };


    const genres =
      [
        ...new Set(
          DB.series.flatMap(
            seriesGenres
          )
        )
      ]
        .sort(
          (a, b) =>
            a.localeCompare(
              b,
              "es"
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
      ]
        .sort(
          (a, b) =>
            a.localeCompare(
              b,
              "es"
            )
        );


    app.innerHTML = `
      <section class="search page-top">

        <h1>
          Buscar
        </h1>

        <div class="searchbar">

          ${ICONS.search}

          <input
            id="q"
            type="text"
            value="${esc(
              query
            )}"
            autocomplete="off"
            placeholder="Nombre..."
          >

        </div>


        <div class="filters">

          ${
            genres.length
              ? `
                <select id="sfGenre">

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
                    .join("")}

                </select>
              `
              : ""
          }


          ${
            years.length
              ? `
                <select id="sfYear">

                  <option value="">
                    Año
                  </option>

                  ${years
                    .map(
                      y =>
                        `<option>${y}</option>`
                    )
                    .join("")}

                </select>
              `
              : ""
          }


          ${
            countries.length
              ? `
                <select id="sfCountry">

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
                    .join("")}

                </select>
              `
              : ""
          }

        </div>


        <div
          id="results"
          class="grid"
        ></div>

      </section>
    `;


    const bind =
      (
        id,
        key
      ) => {

        const element =
          document.getElementById(
            id
          );


        if (!element) {
          return;
        }


        element.onchange =
          () => {

            searchState[
              key
            ] =
              element.value;


            updateSearchResults(
              document.getElementById(
                "q"
              ).value
            );
          };
      };


    bind(
      "sfGenre",
      "genre"
    );

    bind(
      "sfYear",
      "year"
    );

    bind(
      "sfCountry",
      "country"
    );


    const input =
      document.getElementById(
        "q"
      );


    input.addEventListener(
      "input",
      event => {

        clearTimeout(
          searchTimer
        );


        searchTimer =
          setTimeout(
            () =>
              updateSearchResults(
                event.target.value
              ),
            120
          );
      }
    );


    setTimeout(
      () => {

        input.focus();

        input.setSelectionRange(
          input.value.length,
          input.value.length
        );

      },
      50
    );
  }


  updateSearchResults(
    query
  );
}


function updateSearchResults(
  query = ""
) {

  const container =
    document.getElementById(
      "results"
    );


  if (!container) {
    return;
  }


  const target =
    fold(
      query.trim()
    );


  if (!target) {

    container.innerHTML = `
      <p
        class="muted"
        style="grid-column:1/-1"
      >
        Escribe para ver sugerencias...
      </p>
    `;

    return;
  }


  /*
   * Máximo 60 resultados renderizados.
   *
   * Aunque haya miles de coincidencias,
   * no bloqueamos el navegador.
   */

  let matches = [];


  for (
    const series of DB.series
  ) {

    const title =
      fold(
        cleanTitle(
          series
        )
      );


    if (
      title.startsWith(
        target
      ) ||
      title.includes(
        target
      )
    ) {

      matches.push(
        series
      );


      if (
        matches.length >=
        60
      ) {

        break;
      }
    }
  }


  if (
    searchState.genre
  ) {

    matches =
      matches.filter(
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


  if (
    searchState.year
  ) {

    matches =
      matches.filter(
        s =>
          String(
            getYear(s)
          ) ===
          searchState.year
      );
  }


  if (
    searchState.country
  ) {

    matches =
      matches.filter(
        s =>
          fold(
            getCountry(s)
          ) ===
          fold(
            searchState.country
          )
      );
  }


  container.innerHTML =
    matches.length
      ? matches
          .map(
            s =>
              contentTypeOf(
                s
              ) === "movie"
                ? movieCard(s)
                : card(s)
          )
          .join("")
      : `
          <p
            class="muted"
            style="grid-column:1/-1"
          >
            No se encontraron resultados.
          </p>
        `;
}


/* ============================================================
   DETALLE
   ============================================================ */

let detailState = {
  seriesId: null,
  seasonIdx: 0,
  page: null
};


const EPS_PER_PAGE = 50;


function detail(
  slug,
  seasonRef
) {

  const series =
    findSeries(slug);


  if (!series) {
    return notfound();
  }


  const seasons =
    orderSeasons(
      series,
      getSeriesSeasons(
        series.id
      )
    );


  if (
    detailState.seriesId !==
    series.id
  ) {

    detailState = {
      seriesId:
        series.id,
      seasonIdx: 0,
      page: null
    };
  }


  if (seasonRef) {

    const index =
      seasons.findIndex(
        season =>
          (
            season.slug ||
            season.id
          ) ===
            seasonRef ||
          String(
            season.number
          ) ===
            String(
              seasonRef
            )
      );


    if (index !== -1) {

      detailState.seasonIdx =
        index;

      detailState.page =
        null;
    }
  }


  const image =
    getSeriesImage(
      series
    );


  const title =
    cleanTitle(
      series
    );


  const genres =
    seriesGenres(
      series
    );


  const favorite =
    isFav(
      series.id
    );


  const episodeCount =
    seriesEpisodeCount(
      series
    );


  const lastEpisode =
    lastWatchedEpisode(
      series
    );


  const lastSeason =
    lastEpisode
      ? INDEX.seasonsById.get(
          lastEpisode.seasonId
        )
      : null;


  const lastSeasonNumber =
    lastSeason &&
    Number.isFinite(
      lastSeason.number
    )
      ? lastSeason.number
      : 1;


  const allEpisodes =
    getSeriesEpisodes(
      series.id
    );


  const isMovie =
    contentTypeOf(
      series
    ) === "movie" ||
    allEpisodes.length === 1;


  const singleEpisode =
    isMovie
      ? allEpisodes[0]
      : null;


  setAmbience(
    image
  );


  app.innerHTML = `
    <section class="detail-v2">

      <div
        class="detail-hero"
        style="--dhero:url('${esc(
          image
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
              series.status ||
              ""
            )}
          </div>

          <h1>
            ${esc(title)}
          </h1>

          <div class="detail-meta">

            ${
              isMovie
                ? `<span class="movie-tag">PELÍCULA</span> ·`
                : ""
            }

            ${
              series.year
                ? `<span>${series.year}</span> ·`
                : ""
            }

            ${
              series.country
                ? `<span>${esc(
                    series.country
                  )}</span> ·`
                : ""
            }

            ${
              !isMovie
                ? `
                  <span>
                    ${seasons.length}
                    temporada${
                      seasons.length ===
                      1
                        ? ""
                        : "s"
                    }
                  </span>
                  ·
                  <span>
                    ${episodeCount}
                    episodios
                  </span>
                `
                : ""
            }

            ${
              genres.length
                ? `
                  ·
                  <span>
                    ${esc(
                      genres
                        .slice(
                          0,
                          3
                        )
                        .join(
                          " · "
                        )
                    )}
                  </span>
                `
                : ""
            }

          </div>


          <div class="detail-actions">

            ${
              lastEpisode
                ? `
                  <button
                    class="btn-x play big"
                    onclick="
                      location.hash='#/episode/${qs(
                        lastEpisode.slug ||
                        lastEpisode.id
                      )}'
                    "
                  >

                    ${ICONS.play}

                    <span>
                      ${
                        isMovie
                          ? "Reproducir"
                          : `Reproducir${
                              lastEpisode.number >
                              1
                                ? ` · T${lastSeasonNumber}:E${lastEpisode.number}`
                                : ""
                            }`
                      }
                    </span>

                  </button>
                `
                : ""
            }


            <button
              class="btn-x glass round"
              id="favBtn"
              title="Mi lista"
            >
              ${
                favorite
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
            ? `
              <div class="chips">

                ${genres
                  .map(
                    genre =>
                      `
                        <a
                          class="chip"
                          href="#/genre/${qs(
                            genre
                          )}"
                        >
                          ${esc(
                            genre
                          )}
                        </a>
                      `
                  )
                  .join("")}

              </div>
            `
            : ""
        }


        <p class="detail-syn">
          ${esc(
            series.synopsis ||
            "Sinopsis no disponible."
          )}
        </p>


        ${
          isMovie
            ? `
              <div class="movie-cta">

                ${
                  singleEpisode
                    ? `
                      <button
                        class="btn-x play big"
                        onclick="
                          location.hash='#/episode/${qs(
                            singleEpisode.slug ||
                            singleEpisode.id
                          )}'
                        "
                      >
                        ${ICONS.play}
                        <span>
                          Reproducir ahora
                        </span>
                      </button>
                    `
                    : `
                      <div class="empty">
                        No hay reproductor disponible.
                      </div>
                    `
                }

              </div>
            `
            : `
              <div id="seasonArea"></div>
            `
        }

      </div>

    </section>
  `;


  document.getElementById(
    "favBtn"
  ).onclick =
    () => {

      const value =
        toggleFav(
          series.id
        );


      document.getElementById(
        "favBtn"
      ).innerHTML =
        value
          ? ICONS.check
          : ICONS.plus;
    };


  if (!isMovie) {

    renderSeasonArea(
      seasons
    );
  }
}


/* ============================================================
   TEMPORADAS
   ============================================================ */

function renderSeasonArea(
  seasons
) {

  const area =
    document.getElementById(
      "seasonArea"
    );


  if (!area) {
    return;
  }


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
            (season, index) => {

              const count =
                getSeasonEpisodes(
                  season.id
                ).length;


              return `
                <option
                  value="${index}"
                  ${
                    index ===
                    detailState.seasonIdx
                      ? "selected"
                      : ""
                  }
                >
                  ${esc(
                    seasonTitle(
                      season,
                      index
                    )
                  )}
                  ·
                  ${count}
                  episodios
                </option>
              `;
            }
          )
          .join("")}

      </select>

    </div>

    <div id="episodeArea"></div>
  `;


  renderEpisodePage(
    seasons[
      detailState.seasonIdx
    ]
  );
}


function selectSeason(
  index
) {

  detailState.seasonIdx =
    Number(index);

  detailState.page =
    null;


  const series =
    findSeries(
      detailState.seriesId
    );


  if (!series) {
    return;
  }


  const seasons =
    orderSeasons(
      series,
      getSeriesSeasons(
        series.id
      )
    );


  renderEpisodePage(
    seasons[
      detailState.seasonIdx
    ]
  );
}


/* ============================================================
   EPISODIOS
   ============================================================ */

function renderEpisodePage(
  season
) {

  const area =
    document.getElementById(
      "episodeArea"
    );


  if (!area || !season) {
    return;
  }


  const episodes =
    dedupeEps(
      getSeasonEpisodes(
        season.id
      )
    );


  if (!episodes.length) {

    area.innerHTML =
      '<div class="empty">No hay episodios disponibles todavía para esta temporada.</div>';

    return;
  }


  const totalPages =
    Math.ceil(
      episodes.length /
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
        ).map(
          Number
        )
      );


    detailState.page =
      lastWatched
        ? Math.floor(
            (
              lastWatched -
              1
            ) /
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


  const start =
    page *
    EPS_PER_PAGE;


  const visible =
    episodes.slice(
      start,
      start +
        EPS_PER_PAGE
    );


  const watched =
    getWatched()[
      season.id
    ] || {};


  area.innerHTML = `
    <div class="episode-list">

      ${visible
        .map(
          episode => {

            const seen =
              Boolean(
                watched[
                  episode.number
                ]
              );


            return `
              <a
                class="episode ${
                  seen
                    ? "watched"
                    : ""
                }"
                href="#/episode/${qs(
                  episode.slug ||
                  episode.id
                )}"
              >

                <span class="ep-num">
                  ${episode.number}
                </span>

                <span class="ep-info">

                  <strong>
                    ${esc(
                      cleanEpisodeTitle(
                        episode
                      )
                    )}
                  </strong>

                  <span class="meta">
                    ${esc(
                      (
                        episode.servers ||
                        []
                      )
                        .map(
                          server =>
                            server.name
                        )
                        .join(
                          " · "
                        ) ||
                      episode.releaseDate ||
                      ""
                    )}
                  </span>

                </span>


                <button
                  class="watched-btn ${
                    seen
                      ? "on"
                      : ""
                  }"
                  title="${
                    seen
                      ? "Quitar marcador"
                      : "Marcar como visto"
                  }"
                  onclick="
                    event.preventDefault();
                    event.stopPropagation();
                    toggleWatched(
                      '${esc(
                        season.id
                      )}',
                      ${episode.number}
                    )
                  "
                >
                  ${
                    seen
                      ? ICONS.check
                      : ""
                  }
                </button>

              </a>
            `;
          }
        )
        .join("")}

    </div>


    ${
      totalPages > 1
        ? `
          <div class="ep-pagination">

            <button
              class="btn-x glass"
              ${
                page === 0
                  ? "disabled"
                  : ""
              }
              onclick="
                gotoPage(
                  ${page - 1}
                )
              "
            >
              ${ICONS.prev}
              <span>
                Anterior
              </span>
            </button>


            <span class="muted">
              Página
              ${page + 1}
              de
              ${totalPages}
            </span>


            <button
              class="btn-x glass"
              ${
                page >=
                totalPages - 1
                  ? "disabled"
                  : ""
              }
              onclick="
                gotoPage(
                  ${page + 1}
                )
              "
            >
              <span>
                Siguiente
              </span>
              ${ICONS.next}
            </button>

          </div>
        `
        : ""
    }
  `;
}


function gotoPage(
  page
) {

  detailState.page =
    page;


  const series =
    findSeries(
      detailState.seriesId
    );


  if (!series) {
    return;
  }


  const seasons =
    orderSeasons(
      series,
      getSeriesSeasons(
        series.id
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
          "episodeArea"
        )
        ?.scrollIntoView({
          behavior:
            "smooth",
          block:
            "start"
        }),
    50
  );
}


/* ============================================================
   AUTO NEXT
   ============================================================ */

let currentEpisode =
  null;


let autoNextEnabled =
  localStorage.getItem(
    "donghuaflix_autonext"
  ) !== "off";


function toggleAutoNext() {

  autoNextEnabled =
    !autoNextEnabled;


  localStorage.setItem(
    "donghuaflix_autonext",
    autoNextEnabled
      ? "on"
      : "off"
  );


  showToast(
    autoNextEnabled
      ? "Auto-siguiente activado"
      : "Auto-siguiente desactivado"
  );


  const button =
    document.getElementById(
      "autoNextBtn"
    );


  if (button) {

    button.innerHTML =
      `${ICONS.repeat}<span>Auto: ${
        autoNextEnabled
          ? "ON"
          : "OFF"
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


  const episodes =
    dedupeEps(
      getSeasonEpisodes(
        currentEpisode.seasonId
      )
    );


  const index =
    episodes.findIndex(
      episode =>
        episode.id ===
        currentEpisode.id
    );


  const next =
    episodes[
      index + 1
    ];


  if (next) {

    showToast(
      "Cargando siguiente episodio…"
    );


    setTimeout(
      () => {

        location.hash =
          "#/episode/" +
          qs(
            next.slug ||
            next.id
          );

      },
      1200
    );

  } else {

    showToast(
      "¡Has terminado esta temporada!"
    );
  }
}


window.addEventListener(
  "message",
  event => {

    const origin =
      String(
        event.origin ||
        ""
      );


    if (
      !/dailymotion|dmcdn/i.test(
        origin
      )
    ) {
      return;
    }


    const data =
      typeof event.data ===
      "string"
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


/* ============================================================
   RECOMENDACIONES
   ============================================================ */

function getRecommendedSeries(
  current,
  limit = 8
) {

  const historyIds =
    new Set(
      Object.keys(
        getHistory()
      )
    );


  const genres =
    new Set(
      seriesGenres(
        current
      ).map(
        fold
      )
    );


  const scored =
    DB.series
      .filter(
        s =>
          s.id !==
            current.id &&
          !historyIds.has(
            s.id
          )
      )
      .map(
        s => {

          let score = 0;


          for (
            const genre
            of seriesGenres(
              s
            )
          ) {

            if (
              genres.has(
                fold(
                  genre
                )
              )
            ) {

              score++;
            }
          }


          return {
            s,
            score
          };
        }
      );


  scored.sort(
    (a, b) =>
      b.score -
      a.score ||
      (
        b.s.updatedAt ||
        ""
      ).localeCompare(
        a.s.updatedAt ||
        ""
      )
  );


  return scored
    .slice(
      0,
      limit
    )
    .map(
      item =>
        item.s
    );
}


/* ============================================================
   REPRODUCTOR
   ============================================================ */

function togglePlayerFS() {

  const player =
    document.querySelector(
      ".player"
    );


  if (!player) {
    return;
  }


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


function episode(
  slug
) {

  const episode =
    findEpisode(
      slug
    );


  if (!episode) {
    return notfound();
  }


  currentEpisode =
    episode;


  saveHistory(
    episode.seriesId,
    episode
  );


  markWatchedUpTo(
    episode.seasonId,
    episode.number
  );


  const seasonEpisodes =
    dedupeEps(
      getSeasonEpisodes(
        episode.seasonId
      )
    );


  const index =
    seasonEpisodes.findIndex(
      e =>
        e.id ===
        episode.id
    );


  const previous =
    index > 0
      ? seasonEpisodes[
          index - 1
        ]
      : null;


  const next =
    index <
    seasonEpisodes.length - 1
      ? seasonEpisodes[
          index + 1
        ]
      : null;


  const series =
    findSeries(
      episode.seriesId
    );


  const seriesRef =
    series
      ? (
          series.slug ||
          series.id
        )
      : episode.seriesId;


  const season =
    INDEX.seasonsById.get(
      episode.seasonId
    );


  setAmbience(
    getSeriesImage(
      series || {}
    ) ||
    season?.image ||
    ""
  );


  const langLabel = {
    latino: "Latino",
    castellano: "Castellano",
    subtitulado:
      "Subtitulado"
  };


  const groups = [];


  for (
    const language
    of [
      "latino",
      "castellano",
      "subtitulado"
    ]
  ) {

    const servers =
      (
        episode.servers ||
        []
      ).filter(
        server =>
          server.lang ===
          language
      );


    if (servers.length) {

      groups.push({
        key:
          language,
        label:
          langLabel[
            language
          ],
        servers
      });
    }
  }


  const untagged =
    (
      episode.servers ||
      []
    ).filter(
      server =>
        !server.lang
    );


  if (
    untagged.length
  ) {

    groups.push({
      key:
        "none",
      label:
        "Servidores",
      servers:
        untagged
    });
  }


  let current =
    episode.servers?.[0];


  let activeGroup =
    Math.max(
      0,
      groups.findIndex(
        group =>
          group.servers.includes(
            current
          )
      )
    );


  const renderServers =
    () => {

      const wrapper =
        document.getElementById(
          "serverGroups"
        );


      if (
        !wrapper ||
        !groups.length
      ) {

        return;
      }


      const group =
        groups[
          activeGroup
        ];


      wrapper.innerHTML = `
        <div class="lang-tabs">

          ${groups
            .map(
              (item, index) =>
                `
                  <button
                    class="${
                      index ===
                      activeGroup
                        ? "on"
                        : ""
                    }"
                    data-g="${index}"
                  >
                    ${item.label}
                  </button>
                `
            )
            .join("")}

        </div>


        <div class="server-tabs">

          ${group.servers
            .map(
              server =>
                `
                  <button
                    class="${
                      server ===
                      current
                        ? "active"
                        : ""
                    }"
                    data-url="${esc(
                      server.url
                    )}"
                  >
                    ${esc(
                      server.name
                    )}
                  </button>
                `
            )
            .join("")}

        </div>
      `;


      wrapper
        .querySelectorAll(
          "[data-g]"
        )
        .forEach(
          button => {

            button.onclick =
              () => {

                activeGroup =
                  Number(
                    button.dataset.g
                  );


                current =
                  groups[
                    activeGroup
                  ]
                    .servers[0];


                renderPlayer();

                renderServers();
              };
          }
        );


      wrapper
        .querySelectorAll(
          "[data-url]"
        )
        .forEach(
          button => {

            button.onclick =
              () => {

                const server =
                  group.servers.find(
                    item =>
                      item.url ===
                      button.dataset
                        .url
                  );


                if (server) {

                  current =
                    server;

                  renderPlayer();

                  renderServers();
                }
              };
          }
        );
    };


  const renderPlayer =
    () => {

      const player =
        document.getElementById(
          "player"
        );


      if (!player) {
        return;
      }


      player.innerHTML =
        current?.url
          ? `
            <iframe
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
            </button>
          `
          : `
            <div class="empty">
              Servidor no disponible.
            </div>
          `;
    };


  const recommendations =
    series
      ? getRecommendedSeries(
          series
        )
      : [];


  app.innerHTML = `
    <section class="detail page-top">

      <div class="eyebrow">

        ${
          contentTypeOf(
            series || {}
          ) === "movie"
            ? "PELÍCULA"
            : `${esc(
                season
                  ? seasonTitle(
                      season,
                      0
                    )
                  : ""
              )} · EPISODIO ${
                episode.number
              }`
        }

        ${
          isWatched(
            episode.seasonId,
            episode.number
          )
            ? " · VISTO"
            : ""
        }

      </div>


      <h1 class="ep-title">
        ${esc(
          cleanEpisodeTitle(
            episode
          )
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
          previous
            ? `
              <a
                class="btn-x glass"
                href="#/episode/${qs(
                  previous.slug ||
                  previous.id
                )}"
              >
                ${ICONS.prev}
                <span>
                  Anterior
                </span>
              </a>
            `
            : `
              <button
                class="btn-x glass"
                disabled
              >
                ${ICONS.prev}
                <span>
                  Anterior
                </span>
              </button>
            `
        }


        <a
          class="btn-x glass"
          href="#/series/${qs(
            seriesRef
          )}"
        >
          ${ICONS.list}
          <span>
            Serie
          </span>
        </a>


        ${
          next
            ? `
              <a
                class="btn-x glass"
                href="#/episode/${qs(
                  next.slug ||
                  next.id
                )}"
              >
                <span>
                  Siguiente
                </span>
                ${ICONS.next}
              </a>
            `
            : `
              <button
                class="btn-x glass"
                disabled
              >
                <span>
                  Siguiente
                </span>
                ${ICONS.next}
              </button>
            `
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
                ? "ON"
                : "OFF"
            }
          </span>
        </button>

      </div>


      ${
        recommendations.length
          ? `
            <div
              style="margin-top:34px"
            >

              <div class="section-head">

                <h2>
                  También te puede gustar
                </h2>

                <span class="muted">
                  ${recommendations.length}
                </span>

              </div>


              <div class="grid">

                ${recommendations
                  .map(
                    item =>
                      contentTypeOf(
                        item
                      ) === "movie"
                        ? movieCard(
                            item
                          )
                        : card(item)
                  )
                  .join("")}

              </div>

            </div>
          `
          : ""
      }

    </section>
  `;


  renderPlayer();

  renderServers();
}


/* ============================================================
   NOT FOUND
   ============================================================ */

function notfound() {

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

    </section>
  `;
}


/* ============================================================
   FOOTER
   ============================================================ */

function updateFooter() {

  const footer =
    document.getElementById(
      "footerStatus"
    );


  if (!footer) {
    return;
  }


  const icon =
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r=".8" fill="currentColor" stroke="none"/></svg>';


  footer.innerHTML = `
    ${
      DB.meta?.syncedAt
        ? `
          Actualizado:
          ${new Date(
            DB.meta.syncedAt
          ).toLocaleString(
            "es-ES"
          )}
          ·
        `
        : ""
    }

    Desarrollado por

    <a
      class="ig-link"
      href="https://instagram.com/bledark__"
      target="_blank"
      rel="noopener"
    >
      ${icon}
      @bledark__
    </a>
  `;
}


/* ============================================================
   LOAD
   ============================================================ */

async function load() {

  app.innerHTML = `
    <section class="section page-top">

      <div class="grid">

        ${Array(8)
          .fill(
            '<div class="skeleton"></div>'
          )
          .join("")}

      </div>

    </section>
  `;


  try {

    /*
     * MUY IMPORTANTE:
     *
     * Solo cargamos el catálogo actual.
     *
     * NO hacemos probeCatalogs().
     */

    DB =
      await ensureCatalog(
        currentCatalog,
        {
          initialParts:
            currentCatalog ===
            "peliculas"
              ? 2
              : 1
        }
      );


    rebuildIndexes();

    SERIES_IMAGE_CACHE.clear();


    renderCatBar();

    updateFooter();

    route();


  } catch (
    error
  ) {

    console.error(
      "Error cargando catálogo:",
      error
    );


    app.innerHTML = `
      <section
        class="empty page-top"
      >

        <h2>
          Error al cargar el catálogo
        </h2>

        <p class="muted">
          Revisa tu conexión o
          el archivo del catálogo.
        </p>

      </section>
    `;
  }
}


/* ============================================================
   NAVEGACIÓN
   ============================================================ */

function highlightNav() {

  const hash =
    location.hash ||
    "#/";


  document
    .querySelectorAll(
      "[data-nav]"
    )
    .forEach(
      link => {

        const href =
          link.getAttribute(
            "href"
          );


        const active =
          href === hash ||
          (
            href !== "#/" &&
            hash.startsWith(
              href
            )
          );


        link.classList.toggle(
          "active",
          active
        );
      }
    );
}


function route() {

  clearInterval(
    heroTimer
  );


  document
    .getElementById(
      "moreMenu"
    )
    ?.classList.remove(
      "open"
    );


  document
    .getElementById(
      "catalogMenu"
    )
    ?.classList.remove(
      "open"
    );


  const parts =
    (
      location.hash ||
      "#/"
    )
      .replace(
        /^#\/?/,
        ""
      )
      .split("/")
      .filter(Boolean)
      .map(
        decodeURIComponent
      );


  const type =
    parts[0];

  const arg =
    parts[1];

  const extra =
    parts[2];


  if (!type) {

    home();

  }

  else if (
    type === "search"
  ) {

    search(
      arg || ""
    );

  }

  else if (
    type === "series" &&
    !arg
  ) {

    listAllSeries();

  }

  else if (
    type === "movies"
  ) {

    /*
     * Aseguramos que estamos usando
     * el catálogo de películas.
     *
     * Si el usuario entra directamente
     * por URL y el catálogo actual
     * no es películas, lo cargamos.
     */

    if (
      currentCatalog !==
      "peliculas"
    ) {

      switchCatalog(
        "peliculas"
      );

      return;
    }


    listMovies();

  }

  else if (
    type === "series" &&
    arg
  ) {

    detail(
      arg,
      extra
    );

  }

  else if (
    type === "airing"
  ) {

    listByStatus(
      "emisión",
      "Donghuas En Emisión"
    );

  }

  else if (
    type === "completed"
  ) {

    listByStatus(
      "finaliz",
      "Donghuas Finalizados"
    );

  }

  else if (
    type === "genres"
  ) {

    listGenres();

  }

  else if (
    type === "genre" &&
    arg
  ) {

    listByGenre(
      arg
    );

  }

  else if (
    type === "mylist"
  ) {

    listMyList();

  }

  else if (
    type === "episode"
  ) {

    episode(
      arg
    );

  }

  else {

    home();
  }


  highlightNav();


  window.scrollTo({
    top: 0,
    behavior: "auto"
  });
}


/* ============================================================
   EVENTOS
   ============================================================ */

window.addEventListener(
  "hashchange",
  route
);


window.addEventListener(
  "scroll",
  () => {

    document
      .querySelector(
        ".nav"
      )
      ?.classList.toggle(
        "scrolled",
        window.scrollY >
          40
      );


    document
      .getElementById(
        "toTop"
      )
      ?.classList.toggle(
        "show",
        window.scrollY >
          500
      );

  },
  {
    passive: true
  }
);


/* ============================================================
   DOM READY
   ============================================================ */

document.addEventListener(
  "DOMContentLoaded",
  () => {

    const reload =
      document.getElementById(
        "reloadBtn"
      );


    if (reload) {

      reload.addEventListener(
        "click",
        async () => {

          reload.style.transform =
            "rotate(360deg)";

          reload.style.transition =
            "transform .5s ease";


          /*
           * No destruimos todos los
           * catálogos innecesariamente.
           *
           * Solo eliminamos la caché
           * del catálogo actual.
           */

          delete DB_CACHE[
            currentCatalog
          ];


          delete CATALOG_STATE[
            currentCatalog
          ];


          CATALOG_AVAILABLE[
            currentCatalog
          ] =
            currentCatalog ===
            "donghua";


          await load();


          setTimeout(
            () => {

              reload.style.transform =
                "none";

            },
            500
          );
        }
      );
    }


    document
      .getElementById(
        "toTop"
      )
      ?.addEventListener(
        "click",
        () =>
          window.scrollTo({
            top: 0,
            behavior:
              "smooth"
          })
      );


    if (
      "serviceWorker" in
      navigator
    ) {

      navigator.serviceWorker
        .register(
          "sw.js"
        )
        .catch(
          () => {}
        );
    }
  }
);


/* ============================================================
   ARRANQUE
   ============================================================ */

load();
