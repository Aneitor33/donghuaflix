import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

/*
============================================================
 DONGHUAFLIX — SCRAPER DE PELÍCULAS PELICINEHD
============================================================

 Fuente:
   https://pelicinehd.com

 Listado:
   /movies/
   /movies/page/2/
   /movies/page/3/
   ...

 Fichas:
   /movies/{slug}/

 Salida:
   public/data/catalog-pelicinehd.json

 IMPORTANTE:
 - Este scraper es específico para PeliCineHD.
 - No utiliza la lógica antigua de Doramasflix.
 - Un HTTP 403 NO se interpreta como catálogo vacío.
 - Si falla el descubrimiento, el catálogo anterior se conserva.
 - Las películas se procesan en paralelo.
 - El número de workers se controla mediante WORKERS.
============================================================
*/


/* =========================================================
   CONFIGURACIÓN
========================================================= */

const BASE_URL = (
  process.env.SOURCE_URL ||
  'https://pelicinehd.com'
).replace(/\/+$/, '');

const OUT_FILE = path.resolve(
  process.env.OUT_FILE ||
  'public/data/catalog-pelicinehd.json'
);

const CATALOG_TAG =
  process.env.CATALOG_TAG ||
  'pelicinehd';

const MOVIES_INDEX =
  process.env.MOVIES_INDEX ||
  '/movies/';

const MOVIES_ARCHIVE =
  process.env.MOVIES_ARCHIVE ||
  '/movies/page/';

const WORKERS = Math.max(
  1,
  Math.min(
    12,
    Number(process.env.WORKERS || 6)
  )
);

const POLITENESS_MS = Math.max(
  0,
  Number(process.env.POLITENESS_MS || 500)
);

const FETCH_TIMEOUT_MS = Math.max(
  5000,
  Number(process.env.REQUEST_TIMEOUT_MS || 30000)
);

const FETCH_RETRIES = Math.max(
  1,
  Number(process.env.RETRIES || 3)
);

const MAX_DISCOVERY_PAGES = Math.max(
  1,
  Number(process.env.MAX_DISCOVERY_PAGES || 150)
);

const INCREMENTAL_PAGES = Math.max(
  1,
  Number(process.env.INCREMENTAL_PAGES || 5)
);

const CHECKPOINT_EVERY = Math.max(
  1,
  Number(process.env.CHECKPOINT_EVERY || 10)
);

const FULL_SYNC =
  String(process.env.FULL_SYNC || 'false').toLowerCase() === 'true' ||
  process.env.FULL_SYNC === '1';

const SERVER_BLACKLIST = (
  process.env.SERVER_BLACKLIST ||
  ''
)
  .split(',')
  .map(x => x.trim().toLowerCase())
  .filter(Boolean);


/* =========================================================
   UTILIDADES
========================================================= */

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

const clean = value =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();

const fold = value =>
  clean(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

function absolute(raw, base = BASE_URL) {
  if (!raw) return null;

  const value = String(raw).trim();

  if (
    !value ||
    /^(javascript:|mailto:|tel:|data:|#)/i.test(value)
  ) {
    return null;
  }

  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

function sameOrigin(url) {
  try {
    return new URL(url).origin === new URL(BASE_URL).origin;
  } catch {
    return false;
  }
}

function normalizeUrl(url) {
  try {
    const u = new URL(url, BASE_URL);

    u.hash = '';

    return u.href;
  } catch {
    return null;
  }
}

function slugFromUrl(url) {
  try {
    const u = new URL(url, BASE_URL);

    const parts = u.pathname
      .split('/')
      .filter(Boolean);

    return decodeURIComponent(
      parts[parts.length - 1] || ''
    );
  } catch {
    return '';
  }
}

function unique(values) {
  return [
    ...new Set(
      values
        .map(normalizeUrl)
        .filter(Boolean)
    )
  ];
}

function isMovieUrl(url) {
  try {
    return new URL(url).pathname.startsWith('/movies/');
  } catch {
    return false;
  }
}

function isArchiveUrl(url) {
  try {
    const p = new URL(url).pathname;

    return (
      p === '/movies/' ||
      /^\/movies\/page\/\d+\/?$/.test(p)
    );
  } catch {
    return false;
  }
}

function moviePageUrl(page) {
  if (page <= 1) {
    return new URL(
      MOVIES_INDEX,
      BASE_URL
    ).href;
  }

  return new URL(
    `${MOVIES_ARCHIVE}${page}/`,
    BASE_URL
  ).href;
}

function isBlacklisted(value) {
  const text = fold(value);

  return SERVER_BLACKLIST.some(
    item => text.includes(item)
  );
}


/* =========================================================
   FETCH
========================================================= */

class HttpError extends Error {
  constructor(message, status, url) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
  }
}

async function fetchText(
  url,
  attempt = 1
) {
  const controller =
    new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    FETCH_TIMEOUT_MS
  );

  try {
    const response = await fetch(
      url,
      {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,

        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',

          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',

          'Accept-Language':
            'es-ES,es;q=0.9,en-US;q=0.7,en;q=0.6',

          'Cache-Control':
            'no-cache',

          'Pragma':
            'no-cache',

          'Upgrade-Insecure-Requests':
            '1'
        }
      }
    );

    if (!response.ok) {
      const retryable = [
        408,
        425,
        429,
        500,
        502,
        503,
        504
      ].includes(response.status);

      /*
       * 403 es importante:
       * NO lo convertimos en una página vacía.
       */
      if (
        retryable &&
        attempt < FETCH_RETRIES
      ) {
        await sleep(
          1500 * attempt
        );

        return fetchText(
          url,
          attempt + 1
        );
      }

      throw new HttpError(
        `HTTP ${response.status}: ${url}`,
        response.status,
        url
      );
    }

    return await response.text();

  } catch (error) {

    if (
      error instanceof HttpError
    ) {
      throw error;
    }

    if (
      attempt < FETCH_RETRIES
    ) {
      await sleep(
        1500 * attempt
      );

      return fetchText(
        url,
        attempt + 1
      );
    }

    throw error;

  } finally {
    clearTimeout(timer);
  }
}


/* =========================================================
   CARGAR CATÁLOGO EXISTENTE
========================================================= */

function emptyCatalog() {
  return {
    meta: {
      version: 2,
      source: `${BASE_URL}/`,
      syncedAt: null,
      lastSync: null
    },

    series: [],

    seasons: [],

    episodes: [],

    genres: []
  };
}

async function loadCatalog() {
  try {
    const text =
      await fs.readFile(
        OUT_FILE,
        'utf8'
      );

    const parsed =
      JSON.parse(text);

    if (
      !parsed ||
      typeof parsed !== 'object'
    ) {
      throw new Error(
        'Catálogo inválido'
      );
    }

    return {
      ...emptyCatalog(),
      ...parsed,

      meta: {
        ...emptyCatalog().meta,
        ...(parsed.meta || {})
      },

      series: Array.isArray(
        parsed.series
      )
        ? parsed.series
        : [],

      seasons: Array.isArray(
        parsed.seasons
      )
        ? parsed.seasons
        : [],

      episodes: Array.isArray(
        parsed.episodes
      )
        ? parsed.episodes
        : [],

      genres: Array.isArray(
        parsed.genres
      )
        ? parsed.genres
        : []
    };

  } catch (error) {

    if (
      error.code === 'ENOENT'
    ) {
      console.log(
        '📁 No existe catálogo anterior. Se creará uno nuevo.'
      );

      return emptyCatalog();
    }

    throw error;
  }
}


/* =========================================================
   GUARDAR CATÁLOGO DE FORMA SEGURA
========================================================= */

async function saveCatalog(catalog) {

  const directory =
    path.dirname(OUT_FILE);

  await fs.mkdir(
    directory,
    {
      recursive: true
    }
  );

  const temporary =
    `${OUT_FILE}.tmp`;

  const json =
    JSON.stringify(
      catalog,
      null,
      2
    );

  await fs.writeFile(
    temporary,
    json,
    'utf8'
  );

  await fs.rename(
    temporary,
    OUT_FILE
  );
}


/* =========================================================
   UPSERT
========================================================= */

function upsert(
  array,
  item
) {
  const index =
    array.findIndex(
      x => x.id === item.id
    );

  if (index === -1) {
    array.push(item);
  } else {
    array[index] = {
      ...array[index],
      ...item
    };
  }
}


/* =========================================================
   DESCUBRIMIENTO DE PELÍCULAS
========================================================= */

function extractMovieLinks(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(html);

  const found = [];

  $('a[href]').each(
    (_, element) => {

      const href =
        $(element).attr('href');

      const url =
        absolute(
          href,
          pageUrl
        );

      if (!url) return;

      if (!sameOrigin(url)) {
        return;
      }

      try {

        const parsed =
          new URL(url);

        const pathname =
          parsed.pathname;

        /*
         * Ficha:
         * /movies/slug/
         *
         * Excluimos:
         * /movies/
         * /movies/page/2/
         */
        if (
          !pathname.startsWith(
            '/movies/'
          )
        ) {
          return;
        }

        if (
          isArchiveUrl(url)
        ) {
          return;
        }

        const slug =
          slugFromUrl(url);

        if (!slug) return;

        found.push(
          normalizeUrl(url)
        );

      } catch {}
    }
  );

  return unique(found);
}


/* =========================================================
   PAGINACIÓN
========================================================= */

function extractPaginationPages(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(html);

  const pages =
    new Set();

  /*
   * Buscamos enlaces reales.
   */
  $('a[href]').each(
    (_, element) => {

      const href =
        $(element).attr('href');

      const url =
        absolute(
          href,
          pageUrl
        );

      if (!url) return;

      if (!sameOrigin(url)) {
        return;
      }

      if (
        !isArchiveUrl(url)
      ) {
        return;
      }

      try {

        const pathname =
          new URL(url).pathname;

        const match =
          pathname.match(
            /^\/movies\/page\/(\d+)\/?$/
          );

        if (match) {
          pages.add(
            Number(match[1])
          );
        } else if (
          pathname === '/movies/' ||
          pathname === '/movies'
        ) {
          pages.add(1);
        }

      } catch {}
    }
  );

  /*
   * También buscamos el número
   * máximo visible en el HTML.
   */
  const matches =
    html.matchAll(
      /\/movies\/page\/(\d+)\/?/gi
    );

  for (const match of matches) {
    const n =
      Number(match[1]);

    if (
      Number.isFinite(n)
    ) {
      pages.add(n);
    }
  }

  return [
    ...pages
  ].filter(
    n =>
      n >= 1 &&
      n <= MAX_DISCOVERY_PAGES
  ).sort(
    (a, b) => a - b
  );
}


/* =========================================================
   RESULTADO DE UNA PÁGINA
========================================================= */

async function readListingPage(
  page
) {
  const url =
    moviePageUrl(page);

  console.log(
    `\n📄 Listado ${page}: ${url}`
  );

  const html =
    await fetchText(url);

  const movies =
    extractMovieLinks(
      html,
      url
    );

  const pages =
    extractPaginationPages(
      html,
      url
    );

  console.log(
    `   🎬 Películas encontradas: ${movies.length}`
  );

  if (pages.length) {
    console.log(
      `   📚 Páginas detectadas: ${pages.slice(0, 15).join(', ')}${pages.length > 15 ? '...' : ''}`
    );
  }

  return {
    url,
    html,
    movies,
    pages
  };
}


/* =========================================================
   DESCUBRIMIENTO COMPLETO
========================================================= */

async function fullDiscovery() {

  console.log(
    '\n===================================================='
  );

  console.log(
    '🔎 DESCUBRIMIENTO COMPLETO PELICINEHD'
  );

  console.log(
    '===================================================='
  );

  const all =
    new Set();

  const visited =
    new Set();

  /*
   * Primera página.
   */
  const first =
    await readListingPage(1);

  first.movies.forEach(
    url => all.add(url)
  );

  visited.add(1);

  /*
   * Usamos las páginas detectadas
   * por el propio sitio.
   */
  const queue =
    [...first.pages]
      .filter(n => n > 1);

  /*
   * Aunque el HTML solo muestre
   * "1 2 3 ... 109", iremos
   * comprobando secuencialmente.
   */
  let nextPage = 2;

  while (
    nextPage <= MAX_DISCOVERY_PAGES
  ) {

    if (
      !queue.includes(nextPage)
    ) {
      queue.push(nextPage);
    }

    nextPage++;
  }

  queue.sort(
    (a, b) => a - b
  );

  for (
    const page of queue
  ) {

    if (
      visited.has(page)
    ) {
      continue;
    }

    visited.add(page);

    let result;

    try {

      result =
        await readListingPage(
          page
        );

    } catch (error) {

      /*
       * MUY IMPORTANTE:
       * si recibimos 403 durante
       * el descubrimiento, abortamos.
       *
       * No interpretamos esto
       * como "no hay más películas".
       */
      if (
        error instanceof HttpError &&
        error.status === 403
      ) {
        throw new Error(
          `PeliCineHD bloqueó el acceso con HTTP 403 en la página ${page}. ` +
          `No se modificará el catálogo existente.`
        );
      }

      console.log(
        `   ⚠️ No se pudo leer página ${page}: ${error.message}`
      );

      /*
       * Un error temporal no significa
       * automáticamente que terminó el catálogo.
       */
      continue;
    }

    result.movies.forEach(
      url => all.add(url)
    );

    /*
     * Si una página no tiene películas,
     * tenemos una señal fuerte de final.
     *
     * Pero no detenemos inmediatamente
     * si todavía había páginas detectadas.
     */
    if (
      result.movies.length === 0 &&
      page > 2
    ) {

      console.log(
        `   🛑 Página ${page} sin películas. Fin probable del archivo.`
      );

      /*
       * Solo terminamos si las siguientes
       * páginas tampoco estaban anunciadas.
       */
      const announcedLater =
        result.pages.some(
          p => p > page
        );

      if (!announcedLater) {
        break;
      }
    }

    await sleep(
      POLITENESS_MS
    );
  }

  console.log(
    `\n🎯 TOTAL DE PELÍCULAS DESCUBIERTAS: ${all.size}`
  );

  return [
    ...all
  ];
}


/* =========================================================
   DESCUBRIMIENTO INCREMENTAL
========================================================= */

async function incrementalDiscovery(
  existing
) {

  console.log(
    '\n===================================================='
  );

  console.log(
    '⚡ DESCUBRIMIENTO INCREMENTAL'
  );

  console.log(
    '===================================================='
  );

  const known =
    new Set(
      existing
        .map(
          item =>
            normalizeUrl(
              item.sourceUrl
            )
        )
        .filter(Boolean)
    );

  const discovered =
    new Set();

  let consecutiveOldPages = 0;

  /*
   * Revisamos las primeras páginas.
   *
   * Esto permite detectar películas
   * nuevas al principio del archivo.
   */
  for (
    let page = 1;
    page <= INCREMENTAL_PAGES;
    page++
  ) {

    let result;

    try {

      result =
        await readListingPage(
          page
        );

    } catch (error) {

      if (
        error instanceof HttpError &&
        error.status === 403
      ) {
        throw new Error(
          `PeliCineHD bloqueó el acceso con HTTP 403 en la página ${page}. ` +
          `El catálogo existente se conserva sin cambios.`
        );
      }

      console.log(
        `   ⚠️ Error en página ${page}: ${error.message}`
      );

      break;
    }

    let newOnPage = 0;

    for (
      const movieUrl
      of result.movies
    ) {

      discovered.add(
        movieUrl
      );

      if (
        !known.has(movieUrl)
      ) {
        newOnPage++;
      }
    }

    console.log(
      `   🆕 Nuevas en página ${page}: ${newOnPage}`
    );

    if (
      newOnPage === 0
    ) {
      consecutiveOldPages++;
    } else {
      consecutiveOldPages = 0;
    }

    /*
     * Si tenemos varias páginas seguidas
     * completamente conocidas, normalmente
     * ya estamos fuera de la zona nueva.
     */
    if (
      consecutiveOldPages >= 2
    ) {

      console.log(
        '   🛑 Varias páginas consecutivas sin novedades.'
      );

      break;
    }

    await sleep(
      POLITENESS_MS
    );
  }

  console.log(
    `\n🎯 URLs comprobadas incrementalmente: ${discovered.size}`
  );

  return [
    ...discovered
  ];
}


/* =========================================================
   EXTRAER TEXTO DE UN ELEMENTO
========================================================= */

function textOf(
  $,
  selector
) {
  return clean(
    $(selector)
      .first()
      .text()
  );
}


/* =========================================================
   PORTADA
========================================================= */

function extractPoster(
  $,
  url
) {

  const og =
    absolute(
      $(
        'meta[property="og:image"]'
      ).attr('content'),
      url
    );

  if (og) {
    return og;
  }

  const twitter =
    absolute(
      $(
        'meta[name="twitter:image"]'
      ).attr('content'),
      url
    );

  if (twitter) {
    return twitter;
  }

  let result = null;

  $('img').each(
    (_, element) => {

      if (result) return;

      const src =
        $(
          element
        ).attr('data-src') ||
        $(
          element
        ).attr('data-lazy-src') ||
        $(
          element
        ).attr('src');

      const image =
        absolute(
          src,
          url
        );

      if (!image) return;

      if (
        /logo|icon|avatar/i.test(
          image
        )
      ) {
        return;
      }

      result = image;
    }
  );

  return result;
}


/* =========================================================
   GÉNEROS
========================================================= */

function extractGenres(
  $,
  url
) {

  const genres =
    new Set();

  /*
   * Primero intentamos enlaces
   * de taxonomías/géneros.
   */
  $('a[href]').each(
    (_, element) => {

      const text =
        clean(
          $(element).text()
        );

      if (!text) return;

      const href =
        absolute(
          $(element).attr('href'),
          url
        );

      if (!href) return;

      try {

        const pathname =
          new URL(href).pathname;

        if (
          /genre|genero|género/i.test(
            pathname
          )
        ) {
          genres.add(text);
        }

      } catch {}
    }
  );

  /*
   * En las fichas de PeliCineHD
   * los géneros suelen aparecer juntos
   * cerca de la duración/año.
   */
  if (
    genres.size === 0
  ) {

    const body =
      clean(
        $('body').text()
      );

    const h1 =
      textOf($, 'h1');

    const start =
      h1
        ? body.indexOf(h1)
        : -1;

    if (start >= 0) {

      const fragment =
        body.slice(
          start,
          start + 700
        );

      /*
       * Ejemplo:
       * "Acción, Ciencia ficción, Suspense 1h 46m 2026"
       */
      const match =
        fragment.match(
          /^.*?\n?\s*([^0-9]{2,150}?)\s+\d+\s*h(?:\s*\d+\s*m)?/i
        );

      if (match) {

        const raw =
          clean(
            match[1]
          );

        if (
          raw &&
          raw.length < 180
        ) {

          raw
            .split(',')
            .map(clean)
            .filter(
              x =>
                x.length > 1 &&
                x.length < 50
            )
            .forEach(
              x => genres.add(x)
            );
        }
      }
    }
  }

  return [
    ...genres
  ];
}


/* =========================================================
   AÑO
========================================================= */

function extractYear(
  $,
  title
) {

  const body =
    clean(
      $('body').text()
    );

  const candidates = [
    body.match(
      /(?:estreno|año|fecha)[^0-9]{0,30}((?:19|20)\d{2})/i
    ),

    body.match(
      /\b((?:19|20)\d{2})\b/
    ),

    title.match(
      /\b((?:19|20)\d{2})\b/
    )
  ];

  for (
    const match
    of candidates
  ) {

    if (match) {
      return Number(
        match[1]
      );
    }
  }

  return null;
}


/* =========================================================
   DURACIÓN
========================================================= */

function extractRuntime(
  $
) {

  const body =
    clean(
      $('body').text()
    );

  const match =
    body.match(
      /\b(\d{1,2})\s*h(?:\s*(\d{1,2})\s*m)?\b/i
    );

  if (!match) {
    return null;
  }

  const hours =
    Number(
      match[1]
    );

  const minutes =
    match[2]
      ? Number(match[2])
      : 0;

  return {
    hours,
    minutes,
    text:
      minutes
        ? `${hours}h ${minutes}m`
        : `${hours}h`
  };
}


/* =========================================================
   TMDB
========================================================= */

function extractTmdb(
  $,
  body
) {

  const selectors = [
    '[class*="tmdb"]',
    '[id*="tmdb"]'
  ];

  for (
    const selector
    of selectors
  ) {

    const text =
      textOf(
        $,
        selector
      );

    const match =
      text.match(
        /(\d+(?:\.\d+)?)/
      );

    if (match) {
      return Number(
        match[1]
      );
    }
  }

  const match =
    body.match(
      /(\d+(?:\.\d+)?)\s*TMDB/i
    );

  if (match) {
    return Number(
      match[1]
    );
  }

  return null;
}


/* =========================================================
   SINOPSIS
========================================================= */

function extractSynopsis(
  $,
  title
) {

  const candidates = [];

  /*
   * Meta description.
   */
  const description =
    clean(
      $(
        'meta[name="description"]'
      ).attr('content')
    );

  if (
    description &&
    description.length > 40
  ) {
    candidates.push(
      description
    );
  }

  /*
   * OpenGraph description.
   */
  const og =
    clean(
      $(
        'meta[property="og:description"]'
      ).attr('content')
    );

  if (
    og &&
    og.length > 40
  ) {
    candidates.push(
      og
    );
  }

  /*
   * Párrafos.
   */
  $('p').each(
    (_, element) => {

      const text =
        clean(
          $(element).text()
        );

      if (
        text.length >= 80 &&
        text.length <= 1500
      ) {
        candidates.push(
          text
        );
      }
    }
  );

  for (
    const candidate
    of candidates
  ) {

    const folded =
      fold(candidate);

    if (
      folded.includes(
        'utiliza el navegador'
      ) ||
      folded.includes(
        'bloqueador de anuncios'
      ) ||
      folded.includes(
        'telegram'
      )
    ) {
      continue;
    }

    if (
      fold(candidate)
        .includes(
          fold(title)
        )
    ) {
      /*
       * No descartamos automáticamente:
       * algunas descripciones incluyen
       * el título.
       */
    }

    return candidate;
  }

  return null;
}


/* =========================================================
   DIRECTOR / ACTORES
========================================================= */

function extractLabeledList(
  $,
  labels
) {

  const result = [];

  $('body *').each(
    (_, element) => {

      const text =
        clean(
          $(element).text()
        );

      if (
        !text ||
        text.length > 400
      ) {
        return;
      }

      const normalized =
        fold(text);

      const label =
        labels.find(
          x =>
            normalized ===
            fold(x)
        );

      if (!label) {
        return;
      }

      let value = '';

      const next =
        $(element)
          .next()
          .text();

      if (
        clean(next)
      ) {
        value =
          clean(next);
      }

      if (!value) {
        const parentText =
          clean(
            $(element)
              .parent()
              .text()
          );

        const re =
          new RegExp(
            `^${label}\\s*[:\\-]?\\s*(.+)$`,
            'i'
          );

        const match =
          parentText.match(re);

        if (match) {
          value =
            clean(
              match[1]
            );
        }
      }

      if (
        value &&
        value.length < 1000
      ) {

        value
          .split(',')
          .map(clean)
          .filter(Boolean)
          .forEach(
            x => result.push(x)
          );
      }
    }
  );

  return [
    ...new Set(result)
  ];
}


/* =========================================================
   SERVIDORES / OPCIONES
========================================================= */

function cleanServerName(
  raw
) {

  return clean(
    String(raw || '')
      .replace(
        /^opci[oó]n\s*\d+\s*/i,
        ''
      )
      .replace(
        /^\d+\s*[.\-:]\s*/,
        ''
      )
  );
}

function detectLanguage(
  text
) {

  const t =
    fold(text);

  if (
    /subtit|subtitul/.test(t)
  ) {
    return 'SUBTITULADO';
  }

  if (
    /castellano|cast|espanol|español/.test(t)
  ) {
    return 'CAS';
  }

  if (
    /latino|lat\b/.test(t)
  ) {
    return 'LAT';
  }

  if (
    /ingles|inglés|english/.test(t)
  ) {
    return 'INGLES';
  }

  if (
    /dual/.test(t)
  ) {
    return 'DUAL';
  }

  return null;
}

function detectQuality(
  text
) {

  const t =
    fold(text);

  if (
    /\b2160p\b|\b4k\b/.test(t)
  ) {
    return '4K';
  }

  if (
    /\b1080p\b|\bfhd\b/.test(t)
  ) {
    return '1080P';
  }

  if (
    /\b720p\b|\bhd\b/.test(t)
  ) {
    return 'HD';
  }

  if (
    /\bcam\b/.test(t)
  ) {
    return 'CAM';
  }

  return null;
}

function extractUrlFromElement(
  $,
  element,
  pageUrl
) {

  const attrs = [
    'href',
    'data-url',
    'data-link',
    'data-src',
    'data-embed',
    'data-player',
    'data-server',
    'data-href'
  ];

  for (
    const attr
    of attrs
  ) {

    const value =
      $(element).attr(
        attr
      );

    const url =
      absolute(
        value,
        pageUrl
      );

    if (url) {
      return url;
    }
  }

  return null;
}

function extractServers(
  $,
  html,
  pageUrl
) {

  const servers = [];

  const seen =
    new Set();

  function addServer({
    name,
    url,
    label
  }) {

    const cleanNameValue =
      cleanServerName(
        name || label || 'Servidor'
      );

    if (
      !cleanNameValue
    ) {
      return;
    }

    /*
     * No guardamos basura.
     */
    if (
      isBlacklisted(
        `${cleanNameValue} ${url || ''}`
      )
    ) {
      return;
    }

    const language =
      detectLanguage(
        label ||
        cleanNameValue
      );

    const quality =
      detectQuality(
        label ||
        cleanNameValue
      );

    const key =
      `${fold(cleanNameValue)}|${url || ''}|${language || ''}|${quality || ''}`;

    if (
      seen.has(key)
    ) {
      return;
    }

    seen.add(key);

    servers.push({
      name:
        cleanNameValue,

      url:
        url || null,

      lang:
        language,

      quality:
        quality,

      label:
        clean(
          label ||
          cleanNameValue
        )
    });
  }


  /*
   * OPCIONES / BOTONES
   */
  $('a, button, li, div, span').each(
    (_, element) => {

      const text =
        clean(
          $(element).text()
        );

      if (
        !text ||
        text.length > 180
      ) {
        return;
      }

      /*
       * Solo nos interesan elementos
       * que parezcan opciones de servidor.
       */
      const looksLikeOption =
        /opci[oó]n\s*\d+/i.test(text) ||
        /\b(?:minochinos|voe|morencius|streamwish|strwish|wishonly|filemoon|media)\b/i.test(text);

      if (
        !looksLikeOption
      ) {
        return;
      }

      const url =
        extractUrlFromElement(
          $,
          element,
          pageUrl
        );

      addServer({
        name: text,
        label: text,
        url
      });
    }
  );


  /*
   * IFRAME.
   */
  $('iframe[src]').each(
    (_, element) => {

      const url =
        absolute(
          $(element).attr('src'),
          pageUrl
        );

      if (!url) {
        return;
      }

      const surrounding =
        clean(
          $(element)
            .parent()
            .text()
        );

      addServer({
        name:
          surrounding ||
          new URL(url).hostname,

        label:
          surrounding ||
          new URL(url).hostname,

        url
      });
    }
  );


  /*
   * DATA-*.
   */
  $(
    '[data-url], [data-link], [data-src], [data-embed], [data-player], [data-server]'
  ).each(
    (_, element) => {

      const url =
        extractUrlFromElement(
          $,
          element,
          pageUrl
        );

      if (!url) {
        return;
      }

      const text =
        clean(
          $(element).text()
        );

      const attrs =
        Object.entries(
          element.attribs || {}
        )
          .map(
            ([key, value]) =>
              `${key}=${value}`
          )
          .join(' ');

      const label =
        `${text} ${attrs}`.trim();

      addServer({
        name:
          text ||
          new URL(url).hostname,

        label,

        url
      });
    }
  );


  /*
   * URLs explícitas dentro de scripts.
   *
   * No hacemos ninguna petición adicional:
   * simplemente aprovechamos URLs que
   * ya están públicamente presentes
   * en el HTML recibido.
   */
  const urlRegex =
    /https?:\/\/[^\s"'<>\\]+/gi;

  for (
    const match
    of html.matchAll(urlRegex)
  ) {

    const raw =
      match[0]
        .replace(
          /[),;]+$/,
          ''
        );

    let url;

    try {
      url =
        new URL(raw).href;
    } catch {
      continue;
    }

    const host =
      new URL(url).hostname;

    /*
     * Solo si parece servidor de vídeo.
     */
    if (
      !/(voe|minochinos|morencius|streamwish|strwish|wishonly|filemoon|media|stream)/i.test(
        host
      )
    ) {
      continue;
    }

    addServer({
      name: host,
      label: host,
      url
    });
  }

  return servers;
}


/* =========================================================
   PARSEO DE UNA PELÍCULA
========================================================= */

function parseMovie(
  html,
  url
) {

  const $ =
    cheerio.load(html);

  const slug =
    slugFromUrl(url);

  const title =
    clean(
      $('h1')
        .first()
        .text()
    ) ||
    clean(
      $(
        'meta[property="og:title"]'
      ).attr('content')
    ) ||
    slug
      .replace(
        /-/g,
        ' '
      )
      .replace(
        /\b\w/g,
        x => x.toUpperCase()
      );

  const body =
    clean(
      $('body').text()
    );

  const image =
    extractPoster(
      $,
      url
    );

  const genres =
    extractGenres(
      $,
      url
    );

  const year =
    extractYear(
      $,
      title
    );

  const runtime =
    extractRuntime(
      $
    );

  const synopsis =
    extractSynopsis(
      $,
      title
    );

  const directors =
    extractLabeledList(
      $,
      [
        'Director',
        'Directores'
      ]
    );

  const actors =
    extractLabeledList(
      $,
      [
        'Actores',
        'Actores principales'
      ]
    );

  const tmdb =
    extractTmdb(
      $,
      body
    );

  const servers =
    extractServers(
      $,
      html,
      url
    );

  /*
   * Calidad general de la ficha.
   */
  let quality = null;

  const qualityMatch =
    body.match(
      /\b(4K|2160p|FHD|1080p|HD|720p|CAM)\b/i
    );

  if (qualityMatch) {
    quality =
      qualityMatch[1]
        .toUpperCase();
  }

  return {
    id: slug,
    slug,

    title,

    image:
      image || null,

    synopsis:
      synopsis || null,

    year,

    runtime:
      runtime
        ? runtime.text
        : null,

    runtimeMinutes:
      runtime
        ? (
            runtime.hours * 60 +
            runtime.minutes
          )
        : null,

    quality,

    tmdb,

    genres,

    directors,

    actors,

    servers,

    sourceUrl:
      normalizeUrl(url)
  };
}


/* =========================================================
   CONVERTIR PELÍCULA AL ESQUEMA DEL CATÁLOGO
========================================================= */

function movieToCatalog(
  movie,
  oldMovie,
  now
) {

  const movieId =
    movie.id;

  /*
   * Mantenemos la película
   * dentro de "series" porque
   * ese es el esquema que ya utiliza
   * el frontend actual.
   */
  const seriesItem = {
    ...(oldMovie || {}),

    id:
      movieId,

    slug:
      movie.slug,

    title:
      movie.title,

    image:
      movie.image ||
      oldMovie?.image ||
      null,

    synopsis:
      movie.synopsis ||
      oldMovie?.synopsis ||
      null,

    year:
      movie.year ||
      oldMovie?.year ||
      null,

    runtime:
      movie.runtime ||
      oldMovie?.runtime ||
      null,

    runtimeMinutes:
      movie.runtimeMinutes ||
      oldMovie?.runtimeMinutes ||
      null,

    quality:
      movie.quality ||
      oldMovie?.quality ||
      null,

    tmdb:
      movie.tmdb ??
      oldMovie?.tmdb ??
      null,

    genres:
      movie.genres.length
        ? movie.genres
        : (
            oldMovie?.genres ||
            []
          ),

    directors:
      movie.directors.length
        ? movie.directors
        : (
            oldMovie?.directors ||
            []
          ),

    actors:
      movie.actors.length
        ? movie.actors
        : (
            oldMovie?.actors ||
            []
          ),

    contentType:
      'movie',

    type:
      CATALOG_TAG,

    status:
      'Finalizado',

    country:
      oldMovie?.country ||
      null,

    totalEpisodes:
      1,

    sourceUrl:
      movie.sourceUrl,

    updatedAt:
      now
  };

  /*
   * La película se representa como
   * un único "episodio" para que
   * el reproductor existente pueda
   * seguir utilizando el mismo modelo.
   */
  const episodeId =
    `${movie.slug}-pelicula`;

  const episode = {
    id:
      episodeId,

    slug:
      episodeId,

    title:
      movie.title,

    sourceUrl:
      movie.sourceUrl,

    servers:
      movie.servers,

    seriesId:
      movieId,

    seasonId:
      `${movieId}-1`,

    number:
      1,

    updatedAt:
      now
  };

  const season = {
    id:
      `${movieId}-1`,

    slug:
      `${movieId}-1`,

    seriesId:
      movieId,

    sourceUrl:
      movie.sourceUrl,

    number:
      1,

    image:
      movie.image ||
      null,

    episodeCount:
      1,

    initialSyncComplete:
      true,

    updatedAt:
      now
  };

  return {
    seriesItem,
    season,
    episode
  };
}


/* =========================================================
   WORKERS
========================================================= */

async function processMovies(
  catalog,
  movieUrls
) {

  console.log(
    '\n===================================================='
  );

  console.log(
    `⚡ PROCESANDO ${movieUrls.length} PELÍCULAS`
  );

  console.log(
    `⚙️ Workers: ${WORKERS}`
  );

  console.log(
    '===================================================='
  );

  const allGenres =
    new Set(
      catalog.genres || []
    );

  let cursor = 0;

  let completed = 0;

  let success = 0;

  let errors = 0;

  let changed = 0;

  let saveCounter = 0;

  async function worker() {

    while (true) {

      const index =
        cursor++;

      if (
        index >= movieUrls.length
      ) {
        break;
      }

      const url =
        movieUrls[index];

      const slug =
        slugFromUrl(url);

      console.log(
        `\n🎬 [${index + 1}/${movieUrls.length}] ${slug}`
      );

      try {

        const html =
          await fetchText(url);

        const movie =
          parseMovie(
            html,
            url
          );

        /*
         * Si la ficha devuelve HTML
         * pero no tiene título real,
         * no la guardamos como película.
         */
        if (
          !movie.title ||
          movie.title === slug
        ) {
          throw new Error(
            'Ficha sin título válido'
          );
        }

        const old =
          catalog.series.find(
            item =>
              item.id ===
              movie.id
          );

        const previousEpisode =
          catalog.episodes.find(
            episode =>
              episode.id ===
              `${movie.slug}-pelicula`
          );

        const before =
          JSON.stringify({
            title:
              old?.title,
            image:
              old?.image,
            synopsis:
              old?.synopsis,
            year:
              old?.year,
            servers:
              previousEpisode?.servers ||
              []
          });

        const now =
          new Date().toISOString();

        const converted =
          movieToCatalog(
            movie,
            old,
            now
          );

        upsert(
          catalog.series,
          converted.seriesItem
        );

        upsert(
          catalog.seasons,
          converted.season
        );

        upsert(
          catalog.episodes,
          converted.episode
        );

        movie.genres.forEach(
          genre =>
            allGenres.add(genre)
        );

        const after =
          JSON.stringify({
            title:
              converted.seriesItem.title,

            image:
              converted.seriesItem.image,

            synopsis:
              converted.seriesItem.synopsis,

            year:
              converted.seriesItem.year,

            servers:
              converted.episode.servers
          });

        if (
          before !== after
        ) {
          changed++;
        }

        success++;

        const serverNames =
          movie.servers
            .map(
              server =>
                server.lang
                  ? `${server.name}[${server.lang}]`
                  : server.name
            )
            .join(', ');

        console.log(
          `   ✅ ${movie.title}`
        );

        console.log(
          `   📅 Año: ${movie.year || '—'}`
        );

        console.log(
          `   🎭 Géneros: ${movie.genres.join(', ') || '—'}`
        );

        console.log(
          `   🎥 Servidores: ${serverNames || 'NINGUNO'}`
        );

        completed++;

        /*
         * Checkpoint.
         */
        saveCounter++;

        if (
          saveCounter >= CHECKPOINT_EVERY
        ) {

          saveCounter = 0;

          catalog.genres =
            [
              ...allGenres
            ].sort(
              (a, b) =>
                a.localeCompare(
                  b,
                  'es'
                )
            );

          await saveCatalog(
            catalog
          );

          console.log(
            `   💾 Checkpoint guardado (${completed}/${movieUrls.length})`
          );
        }

      } catch (error) {

        errors++;

        console.log(
          `   ❌ Error: ${error.message}`
        );

        /*
         * Un 403 durante una ficha
         * NO elimina la película existente.
         */
        if (
          error instanceof HttpError &&
          error.status === 403
        ) {

          console.log(
            '   ⚠️ HTTP 403 en ficha. Se conserva la versión anterior.'
          );
        }

      }

      await sleep(
        POLITENESS_MS
      );
    }
  }

  await Promise.all(
    Array.from(
      {
        length: WORKERS
      },
      () => worker()
    )
  );

  catalog.genres =
    [
      ...allGenres
    ].sort(
      (a, b) =>
        a.localeCompare(
          b,
          'es'
        )
    );

  await saveCatalog(
    catalog
  );

  console.log(
    '\n===================================================='
  );

  console.log(
    '📊 RESULTADO DEL PROCESAMIENTO'
  );

  console.log(
    '===================================================='
  );

  console.log(
    `📚 Procesadas: ${completed}`
  );

  console.log(
    `✅ Correctas: ${success}`
  );

  console.log(
    `🔄 Modificadas/nuevas: ${changed}`
  );

  console.log(
    `❌ Errores: ${errors}`
  );

  console.log(
    `📦 Películas en catálogo: ${catalog.series.length}`
  );

  console.log(
    `🎥 Entradas de reproducción: ${catalog.episodes.length}`
  );

  console.log(
    '====================================================\n'
  );
}


/* =========================================================
   MAIN
========================================================= */

async function main() {

  const startedAt =
    new Date().toISOString();

  console.log(
    '\n===================================================='
  );

  console.log(
    '🎬 PELICINEHD CATALOG SYNC'
  );

  console.log(
    '===================================================='
  );

  console.log(
    `Fuente: ${BASE_URL}`
  );

  console.log(
    `Listado: ${new URL(MOVIES_INDEX, BASE_URL).href}`
  );

  console.log(
    `Workers: ${WORKERS}`
  );

  console.log(
    `Modo: ${FULL_SYNC ? 'COMPLETO' : 'INCREMENTAL'}`
  );

  console.log(
    `Archivo: ${OUT_FILE}`
  );

  console.log(
    '====================================================\n'
  );


  const catalog =
    await loadCatalog();

  const existingMovies =
    catalog.series.filter(
      item =>
        item.contentType === 'movie' ||
        item.type === CATALOG_TAG ||
        isMovieUrl(
          item.sourceUrl || ''
        )
    );


  console.log(
    `📦 Catálogo existente: ${existingMovies.length} películas`
  );


  let movieUrls;


  /*
   * ======================================================
   * DESCUBRIMIENTO
   * ======================================================
   */

  if (
    FULL_SYNC ||
    existingMovies.length === 0
  ) {

    console.log(
      '\n🆕 Primera sincronización o sincronización completa.'
    );

    movieUrls =
      await fullDiscovery();

  } else {

    movieUrls =
      await incrementalDiscovery(
        existingMovies
      );
  }


  /*
   * ======================================================
   * PROTECCIÓN CONTRA CATÁLOGO VACÍO
   * ======================================================
   */

  if (
    movieUrls.length === 0
  ) {

    /*
     * Si ya había películas,
     * no hacemos absolutamente nada.
     */
    if (
      existingMovies.length > 0
    ) {

      console.log(
        '\n⚠️ No se encontraron nuevas películas.'
      );

      console.log(
        '📦 El catálogo existente se conserva.'
      );

      catalog.meta = {
        ...(catalog.meta || {}),

        version: 2,

        source:
          `${BASE_URL}/`,

        syncedAt:
          new Date().toISOString(),

        lastSync: {
          status:
            'success',

          type:
            FULL_SYNC
              ? 'full-no-results'
              : 'incremental-no-results',

          startedAt,

          finishedAt:
            new Date().toISOString(),

          error:
            null
        }
      };

      await saveCatalog(
        catalog
      );

      return;
    }

    /*
     * Primera sincronización sin resultados:
     * esto SÍ es un error.
     */
    throw new Error(
      'La primera sincronización no encontró ninguna película. ' +
      'El catálogo NO será generado como vacío.'
    );
  }


  /*
   * ======================================================
   * DEDUPLICAR
   * ======================================================
   */

  movieUrls =
    unique(
      movieUrls
        .filter(
          isMovieUrl
        )
    );

  console.log(
    `\n🎯 Fichas únicas a procesar: ${movieUrls.length}`
  );


  /*
   * ======================================================
   * PROCESAR
   * ======================================================
   */

  await processMovies(
    catalog,
    movieUrls
  );


  /*
   * ======================================================
   * METADATA FINAL
   * ======================================================
 */

  catalog.meta = {
    ...(catalog.meta || {}),

    version: 2,

    source:
      `${BASE_URL}/`,

    syncedAt:
      new Date().toISOString(),

    lastSync: {
      status:
        'success',

      type:
        FULL_SYNC ||
        existingMovies.length === 0
          ? 'full'
          : 'incremental',

      startedAt,

      finishedAt:
        new Date().toISOString(),

      discovered:
        movieUrls.length,

      error:
        null
    }
  };


  await saveCatalog(
    catalog
  );


  /*
   * ======================================================
   * RESUMEN
   * ======================================================
   */

  console.log(
    '\n===================================================='
  );

  console.log(
    '🎉 SINCRONIZACIÓN TERMINADA'
  );

  console.log(
    '===================================================='
  );

  console.log(
    `🎬 Películas: ${catalog.series.length}`
  );

  console.log(
    `📺 Reproducciones: ${catalog.episodes.length}`
  );

  console.log(
    `📚 Temporadas: ${catalog.seasons.length}`
  );

  console.log(
    `🎭 Géneros: ${catalog.genres.length}`
  );

  console.log(
    `💾 Archivo: ${OUT_FILE}`
  );

  console.log(
    '====================================================\n'
  );
}


/* =========================================================
   ERROR GLOBAL
========================================================= */

main()
  .catch(
    async error => {

      console.error(
        '\n===================================================='
      );

      console.error(
        '💥 SINCRONIZACIÓN FALLIDA'
      );

      console.error(
        '===================================================='
      );

      console.error(
        error?.message ||
        error
      );

      console.error(
        '\n🛡️ El catálogo existente NO se ha reemplazado por uno vacío.'
      );

      console.error(
        '====================================================\n'
      );

      /*
       * Intentamos marcar el error
       * únicamente si el catálogo ya existía.
       */
      try {

        const catalog =
          await loadCatalog();

        if (
          catalog.series.length > 0
        ) {

          catalog.meta = {
            ...(catalog.meta || {}),

            lastSync: {
              status:
                'error',

              finishedAt:
                new Date().toISOString(),

              error:
                String(
                  error?.message ||
                  error
                )
            }
          };

          await saveCatalog(
            catalog
          );
        }

      } catch {}

      process.exitCode = 1;
    }
  );
