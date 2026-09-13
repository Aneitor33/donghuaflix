import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.resolve('public/data/catalog.json');

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

const clean = value =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();


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
      u.pathname = u.pathname.replace(/\/+$/, '');
    }

    return u.href;
  } catch {
    return null;
  }
}


function slugFromUrl(raw) {
  try {
    const u = new URL(raw, BASE_URL);

    const parts = u.pathname
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


/* =========================================================
   NUMERACIÓN
========================================================= */

function seasonNumber(value) {
  const slug =
    typeof value === 'string' && value.includes('/')
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
  const text = String(value || '');

  const patterns = [
    /(?:episodio|episode)[-_ ]?x?(\d+)/i,
    /(?:^|[-_ ])x(\d+)(?:$|[-_ ])/i,
    /(?:episode|episodio)[-_ ]?(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);

    if (match) {
      return Number(match[1]);
    }
  }

  return null;
}


/* =========================================================
   FETCH
========================================================= */

async function sleep(ms) {
  await new Promise(resolve =>
    setTimeout(resolve, ms)
  );
}


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
    const response = await fetch(
      url,
      {
        signal: controller.signal,
        redirect: 'follow',

        headers: {
          'User-Agent':
            'Mozilla/5.0 (compatible; DonghuaFlixSync/2.0)',

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
        ].includes(response.status)
      ) {
        await sleep(1000 * attempt);

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

    if (attempt < FETCH_RETRIES) {
      await sleep(1000 * attempt);

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
   DESCUBRIMIENTO DE SERIES
========================================================= */

function parseSeriesLinks(
  html,
  pageUrl
) {
  const $ = cheerio.load(html);

  const links = [];

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

      if (!url || !sameOrigin(url)) {
        return;
      }

      try {
        const u = new URL(url);

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

  return uniqueUrls(links);
}


function extractPaginationLinks(
  html,
  pageUrl
) {
  const $ = cheerio.load(html);

  const links = [];

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

      if (!url || !sameOrigin(url)) {
        return;
      }

      try {
        const u = new URL(url);
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

  return uniqueUrls(links);
}


async function discoverPaginatedSeed(
  seed
) {
  const firstUrl =
    canonical(
      absolute(seed)
    );

  const queue = [
    firstUrl
  ];

  const visited =
    new Set();

  const found =
    new Set();

  while (
    queue.length &&
    visited.size < MAX_DISCOVERY_PAGES
  ) {

    const pageUrl =
      queue.shift();

    if (
      !pageUrl ||
      visited.has(pageUrl)
    ) {
      continue;
    }

    visited.add(pageUrl);

    console.log(
      `📄 Página ${visited.size}: ${pageUrl}`
    );

    try {

      const html =
        await fetchHtml(pageUrl);

      const series =
        parseSeriesLinks(
          html,
          pageUrl
        );

      series.forEach(
        url => found.add(url)
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
        url => queue.push(url)
      );

      if (nextPages.length) {
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

  return [...found];
}


async function discoverSeries() {
  const all =
    new Set();

  for (const seed of SEEDS) {

    console.log(
      `\n🔎 Descubriendo desde ${seed}`
    );

    const urls =
      await discoverPaginatedSeed(
        seed
      );

    urls.forEach(
      url => all.add(url)
    );

    console.log(
      `✅ Acumuladas: ${all.size} series`
    );
  }

  console.log(
    `\n🎯 TOTAL SERIES DESCUBIERTAS: ${all.size}`
  );

  return [...all];
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
    const selector of selectors
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
          genres.add(text);
        }
      }
    );
  }

  return [...genres];
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
    absolute(
      $('meta[property="og:image"]')
        .attr('content') ||

      $('img')
        .first()
        .attr('src') ||

      $('img')
        .first()
        .attr('data-src'),

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

      const seasonUrl =
        canonical(
          absolute(
            href,
            url
          )
        );

      if (
        !seasonUrl ||
        !sameOrigin(seasonUrl)
      ) {
        return;
      }

      try {

        const pathname =
          new URL(
            seasonUrl
          ).pathname;

        if (
          /\/season\//i.test(
            pathname
          )
        ) {
          seasonUrls.push(
            seasonUrl
          );
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
      uniqueUrls(seasonUrls),

    sourceUrl:
      canonical(url)
  };
}


/* =========================================================
   EPISODIOS — EXTRACTOR ROBUSTO
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

  const add = raw => {
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
     Enlaces normales de episodios
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
     Cualquier enlace
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
     Atributos alternativos
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
     Buscar directamente dentro
     del HTML bruto
  */

  const normalizedHtml =
    html.replace(
      /\\\//g,
      '/'
    );

  const regex =
    /(?:https?:\/\/[^"'<>\\s]+)?\/episode\/[^"'<>\\s?#]+/gi;

  const matches =
    normalizedHtml.match(regex) || [];

  for (
    const match of matches
  ) {
    add(match);
  }


  return uniqueUrls(
    candidates
  );
}


/* =========================================================
   COMPROBAR QUE EL EPISODIO PERTENECE
   A LA TEMPORADA CORRECTA
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


  /*
     Forma normal:

     beyond-timescape-1-episodio-x1
  */

  if (
    episodeSlug.startsWith(
      `${seasonSlug}-episodio-`
    )
  ) {
    return true;
  }


  /*
     Variante inglesa
  */

  if (
    episodeSlug.startsWith(
      `${seasonSlug}-episode-`
    )
  ) {
    return true;
  }


  /*
     Segunda comprobación usando
     número de temporada.
  */

  const sn =
    seasonNumber(
      seasonSlug
    );

  if (sn != null) {

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
      )
    ) {
      return true;
    }

    if (
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


  /*
     MUY IMPORTANTE:

     Aquí eliminamos cualquier episodio
     que realmente pertenezca a otra
     temporada/serie.
  */

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

        let text = '';

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
                candidate === url
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


  /*
     Preferimos SIEMPRE x1.
     Si por alguna razón x1 no aparece,
     usamos el episodio numerado más bajo.
  */

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
      `${name}|${url}`.toLowerCase();

    if (
      servers.some(
        item =>
          `${item.name}|${item.url}`
            .toLowerCase() === key
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


  /*
     Enlaces externos
  */

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


  /*
     Iframes / vídeo
  */

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
              new URL(full).hostname,
              full,
              true
            );

          } catch {}
        }
      }
    );


  /*
     data-src / data-embed / etc.
  */

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
              new URL(full).hostname,
              full,
              true
            );

          } catch {}
        }
      }
    );


  /*
     ANTERIOR
  */

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


  /*
     SIGUIENTE
  */

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


  /*
     rel=prev / rel=next
  */

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
   RECORRER TODOS LOS EPISODIOS
========================================================= */

async function crawlEpisodes(
  season,
  previousEpisodes = []
) {
  if (
    !season.firstEpisodeUrl
  ) {
    return [];
  }

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

  const visited =
    new Set();

  let currentUrl =
    season.firstEpisodeUrl;

  let previousNumber =
    null;


  while (
    currentUrl &&
    results.length <
      MAX_EPISODES_PER_SEASON_SAFETY
  ) {

    currentUrl =
      canonical(
        currentUrl
      );


    /*
       Protección contra bucles
    */

    if (
      !currentUrl ||
      visited.has(currentUrl)
    ) {
      break;
    }


    /*
       No permitir que Siguiente
       salte a otra temporada.
    */

    if (
      !linkIsEpisodeOfSeason(
        currentUrl,
        season.sourceUrl
      )
    ) {
      console.log(
        `      🛑 Siguiente sale de la temporada: ${currentUrl}`
      );

      break;
    }


    visited.add(
      currentUrl
    );


    console.log(
      `      ▶ ${results.length + 1}: ${currentUrl}`
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


      /*
         El recorrido tiene que avanzar
         1 → 2 → 3 → 4...
      */

      if (
        number != null &&
        previousNumber != null &&
        number <= previousNumber
      ) {

        console.log(
          `      ⚠️ Secuencia no ascendente (${previousNumber} → ${number}), se detiene.`
        );

        break;
      }


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

        /*
           Si encontramos servidores nuevos,
           usamos esos.

           Si no, conservamos los antiguos.
        */

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
          results.length + 1,

        releaseDate:
          detail.releaseDate ||
          oldEpisode.releaseDate ||
          null
      });


      previousNumber =
        number ??
        previousNumber;


      /*
         ESTE ES EL PUNTO CLAVE:

         No generamos x2, x3, x4...

         Seguimos el enlace real
         "Siguiente" de DonghuaLife.
      */

      currentUrl =
        detail.nextUrl;


    } catch (error) {

      console.log(
        `      ❌ Error episodio: ${error.message}`
      );

      break;
    }
  }


  /*
     Si no hemos conseguido nada nuevo,
     conservar el catálogo anterior.
  */

  if (
    results.length === 0 &&
    previousEpisodes.length
  ) {

    console.log(
      `      ↩️ Se conservan ${previousEpisodes.length} episodios anteriores.`
    );

    return previousEpisodes;
  }


  return results;
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
        entry[key] === item[key]
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
    path.dirname(OUT_FILE),
    {
      recursive: true
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
   MAIN
========================================================= */

async function main() {

  console.log(
    '🚀 Iniciando sincronización mejorada del catálogo...'
  );


  const previous =
    await loadCatalog();


  /*
     Primero descubrimos TODAS
     las series mediante paginación.
  */

  const discovered =
    await discoverSeries();


  console.log(
    `📚 Series descubiertas: ${discovered.length}`
  );


  /*
     Empezamos con el catálogo anterior
     para no perder información si algo
     falla durante esta sincronización.
  */

  const startedAt =
    new Date().toISOString();


  const db = {

    meta: {
      ...previous.meta,

      version: 3,

      source:
        `${BASE_URL}/`,

      syncedAt:
        startedAt,

      lastSync: {

        status:
          'running',

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

  for (
    let i = 0;
    i < discovered.length;
    i++
  ) {

    const seriesUrl =
      discovered[i];

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
            item.id === detail.id ||
            item.slug === detail.slug
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


        console.log(
          `\n   📖 Temporada ${seasonNumber(seasonUrl) ?? seasonId}`
        );


        const oldSeason =
          db.seasons.find(
            item =>
              item.id === seasonId ||
              item.sourceUrl === seasonUrl
          );


        const oldEpisodes =
          db.episodes.filter(
            item =>
              item.seasonId === seasonId
          );


        try {

          const seasonHtml =
            await fetchHtml(
              seasonUrl
            );


          /*
             Aquí está la nueva detección
             robusta de episodios.
          */

          const parsedSeason =
            parseSeason(
              seasonHtml,
              seasonUrl
            );


          console.log(
            `   🔎 Enlaces de episodios detectados: ${parsedSeason.discoveredEpisodeLinks.length}`
          );


          if (
            parsedSeason.firstEpisodeUrl
          ) {

            console.log(
              `   🎯 Episodio inicial: ${parsedSeason.firstEpisodeUrl}`
            );

          } else {

            console.log(
              `   ⚠️ No se encontró episodio inicial para ${seasonId}`
            );

            if (
              oldEpisodes.length
            ) {

              console.log(
                `   ↩️ Se conservarán ${oldEpisodes.length} episodios existentes.`
              );
            }
          }


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

            number:
              parsedSeason.number,

            seriesId:
              detail.id,

            firstEpisodeUrl:
              parsedSeason.firstEpisodeUrl,

            updatedAt:
              new Date().toISOString()
          };


          upsert(
            db.seasons,
            seasonItem,
            'id'
          );


          /*
             Si encontramos episodio inicial,
             recorremos la cadena Siguiente.
          */

          if (
            parsedSeason.firstEpisodeUrl
          ) {

            const seasonWithSeries = {

              ...seasonItem,

              firstEpisodeUrl:
                parsedSeason.firstEpisodeUrl
            };


            const episodes =
              await crawlEpisodes(
                seasonWithSeries,
                oldEpisodes
              );


            if (
              episodes.length
            ) {

              /*
                 Sustituimos únicamente
                 los episodios de ESTA temporada.
              */

              db.episodes =
                db.episodes.filter(
                  item =>
                    item.seasonId !==
                    seasonId
                );


              for (
                const episode
                of episodes
              ) {

                upsert(
                  db.episodes,
                  episode,
                  'id'
                );
              }


              console.log(
                `   ✅ Episodios encontrados: ${episodes.length}`
              );

            } else if (
              oldEpisodes.length
            ) {

              console.log(
                `   ↩️ Episodios conservados: ${oldEpisodes.length}`
              );

            } else {

              console.log(
                '   ⚠️ Episodios encontrados: 0'
              );
            }

          } else {

            console.log(
              `   📦 Episodios actuales conservados: ${oldEpisodes.length}`
            );
          }


        } catch (error) {

          console.log(
            `   ❌ Error temporada: ${error.message}`
          );


          if (
            oldEpisodes.length
          ) {

            console.log(
              `   ↩️ Se conservan ${oldEpisodes.length} episodios existentes.`
            );
          }
        }
      }


    } catch (error) {

      console.log(
        `❌ Error serie: ${error.message}`
      );
    }
  }


  /* =====================================================
     ORDENAR CATÁLOGO
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
     FINALIZAR
  ===================================================== */

  const finished =
    new Date().toISOString();


  db.meta.syncedAt =
    finished;


  db.meta.lastSync = {

    status:
      'success',

    startedAt:
      db.meta.lastSync.startedAt,

    finishedAt:
      finished,

    error:
      null
  };


  await saveCatalog(
    db
  );


  console.log(
    '\n🎉 Sincronización terminada.'
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
}


/* =========================================================
   ERROR FATAL
========================================================= */

main().catch(
  async error => {

    console.error(
      '💥 Error fatal:',
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


    process.exitCode = 1;
  }
);
