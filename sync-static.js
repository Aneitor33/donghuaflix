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

const REQUEST_TIMEOUT = 30000;

// =========================================================
// UTILIDADES
// =========================================================

const clean = (value) =>
  (value || '')
    .replace(/\s+/g, ' ')
    .trim();

function absolute(href, base = BASE_URL) {
  try {
    if (!href) return null;

    if (
      /^javascript:/i.test(href) ||
      /^mailto:/i.test(href) ||
      /^tel:/i.test(href)
    ) {
      return null;
    }

    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function canonical(url) {
  try {
    const u = new URL(url);

    u.hash = '';

    // IMPORTANTE:
    // No eliminamos los parámetros ?page=2, ?page=3, etc.
    if (
      u.pathname.length > 1 &&
      u.pathname.endsWith('/') &&
      !u.search
    ) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.href;
  } catch {
    return url;
  }
}

function uniqueUrls(values) {
  return [
    ...new Set(
      values
        .filter(Boolean)
        .map(canonical)
    )
  ];
}

function slugFromUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname
      .split('/')
      .filter(Boolean);

    return parts.at(-1) || null;
  } catch {
    return null;
  }
}

function episodeNumber(value) {
  const text = String(value || '');

  let match = text.match(
    /(?:episodio|episode)[^0-9]{0,15}(?:x)?(\d+)/i
  );

  if (match) {
    return Number(match[1]);
  }

  match = text.match(
    /(?:^|[-_\s])x(\d+)(?:$|[-_\s])/i
  );

  if (match) {
    return Number(match[1]);
  }

  return null;
}

function seasonNumber(value) {
  const text = String(value || '');

  let match = text.match(
    /(?:season|temporada)[^0-9]{0,10}(\d+)/i
  );

  if (match) {
    return Number(match[1]);
  }

  match = text.match(
    /\/season\/[^/?#]*?[-_](\d+)(?:[-_/?.#]|$)/i
  );

  if (match) {
    return Number(match[1]);
  }

  return null;
}

async function fetchHtml(url) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36',

        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

        'Accept-Language':
          'es-ES,es;q=0.9,en;q=0.8'
      }
    });

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} en ${url}`
      );
    }

    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

// =========================================================
// TEXTO / IMAGEN
// =========================================================

function textFrom($, selectors) {
  for (const selector of selectors) {
    const value = clean(
      $(selector)
        .first()
        .text()
    );

    if (value) {
      return value;
    }
  }

  return '';
}

function imageFrom($, selectors) {
  for (const selector of selectors) {
    const element =
      $(selector).first();

    if (!element.length) {
      continue;
    }

    const src =
      element.attr('src') ||
      element.attr('data-src') ||
      element.attr('data-lazy-src') ||
      element.attr('data-original');

    const url = absolute(src);

    if (url) {
      return url;
    }
  }

  return null;
}

// =========================================================
// GÉNEROS
// =========================================================

function extractGenres($) {
  const genres = new Set();

  const selectors = [
    '[class*="genre"] a',
    '[class*="genero"] a',
    '[class*="genres"] a',
    '[class*="generos"] a',
    '.genre a',
    '.genero a'
  ];

  for (const selector of selectors) {
    $(selector).each((_, element) => {
      const value =
        clean($(element).text());

      if (
        value &&
        value.length < 80 &&
        !/^(ver|más|leer|watch)$/i.test(value)
      ) {
        genres.add(value);
      }
    });
  }

  const blocks = [
    '[class*="genre"]',
    '[class*="genero"]'
  ];

  for (const selector of blocks) {
    $(selector).each((_, element) => {
      const text =
        clean($(element).text());

      if (!text) {
        return;
      }

      const parts =
        text
          .split(',')
          .map(clean)
          .filter(Boolean);

      for (const part of parts) {
        if (
          part.length > 1 &&
          part.length < 80 &&
          !/^(géneros?|generos?)$/i.test(part)
        ) {
          genres.add(part);
        }
      }
    });
  }

  return [...genres];
}

// =========================================================
// ENLACES DE SERIES
// =========================================================

function parseSeriesLinks(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(html);

  const result = [];

  $('a[href]').each(
    (_, element) => {
      const href =
        $(element).attr('href');

      const seriesUrl =
        absolute(
          href,
          pageUrl
        );

      if (!seriesUrl) {
        return;
      }

      try {
        const parsed =
          new URL(seriesUrl);

        if (
          parsed.origin !==
          new URL(BASE_URL).origin
        ) {
          return;
        }

        if (
          !parsed.pathname.includes(
            '/series/'
          )
        ) {
          return;
        }

        result.push(
          canonical(seriesUrl)
        );
      } catch {
        // ignorar
      }
    }
  );

  return uniqueUrls(result);
}

// =========================================================
// PAGINACIÓN
// =========================================================

function isPaginationLink(
  url,
  currentUrl,
  elementText = '',
  rel = ''
) {
  try {
    const target =
      new URL(url);

    const current =
      new URL(currentUrl);

    if (
      target.origin !==
      current.origin
    ) {
      return false;
    }

    // Debe ser la misma sección.
    if (
      target.pathname !==
      current.pathname
    ) {
      return false;
    }

    const text =
      clean(elementText)
        .toLowerCase();

    const relation =
      String(rel || '')
        .toLowerCase();

    // Paginación normal:
    // ?page=2
    // ?page=3
    if (
      target.searchParams.has('page') ||
      target.searchParams.has('paged')
    ) {
      return true;
    }

    // rel="next"
    if (
      relation === 'next' ||
      relation.includes('next')
    ) {
      return true;
    }

    // Botón Siguiente
    if (
      /\b(siguiente|next)\b/i.test(text)
    ) {
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

function extractPaginationLinks(
  html,
  pageUrl
) {
  const $ =
    cheerio.load(html);

  const result = [];

  $('a[href]').each(
    (_, element) => {
      const href =
        $(element).attr('href');

      const paginationUrl =
        absolute(
          href,
          pageUrl
        );

      if (!paginationUrl) {
        return;
      }

      const text =
        clean($(element).text());

      const rel =
        $(element).attr('rel') || '';

      if (
        isPaginationLink(
          paginationUrl,
          pageUrl,
          text,
          rel
        )
      ) {
        result.push(
          canonical(paginationUrl)
        );
      }
    }
  );

  return uniqueUrls(result);
}

function getPageNumber(url) {
  try {
    const u =
      new URL(url);

    const value =
      u.searchParams.get('page') ||
      u.searchParams.get('paged');

    if (!value) {
      return 1;
    }

    const number =
      Number(value);

    return Number.isFinite(number)
      ? number
      : 1;
  } catch {
    return 1;
  }
}

// =========================================================
// PARSEAR SERIE
// =========================================================

function parseSeries(
  html,
  url
) {
  const $ =
    cheerio.load(html);

  const slug =
    slugFromUrl(url);

  const title =
    textFrom($, [
      'h1',
      '.entry-title',
      '.post-title',
      '.series-title',
      '[class*="title"]'
    ]);

  const image =
    imageFrom($, [
      '.poster img',
      '.cover img',
      '.series img',
      '.anime img',
      'article img',
      'main img',
      'img'
    ]);

  const synopsis =
    textFrom($, [
      '.sinopsis',
      '.synopsis',
      '.description',
      '.summary',
      '[class*="description"]',
      '[class*="sinopsis"]'
    ]);

  const originalTitle =
    textFrom($, [
      '.original-title',
      '.titulo-original',
      '[class*="original"]'
    ]);

  const duration =
    textFrom($, [
      '.duration',
      '.duracion',
      '[class*="duration"]',
      '[class*="duracion"]'
    ]);

  const releaseDate =
    textFrom($, [
      '.release-date',
      '.fecha',
      '[class*="release"]',
      '[class*="fecha"]'
    ]);

  const status =
    textFrom($, [
      '.status',
      '.estado',
      '[class*="status"]',
      '[class*="estado"]'
    ]);

  const genres =
    extractGenres($);

  // =======================================================
  // TEMPORADAS
  // =======================================================

  const seasonUrls =
    uniqueUrls(
      $('a[href]')
        .map((_, element) => {
          const href =
            $(element).attr('href');

          if (!href) {
            return null;
          }

          // IMPORTANTE:
          // Se llama seasonUrl y NO url.
          // Esto corrige:
          // Cannot access 'url' before initialization
          const seasonUrl =
            absolute(
              href,
              url
            );

          if (!seasonUrl) {
            return null;
          }

          try {
            const parsed =
              new URL(seasonUrl);

            if (
              parsed.origin !==
              new URL(BASE_URL).origin
            ) {
              return null;
            }

            if (
              !parsed.pathname.includes(
                '/season/'
              )
            ) {
              return null;
            }

            return canonical(
              seasonUrl
            );
          } catch {
            return null;
          }
        })
        .get()
    );

  return {
    id: slug,
    slug,

    title,

    image,

    synopsis,

    originalTitle,

    duration,

    releaseDate,

    status,

    genres,

    sourceUrl:
      canonical(url),

    seasonUrls,

    updatedAt:
      new Date().toISOString()
  };
}

// =========================================================
// PARSEAR TEMPORADA
// =========================================================

function parseSeason(
  html,
  seasonUrl
) {
  const $ =
    cheerio.load(html);

  const episodeLinks = [];

  $('a[href]').each(
    (_, element) => {
      const href =
        $(element).attr('href');

      if (!href) {
        return;
      }

      const episodeUrl =
        absolute(
          href,
          seasonUrl
        );

      if (!episodeUrl) {
        return;
      }

      try {
        const parsed =
          new URL(episodeUrl);

        if (
          parsed.origin !==
          new URL(BASE_URL).origin
        ) {
          return;
        }

        if (
          !parsed.pathname.includes(
            '/episode/'
          )
        ) {
          return;
        }

        const number =
          episodeNumber(
            episodeUrl
          ) ??
          episodeNumber(
            $(element).text()
          );

        episodeLinks.push({
          url:
            canonical(
              episodeUrl
            ),

          number
        });
      } catch {
        // ignorar
      }
    }
  );

  const unique =
    new Map();

  for (
    const item
    of episodeLinks
  ) {
    if (
      !unique.has(item.url)
    ) {
      unique.set(
        item.url,
        item
      );
    }
  }

  const episodes =
    [...unique.values()];

  episodes.sort(
    (a, b) => {
      const na =
        a.number == null
          ? Number.MAX_SAFE_INTEGER
          : a.number;

      const nb =
        b.number == null
          ? Number.MAX_SAFE_INTEGER
          : b.number;

      return na - nb;
    }
  );

  const first =
    episodes.find(
      episode =>
        episode.number === 1
    ) ||
    episodes[0] ||
    null;

  return {
    id:
      slugFromUrl(seasonUrl),

    slug:
      slugFromUrl(seasonUrl),

    sourceUrl:
      canonical(seasonUrl),

    number:
      seasonNumber(seasonUrl),

    firstEpisodeUrl:
      first?.url || null
  };
}

// =========================================================
// SERVIDORES
// =========================================================

function serverName(url) {
  try {
    const hostname =
      new URL(url)
        .hostname
        .replace(/^www\./, '')
        .toLowerCase();

    if (
      hostname.includes(
        'dailymotion'
      )
    ) {
      return 'Dailymotion';
    }

    if (
      hostname.includes(
        'streamtape'
      )
    ) {
      return 'Streamtape';
    }

    if (
      hostname.includes(
        'ok.ru'
      )
    ) {
      return 'OK.ru';
    }

    if (
      hostname.includes(
        'mega'
      )
    ) {
      return 'Mega';
    }

    if (
      hostname.includes(
        'vid'
      )
    ) {
      return 'Vid';
    }

    return hostname;
  } catch {
    return 'Servidor';
  }
}

// =========================================================
// PARSEAR EPISODIO
// =========================================================

function parseEpisode(
  html,
  episodeUrl
) {
  const $ =
    cheerio.load(html);

  const servers = [];

  function addServer(url) {
    if (!url) {
      return;
    }

    const absoluteUrl =
      absolute(
        url,
        episodeUrl
      );

    if (!absoluteUrl) {
      return;
    }

    try {
      const parsed =
        new URL(absoluteUrl);

      // No guardar enlaces internos.
      if (
        parsed.hostname
          .toLowerCase()
          .includes(
            'donghualife.com'
          )
      ) {
        return;
      }

      const finalUrl =
        canonical(
          absoluteUrl
        );

      const exists =
        servers.some(
          server =>
            server.url ===
            finalUrl
        );

      if (!exists) {
        servers.push({
          name:
            serverName(
              finalUrl
            ),

          url:
            finalUrl
        });
      }
    } catch {
      // ignorar
    }
  }

  // =======================================================
  // ENLACES
  // =======================================================

  $('a[href]').each(
    (_, element) => {
      const href =
        $(element).attr('href');

      const text =
        clean(
          $(element).text()
        );

      if (!href) {
        return;
      }

      // No considerar navegación como servidor.
      if (
        /\b(anterior|siguiente|serie|temporada)\b/i.test(
          text
        )
      ) {
        return;
      }

      addServer(href);
    }
  );

  // =======================================================
  // IFRAMES
  // =======================================================

  $('iframe').each(
    (_, element) => {
      addServer(
        $(element).attr('src') ||
        $(element).attr('data-src')
      );
    }
  );

  // =======================================================
  // DATA ATTRIBUTES
  // =======================================================

  $(
    '[data-src],[data-url],[data-embed]'
  ).each(
    (_, element) => {
      addServer(
        $(element).attr(
          'data-src'
        ) ||
        $(element).attr(
          'data-url'
        ) ||
        $(element).attr(
          'data-embed'
        )
      );
    }
  );

  // =======================================================
  // ANTERIOR / SIGUIENTE / SERIE
  // =======================================================

  let previousUrl = null;
  let nextUrl = null;
  let seriesUrl = null;

  $('a[href]').each(
    (_, element) => {
      const href =
        $(element).attr('href');

      if (!href) {
        return;
      }

      const navigationUrl =
        absolute(
          href,
          episodeUrl
        );

      if (!navigationUrl) {
        return;
      }

      const text =
        clean(
          $(element).text()
        ).toLowerCase();

      const rel =
        String(
          $(element).attr('rel') ||
          ''
        ).toLowerCase();

      if (
        /\banterior\b/.test(text) ||
        rel === 'prev' ||
        rel.includes('prev')
      ) {
        previousUrl =
          canonical(
            navigationUrl
          );
      }

      if (
        /\bsiguiente\b/.test(text) ||
        /\bnext\b/.test(text) ||
        rel === 'next' ||
        rel.includes('next')
      ) {
        nextUrl =
          canonical(
            navigationUrl
          );
      }

      if (
        /\bserie\b/.test(text) ||
        /\btemporada\b/.test(text)
      ) {
        seriesUrl =
          canonical(
            navigationUrl
          );
      }
    }
  );

  // Fallback anterior.
  if (!previousUrl) {
    const href =
      $('a[rel="prev"]')
        .first()
        .attr('href');

    if (href) {
      previousUrl =
        canonical(
          absolute(
            href,
            episodeUrl
          )
        );
    }
  }

  // Fallback siguiente.
  if (!nextUrl) {
    const href =
      $('a[rel="next"]')
        .first()
        .attr('href');

    if (href) {
      nextUrl =
        canonical(
          absolute(
            href,
            episodeUrl
          )
        );
    }
  }

  const number =
    episodeNumber(
      episodeUrl
    ) ||
    episodeNumber(
      $('h1')
        .first()
        .text()
    );

  const title =
    textFrom($, [
      'h1',
      '.entry-title',
      '.post-title',
      '.episode-title'
    ]);

  return {
    id:
      slugFromUrl(
        episodeUrl
      ),

    slug:
      slugFromUrl(
        episodeUrl
      ),

    title,

    sourceUrl:
      canonical(
        episodeUrl
      ),

    number,

    servers,

    previousUrl,

    nextUrl,

    seriesUrl,

    updatedAt:
      new Date().toISOString()
  };
}

// =========================================================
// DESCUBRIMIENTO PAGINADO
// =========================================================

async function discoverPaginatedSeed(
  seedUrl
) {
  const queue = [
    canonical(seedUrl)
  ];

  const visited =
    new Set();

  const found =
    new Map();

  let pagesProcessed = 0;

  // Solo protección contra un bucle de paginación.
  // NO es un límite de series.
  const MAX_PAGES = 200;

  while (
    queue.length &&
    pagesProcessed < MAX_PAGES
  ) {
    const currentUrl =
      queue.shift();

    if (
      visited.has(currentUrl)
    ) {
      continue;
    }

    visited.add(
      currentUrl
    );

    try {
      const page =
        getPageNumber(
          currentUrl
        );

      console.log(
        `   📄 Página ${page}: ${currentUrl}`
      );

      const html =
        await fetchHtml(
          currentUrl
        );

      pagesProcessed++;

      // ===================================================
      // SERIES
      // ===================================================

      const seriesLinks =
        parseSeriesLinks(
          html,
          currentUrl
        );

      for (
        const seriesUrl
        of seriesLinks
      ) {
        const slug =
          slugFromUrl(
            seriesUrl
          );

        if (!slug) {
          continue;
        }

        if (
          !found.has(slug)
        ) {
          found.set(
            slug,
            {
              slug,
              sourceUrl:
                seriesUrl
            }
          );
        }
      }

      console.log(
        `      ↳ ${seriesLinks.length} enlaces de series`
      );

      // ===================================================
      // SIGUIENTES PÁGINAS
      // ===================================================

      const pagination =
        extractPaginationLinks(
          html,
          currentUrl
        );

      for (
        const nextPage
        of pagination
      ) {
        if (
          !visited.has(
            nextPage
          )
        ) {
          queue.push(
            nextPage
          );
        }
      }

      if (
        pagination.length
      ) {
        console.log(
          `      ↳ ${pagination.length} páginas siguientes detectadas`
        );
      }
    } catch (error) {
      console.warn(
        `   ⚠️ Error página ${currentUrl}: ${error.message}`
      );
    }
  }

  if (
    pagesProcessed >=
    MAX_PAGES
  ) {
    console.warn(
      `   ⚠️ Se alcanzó el límite de seguridad de ${MAX_PAGES} páginas.`
    );
  }

  return [
    ...found.values()
  ];
}

// =========================================================
// DESCUBRIR TODAS LAS SERIES
// =========================================================

async function discoverSeries() {
  const found =
    new Map();

  console.log(
    '\n🔎 Descubriendo series y paginación...\n'
  );

  for (
    const seed
    of SEEDS
  ) {
    const url =
      canonical(
        absolute(seed)
      );

    console.log(
      `\n🌐 Explorando: ${url}`
    );

    const series =
      await discoverPaginatedSeed(
        url
      );

    for (
      const item
      of series
    ) {
      if (
        !found.has(
          item.slug
        )
      ) {
        found.set(
          item.slug,
          item
        );
      }
    }

    console.log(
      `   ✅ Acumuladas: ${found.size} series`
    );
  }

  const result =
    [...found.values()];

  console.log(
    `\n🎯 TOTAL SERIES DESCUBIERTAS: ${result.length}\n`
  );

  return result;
}

// =========================================================
// CRAWL DE EPISODIOS
// =========================================================

async function crawlEpisodes(
  series,
  season
) {
  const firstUrl =
    season.firstEpisodeUrl;

  if (!firstUrl) {
    console.warn(
      `   ⚠️ No se encontró primer episodio para ${season.slug}`
    );

    return [];
  }

  const episodes = [];

  const visited =
    new Set();

  let currentUrl =
    canonical(
      firstUrl
    );

  let previousNumber =
    null;

  // Protección contra bucles.
  // NO limita los episodios normales.
  const SAFETY_LIMIT =
    100000;

  while (
    currentUrl &&
    episodes.length <
      SAFETY_LIMIT
  ) {
    if (
      visited.has(
        currentUrl
      )
    ) {
      console.warn(
        `   ⚠️ Bucle detectado en ${currentUrl}`
      );

      break;
    }

    visited.add(
      currentUrl
    );

    let html;

    try {
      html =
        await fetchHtml(
          currentUrl
        );
    } catch (error) {
      console.warn(
        `   ⚠️ Error episodio ${currentUrl}: ${error.message}`
      );

      break;
    }

    const detail =
      parseEpisode(
        html,
        currentUrl
      );

    const currentNumber =
      detail.number ??
      episodeNumber(
        currentUrl
      );

    // =====================================================
    // COMPROBAR TEMPORADA
    // =====================================================

    const detectedSeason =
      seasonNumber(
        currentUrl
      );

    const expectedSeason =
      season.number;

    if (
      detectedSeason != null &&
      expectedSeason != null &&
      detectedSeason !==
        expectedSeason
    ) {
      console.log(
        `   ↪️ El episodio pertenece a otra temporada.`
      );

      break;
    }

    // =====================================================
    // COMPROBAR QUE AVANZA
    // =====================================================

    if (
      currentNumber != null &&
      previousNumber != null &&
      currentNumber <=
        previousNumber
    ) {
      console.log(
        `   ⚠️ La numeración dejó de avanzar (${previousNumber} → ${currentNumber}).`
      );

      break;
    }

    previousNumber =
      currentNumber ??
      previousNumber;

    // =====================================================
    // GUARDAR EPISODIO
    // =====================================================

    episodes.push({
      id:
        detail.id,

      slug:
        detail.slug,

      title:
        detail.title ||
        `${series.title} - ${currentNumber ?? ''}`.trim(),

      sourceUrl:
        detail.sourceUrl,

      servers:
        detail.servers || [],

      previousUrl:
        detail.previousUrl ||
        null,

      nextUrl:
        detail.nextUrl ||
        null,

      updatedAt:
        detail.updatedAt,

      seriesId:
        series.id,

      seasonId:
        season.id,

      number:
        currentNumber
    });

    console.log(
      `      🎬 Episodio ${currentNumber ?? '?'}`
    );

    // =====================================================
    // SIGUIENTE
    // =====================================================

    let nextUrl =
      detail.nextUrl;

    if (!nextUrl) {
      console.log(
        `   🏁 No hay Siguiente. Temporada terminada.`
      );

      break;
    }

    nextUrl =
      canonical(
        nextUrl
      );

    // Si apunta a la serie.
    if (
      detail.seriesUrl &&
      nextUrl ===
        detail.seriesUrl
    ) {
      console.log(
        `   🏁 Siguiente apunta a la serie.`
      );

      break;
    }

    // =====================================================
    // COMPROBAR TEMPORADA DEL SIGUIENTE
    // =====================================================

    const nextSeason =
      seasonNumber(
        nextUrl
      );

    if (
      nextSeason != null &&
      season.number != null &&
      nextSeason !==
        season.number
    ) {
      console.log(
        `   🏁 Siguiente pertenece a otra temporada.`
      );

      break;
    }

    // =====================================================
    // COMPROBAR NÚMERO DEL SIGUIENTE
    // =====================================================

    const nextNumber =
      episodeNumber(
        nextUrl
      );

    if (
      currentNumber != null &&
      nextNumber != null &&
      nextNumber <=
        currentNumber
    ) {
      console.log(
        `   ⚠️ El siguiente episodio no aumenta la numeración.`
      );

      break;
    }

    currentUrl =
      nextUrl;
  }

  if (
    episodes.length >=
    SAFETY_LIMIT
  ) {
    console.warn(
      `   ⚠️ Se alcanzó el límite de seguridad de ${SAFETY_LIMIT} episodios.`
    );
  }

  return episodes;
}

// =========================================================
// UPSERT
// =========================================================

function upsert(
  array,
  item,
  key = 'id'
) {
  const index =
    array.findIndex(
      x =>
        x[key] ===
        item[key]
    );

  if (index < 0) {
    array.push(item);
  } else {
    array[index] = {
      ...array[index],
      ...item
    };
  }
}

// =========================================================
// CARGAR CATÁLOGO
// =========================================================

async function loadCatalog() {
  try {
    const raw =
      await fs.readFile(
        OUT_FILE,
        'utf8'
      );

    const catalog =
      JSON.parse(raw);

    return {
      meta:
        catalog.meta || {},

      series:
        Array.isArray(
          catalog.series
        )
          ? catalog.series
          : [],

      seasons:
        Array.isArray(
          catalog.seasons
        )
          ? catalog.seasons
          : [],

      episodes:
        Array.isArray(
          catalog.episodes
        )
          ? catalog.episodes
          : [],

      movies:
        Array.isArray(
          catalog.movies
        )
          ? catalog.movies
          : [],

      genres:
        Array.isArray(
          catalog.genres
        )
          ? catalog.genres
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

// =========================================================
// MAIN
// =========================================================

async function main() {
  const startedAt =
    new Date().toISOString();

  console.log(
    '🚀 Iniciando sincronización del catálogo DonghuaFlix...\n'
  );

  const db =
    await loadCatalog();

  // =======================================================
  // DESCUBRIR SERIES
  // =======================================================

  const discovered =
    await discoverSeries();

  console.log(
    `📚 Series descubiertas: ${discovered.length}\n`
  );

  let processed = 0;

  // =======================================================
  // PROCESAR CADA SERIE
  // =======================================================

  for (
    const item
    of discovered
  ) {
    processed++;

    console.log(
      '\n=================================================='
    );

    console.log(
      `${processed}/${discovered.length} — ${item.slug}`
    );

    console.log(
      '=================================================='
    );

    try {
      const seriesUrl =
        canonical(
          item.sourceUrl
        );

      const seriesHtml =
        await fetchHtml(
          seriesUrl
        );

      const detail =
        parseSeries(
          seriesHtml,
          seriesUrl
        );

      const previous =
        db.series.find(
          x =>
            x.id ===
            detail.id
        );

      const series = {
        id:
          detail.id,

        slug:
          detail.slug,

        title:
          detail.title ||
          previous?.title ||
          detail.slug,

        image:
          detail.image ||
          previous?.image ||
          null,

        synopsis:
          detail.synopsis ||
          previous?.synopsis ||
          '',

        originalTitle:
          detail.originalTitle ||
          previous?.originalTitle ||
          '',

        duration:
          detail.duration ||
          previous?.duration ||
          '',

        releaseDate:
          detail.releaseDate ||
          previous?.releaseDate ||
          '',

        status:
          detail.status ||
          previous?.status ||
          '',

        genres:
          detail.genres?.length
            ? detail.genres
            : (
                previous?.genres ||
                []
              ),

        sourceUrl:
          detail.sourceUrl,

        updatedAt:
          detail.updatedAt
      };

      upsert(
        db.series,
        series
      );

      console.log(
        `   📺 ${series.title}`
      );

      console.log(
        `   🎭 Géneros: ${series.genres.length}`
      );

      // =====================================================
      // TEMPORADAS
      // =====================================================

      const seasonUrls =
        uniqueUrls(
          detail.seasonUrls ||
            []
        );

      console.log(
        `   📚 Temporadas encontradas: ${seasonUrls.length}`
      );

      const sortedSeasonUrls =
        seasonUrls.sort(
          (a, b) => {
            const na =
              seasonNumber(a) ??
              Number.MAX_SAFE_INTEGER;

            const nb =
              seasonNumber(b) ??
              Number.MAX_SAFE_INTEGER;

            return na - nb;
          }
        );

      // =====================================================
      // PROCESAR TEMPORADAS
      // =====================================================

      for (
        const seasonUrl
        of sortedSeasonUrls
      ) {
        try {
          const seasonHtml =
            await fetchHtml(
              seasonUrl
            );

          const seasonDetail =
            parseSeason(
              seasonHtml,
              seasonUrl
            );

          const season = {
            id:
              seasonDetail.id,

            slug:
              seasonDetail.slug,

            sourceUrl:
              seasonDetail.sourceUrl,

            number:
              seasonDetail.number,

            seriesId:
              series.id,

            updatedAt:
              new Date().toISOString()
          };

          upsert(
            db.seasons,
            season
          );

          console.log(
            `   📖 Temporada ${season.number ?? '?'}`
          );

          if (
            !seasonDetail.firstEpisodeUrl
          ) {
            console.warn(
              `      ⚠️ No se encontró el primer episodio.`
            );

            continue;
          }

          // =================================================
          // EPISODIOS
          // =================================================

          const episodes =
            await crawlEpisodes(
              series,
              season
            );

          console.log(
            `      ✅ Episodios encontrados: ${episodes.length}`
          );

          for (
            const episode
            of episodes
          ) {
            upsert(
              db.episodes,
              episode
            );
          }
        } catch (error) {
          console.warn(
            `   ❌ Error temporada ${seasonUrl}: ${error.message}`
          );
        }
      }
    } catch (error) {
      console.warn(
        `❌ Error serie: ${error.message}`
      );
    }
  }

  // =========================================================
  // ORDENAR SERIES
  // =========================================================

  db.series.sort(
    (a, b) =>
      String(
        a.title || ''
      ).localeCompare(
        String(
          b.title || ''
        ),
        'es',
        {
          sensitivity:
            'base'
        }
      )
  );

  // =========================================================
  // ORDENAR TEMPORADAS
  // =========================================================

  db.seasons.sort(
    (a, b) => {
      const sa =
        a.seriesId || '';

      const sb =
        b.seriesId || '';

      if (sa !== sb) {
        return sa.localeCompare(
          sb
        );
      }

      return (
        (a.number || 0) -
        (b.number || 0)
      );
    }
  );

  // =========================================================
  // ORDENAR EPISODIOS
  // =========================================================

  db.episodes.sort(
    (a, b) => {
      if (
        a.seriesId !==
        b.seriesId
      ) {
        return String(
          a.seriesId || ''
        ).localeCompare(
          String(
            b.seriesId || ''
          )
        );
      }

      if (
        a.seasonId !==
        b.seasonId
      ) {
        return String(
          a.seasonId || ''
        ).localeCompare(
          String(
            b.seasonId || ''
          )
        );
      }

      return (
        (a.number || 0) -
        (b.number || 0)
      );
    }
  );

  // =========================================================
  // RECONSTRUIR GÉNEROS
  // =========================================================

  const genres =
    new Set();

  for (
    const series
    of db.series
  ) {
    for (
      const genre
      of series.genres || []
    ) {
      const value =
        clean(genre);

      if (value) {
        genres.add(
          value
        );
      }
    }
  }

  db.genres =
    [...genres].sort(
      (a, b) =>
        a.localeCompare(
          b,
          'es',
          {
            sensitivity:
              'base'
          }
        )
    );

  // =========================================================
  // META
  // =========================================================

  db.meta = {
    ...(db.meta || {}),

    version: 2,

    source:
      BASE_URL + '/',

    syncedAt:
      new Date().toISOString(),

    lastSync: {
      status:
        'success',

      startedAt,

      finishedAt:
        new Date().toISOString(),

      error:
        null
    }
  };

  // =========================================================
  // GUARDAR
  // =========================================================

  await fs.mkdir(
    path.dirname(
      OUT_FILE
    ),
    {
      recursive: true
    }
  );

  const tempFile =
    OUT_FILE + '.tmp';

  await fs.writeFile(
    tempFile,
    JSON.stringify(
      db,
      null,
      2
    ),
    'utf8'
  );

  await fs.rename(
    tempFile,
    OUT_FILE
  );

  // =========================================================
  // RESUMEN
  // =========================================================

  console.log(
    '\n\n=============================================='
  );

  console.log(
    '✅ SINCRONIZACIÓN COMPLETADA'
  );

  console.log(
    '=============================================='
  );

  console.log(
    `📺 Series: ${db.series.length}`
  );

  console.log(
    `📚 Temporadas: ${db.seasons.length}`
  );

  console.log(
    `🎬 Episodios: ${db.episodes.length}`
  );

  console.log(
    `🎭 Géneros: ${db.genres.length}`
  );

  console.log(
    `💾 Archivo: ${OUT_FILE}`
  );

  console.log(
    '==============================================\n'
  );
}

// =========================================================
// EJECUTAR
// =========================================================

main().catch(error => {
  console.error(
    '\n❌ ERROR FATAL:'
  );

  console.error(error);

  process.exit(1);
});
