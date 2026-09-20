import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.resolve(process.env.OUT_FILE || 'public/data/catalog-donghualife.json');

const SEEDS = [
  '/series',
  '/donghuas',
  '/en-emision',
  '/finalizado',
  '/en-pausa',
  '/'
];

const MAX_DISCOVERY_PAGES = 200;
const MAX_EPISODES_PER_SEASON_SAFETY = 100000;

const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;

// WORKERS: 8 en paralelo (configurable)
const WORKERS = Math.max(1, Math.min(20, Number(process.env.WORKERS || 10)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);

/* Pool simple de workers */
async function runPool(items, workers, fn) {
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const it = items[i++];
      try { await fn(it); } catch (e) { console.log(`   ⚠️ ${e.message}`); }
      await sleep(POLITENESS_MS);
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

/*
   Mínimo de páginas que queremos comprobar
   por temporada.

   La página base cuenta como la primera.
   Por eso comprobaremos además page=1..4.
*/
const MIN_SEASON_PAGE_PROBES = 5;

/*
   Protección para no generar infinitamente
   URLs de episodios cuando intentamos completar
   huecos mediante el patrón aprendido.
*/
const MAX_INFERRED_EPISODE_ATTEMPTS = 20;

/*
   Límite de pasos de la cadena "Siguiente episodio".
   2000 es más que de sobra para las temporadas más largas.
*/
const MAX_CHAIN_STEPS = 2000;


/* =========================================================
   COLA DE GUARDADO

   Con 10 workers en paralelo NO podemos escribir el
   catálogo a la vez: encolamos los guardados para que
   se ejecuten de uno en uno, siempre con el estado
   más reciente de la base de datos.
========================================================= */

let saveQueue =
  Promise.resolve();


function enqueueSave(db) {
  saveQueue =
    saveQueue
      .then(
        () =>
          saveCatalog(db)
      )
      .catch(
        error =>
          console.log(
            `⚠️ Error guardando catálogo: ${error.message}`
          )
      );


  return saveQueue;
}

// Bloqueo global para evitar ejecuciones simultáneas (Mejora 16)
let isSyncRunning = false;


/* =========================================================
   UTILIDADES
========================================================= */

const clean = value =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();


async function sleep(ms) {
  await new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


/* =========================================================
   URLS
========================================================= */

function absolute(raw, base = BASE_URL) {
  if (!raw) return null;

  const value = String(raw).trim();

  if (
    !value ||
    /^(javascript:|mailto:|tel:|#)/i.test(value)
  ) {
    return null;
  }

  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}


function canonical(raw) {
  const url = absolute(raw);

  if (!url) return null;

  try {
    const u = new URL(url);

    u.hash = '';
    u.hostname = u.hostname.toLowerCase();

    if (u.pathname.length > 1) {
      u.pathname =
        u.pathname.replace(/\/+$/, '');
    }

    return u.href;

  } catch {
    return null;
  }
}


/*
   Para las páginas de temporadas:

   /temporada-x
   /temporada-x?page=0

   se consideran la misma página.

   Esto es importante porque algunas páginas
   muestran explícitamente "page=0" y otras no.
*/
function canonicalSeasonPage(raw) {
  const url =
    canonical(raw);

  if (!url) {
    return null;
  }

  try {

    const u =
      new URL(url);

    const page =
      u.searchParams.get('page');

    if (
      page === '0'
    ) {
      u.searchParams.delete('page');
    }

    return u.href;

  } catch {
    return url;
  }
}


function slugFromUrl(raw) {
  try {

    const u =
      new URL(
        raw,
        BASE_URL
      );

    const parts =
      u.pathname
        .split('/')
        .filter(Boolean);

    return decodeURIComponent(
      parts.at(-1) || ''
    ).replace(/\/$/, '');

  } catch {
    return '';
  }
}


function sameOrigin(url) {
  try {

    return (
      new URL(url).origin ===
      new URL(BASE_URL).origin
    );

  } catch {
    return false;
  }
}


function uniqueUrls(values) {
  return [
    ...new Set(
      values
        .map(canonical)
        .filter(Boolean)
    )
  ];
}


/* =========================================================
   NUMERACIÓN
========================================================= */

function seasonNumber(value) {

  const slug =
    typeof value === 'string' &&
    value.includes('/')
      ? slugFromUrl(value)
      : String(value || '');


  const match =
    slug.match(
      /(?:^|-)season-(\d+)(?:-|$)/i
    ) ||
    slug.match(
      /-(\d+)(?:-0)?$/
    );


  if (match) {
    return Number(match[1]);
  }


  const generic =
    slug.match(
      /(?:^|[- ])(?:temporada|season)[- ]?(\d+)/i
    );


  return generic
    ? Number(generic[1])
    : null;
}


function episodeNumber(value) {

  const text =
    String(value || '');


  const patterns = [

    /(?:episodio|episode)[-_ ]?x?(\d+)/i,

    /(?:^|[-_ ])x(\d+)(?:$|[-_ ])/i,

    /(?:episode|episodio)[-_ ]?(\d+)/i

  ];


  for (
    const pattern
    of patterns
  ) {

    const match =
      text.match(pattern);

    if (match) {
      return Number(match[1]);
    }
  }


  return null;
}


/* =========================================================
   FETCH
========================================================= */

async function fetchHtml(
  url,
  attempt = 1
) {

  const controller =
    new AbortController();


  const timer =
    setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS
    );


  try {

    const response =
      await fetch(
        url,
        {
          signal:
            controller.signal,

          redirect:
            'follow',

          headers: {

            'User-Agent':
              'Mozilla/5.0 (compatible; DonghuaFlixSync/3.0)',

            'Accept':
              'text/html,application/xhtml+xml'

          }
        }
      );


    if (!response.ok) {

      if (
        attempt < FETCH_RETRIES &&
        [
          408,
          425,
          429,
          500,
          502,
          503,
          504
        ].includes(
          response.status
        )
      ) {

        await sleep(
          1000 * attempt
        );


        return fetchHtml(
          url,
          attempt + 1
        );
      }


      throw new Error(
        `HTTP ${response.status} en ${url}`
      );
    }


    return await response.text();


  } catch (error) {

    if (
      attempt < FETCH_RETRIES
    ) {

      await sleep(
        1000 * attempt
      );


      return fetchHtml(
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
   DESCUBRIMIENTO DE SERIES
========================================================= */

function parseSeriesLinks(
  html,
  pageUrl
) {

  const $ =
    cheerio.load(html);

  const links =
    [];


  $('a[href]').each(
    (_, element) => {

      const href =
        $(element).attr('href');


      const url =
        canonical(
          absolute(
            href,
            pageUrl
          )
        );


      if (
        !url ||
        !sameOrigin(url)
      ) {
        return;
      }


      try {

        const u =
          new URL(url);


        if (
          /\/series\//i.test(
            u.pathname
          )
        ) {

          links.push(url);

        }

      } catch {}

    }
  );


  return uniqueUrls(
    links
  );
}


function extractPaginationLinks(
  html,
  pageUrl
) {

  const $ =
    cheerio.load(html);

  const links =
    [];


  $('a[href]').each(
    (_, element) => {

      const href =
        $(element).attr('href');


      const url =
        canonical(
          absolute(
            href,
            pageUrl
          )
        );


      if (
        !url ||
        !sameOrigin(url)
      ) {
        return;
      }


      try {

        const u =
          new URL(url);

        const current =
          new URL(pageUrl);


        if (
          u.pathname !==
          current.pathname
        ) {
          return;
        }


        if (
          !u.searchParams.has('page')
        ) {
          return;
        }


        const page =
          Number(
            u.searchParams.get('page')
          );


        if (
          Number.isInteger(page) &&
          page >= 1
        ) {

          links.push(url);

        }

      } catch {}

    }
  );


  return uniqueUrls(
    links
  );
}


async function discoverPaginatedSeed(
  seed
) {

  const firstUrl =
    canonical(
      absolute(seed)
    );


  const queue =
    [firstUrl];


  const visited =
    new Set();


  const found =
    new Set();


  while (
    queue.length &&
    visited.size <
      MAX_DISCOVERY_PAGES
  ) {

    const pageUrl =
      queue.shift();


    if (
      !pageUrl ||
      visited.has(pageUrl)
    ) {
      continue;
    }


    visited.add(
      pageUrl
    );


    console.log(
      `📄 Página ${visited.size}: ${pageUrl}`
    );


    try {

      const html =
        await fetchHtml(
          pageUrl
        );


      const series =
        parseSeriesLinks(
          html,
          pageUrl
        );


      series.forEach(
        url =>
          found.add(url)
      );


      console.log(
        `   ${series.length} enlaces de series`
      );


      const nextPages =
        extractPaginationLinks(
          html,
          pageUrl
        )
        .filter(
          url =>
            !visited.has(url) &&
            !queue.includes(url)
        );


      nextPages.forEach(
        url =>
          queue.push(url)
      );


      if (
        nextPages.length
      ) {

        console.log(
          `   ${nextPages.length} páginas siguientes detectadas`
        );

      }

    } catch (error) {

      console.log(
        `   ⚠️ ${error.message}`
      );

    }
  }


  return [
    ...found
  ];
}


async function discoverSeries() {

  const all =
    new Set();


  for (
    const seed
    of SEEDS
  ) {

    console.log(
      `\n🔎 Descubriendo desde ${seed}`
    );


    const urls =
      await discoverPaginatedSeed(
        seed
      );


    urls.forEach(
      url =>
        all.add(url)
    );


    console.log(
      `✅ Acumuladas: ${all.size} series`
    );

  }


  console.log(
    `\n🎯 TOTAL SERIES DESCUBIERTAS: ${all.size}`
  );


  return [
    ...all
  ];
}



/* =========================================================
   PORTADA REAL
   El primer <img> de la página suele ser IcoPrueba.png
   (placeholder de lazy-load). Buscamos entre TODAS las
   imágenes y descartamos placeholders, logos e iconos.
========================================================= */

function extractPosterImage(
  $,
  pageUrl
) {

  const candidates =
    [];


  /*
     1) Open Graph suele ser lo más fiable.
  */

  candidates.push(

    $('meta[property="og:image"]')
      .attr('content'),

    $('meta[name="twitter:image"]')
      .attr('content')

  );


  /*
     2) Todas las imágenes de la página.

     Las imágenes reales suelen venir en
     data-src / data-original (lazy-load)
     y el src visible es el placeholder.
  */

  $('img')
    .each(
      (_, el) => {

        const node =
          $(el);


        const klass =
          String(
            node.attr('class') ||
            ''
          ).toLowerCase();


        const alt =
          String(
            node.attr('alt') ||
            ''
          ).toLowerCase();


        const weight =
          (
            /poster|portada|cover|thumb|image|img/.test(klass) ||
            /poster|portada|cover/.test(alt)
          )
            ? 0
            : 1;


        candidates.push({

          weight,

          raw:

            node.attr('data-src') ||

            node.attr('data-original') ||

            node.attr('data-lazy-src') ||

            node.attr('src')

        });

      }
    );


  /*
     Ordenamos: og:image y coincidencias
     de clase/alt primero.
  */

  const flattened =
    [];


  for (
    const item
    of candidates
  ) {

    if (
      typeof item ===
      'string' ||
      item == null
    ) {

      flattened.push({

        weight: 0,

        raw: item

      });

    } else {

      flattened.push(
        item
      );

    }

  }


  flattened.sort(
    (a, b) =>
      a.weight -
      b.weight
  );


  /*
     3) Validamos cada candidato.
  */

  for (
    const { raw }
    of flattened
  ) {

    const url =
      absolute(
        raw,
        pageUrl
      );


    if (
      !url ||
      !sameOrigin(url)
    ) {
      continue;
    }


    const lower =
      url.toLowerCase();


    /*
       Descartamos el placeholder y
       elementos gráficos que no son
       portadas.
    */

    if (
      /icoprueba/.test(lower)
    ) {
      continue;
    }


    if (
      /\/logo|icon|favicon|banner|avatar|sprite|flag|search/.test(lower)
    ) {
      continue;
    }


    if (
      !/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(lower)
    ) {
      continue;
    }


    return url;

  }


  return null;

}


/* =========================================================
   GÉNEROS
========================================================= */

function extractGenres($) {

  const genres =
    new Set();


  const selectors = [

    '[class*="genre"] a',

    '[class*="genero"] a',

    '[class*="category"] a',

    '[class*="categoria"] a',

    'a[href*="genre="]',

    'a[href*="/genre/"]'

  ];


  for (
    const selector
    of selectors
  ) {

    $(selector).each(
      (_, el) => {

        const text =
          clean(
            $(el).text()
          );


        if (
          text &&
          text.length < 80
        ) {

          genres.add(
            text
          );

        }

      }
    );
  }


  return [
    ...genres
  ];
}


/* =========================================================
   SERIES
========================================================= */

function parseSeries(
  html,
  url
) {

  const $ =
    cheerio.load(html);


  const title =
    clean(

      $('h1')
        .first()
        .text() ||

      $('meta[property="og:title"]')
        .attr('content') ||

      $('title')
        .text()

    );


  const image =
    extractPosterImage(
      $,
      url
    );


  const synopsis =
    clean(

      $('[class*="synopsis"]')
        .first()
        .text() ||

      $('[class*="sinopsis"]')
        .first()
        .text() ||

      $('[class*="description"]')
        .first()
        .text() ||

      $('[class*="descripcion"]')
        .first()
        .text() ||

      $('meta[name="description"]')
        .attr('content')

    );


  const seasonUrls =
    [];


  $('a[href]').each(
    (_, element) => {

      const href =
        $(element).attr('href');


      const candidateUrl =
        canonical(
          absolute(
            href,
            url
          )
        );


      if (
        !candidateUrl ||
        !sameOrigin(candidateUrl)
      ) {
        return;
      }


      try {

        const u = new URL(candidateUrl);
        const pathname = u.pathname;

        // Mejora 1 y 2: Detección inteligente de temporadas basada en contenido real y evitando paginación
        if (u.searchParams.has('page')) {
          return; // La paginación nunca es una temporada (Mejora 2)
        }

        const isSeasonPath = /\/season\//i.test(pathname);
        const hasSeasonKeyword = /(?:season|temporada)/i.test(pathname) || seasonNumber(candidateUrl) !== null;

        if (isSeasonPath || hasSeasonKeyword) {
          seasonUrls.push(candidateUrl);
        }

      } catch {}

    }
  );


  const releaseDate =
    clean(

      $('[class*="release"]')
        .first()
        .text() ||

      $('[class*="fecha"]')
        .first()
        .text() ||

      ''

    ) || null;


  const duration =
    clean(

      $('[class*="duration"]')
        .first()
        .text() ||

      $('[class*="duracion"]')
        .first()
        .text() ||

      ''

    ) || null;


  const originalTitle =
    clean(

      $('[class*="original"]')
        .first()
        .text() ||

      $('[class*="titulo-original"]')
        .first()
        .text() ||

      ''

    ) || null;


  const status =
    clean(

      $('[class*="status"]')
        .first()
        .text() ||

      $('[class*="estado"]')
        .first()
        .text() ||

      ''

    ) || null;


  return {

    id:
      slugFromUrl(url),

    slug:
      slugFromUrl(url),

    title:
      title ||
      slugFromUrl(url),

    image:
      image || null,

    synopsis:
      synopsis || null,

    originalTitle,

    duration,

    releaseDate,

    status,

    genres:
      extractGenres($),

    seasonUrls:
      uniqueUrls(
        seasonUrls
      ),

    sourceUrl:
      canonical(url)

  };
}


/* =========================================================
   EPISODIOS
========================================================= */

function normalizeCandidate(
  raw,
  seasonUrl
) {

  if (!raw) {
    return null;
  }


  let value =
    String(raw).trim();


  value =
    value
      .replace(/\\\//g, '/')
      .replace(/[),.;]}]+$/g, '');


  const url =
    canonical(
      absolute(
        value,
        seasonUrl
      )
    );


  if (
    !url ||
    !sameOrigin(url)
  ) {
    return null;
  }


  try {

    const u =
      new URL(url);


    if (
      !/\/episode\//i.test(
        u.pathname
      )
    ) {
      return null;
    }


    return url;

  } catch {

    return null;

  }
}


function collectEpisodeUrlsFromSeason(
  html,
  seasonUrl
) {

  const $ =
    cheerio.load(html);


  const candidates =
    [];


  const add =
    raw => {

      const url =
        normalizeCandidate(
          raw,
          seasonUrl
        );


      if (url) {
        candidates.push(url);
      }

    };


  /*
     MÉTODO 1
  */

  $('a[href*="/episode/"]')
    .each(
      (_, el) =>
        add(
          $(el).attr('href')
        )
    );


  /*
     MÉTODO 2
  */

  $('a[href]')
    .each(
      (_, el) =>
        add(
          $(el).attr('href')
        )
    );


  /*
     MÉTODO 3
  */

  $(
    '[data-href],' +
    '[data-url],' +
    '[data-link],' +
    '[data-src],' +
    '[data-episode-url]'
  )
    .each(
      (_, el) => {

        add(

          $(el).attr('data-href') ||

          $(el).attr('data-url') ||

          $(el).attr('data-link') ||

          $(el).attr('data-src') ||

          $(el).attr(
            'data-episode-url'
          )

        );

      }
    );


  /*
     MÉTODO 4
  */

  const normalizedHtml =
    html.replace(
      /\\\//g,
      '/'
    );


  const regex =
    /(?:https?:\/\/[^"'<>\s]+)?\/episode\/[^"'<>\s?#]+/gi;


  const matches =
    normalizedHtml.match(
      regex
    ) || [];


  for (
    const match
    of matches
  ) {

    add(match);

  }


  return uniqueUrls(
    candidates
  );
}


/* =========================================================
   PERTENENCIA A TEMPORADA
========================================================= */

function episodeBelongsToSeason(
  episodeUrl,
  seasonUrl
) {

  const episodeSlug =
    slugFromUrl(
      episodeUrl
    ).toLowerCase();


  const seasonSlug =
    slugFromUrl(
      seasonUrl
    ).toLowerCase();


  if (
    !episodeSlug ||
    !seasonSlug
  ) {
    return false;
  }


  /*
     FORMATO MODERNO:

     Quitamos el número final con CUALQUIER
     variante y comparamos el "base":

     slug-1-x18             → slug-1
     slug-1-episodio-x142   → slug-1
     slug-1-18              → slug-1
     slug-especial-x2       → slug-especial
  */

  const base =
    episodeSlug.replace(
      /-?(?:episodio-|episode-)?x?(\d+)$/i,
      ''
    );


  if (
    base === seasonSlug
  ) {
    return true;
  }


  /*
     Compatibilidad con el comportamiento
     anterior (algunos slugs antiguos).
  */

  if (
    episodeSlug.startsWith(
      `${seasonSlug}-episodio-`
    ) ||
    episodeSlug.startsWith(
      `${seasonSlug}-episode-`
    )
  ) {
    return true;
  }


  const sn =
    seasonNumber(
      seasonSlug
    );


  if (
    sn != null
  ) {

    const prefix =
      seasonSlug.replace(
        new RegExp(
          `-${sn}$`
        ),
        ''
      );


    if (
      episodeSlug.startsWith(
        `${prefix}-${sn}-episodio-`
      ) ||
      episodeSlug.startsWith(
        `${prefix}-${sn}-episode-`
      )
    ) {
      return true;
    }

  }


  return false;
}


/* =========================================================
   PAGINACIÓN DE TEMPORADA
========================================================= */

/*
   Extrae únicamente las páginas de paginación
   de ESA temporada.

   A diferencia de extractPaginationLinks(),
   aquí aceptamos page=0 porque algunas páginas
   lo muestran explícitamente.
*/
function extractSeasonPaginationLinks(
  html,
  seasonUrl
) {

  const $ =
    cheerio.load(html);


  const links =
    [];


  const baseSeason =
    canonicalSeasonPage(
      seasonUrl
    );


  if (!baseSeason) {
    return [];
  }


  let basePath = '';


  try {

    basePath =
      new URL(
        baseSeason
      ).pathname;

  } catch {

    return [];

  }


  $('a[href]').each(
    (_, element) => {

      const href =
        $(element).attr('href');


      const url =
        canonicalSeasonPage(
          absolute(
            href,
            seasonUrl
          )
        );


      if (
        !url ||
        !sameOrigin(url)
      ) {
        return;
      }


      try {

        const u =
          new URL(url);


        if (
          u.pathname !==
          basePath
        ) {
          return;
        }


        if (
          !u.searchParams.has('page')
        ) {
          return;
        }


        const page =
          Number(
            u.searchParams.get('page')
          );


        if (
          Number.isInteger(page) &&
          page >= 0
        ) {

          links.push(url);

        }

      } catch {}

    }
  );


  return [
    ...new Set(
      links
    )
  ];
}


/*
   Genera una página concreta:

   base
   ?page=1
   ?page=2
   etc.
*/
function buildSeasonPageUrl(
  seasonUrl,
  page
) {

  const base =
    canonicalSeasonPage(
      seasonUrl
    );


  if (!base) {
    return null;
  }


  if (
    page <= 0
  ) {
    return base;
  }


  try {

    const u =
      new URL(base);


    u.searchParams.set(
      'page',
      String(page)
    );


    return canonicalSeasonPage(
      u.href
    );

  } catch {

    return null;

  }
}


/*
   ESTA ES LA PARTE PRINCIPAL
   DE LA RECUPERACIÓN HISTÓRICA.

   Recorremos:

   página base
   page=1
   page=2
   page=3
   page=4

   como mínimo.

   Después seguimos las páginas que
   realmente descubra la web.
*/
async function collectAllSeasonEpisodeUrls(
  seasonUrl
) {

  const base =
    canonicalSeasonPage(
      seasonUrl
    );


  if (!base) {

    return {

      episodeUrls: [],

      pagesChecked: 0,

      successfulPages: 0,

      failedPages: 0,

      complete: false

    };

  }


  /*
     Cola principal.
  */

  const queue =
    [base];


  /*
     Forzamos como mínimo
     las primeras cinco páginas.

     La base cuenta como página 1.
  */

  for (
    let page = 1;
    page <= MIN_SEASON_PAGE_PROBES - 1;
    page++
  ) {

    const generated =
      buildSeasonPageUrl(
        base,
        page
      );


    if (
      generated &&
      !queue.includes(generated)
    ) {

      queue.push(
        generated
      );

    }

  }


  const visited =
    new Set();


  const successful =
    new Set();


  const failed =
    new Set();


  const episodeUrls =
    new Set();


  let seasonImage =
    null;


  let discoveredNewEpisodes =
    0;


  while (
    queue.length ||
    visited.size <
      MIN_SEASON_PAGE_PROBES
  ) {

    /*
       Si hemos terminado la cola pero
       todavía no hemos alcanzado el mínimo,
       seguimos generando páginas.
    */

    if (
      !queue.length &&
      visited.size <
        MIN_SEASON_PAGE_PROBES
    ) {

      const nextPage =
        visited.size;


      const generated =
        buildSeasonPageUrl(
          base,
          nextPage
        );


      if (
        generated &&
        !visited.has(generated)
      ) {

        queue.push(
          generated
        );

      } else {

        break;

      }
    }


    const pageUrl =
      queue.shift();


    if (
      !pageUrl
    ) {
      continue;
    }


    const normalizedPage =
      canonicalSeasonPage(
        pageUrl
      );


    if (
      !normalizedPage ||
      visited.has(normalizedPage)
    ) {
      continue;
    }


    visited.add(
      normalizedPage
    );


    console.log(
      `      📄 Página temporada ${visited.size}: ${normalizedPage}`
    );


    try {

      const html =
        await fetchHtml(
          normalizedPage
        );


      successful.add(
        normalizedPage
      );


      /*
         La portada de la temporada suele
         estar en la primera página que
         responde correctamente.
      */

      if (
        !seasonImage
      ) {

        seasonImage =
          extractPosterImage(
            cheerio.load(html),
            base
          );


        if (seasonImage) {
          console.log(`      🖼️  Portada: ${seasonImage}`);
        }

      }


      const before =
        episodeUrls.size;


      const found =
        collectEpisodeUrlsFromSeason(
          html,
          seasonUrl
        );


      for (
        const episodeUrl
        of found
      ) {

        if (
          episodeBelongsToSeason(
            episodeUrl,
            seasonUrl
          )
        ) {

          episodeUrls.add(
            episodeUrl
          );

        }

      }


      const gained =
        episodeUrls.size -
        before;


      discoveredNewEpisodes +=
        gained;


      console.log(
        `         🎬 ${found.length} enlaces detectados | +${gained} nuevos | total ${episodeUrls.size}`
      );


      /*
         Descubrimos las páginas reales
         que la web nos ofrece.
      */

      const nextPages =
        extractSeasonPaginationLinks(
          html,
          seasonUrl
        );


      for (
        const nextPage
        of nextPages
      ) {

        const normalized =
          canonicalSeasonPage(
            nextPage
          );


        if (
          normalized &&
          !visited.has(normalized) &&
          !queue.includes(normalized)
        ) {

          queue.push(
            normalized
          );

        }

      }


      /*
         Si hay un enlace "siguiente" que
         no haya sido detectado como paginación,
         también intentamos reconocerlo.
      */

      const $ =
        cheerio.load(html);


      $('a[href]').each(
        (_, el) => {

          const text =
            clean(
              $(el).text()
            ).toLowerCase();


          if (
            !text.includes('siguiente') &&
            !text.includes('next') &&
            !text.includes('siguiente página')
          ) {
            return;
          }


          const candidate =
            canonicalSeasonPage(
              absolute(
                $(el).attr('href'),
                normalizedPage
              )
            );


          if (
            candidate &&
            !visited.has(candidate) &&
            !queue.includes(candidate)
          ) {

            queue.push(
              candidate
            );

          }

        }
      );


    } catch (error) {

      failed.add(
        normalizedPage
      );


      console.log(
        `         ⚠️ No se pudo leer: ${error.message}`
      );

    }


    /*
       Si ya hemos comprobado al menos
       cinco páginas y no quedan páginas
       descubiertas, podemos terminar.

       No dependemos de que exista page=0.
    */

    if (
      visited.size >=
        MIN_SEASON_PAGE_PROBES &&
      queue.length === 0
    ) {

      break;

    }


    /*
       Protección adicional.
    */

    if (
      episodeUrls.size >=
        MAX_EPISODES_PER_SEASON_SAFETY
    ) {

      console.log(
        '      🛑 Alcanzado límite de seguridad de episodios.'
      );

      break;

    }

  }


  /*
     Consideramos que la paginación ha sido
     recorrida si:

     - comprobamos al menos 5 páginas
     - no quedan páginas pendientes
     - al menos una página respondió correctamente
  */

  const paginationComplete =
    visited.size >=
      MIN_SEASON_PAGE_PROBES &&
    queue.length === 0 &&
    successful.size > 0;


  /*
     Ordenamos por número.
  */

  const sortedEpisodes =
    [
      ...episodeUrls
    ].sort(
      (a, b) => {

        const na =
          episodeNumber(a) ??
          Number.MAX_SAFE_INTEGER;

        const nb =
          episodeNumber(b) ??
          Number.MAX_SAFE_INTEGER;

        return na - nb;

      }
    );


  const numbers =
    sortedEpisodes
      .map(
        episodeNumber
      )
      .filter(
        Number.isFinite
      );


  const minEpisode =
    numbers.length
      ? Math.min(...numbers)
      : null;


  const maxEpisode =
    numbers.length
      ? Math.max(...numbers)
      : null;


  /*
     Detectar huecos.

     Ejemplo:

     1,2,3,4,6,7

     => falta 5
  */

  const missingEpisodes =
    [];


  if (
    minEpisode === 1 &&
    maxEpisode != null
  ) {

    const numberSet =
      new Set(numbers);


    for (
      let n = 1;
      n <= maxEpisode;
      n++
    ) {

      if (
        !numberSet.has(n)
      ) {

        missingEpisodes.push(n);

      }

    }

  }


  console.log(
    `      📊 Páginas comprobadas: ${visited.size}`
  );


  console.log(
    `      📊 Episodios descubiertos: ${sortedEpisodes.length}`
  );


  console.log(
    `      📊 Rango: ${minEpisode ?? '?'} → ${maxEpisode ?? '?'}`
  );


  if (
    missingEpisodes.length
  ) {

    console.log(
      `      ⚠️ Episodios faltantes: ${missingEpisodes.slice(0, 30).join(', ')}${missingEpisodes.length > 30 ? '...' : ''}`
    );

  }


  return {

    episodeUrls:
      sortedEpisodes,

    image:
      seasonImage,

    pagesChecked:
      visited.size,

    successfulPages:
      successful.size,

    failedPages:
      failed.size,

    paginationComplete,

    minEpisode,

    maxEpisode,

    totalEpisodes:
      sortedEpisodes.length,

    missingEpisodes,

    discoveredNewEpisodes

  };
}


/* =========================================================
   APRENDER PATRÓN DE URL DE EPISODIO
========================================================= */

/*
   No imponemos un patrón universal.

   Lo aprendemos de una URL REAL de esa
   temporada.

   Ejemplo:

   /episode/donghua-episodio-680

   se convierte conceptualmente en:

   /episode/donghua-episodio-{NUMBER}
*/
/*
   No imponemos un patrón universal.

   APRENDEMOS TODOS los prefijos reales
   de la temporada. Ejemplo real de la web:

     /episode/el-inmortal-renegado-1-x18
     /episode/el-inmortal-renegado-1-episodio-x142

   conviven en la MISMA temporada, así que
   necesitamos ambos patrones candidatos:

     prefix1 + numero  →  .../slug-1-x{n}
     prefix2 + numero  →  .../slug-1-episodio-x{n}
*/
function learnEpisodeUrlPatterns(
  episodeUrls
) {

  const prefixes =
    new Set();


  for (
    const raw
    of episodeUrls
  ) {

    const url =
      canonical(
        raw
      );


    if (!url) {
      continue;
    }


    try {

      const u =
        new URL(url);


      /*
         El número de episodio SIEMPRE va
         al final del path.
      */

      const match =
        u.pathname.match(
          /^(.*?)(\d+)$/
        );


      if (!match) {
        continue;
      }


      const prefix =
        `${u.origin}${match[1]}`;


      prefixes.add(
        prefix
      );

    } catch {}

  }


  return [
    ...prefixes
  ].map(
    prefix => ({

      build(number) {

        try {

          return canonical(
            `${prefix}${number}`
          );

        } catch {

          return null;

        }

      }

    })
  );

}


/* =========================================================
   COMPLETAR HUECOS MEDIANTE PATRÓN
========================================================= */

/*
   Esto es SOLO un mecanismo de respaldo.

   Primero usamos la paginación real.

   Si la paginación nos da:

   680 ... 652

   y falta 651,

   podemos intentar:

   URL de 650/652
   → aprender patrón
   → construir 651
   → comprobar que existe
   → comprobar que pertenece a la temporada.
*/
async function fillEpisodeGapsWithPattern(
  seasonUrl,
  episodeUrls,
  missingEpisodes
) {

  if (
    !missingEpisodes.length ||
    !episodeUrls.length
  ) {

    return {

      episodeUrls,

      validatedInferred:
        0

    };

  }


  const sorted =
    [...episodeUrls].sort(
      (a, b) =>
        (
          episodeNumber(a) ??
          999999999
        ) -
        (
          episodeNumber(b) ??
          999999999
        )
    );


  /*
     Aprendemos TODOS los patrones de URL
     de esta temporada (corto, largo, etc.).
  */

  const patterns =
    learnEpisodeUrlPatterns(
      sorted.slice(
        0,
        20
      )
    );


  if (
    !patterns.length
  ) {

    console.log(
      '      ℹ️ No se pudo aprender un patrón de URL.'
    );


    return {

      episodeUrls,

      validatedInferred:
        0

    };

  }


  console.log(
    `      🧠 Patrones aprendidos: ${patterns.length}`
  );


  const result =
    new Set(
      episodeUrls
    );


  let validated =
    0;


  let attempts =
    0;


  /*
     Para cada hueco probamos TODOS los
     patrones hasta encontrar el episodio.
  */

  for (
    const number
    of missingEpisodes
  ) {

    if (
      attempts >=
        MAX_INFERRED_EPISODE_ATTEMPTS
    ) {

      console.log(
        `      🛑 Límite de intentos alcanzado (${MAX_INFERRED_EPISODE_ATTEMPTS}).`
      );


      break;

    }


    let found =
      false;


    for (
      const pattern
      of patterns
    ) {

      if (
        attempts >=
          MAX_INFERRED_EPISODE_ATTEMPTS
      ) {
        break;
      }


      const candidate =
        pattern.build(
          number
        );


      if (
        !candidate ||
        !sameOrigin(candidate)
      ) {
        continue;
      }


      attempts++;


      try {

        const html =
          await fetchHtml(
            candidate
          );


        /*
           Verificación 1:
           el número de la URL debe coincidir.
        */

        const urlNumber =
          episodeNumber(
            candidate
          );


        if (
          urlNumber !==
          number
        ) {

          console.log(
            `      ⚠️ Candidato rechazado por URL: esperaba ${number}, URL dice ${urlNumber ?? '?'} (${candidate})`
          );


          continue;

        }


        /*
           Verificación 2:
           el número en el título de la página
           debe coincidir.
        */

        const $ =
          cheerio.load(html);


        const title =
          clean(
            $('h1')
              .first()
              .text() ||

            $('title')
              .text()
          );


        const titleNumber =
          episodeNumber(
            candidate
          ) ??
          episodeNumber(
            title
          );


        if (
          titleNumber !==
          number
        ) {

          console.log(
            `      ⚠️ Candidato rechazado por título: esperaba ${number}, página dice ${titleNumber ?? '?'}`
          );


          continue;

        }


        /*
           Verificación 3:
           debe pertenecer a esta temporada.
        */

        if (
          !episodeBelongsToSeason(
            candidate,
            seasonUrl
          )
        ) {

          console.log(
            `      ⚠️ Candidato rechazado por pertenencia: ${candidate}`
          );


          continue;

        }


        result.add(
          candidate
        );


        validated++;


        found =
          true;


        console.log(
          `      🔧 Episodio ${number} recuperado: ${candidate}`
        );


        /*
           Con un patrón que funciona para
           este número pasamos al siguiente
           hueco (pero el siguiente número
           volverá a probar todos).
        */

        break;


      } catch {

        /*
           404 u otro error:
           probamos el siguiente patrón.
        */

        continue;

      }

    }


    if (
      !found
    ) {

      console.log(
        `      ⚪ Episodio ${number}: no existe en ningún patrón conocido.`
      );

    }

  }


  return {

    episodeUrls: [
      ...result
    ].sort(
      (a, b) =>
        (
          episodeNumber(a) ??
          999999999
        ) -
        (
          episodeNumber(b) ??
          999999999
        )
    ),

    validatedInferred:
      validated

  };
}


/* =========================================================
   ANALIZAR COMPLETITUD
========================================================= */

function analyzeSeasonCompleteness(
  episodeUrls,
  paginationComplete
) {

  const numbers =
    episodeUrls
      .map(
        episodeNumber
      )
      .filter(
        Number.isFinite
      );


  if (!numbers.length) {

    return {

      complete:
        false,

      minEpisode:
        null,

      maxEpisode:
        null,

      totalEpisodes:
        0,

      missingEpisodes:
        []

    };

  }


  const uniqueNumbers =
    [
      ...new Set(
        numbers
      )
    ].sort(
      (a, b) =>
        a - b
    );


  const minEpisode =
    uniqueNumbers[0];


  const maxEpisode =
    uniqueNumbers.at(-1);


  const missingEpisodes =
    [];


  /*
     Para considerar una temporada
     históricamente completa queremos
     empezar en 1.

     Si tenemos 620 → 680:

     min = 620

     => incompleta.
  */

  if (
    minEpisode === 1
  ) {

    const set =
      new Set(
        uniqueNumbers
      );


    for (
      let n = 1;
      n <= maxEpisode;
      n++
    ) {

      if (
        !set.has(n)
      ) {

        missingEpisodes.push(n);

      }

    }

  } else {

    for (
      let n = 1;
      n < minEpisode;
      n++
    ) {

      missingEpisodes.push(n);

    }

  }


  const complete =
    paginationComplete &&
    minEpisode === 1 &&
    missingEpisodes.length === 0 &&
    uniqueNumbers.length === maxEpisode;


  return {

    complete,

    minEpisode,

    maxEpisode,

    totalEpisodes:
      uniqueNumbers.length,

    missingEpisodes

  };
}


/* =========================================================
   PARSEAR TEMPORADA
========================================================= */

function parseSeason(
  html,
  seasonUrl
) {

  const $ =
    cheerio.load(html);


  const urls =
    collectEpisodeUrlsFromSeason(
      html,
      seasonUrl
    );


  const filtered =
    urls.filter(
      url =>
        episodeBelongsToSeason(
          url,
          seasonUrl
        )
    );


  const items =
    filtered.map(
      url => {

        let text =
          '';


        $('a[href]')
          .each(
            (_, el) => {

              if (text) {
                return;
              }


              const candidate =
                normalizeCandidate(
                  $(el).attr('href'),
                  seasonUrl
                );


              if (
                candidate ===
                url
              ) {

                text =
                  clean(
                    $(el).text()
                  );

              }

            }
          );


        return {

          url,

          number:
            episodeNumber(url),

          text

        };

      }
    );


  items.sort(
    (a, b) => {

      const na =
        a.number ??
        Number.MAX_SAFE_INTEGER;


      const nb =
        b.number ??
        Number.MAX_SAFE_INTEGER;


      return na - nb;

    }
  );


  const first =
    items.find(
      item =>
        item.number === 1
    ) ||
    items[0] ||
    null;


  return {

    id:
      slugFromUrl(
        seasonUrl
      ),

    slug:
      slugFromUrl(
        seasonUrl
      ),

    sourceUrl:
      canonical(
        seasonUrl
      ),

    number:
      seasonNumber(
        seasonUrl
      ),

    firstEpisodeUrl:
      first?.url ||
      null,

    discoveredEpisodeLinks:
      items

  };
}


/* =========================================================
   NAVEGACIÓN DE EPISODIOS
========================================================= */

function linkIsEpisodeOfSeason(
  url,
  seasonUrl
) {

  return Boolean(
    url &&
    episodeBelongsToSeason(
      url,
      seasonUrl
    )
  );
}


function extractEpisodeNav(
  $,
  selectorText,
  episodeUrl,
  seasonUrl
) {

  let found =
    null;


  $('a[href]').each(
    (_, el) => {

      if (found) {
        return;
      }


      const text =
        clean(
          $(el).text()
        ).toLowerCase();


      if (
        !text.includes(
          selectorText
        )
      ) {
        return;
      }


      const candidate =
        normalizeCandidate(
          $(el).attr('href'),
          episodeUrl
        );


      if (
        candidate &&
        linkIsEpisodeOfSeason(
          candidate,
          seasonUrl
        )
      ) {

        found =
          candidate;

      }

    }
  );


  return found;
}


/* =========================================================
   PARSEAR EPISODIO
========================================================= */

function parseEpisode(
  html,
  episodeUrl,
  seasonUrl
) {

  const $ =
    cheerio.load(html);


  const title =
    clean(

      $('h1')
        .first()
        .text() ||

      $('meta[property="og:title"]')
        .attr('content') ||

      $('title')
        .text()

    );


  const servers =
    [];


  const addServer = (
    name,
    raw,
    embed = false
  ) => {

    const url =
      absolute(
        raw,
        episodeUrl
      );


    if (
      !url ||
      sameOrigin(url)
    ) {
      return;
    }


    const key =
      `${name}|${url}`
        .toLowerCase();


    if (
      servers.some(
        item =>
          `${item.name}|${item.url}`
            .toLowerCase() ===
          key
      )
    ) {
      return;
    }


    servers.push({

      name:
        clean(name) ||
        'Servidor',

      url,

      embed:
        Boolean(embed)

    });

  };


  $('a[href]').each(
    (_, el) => {

      const href =
        $(el).attr('href');


      const text =
        clean(
          $(el).text()
        );


      if (!href) {
        return;
      }


      const lower =
        href.toLowerCase();


      if (
        /dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|mega|youtube/
          .test(lower)
      ) {

        let hostname =
          'Servidor';


        try {

          hostname =
            new URL(
              href,
              episodeUrl
            ).hostname;

        } catch {}


        addServer(

          text ||
          hostname,

          href,

          false

        );

      }

    }
  );


  $(
    'iframe[src],' +
    'video[src],' +
    'source[src]'
  )
    .each(
      (_, el) => {

        const src =
          $(el).attr('src');


        if (!src) {
          return;
        }


        const full =
          absolute(
            src,
            episodeUrl
          );


        if (!full) {
          return;
        }


        const lower =
          full.toLowerCase();


        if (
          /dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|youtube/
            .test(lower)
        ) {

          try {

            addServer(

              new URL(
                full
              ).hostname,

              full,

              true

            );

          } catch {}

        }

      }
    );


  $(
    '[data-src],' +
    '[data-embed],' +
    '[data-url],' +
    '[data-video]'
  )
    .each(
      (_, el) => {

        const raw =
          $(el).attr('data-src') ||

          $(el).attr('data-embed') ||

          $(el).attr('data-url') ||

          $(el).attr('data-video');


        if (!raw) {
          return;
        }


        const full =
          absolute(
            raw,
            episodeUrl
          );


        if (!full) {
          return;
        }


        if (
          /dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|youtube/i
            .test(full)
        ) {

          try {

            addServer(

              new URL(
                full
              ).hostname,

              full,

              true

            );

          } catch {}

        }

      }
    );


  let previousUrl =
    extractEpisodeNav(
      $,
      'anterior',
      episodeUrl,
      seasonUrl
    ) ||

    extractEpisodeNav(
      $,
      'previous',
      episodeUrl,
      seasonUrl
    );


  let nextUrl =
    extractEpisodeNav(
      $,
      'siguiente',
      episodeUrl,
      seasonUrl
    ) ||

    extractEpisodeNav(
      $,
      'next',
      episodeUrl,
      seasonUrl
    );


  const relPrev =
    normalizeCandidate(
      $('link[rel="prev"]')
        .attr('href'),

      episodeUrl
    );


  const relNext =
    normalizeCandidate(
      $('link[rel="next"]')
        .attr('href'),

      episodeUrl
    );


  if (
    !previousUrl &&
    linkIsEpisodeOfSeason(
      relPrev,
      seasonUrl
    )
  ) {

    previousUrl =
      relPrev;

  }


  if (
    !nextUrl &&
    linkIsEpisodeOfSeason(
      relNext,
      seasonUrl
    )
  ) {

    nextUrl =
      relNext;

  }


  const releaseDate =
    clean(

      $('[class*="release"]')
        .first()
        .text() ||

      $('[class*="fecha"]')
        .first()
        .text() ||

      ''

    ) || null;


  return {

    title:
      title ||
      slugFromUrl(
        episodeUrl
      ),

    servers,

    previousUrl:
      previousUrl ||
      null,

    nextUrl:
      nextUrl ||
      null,

    releaseDate

  };
}


/* =========================================================
   DESCUBRIMIENTO EN CADENA — "Siguiente episodio"

   Entramos en el primer episodio de la temporada y
   vamos pulsando "Siguiente" página a página hasta
   llegar al final, SIN depender de:

     - números de episodio
     - patrones de URL
     - paginación

   Esto captura las variaciones reales entre episodios
   (p. ej. ...-x18 conviviendo con ...-episodio-x142).

   - Los enlaces sueltos de la página se aceptan solo
     si pertenecen a la temporada.

   - Los episodios alcanzados mediante el botón
     "Siguiente" se aceptan siempre que sigan
     siendo /episode/ del mismo origen y de esta
     temporada; cuando el "Siguiente" ya no apunta a
     un episodio de la temporada, la cadena termina.
========================================================= */

async function discoverEpisodesByChain(
  seasonUrl,
  startUrls
) {

  const found =
    new Set();


  const chainVisited =
    new Set();


  const failed =
    new Set();


  /*
     Números para los que YA intentamos la
     recuperación mediante el método antiguo.
     Evita bucles infinitos alternando métodos.
  */
  const recoveryAttempted =
    new Set();


  const MAX_PATTERN_RECOVERIES =
    200;


  let patternRecoveries =
    0;


  let steps =
    0;


  let exhausted =
    true;


  /*
     MÉTODO ALTERNO (el de siempre):

     Cuando la cadena "Siguiente" se rompe,
     aprendemos los patrones de URL de los
     episodios ya visitados e intentamos
     construir el siguiente número. Si existe,
     la cadena se reanuda desde ahí.

     Así ambos métodos se ALTERNAN:

       Siguiente → fallo → patrón → Siguiente → ...
  */
  const tryPatternRecovery =
    async fromUrl => {

      const fromNumber =
        episodeNumber(
          fromUrl
        );


      if (
        fromNumber == null ||
        patternRecoveries >=
          MAX_PATTERN_RECOVERIES
      ) {

        return null;

      }


      const target =
        fromNumber + 1;


      if (
        recoveryAttempted.has(
          target
        )
      ) {

        return null;

      }


      recoveryAttempted.add(
        target
      );


      const patterns =
        learnEpisodeUrlPatterns(
          [
            ...found,
            ...chainVisited
          ].slice(
            0,
            20
          )
        );


      for (
        const pattern
        of patterns
      ) {

        const candidate =
          pattern.build(
            target
          );


        if (
          !candidate ||
          !sameOrigin(
            candidate
          ) ||
          chainVisited.has(
            candidate
          ) ||
          found.has(
            candidate
          )
        ) {
          continue;
        }


        try {

          const html =
            await fetchHtml(
              candidate
            );


          /*
             Validación: debe pertenecer a
             esta temporada.
          */

          if (
            !episodeBelongsToSeason(
              candidate,
              seasonUrl
            )
          ) {

            continue;

          }


          /*
             Validación blanda de título:
             si la página declara un número
             de episodio, debe coincidir.
          */

          const $ =
            cheerio.load(
              html
            );


          const title =
            clean(

              $('h1')
                .first()
                .text() ||

              $('title')
                .text()

            );


          const titleNumber =
            episodeNumber(
              title
            );


          if (
            titleNumber != null &&
            titleNumber !==
              target
          ) {

            continue;

          }


          patternRecoveries++;


          console.log(
            `      🔄 Alternando a método de patrón: episodio ${target} recuperado (${slugFromUrl(candidate)}) — se reanuda la cadena`
          );


          return candidate;


        } catch {

          /*
             404 u otro error:
             probamos el siguiente patrón.
          */

          continue;

        }

      }


      return null;

    };


  /*
     Semillas: las URLs que ya tengamos, o si no hay
     ninguna, cualquier enlace /episode/ crudo de la
     página de la temporada (sin filtrar: "sin
     importar nada").
  */

  let seeds =
    (startUrls || [])
      .map(canonical)
      .filter(Boolean);


  if (
    !seeds.length
  ) {

    try {

      const seasonHtml =
        await fetchHtml(
          seasonUrl
        );


      seeds =
        collectEpisodeUrlsFromSeason(
          seasonHtml,
          seasonUrl
        );


      console.log(
        `      🔗 Cadena: sembrando con ${seeds.length} enlaces crudos de la página de temporada`
      );

    } catch {

      /* noop */

    }

  }


  if (
    !seeds.length
  ) {

    return {

      episodeUrls: [],

      chainSteps: 0,

      failedPages: 0,

      recoveries: 0,

      exhausted: true

    };

  }


  /*
     Empezamos por el episodio de menor número
     cuando se pueda deducir.
  */

  seeds.sort(
    (a, b) =>
      (
        episodeNumber(a) ??
        999999999
      ) -
      (
        episodeNumber(b) ??
        999999999
      )
  );


  const queue =
    [seeds[0]];


  /*
     Última página que respondió bien:
     sirve de ancla para la recuperación
     por patrón cuando la cadena se rompe.
  */

  let lastGoodUrl =
    seeds[0];


  while (
    queue.length &&
    steps < MAX_CHAIN_STEPS
  ) {

    const currentUrl =
      canonical(
        queue.shift()
      );


    if (
      !currentUrl ||
      chainVisited.has(
        currentUrl
      )
    ) {
      continue;
    }


    chainVisited.add(
      currentUrl
    );


    steps++;


    console.log(
      `      🔗 Cadena paso ${steps}: ${slugFromUrl(currentUrl)}`
    );


    let chainResumed =
      false;


    try {

      const html =
        await fetchHtml(
          currentUrl
        );


      lastGoodUrl =
        currentUrl;


      const $ =
        cheerio.load(html);


      /*
         1) Cualquier enlace de episodio de ESTA
            temporada presente en la página.
      */

      for (
        const url
        of collectEpisodeUrlsFromSeason(
          html,
          currentUrl
        )
      ) {

        if (
          episodeBelongsToSeason(
            url,
            seasonUrl
          )
        ) {

          found.add(
            url
          );

        }

      }


      /*
         2) Botón "Siguiente episodio".
      */

      let nextUrl =
        extractEpisodeNav(
          $,
          'siguiente',
          currentUrl,
          seasonUrl
        ) ||

        extractEpisodeNav(
          $,
          'next',
          currentUrl,
          seasonUrl
        );


      const relNext =
        normalizeCandidate(
          $('link[rel="next"]')
            .attr('href'),

          currentUrl
        );


      if (
        !nextUrl &&
        relNext &&
        sameOrigin(relNext)
      ) {

        nextUrl =
          relNext;

      }


      const nextCanonical =
        canonical(
          nextUrl
        );


      if (
        nextCanonical &&
        !chainVisited.has(
          nextCanonical
        )
      ) {

        try {

          const isEpisodePath =
            /\/episode\//i
              .test(
                new URL(
                  nextCanonical
                ).pathname
              );


          if (
            isEpisodePath &&
            sameOrigin(
              nextCanonical
            )
          ) {

            if (
              episodeBelongsToSeason(
                nextCanonical,
                seasonUrl
              )
            ) {

              queue.push(
                nextCanonical
              );


              found.add(
                nextCanonical
              );


              chainResumed =
                true;

            }

          }

        } catch {

          /* noop */

        }

      }


      /*
         3) ¿Cadena rota?

            - El episodio cargó bien pero no hay
              "Siguiente" útil.

            → alternamos al método antiguo
              (patrón) y, si recupera el
              episodio, la cadena continúa.
      */

      if (
        !chainResumed
      ) {

        const recovered =
          await tryPatternRecovery(
            currentUrl
          );


        if (
          recovered
        ) {

          queue.push(
            recovered
          );


          found.add(
            recovered
          );


          chainResumed =
            true;

        } else {

          console.log(
            `      🔗 Cadena: fin — "Siguiente" no disponible y el patrón no recuperó el episodio ${(episodeNumber(currentUrl) ?? '?') + 1}`
          );

        }

      }

    } catch (error) {

      /*
         4) La página del episodio NO carga.

            → alternamos al método antiguo
              desde el último episodio bueno.
      */

      failed.add(
        currentUrl
      );


      console.log(
        `         ⚠️ Cadena: no se pudo leer (${error.message}) — probando método de patrón...`
      );


      const recovered =
        await tryPatternRecovery(
          lastGoodUrl
        );


      if (
        recovered
      ) {

        queue.push(
          recovered
        );


        found.add(
          recovered
        );


        chainResumed =
          true;

      }

    }


    if (
      !chainResumed &&
      !queue.length
    ) {

      exhausted =
        true;


      /*
         Cadena terminada (natural o por
         agotar la recuperación).
      */

      break;

    }


    if (
      found.size >=
        MAX_EPISODES_PER_SEASON_SAFETY
    ) {

      exhausted =
        false;


      console.log(
        '      🛑 Cadena: límite de seguridad de episodios.'
      );


      break;

    }

  }


  if (
    steps >= MAX_CHAIN_STEPS
  ) {

    exhausted =
      false;

  }


  const all =
    new Set([
      ...found,
      ...chainVisited
    ]);


  const episodeUrls =
    [...all].sort(
      (a, b) =>
        (
          episodeNumber(a) ??
          Number.MAX_SAFE_INTEGER
        ) -
        (
          episodeNumber(b) ??
          Number.MAX_SAFE_INTEGER
        )
    );


  return {

    episodeUrls,

    chainSteps: steps,

    failedPages:
      failed.size,

    recoveries:
      patternRecoveries,

    exhausted

  };

}



/* =========================================================
   PROCESAR TODOS LOS EPISODIOS DESCUBIERTOS
========================================================= */

async function crawlEpisodeUrls(
  season,
  episodeUrls,
  previousEpisodes = [],
  allowUrls = null
) {

  const results =
    [];


  const oldEpisodeMap =
    new Map(
      previousEpisodes.map(
        item => [
          item.id,
          item
        ]
      )
    );


  let failures =
    0;


  /*
     Importante:

     Aquí ya NO dependemos de "Siguiente".

     La lista viene de TODAS las páginas
     de la temporada.
  */

  const sortedUrls =
    [...episodeUrls].sort(
      (a, b) =>
        (
          episodeNumber(a) ??
          Number.MAX_SAFE_INTEGER
        ) -
        (
          episodeNumber(b) ??
          Number.MAX_SAFE_INTEGER
        )
    );


  let lastSave = 0;
  for (
    let i = 0;
    i < sortedUrls.length;
    i++
  ) {

    const currentUrl =
      canonical(
        sortedUrls[i]
      );


    if (
      !currentUrl
    ) {
      continue;
    }


    if (
      !linkIsEpisodeOfSeason(
        currentUrl,
        season.sourceUrl
      ) &&
      !(
        allowUrls &&
        allowUrls.has(
          currentUrl
        )
      )
    ) {

      console.log(
        `      ⚠️ Episodio rechazado por pertenencia: ${currentUrl}`
      );


      failures++;


      continue;

    }


    // LOG LIMPIO: solo muestra el número y nombre, no la URL larga
    const epSlugClean = slugFromUrl(currentUrl);
    console.log(
      `      ▶ Episodio ${i + 1}/${sortedUrls.length}: ${epSlugClean}`
    );


    try {

      const html =
        await fetchHtml(
          currentUrl
        );


      const detail =
        parseEpisode(
          html,
          currentUrl,
          season.sourceUrl
        );


      const number =
        episodeNumber(
          currentUrl
        ) ??
        episodeNumber(
          detail.title
        );


      const episodeId =
        slugFromUrl(
          currentUrl
        );


      const oldEpisode =
        oldEpisodeMap.get(
          episodeId
        ) || {};


      results.push({

        ...oldEpisode,

        id:
          episodeId,

        slug:
          episodeId,

        title:
          detail.title ||
          oldEpisode.title ||
          episodeId,

        sourceUrl:
          currentUrl,

        servers:
          detail.servers.length
            ? detail.servers
            : (
                oldEpisode.servers ||
                []
              ),

        previousUrl:
          detail.previousUrl ||
          oldEpisode.previousUrl ||
          null,

        nextUrl:
          detail.nextUrl ||
          oldEpisode.nextUrl ||
          null,

        updatedAt:
          new Date().toISOString(),

        seriesId:
          season.seriesId,

        seasonId:
          season.id,

        number:
          number ??
          oldEpisode.number ??
          i + 1,

        releaseDate:
          detail.releaseDate ||
          oldEpisode.releaseDate ||
          null

      });


    } catch (error) {

      failures++;


      console.log(
        `      ❌ Error episodio: ${error.message}`
      );


      /*
         Si ya existía, conservamos
         la versión anterior.
      */

      const episodeId =
        slugFromUrl(
          currentUrl
        );


      const oldEpisode =
        oldEpisodeMap.get(
          episodeId
        );


      if (oldEpisode) {

        results.push(
          oldEpisode
        );

      }

    }

  }


  return {

    episodes:
      results,

    failures,

    processed:
      sortedUrls.length,

    successful:
      results.length

  };
}


/* =========================================================
   COMPLETITUD DESDE EPISODIOS PROCESADOS
========================================================= */

function analyzeProcessedCompleteness(
  episodes,
  paginationComplete,
  processingFailures
) {

  const numbers =
    episodes
      .map(
        item =>
          Number(item.number)
      )
      .filter(
        Number.isFinite
      );


  if (!numbers.length) {

    return {

      complete:
        false,

      minEpisode:
        null,

      maxEpisode:
        null,

      totalEpisodes:
        0,

      missingEpisodes:
        []

    };

  }


  const uniqueNumbers =
    [
      ...new Set(
        numbers
      )
    ].sort(
      (a, b) =>
        a - b
    );


  const minEpisode =
    uniqueNumbers[0];


  const maxEpisode =
    uniqueNumbers.at(-1);


  const set =
    new Set(
      uniqueNumbers
    );


  const missingEpisodes =
    [];


  for (
    let n = 1;
    n <= maxEpisode;
    n++
  ) {

    if (
      !set.has(n)
    ) {

      missingEpisodes.push(n);

    }

  }


  const complete =
    paginationComplete &&
    processingFailures === 0 &&
    minEpisode === 1 &&
    missingEpisodes.length === 0 &&
    uniqueNumbers.length === maxEpisode;


  return {

    complete,

    minEpisode,

    maxEpisode,

    totalEpisodes:
      uniqueNumbers.length,

    missingEpisodes

  };
}


/* =========================================================
   BASE DE DATOS
========================================================= */

function upsert(
  array,
  item,
  key = 'id'
) {

  const index =
    array.findIndex(
      entry =>
        entry[key] ===
        item[key]
    );


  if (
    index === -1
  ) {

    array.push(
      item
    );

  } else {

    array[index] = {

      ...array[index],

      ...item

    };

  }
}


async function loadCatalog() {

  try {

    const text =
      await fs.readFile(
        OUT_FILE,
        'utf8'
      );


    const db =
      JSON.parse(text);


    return {

      meta:
        db.meta || {},

      series:
        Array.isArray(db.series)
          ? db.series
          : [],

      seasons:
        Array.isArray(db.seasons)
          ? db.seasons
          : [],

      episodes:
        Array.isArray(db.episodes)
          ? db.episodes
          : [],

      movies:
        Array.isArray(db.movies)
          ? db.movies
          : [],

      genres:
        Array.isArray(db.genres)
          ? db.genres
          : []

    };


  } catch {

    return {

      meta: {},

      series: [],

      seasons: [],

      episodes: [],

      movies: [],

      genres: []

    };

  }
}


async function saveCatalog(db) {

  await fs.mkdir(
    path.dirname(
      OUT_FILE
    ),
    {
      recursive:
        true
    }
  );


  const tmp =
    `${OUT_FILE}.tmp`;


  await fs.writeFile(

    tmp,

    JSON.stringify(
      db,
      null,
      2
    ),

    'utf8'

  );


  await fs.rename(
    tmp,
    OUT_FILE
  );
}


/* =========================================================
   PROCESAR UNA TEMPORADA — HISTÓRICO COMPLETO
========================================================= */

async function processFullSeason(
  db,
  detail,
  seasonUrl,
  oldSeason,
  oldEpisodes
) {

  const seasonId =
    slugFromUrl(
      seasonUrl
    );


  console.log(
    `\n   📖 Temporada ${seasonNumber(seasonUrl) ?? seasonId}`
  );


  /*
     1. Recorremos TODAS las páginas.
  */

  const discovery =
    await collectAllSeasonEpisodeUrls(
      seasonUrl
    );


  let episodeUrls =
    discovery.episodeUrls;


  /*
     2. Si existen huecos,
        intentamos recuperarlos con
        el patrón aprendido.
  */

  if (
    discovery.missingEpisodes.length
  ) {

    console.log(
      `   🔧 Intentando recuperar ${discovery.missingEpisodes.length} huecos mediante patrón...`
    );


    const inferred =
      await fillEpisodeGapsWithPattern(
        seasonUrl,
        episodeUrls,
        discovery.missingEpisodes
      );


    episodeUrls =
      inferred.episodeUrls;


    if (
      inferred.validatedInferred
    ) {

      console.log(
        `   🔧 Recuperados mediante patrón: ${inferred.validatedInferred}`
      );

    }

  }


  /*
     2b. CADENA "Siguiente episodio".

         Entramos en el primer episodio y pulsamos
         "Siguiente" hasta el final, sin depender de
         números ni patrones. Captura las variaciones
         reales de URL entre episodios.
  */
  const chainAllow =
    new Set();


  {
    const chain =
      await discoverEpisodesByChain(
        seasonUrl,
        episodeUrls
      );


    if (
      chain.episodeUrls.length
    ) {

      const before =
        new Set(
          episodeUrls
        );


      const merged =
        [];


      const seenMerge =
        new Set();


      for (
        const url
        of [
          ...episodeUrls,
          ...chain.episodeUrls
        ]
      ) {

        if (
          seenMerge.has(
            url
          )
        ) {
          continue;
        }


        seenMerge.add(
          url
        );


        merged.push(
          url
        );


        if (
          !before.has(
            url
          )
        ) {

          chainAllow.add(
            url
          );

        }

      }


      episodeUrls =
        merged.sort(
          (a, b) =>
            (
              episodeNumber(a) ??
              Number.MAX_SAFE_INTEGER
            ) -
            (
              episodeNumber(b) ??
              Number.MAX_SAFE_INTEGER
            )
        );


      console.log(
        `   🔗 Cadena "Siguiente": ${chain.chainSteps} pasos · total ${episodeUrls.length}` +
        ` · ${chain.recoveries} recuperación(es) por método de patrón` +
        (
          chain.exhausted
            ? ' · fin de cadena alcanzado ✅'
            : ' · cadena truncada por límite ⚠️'
        )
      );

    }

  }


  /*
     3. Analizamos lo descubierto.
  */

  const discoveredCompleteness =
    analyzeSeasonCompleteness(
      episodeUrls,
      discovery.paginationComplete
    );


  console.log(
    `   📊 Histórico descubierto: ${discoveredCompleteness.minEpisode ?? '?'} → ${discoveredCompleteness.maxEpisode ?? '?'}`
  );


  console.log(
    `   📊 Total enlaces: ${discoveredCompleteness.totalEpisodes}`
  );


  /*
     4. Creamos la temporada.
  */

  const seasonItem = {

    ...(oldSeason || {}),

    id:
      seasonId,

    slug:
      seasonId,

    sourceUrl:
      canonical(
        seasonUrl
      ),

    image:
      discovery.image ||
      (oldSeason && oldSeason.image) ||
      null,

    number:
      seasonNumber(
        seasonUrl
      ),

    seriesId:
      detail.id,

    firstEpisodeUrl:
      episodeUrls.find(
        url =>
          episodeNumber(url) === 1
      ) ||
      episodeUrls[0] ||
      null,

    episodeCount:
      discoveredCompleteness.totalEpisodes,

    minEpisodeFound:
      discoveredCompleteness.minEpisode,

    maxEpisodeFound:
      discoveredCompleteness.maxEpisode,

    missingEpisodes:
      discoveredCompleteness.missingEpisodes,

    paginationComplete:
      discovery.paginationComplete,

    initialSyncComplete:
      false,

    updatedAt:
      new Date().toISOString()

  };


  /*
     5. Procesamos TODOS los episodios.
  */

  const crawl =
    await crawlEpisodeUrls(
      {
        ...seasonItem
      },
      episodeUrls,
      oldEpisodes,
      chainAllow
    );


  console.log(
    `   🎬 Procesados: ${crawl.successful}/${crawl.processed}`
  );


  /*
     6. Comprobamos la completitud REAL.
  */

  const completeness =
    analyzeProcessedCompleteness(
      crawl.episodes,
      discovery.paginationComplete,
      crawl.failures
    );


  /*
     Guardamos estadísticas incluso
     cuando la temporada está incompleta.
  */

  seasonItem.episodeCount =
    completeness.totalEpisodes;

  seasonItem.minEpisodeFound =
    completeness.minEpisode;

  seasonItem.maxEpisodeFound =
    completeness.maxEpisode;

  seasonItem.missingEpisodes =
    completeness.missingEpisodes;

  seasonItem.paginationComplete =
    discovery.paginationComplete;

  seasonItem.initialSyncComplete =
    completeness.complete;


  /*
     7. SOLO reemplazamos completamente
        la temporada si estamos seguros.

     Esto evita el problema anterior:

     catálogo:
       620 → 680

     nueva sincronización incompleta:
       620 → 680

     y accidentalmente borrar cosas.

     Si el proceso está incompleto,
     mezclamos lo nuevo con lo viejo.
  */

  if (
    completeness.complete
  ) {

    db.episodes =
      db.episodes.filter(
        item =>
          item.seasonId !==
          seasonId
      );


    for (
      const episode
      of crawl.episodes
    ) {

      upsert(
        db.episodes,
        episode,
        'id'
      );

    }


    console.log(
      `   🟢 TEMPORADA COMPLETA: 1 → ${completeness.maxEpisode}`
    );


  } else {

    console.log(
      `   🟡 TEMPORADA INCOMPLETA: NO se reemplaza el catálogo anterior.`
    );


    /*
       Actualizamos/insertamos únicamente
       episodios que hemos podido procesar.

       Los antiguos que no hayan sido tocados
       permanecen.
    */

    for (
      const episode
      of crawl.episodes
    ) {

      upsert(
        db.episodes,
        episode,
        'id'
      );

    }


    if (
      oldEpisodes.length
    ) {

      console.log(
        `   ↩️ Se conservan los ${oldEpisodes.length} episodios anteriores.`
      );

    }

  }


  /*
     Guardamos la temporada después
     de analizarla.
  */

  upsert(
    db.seasons,
    seasonItem,
    'id'
  );


  return {

    season:
      seasonItem,

    complete:
      completeness.complete,

    episodes:
      crawl.episodes

  };
}


/* =========================================================
   SINCRONIZACIÓN INCREMENTAL
========================================================= */

/*
   Esta función SOLO se utilizará para temporadas
   que ya tengan:

       initialSyncComplete === true

   Por tanto:

       620 → 680

   NO puede entrar aquí.

   Tiene que terminar primero el histórico.
*/
async function incrementalSeasonSync(
  db,
  season
) {

  if (
    !season.initialSyncComplete
  ) {

    return {

      changed:
        false,

      skipped:
        true

    };

  }


  const oldEpisodes =
    db.episodes.filter(
      item =>
        item.seasonId ===
        season.id
    );


  if (
    !oldEpisodes.length
  ) {

    return {

      changed:
        false,

      skipped:
        true

    };

  }


  const numbers =
    oldEpisodes
      .map(
        item =>
          Number(item.number)
      )
      .filter(
        Number.isFinite
      );


  const lastEpisode =
    numbers.length
      ? Math.max(...numbers)
      : null;


  if (
    lastEpisode == null
  ) {

    return {

      changed:
        false,

      skipped:
        true

    };

  }


  console.log(
    `   🔄 Incremental ${season.id}: último episodio ${lastEpisode}`
  );


  /*
     Primero comprobamos la página actual
     de la temporada.

     Los episodios nuevos normalmente
     aparecerán aquí.
  */

  let seasonHtml;


  try {

    seasonHtml =
      await fetchHtml(
        season.sourceUrl
      );

  } catch (error) {

    console.log(
      `   ⚠️ No se pudo comprobar temporada: ${error.message}`
    );


    return {

      changed:
        false,

      skipped:
        false

    };

  }


  const currentUrls =
    collectEpisodeUrlsFromSeason(
      seasonHtml,
      season.sourceUrl
    )
    .filter(
      url =>
        episodeBelongsToSeason(
          url,
          season.sourceUrl
        )
    );


  const newUrls =
    currentUrls
      .filter(
        url => {

          const number =
            episodeNumber(url);

          return (
            number != null &&
            number > lastEpisode
          );

        }
      );


  /*
     CADENA "Siguiente episodio":

     desde el último episodio conocido pulsamos
     "Siguiente" hasta el final. Captura los
     episodios nuevos aunque su URL varíe.
  */
  try {

    const lastEp =
      [...oldEpisodes].sort(
        (a, b) =>
          (Number(b.number) || 0) -
          (Number(a.number) || 0)
      )[0];


    if (
      lastEp &&
      lastEp.sourceUrl
    ) {

      const chain =
        await discoverEpisodesByChain(
          season.sourceUrl,
          [lastEp.sourceUrl]
        );


      for (
        const url
        of chain.episodeUrls
      ) {

        const n =
          episodeNumber(url);


        if (
          n != null &&
          n > lastEpisode &&
          !newUrls.includes(
            url
          )
        ) {

          newUrls.push(
            url
          );

        }

      }


      if (
        chain.chainSteps > 1
      ) {

        console.log(
          `      🔗 Cadena incremental: ${chain.chainSteps} pasos seguidos`
        );

      }

    }

  } catch {

    /* noop */

  }


  /*
     Aprendemos el patrón de la URL
     más reciente disponible.
  */

  /*
     Aprendemos TODOS los patrones de las
     URLs reales más recientes de la temporada.
  */

  const recentUrls =
    oldEpisodes
      .filter(
        item =>
          Number.isFinite(
            Number(item.number)
          ) &&
          item.sourceUrl
      )
      .sort(
        (a, b) =>
          Number(b.number) -
          Number(a.number)
      )
      .slice(
        0,
        15
      )
      .map(
        item =>
          item.sourceUrl
      );


  const patterns =
    learnEpisodeUrlPatterns(
      recentUrls
    );


  /*
     Comprobamos los siguientes episodios
     probando TODOS los patrones hasta dar
     con el que exista. El primer número
     que no exista en NINGÚN patrón corta
     la cadena (es el final de temporada).
  */

  if (patterns.length) {

    let nextNumber =
      lastEpisode + 1;


    while (
      nextNumber <=
        lastEpisode +
        MAX_INFERRED_EPISODE_ATTEMPTS
    ) {

      let foundNumber =
        false;


      if (
        newUrls.includes(
          patterns[0].build(nextNumber)
        )
      ) {

        foundNumber =
          true;

      } else {

        for (
          const pattern
          of patterns
        ) {

          const candidate =
            pattern.build(
              nextNumber
            );


          if (
            !candidate ||
            newUrls.includes(candidate)
          ) {

            if (
              candidate &&
              newUrls.includes(candidate)
            ) {

              foundNumber =
                true;

            }


            continue;

          }


          try {

            const html =
              await fetchHtml(
                candidate
              );


            const $ =
              cheerio.load(html);


            const title =
              clean(
                $('h1')
                  .first()
                  .text() ||

                $('title')
                  .text()
              );


            const detectedNumber =
              episodeNumber(candidate) ??
              episodeNumber(title);


            if (
              detectedNumber !==
              nextNumber
            ) {

              continue;

            }


            if (
              !episodeBelongsToSeason(
                candidate,
                season.sourceUrl
              )
            ) {

              continue;

            }


            newUrls.push(
              candidate
            );


            console.log(
              `      🆕 Nuevo episodio ${nextNumber}: ${candidate}`
            );


            foundNumber =
              true;


            break;


          } catch {

            /*
               Este patrón no existe:
               probamos el siguiente.
            */

            continue;

          }

        }

      }


      if (
        !foundNumber
      ) {

        /*
           Ningún patrón devolvió este número:
           es el final de los episodios actuales.
        */

        break;

      }


      nextNumber++;

    }

  }


  const uniqueNew =
    [
      ...new Set(
        newUrls
      )
    ].sort(
      (a, b) =>
        (
          episodeNumber(a) ??
          999999999
        ) -
        (
          episodeNumber(b) ??
          999999999
        )
    );


  if (
    !uniqueNew.length
  ) {

    console.log(
      `   ✔️ No hay episodios nuevos en ${season.id}`
    );


    return {

      changed:
        false,

      skipped:
        false

    };

  }


  console.log(
    `   🆕 Episodios nuevos encontrados: ${uniqueNew.length}`
  );


  const crawl =
    await crawlEpisodeUrls(
      season,
      uniqueNew,
      oldEpisodes
    );


  for (
    const episode
    of crawl.episodes
  ) {

    upsert(
      db.episodes,
      episode,
      'id'
    );

  }


  const updatedNumbers =
    db.episodes
      .filter(
        item =>
          item.seasonId ===
          season.id
      )
      .map(
        item =>
          Number(item.number)
      )
      .filter(
        Number.isFinite
      );


  if (
    updatedNumbers.length
  ) {

    season.maxEpisodeFound =
      Math.max(
        ...updatedNumbers
      );


    season.episodeCount =
      new Set(
        updatedNumbers
      ).size;

  }


  season.updatedAt =
    new Date().toISOString();


  upsert(
    db.seasons,
    season,
    'id'
  );


  return {

    changed:
      true,

    skipped:
      false

  };
}


/* =========================================================
   ¿CATÁLOGO HISTÓRICO COMPLETO?
========================================================= */

function catalogHasIncompleteSeasons(
  db
) {

  return db.seasons.some(
    season =>
      season.initialSyncComplete !== true
  );
}


/* =========================================================
   MAIN — SINCRONIZACIÓN HISTÓRICA
========================================================= */

async function runFullSync() {

  console.log(
    '\n🚀 INICIANDO CONSTRUCCIÓN DEL CATÁLOGO HISTÓRICO COMPLETO\n'
  );


  const previous =
    await loadCatalog();


  const discovered =
    await discoverSeries();


  console.log(
    `\n📚 Series descubiertas: ${discovered.length}`
  );


  const startedAt =
    new Date().toISOString();


  const db = {

    meta: {

      ...previous.meta,

      version:
        4,

      source:
        `${BASE_URL}/`,

      syncedAt:
        startedAt,

      lastSync: {

        status:
          'running',

        type:
          'full',

        startedAt,

        finishedAt:
          null,

        error:
          null

      }

    },


    series:
      [...previous.series],


    seasons:
      [...previous.seasons],


    episodes:
      [...previous.episodes],


    movies:
      [...previous.movies],


    genres:
      [...previous.genres]

  };


  const allGenres =
    new Set(
      db.genres
    );


  /* =====================================================
     SERIES
  ===================================================== */

  let idx = 0;
  await runPool(discovered, WORKERS, async (seriesUrl) => {
    const i = idx++;


    const slug =
      slugFromUrl(
        seriesUrl
      );


    console.log(
      `\n${i + 1}/${discovered.length} — ${slug}`
    );


    try {

      const html =
        await fetchHtml(
          seriesUrl
        );


      const detail =
        parseSeries(
          html,
          seriesUrl
        );


      const oldSeries =
        db.series.find(
          item =>
            item.id ===
              detail.id ||
            item.slug ===
              detail.slug
        );


      const seriesItem = {

        ...(oldSeries || {}),

        ...detail,

        updatedAt:
          new Date().toISOString()

      };


      upsert(
        db.series,
        seriesItem,
        'id'
      );


      /*
         CHECKPOINT:

         Guardamos el catálogo cada 10 series
         para no perder horas de trabajo si
         GitHub cancela el workflow (límite
         de 6 horas) o hay un error fatal.
      */

      if (
        (i + 1) % 10 === 0
      ) {

        await enqueueSave(
          db
        );


        console.log(
          `💾 Checkpoint: ${i + 1}/${discovered.length} series guardadas`
        );

      }


      detail.genres?.forEach(
        genre =>
          allGenres.add(
            genre
          )
      );


      console.log(
        `🎭 Géneros: ${detail.genres?.length || 0}`
      );


      console.log(
        `📚 Temporadas encontradas: ${detail.seasonUrls.length}`
      );


      /* =================================================
         TEMPORADAS
      ================================================= */

      for (
        const seasonUrl
        of detail.seasonUrls
      ) {

        const seasonId =
          slugFromUrl(
            seasonUrl
          );


        const oldSeason =
          db.seasons.find(
            item =>
              item.id ===
                seasonId ||
              item.sourceUrl ===
                seasonUrl
          );


        const oldEpisodes =
          db.episodes.filter(
            item =>
              item.seasonId ===
              seasonId
          );


        try {


          /*
             OPTIMIZACIÓN DE REINTENTOS:

             Si la temporada ya se completó en
             una ejecución anterior, NO la
             recorremos entera otra vez.

             → solo buscamos episodios nuevos
               (modo incremental).

             Así, si GitHub corta el workflow
             (límite de 6h), la siguiente
             ejecución retoma rápido.
          */

          if (
            oldSeason &&
            oldSeason.initialSyncComplete === true
          ) {

            await incrementalSeasonSync(
              db,
              oldSeason
            );


            continue;

          }


          await processFullSeason(

            db,

            detail,

            seasonUrl,

            oldSeason,

            oldEpisodes

          );


        } catch (error) {

          console.log(
            `   ❌ Error temporada: ${error.message}`
          );


          if (
            oldEpisodes.length
          ) {

            console.log(
              `   ↩️ Se mantienen ${oldEpisodes.length} episodios anteriores.`
            );

          }

        }

      }


      /* =================================================
         💾 GUARDADO POR SERIE

         Encolado: con 10 workers en paralelo los
         guardados se ejecutan de uno en uno para
         no corromper el JSON.
      ================================================= */

      await enqueueSave(db);


      console.log(
        `💾 Catálogo guardado tras completar la serie: ${slug}`
      );


    } catch (error) {

      console.log(
        `❌ Error serie: ${error.message}`
      );

    }

  }); // Fin runPool


  /* =====================================================
     ORDENAR
  ===================================================== */

  db.genres =
    [...allGenres]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'es'
          )
      );


  db.series.sort(
    (a, b) =>
      clean(a.title).localeCompare(
        clean(b.title),
        'es'
      )
  );


  db.seasons.sort(
    (a, b) => {

      if (
        a.seriesId !==
        b.seriesId
      ) {

        return String(
          a.seriesId
        ).localeCompare(
          String(
            b.seriesId
          )
        );

      }


      return (
        (a.number ?? 999999) -
        (b.number ?? 999999)
      );

    }
  );


  db.episodes.sort(
    (a, b) => {

      if (
        a.seriesId !==
        b.seriesId
      ) {

        return String(
          a.seriesId
        ).localeCompare(
          String(
            b.seriesId
          )
        );

      }


      if (
        a.seasonId !==
        b.seasonId
      ) {

        return String(
          a.seasonId
        ).localeCompare(
          String(
            b.seasonId
          )
        );

      }


      return (
        (a.number ?? 999999999) -
        (b.number ?? 999999999)
      );

    }
  );


  /* =====================================================
     RESULTADO
  ===================================================== */

  const finished =
    new Date().toISOString();


  const incomplete =
    catalogHasIncompleteSeasons(
      db
    );


  db.meta.syncedAt =
    finished;


  db.meta.lastSync = {

    status:
      'success',

    type:
      'full',

    startedAt:
      db.meta.lastSync.startedAt,

    finishedAt:
      finished,

    error:
      null,

    catalogComplete:
      !incomplete

  };


  await saveCatalog(
    db
  );


  console.log(
    '\n===================================================='
  );


  console.log(
    '🎉 SINCRONIZACIÓN HISTÓRICA TERMINADA'
  );


  console.log(
    '===================================================='
  );


  console.log(
    `📚 Series: ${db.series.length}`
  );


  console.log(
    `📖 Temporadas: ${db.seasons.length}`
  );


  console.log(
    `🎬 Episodios: ${db.episodes.length}`
  );


  console.log(
    `🎭 Géneros: ${db.genres.length}`
  );


  if (incomplete) {

    console.log(
      '\n🟡 ATENCIÓN: todavía existen temporadas incompletas.'
    );


    console.log(
      '   La sincronización incremental NO se activará todavía.'
    );

  } else {

    console.log(
      '\n🟢 CATÁLOGO COMPLETO.'
    );


    console.log(
      '   Las temporadas ya pueden entrar en modo incremental.'
    );

  }


  return db;
}


/* =========================================================
   SINCRONIZACIÓN INCREMENTAL GLOBAL
========================================================= */

async function runIncrementalSync() {

  console.log(
    '\n🔄 INICIANDO SINCRONIZACIÓN INCREMENTAL\n'
  );


  const db =
    await loadCatalog();


  let changed =
    false;


  /*
     Solo temporadas marcadas como completas.
  */

  const completeSeasons =
    db.seasons.filter(
      season =>
        season.initialSyncComplete === true
    );


  console.log(
    `📖 Temporadas aptas para incremental: ${completeSeasons.length}/${db.seasons.length}`
  );


  for (
    const season
    of completeSeasons
  ) {

    try {

      const result =
        await incrementalSeasonSync(
          db,
          season
        );


      if (
        result.changed
      ) {

        changed =
          true;

      }

    } catch (error) {

      console.log(
        `   ❌ Error incremental ${season.id}: ${error.message}`
      );

    }

  }


  /*
     Aunque no haya episodios nuevos,
     guardamos el timestamp del último
     chequeo exitoso.
  */

  const finished =
    new Date().toISOString();


  db.meta =
    db.meta || {};


  db.meta.syncedAt =
    finished;


  db.meta.lastSync = {

    status:
      'success',

    type:
      'incremental',

    startedAt:
      db.meta.lastSync?.startedAt ||
      finished,

    finishedAt:
      finished,

    error:
      null,

    changed

  };


  await saveCatalog(
    db
  );


  console.log(
    `\n✅ Incremental terminado. Cambios: ${changed ? 'sí' : 'no'}`
  );


  return db;
}


/* =========================================================
   DECIDIR QUÉ HACER AL ARRANCAR
========================================================= */

async function main() {
  // Mejora 16: Control de bloqueo para evitar ejecuciones simultáneas
  if (isSyncRunning) {
    console.log('⚠️ Ya hay una sincronización en proceso. Saltando esta ejecución.');
    return;
  }

  isSyncRunning = true;

  try {
    console.log(
      '\n=============================================='
    );


    console.log(
      '🚀 DONGHUAFLIX SYNC'
    );


    console.log(
      '==============================================\n'
    );


    const existing =
      await loadCatalog();


    /*
       Si no existe catálogo o todavía hay
       temporadas incompletas:

       → hacemos histórico completo.
    */

    const needsFullSync =
      !existing.seasons.length ||
      catalogHasIncompleteSeasons(
        existing
      );


    if (
      needsFullSync
    ) {

      console.log(
        '📚 El catálogo todavía no está completamente construido.'
      );


      console.log(
        '🧭 Ejecutando sincronización histórica completa...\n'
      );


      await runFullSync();


      /*
         IMPORTANTE:

         No arrancamos inmediatamente
         un incremental aquí.

         Primero dejamos que esta ejecución
         termine y que el catálogo quede
         completamente guardado.

         La siguiente ejecución podrá decidir
         si ya corresponde incremental.
      */

      return;

    }


    /*
       Si llegamos aquí significa que
       TODAS las temporadas están marcadas
       como completas.

       Entonces podemos hacer incremental.
    */

    await runIncrementalSync();
  } finally {
    isSyncRunning = false;
  }

}


/* =========================================================
   ERROR FATAL
========================================================= */

main().catch(
  async error => {

    isSyncRunning = false; // Asegurar liberar el bloqueo en caso de error fatal

    console.error(
      '\n💥 ERROR FATAL:',
      error
    );


    try {

      const db =
        await loadCatalog();


      const finished =
        new Date().toISOString();


      db.meta = {

        ...(db.meta || {}),

        syncedAt:
          finished,

        lastSync: {

          ...(db.meta?.lastSync || {}),

          status:
            'error',

          finishedAt:
            finished,

          error:
            error.message

        }

      };


      await saveCatalog(
        db
      );


    } catch {}


    process.exitCode =
      1;

  }
);
