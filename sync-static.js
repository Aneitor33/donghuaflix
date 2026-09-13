import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.join(process.cwd(), 'public', 'data', 'catalog.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const MIN_DELAY_MS = Number(process.env.SCRAPE_DELAY_MIN_MS) || 500;
const MAX_DELAY_MS = Number(process.env.SCRAPE_DELAY_MAX_MS) || 1200;

const MAX_RETRIES = 3;

// IMPORTANTE:
// Esto NO es un límite de episodios.
// Es solamente una protección contra un enlace de paginación roto
// que podría provocar un bucle infinito.
const MAX_PAGINATION_PAGES = 100000;

const RESERVED_SLUGS = new Set([
  'temporadas',
  'temporada',
  'episodios',
  'episodio',
  'genero',
  'generos',
  'genre',
  'genres',
  'page',
  'pagina',
  'buscar',
  'search',
  'categoria',
  'categorias',
  'inicio'
]);

const GENERIC_HEADINGS = new Set([
  'temporadas',
  'temporada',
  'episodios',
  'episodio',
  'series',
  'inicio'
]);

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay() {
  const min = Math.min(MIN_DELAY_MS, MAX_DELAY_MS);
  const max = Math.max(MIN_DELAY_MS, MAX_DELAY_MS);
  return Math.floor(min + Math.random() * (max - min + 1));
}

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function absoluteUrl(relative, base = BASE_URL) {
  try {
    if (!relative) return null;

    if (/^(javascript:|mailto:|tel:|#)/i.test(relative)) {
      return null;
    }

    const url = new URL(relative, base);

    if (!/^https?:$/i.test(url.protocol)) {
      return null;
    }

    return url.href;
  } catch {
    return null;
  }
}

function sourceUrl(url) {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return url;
  }
}

function slugFromUrl(url) {
  try {
    const pathname = new URL(url).pathname
      .split('/')
      .filter(Boolean);

    return pathname[pathname.length - 1] || '';
  } catch {
    return '';
  }
}

function isSameHost(url) {
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    return hostname === 'donghualife.com';
  } catch {
    return false;
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function isGenericHeading(text) {
  return GENERIC_HEADINGS.has(
    clean(text).toLowerCase()
  );
}

function formatTitle(slug) {
  if (!slug) return 'Sin título';

  return slug
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase())
    .trim();
}

function extractCleanImage($ctx, base = BASE_URL) {
  const candidates = [
    $ctx('meta[property="og:image"]').attr('content'),
    $ctx('meta[name="twitter:image"]').attr('content'),
    $ctx('img').first().attr('src'),
    $ctx('img').first().attr('data-src'),
    $ctx('img').first().attr('data-lazy-src')
  ];

  for (const candidate of candidates) {
    const url = absoluteUrl(candidate, base);
    if (url) return url;
  }

  return null;
}

function extractImageFromElement($, element, base) {
  const candidates = [
    $(element).find('img').first().attr('src'),
    $(element).find('img').first().attr('data-src'),
    $(element).find('img').first().attr('data-lazy-src')
  ];

  for (const candidate of candidates) {
    const url = absoluteUrl(candidate, base);
    if (url) return url;
  }

  return null;
}

function extractNumber(text) {
  const match = clean(text).match(/\b(\d+)\b/);
  return match ? Number(match[1]) : null;
}

function hostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return 'Servidor';
  }
}

function addServer(servers, name, url, embed = false) {
  if (!url) return;

  const cleanUrl = sourceUrl(url);
  const serverName = clean(name) || hostName(cleanUrl);

  const exists = servers.some(
    server =>
      server.url === cleanUrl ||
      (
        server.name.toLowerCase() === serverName.toLowerCase() &&
        server.url === cleanUrl
      )
  );

  if (!exists) {
    servers.push({
      name: serverName,
      url: cleanUrl,
      embed
    });
  }
}

async function fetchHTML(
  url,
  {
    referer = BASE_URL,
    retries = MAX_RETRIES
  } = {}
) {
  let lastError = null;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      await sleep(randomDelay());

      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language':
            'es-ES,es;q=0.9,en;q=0.7',
          'Referer': referer,
          'Cache-Control': 'no-cache'
        },
        redirect: 'follow'
      });

      if (response.ok) {
        return await response.text();
      }

      const error = new Error(
        `HTTP ${response.status} en ${url}`
      );

      lastError = error;

      const retryable =
        response.status === 403 ||
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500;

      if (!retryable) {
        throw error;
      }

      if (attempt < retries) {
        await sleep(1000 * attempt);
      }
    } catch (error) {
      lastError = error;

      if (attempt < retries) {
        await sleep(1000 * attempt);
      }
    }
  }

  throw lastError || new Error(`No se pudo obtener ${url}`);
}

function getLinks($, selector, base) {
  const result = [];

  $(selector).each((_, element) => {
    const href = $(element).attr('href');
    const url = absoluteUrl(href, base);

    if (!url || !isSameHost(url)) return;

    result.push(sourceUrl(url));
  });

  return unique(result);
}

/*
 * Busca enlaces de series desde una página.
 */
function extractSeriesLinks($, base) {
  const result = [];

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const url = absoluteUrl(href, base);

    if (!url || !isSameHost(url)) return;

    const pathname = new URL(url).pathname;

    if (/\/series\//i.test(pathname)) {
      const slug = slugFromUrl(url);

      if (
        slug &&
        !RESERVED_SLUGS.has(slug.toLowerCase())
      ) {
        result.push(sourceUrl(url));
      }
    }
  });

  return unique(result);
}

/*
 * Busca temporadas dentro de una página de serie.
 */
function extractSeasonLinks($, base, seriesSlug) {
  const result = [];

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const url = absoluteUrl(href, base);

    if (!url || !isSameHost(url)) return;

    const pathname = new URL(url).pathname;

    if (/\/season\//i.test(pathname)) {
      result.push(sourceUrl(url));
    }
  });

  /*
   * Si la serie no contiene el enlace directamente,
   * intentamos el formato habitual de la web.
   */
  if (!result.length && seriesSlug) {
    result.push(
      `${BASE_URL}/season/${seriesSlug}-1`
    );
  }

  return unique(result);
}

/*
 * Extrae la información básica de una serie.
 */
function parseSeriesPage(html, url) {
  const $ = cheerio.load(html);

  const seriesSlug = slugFromUrl(url);

  const rawTitle = clean(
    $('h1').first().text() ||
    $('h2').first().text() ||
    $('title').first().text()
  );

  const title =
    isGenericHeading(rawTitle)
      ? formatTitle(seriesSlug)
      : rawTitle.replace(/\s*\|.*$/, '').trim();

  const body = clean($('body').text());

  let synopsis = null;

  const synopsisMatch = body.match(
    /(?:Synopsis|Sinopsis)\s*:?\s*(.*?)(?=\s+(?:Temporadas|Temporada|Autor|Studio|Estudio|Género|Generos|Géneros|Estado|Fecha de emisión)\s*:?\s*)/i
  );

  if (synopsisMatch) {
    synopsis = clean(synopsisMatch[1]);
  }

  let originalTitle = null;

  const originalMatch = body.match(
    /(?:Título original|Titulo original)\s*:?\s*(.*?)(?=\s+(?:Duración|Duracion|Estado|Fecha de emisión|Género|Generos|Géneros)\s*:?\s*)/i
  );

  if (originalMatch) {
    originalTitle = clean(originalMatch[1]);
  }

  let duration = null;

  const durationMatch = body.match(
    /(?:Duración|Duracion)\s*:?\s*(.*?)(?=\s+(?:Estado|Fecha de emisión|Género|Generos|Géneros)\s*:?\s*)/i
  );

  if (durationMatch) {
    duration = clean(durationMatch[1]);
  }

  let status = null;

  const statusElement = $('a').filter((_, element) => {
    return /en emisión|finalizado|en pausa/i.test(
      clean($(element).text())
    );
  }).first();

  if (statusElement.length) {
    status = clean(statusElement.text());
  }

  if (!status) {
    const statusMatch = body.match(
      /Estado\s*:?\s*(.*?)(?=\s+(?:Fecha de emisión|Género|Generos|Géneros|Synopsis|Sinopsis)\s*:?\s*)/i
    );

    if (statusMatch) {
      status = clean(statusMatch[1]);
    }
  }

  let releaseDate = null;

  const releaseMatch = body.match(
    /Fecha de emisión\s*:?\s*(.*?)(?=\s+(?:Género|Generos|Géneros|Synopsis|Sinopsis|Temporadas|Temporada)\s*:?\s*)/i
  );

  if (releaseMatch) {
    releaseDate = clean(releaseMatch[1]);
  }

  const knownGenres = [
    'Animación',
    'Cultivo',
    'Acción',
    'Aventura',
    'Artes marciales',
    'Comedia',
    'Drama',
    'Romance',
    'Reencarnación',
    'Isekai',
    'Estrategia',
    'Fantasía',
    'Misterio',
    'Horror',
    'Historia',
    'Ciencia ficción',
    'Venganza',
    'Sistema de cultivo',
    'Superpoderes',
    'Escolar',
    'Sobrenatural'
  ];

  const genres = [];

  $('a').each((_, element) => {
    const text = clean($(element).text());

    for (const genre of knownGenres) {
      if (
        text.toLowerCase() ===
        genre.toLowerCase()
      ) {
        genres.push(genre);
      }
    }
  });

  const seasonUrls = extractSeasonLinks(
    $,
    url,
    seriesSlug
  );

  return {
    id: seriesSlug,
    slug: seriesSlug,

    /*
     * IMPORTANTE:
     * El título se mantiene basado en el slug.
     * Así no volvemos a tener "Temporadas".
     */
    title:
      seriesSlug
        ? formatTitle(seriesSlug)
        : title || 'Sin título',

    originalTitle:
      originalTitle || null,

    duration:
      duration || null,

    status:
      status || null,

    releaseDate:
      releaseDate || null,

    synopsis:
      synopsis || null,

    image:
      extractCleanImage($, url),

    sourceUrl:
      sourceUrl(url),

    genres:
      unique(genres),

    seasonUrls,

    updatedAt:
      new Date().toISOString()
  };
}

/*
 * Extrae episodios de UNA página de temporada.
 */
function parseEpisodePage(html, url) {
  const $ = cheerio.load(html);

  const episodes = [];

  $('a[href*="/episode/"]').each((_, element) => {
    const href = $(element).attr('href');
    const episodeUrl = absoluteUrl(href, url);

    if (!episodeUrl || !isSameHost(episodeUrl)) {
      return;
    }

    const cleanEpisodeUrl =
      sourceUrl(episodeUrl);

    const row = $(element).closest('tr');

    const cells = row.length
      ? row.find('td')
          .map((_, cell) => clean($(cell).text()))
          .get()
      : [];

    const linkText =
      clean($(element).text());

    const parentText =
      clean($(element).parent().text());

    const combinedText =
      clean(
        [
          cells.join(' '),
          linkText,
          parentText
        ].join(' ')
      );

    const number =
      extractNumber(
        cells[0] ||
        linkText ||
        combinedText
      );

    const releaseDate =
      cells.find(value =>
        /\d{4}|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre/i
          .test(value)
      ) || null;

    episodes.push({
      url: cleanEpisodeUrl,

      number,

      title:
        linkText ||
        (
          number !== null
            ? `Episodio ${number}`
            : 'Episodio'
        ),

      releaseDate
    });
  });

  const map = new Map();

  for (const episode of episodes) {
    map.set(episode.url, episode);
  }

  return [...map.values()];
}

/*
 * Detecta enlaces de paginación.
 *
 * No asumimos que la web usa únicamente ?page=2.
 * Revisamos:
 * - rel=next
 * - enlaces con "Siguiente"
 * - enlaces con "Next"
 * - enlaces numerados
 * - parámetros page/paged/pagina
 */
function extractPaginationLinks($, base, currentEpisodeUrls) {
  const candidates = [];

  $('a[href]').each((_, element) => {
    const href = $(element).attr('href');
    const text = clean($(element).text());
    const rel = clean($(element).attr('rel'));

    const url = absoluteUrl(href, base);

    if (!url || !isSameHost(url)) return;

    const parsed = new URL(url);
    const pathname = parsed.pathname;
    const lowerText = text.toLowerCase();
    const lowerRel = rel.toLowerCase();

    let score = 0;

    if (
      lowerRel.includes('next') ||
      lowerRel.includes('siguiente')
    ) {
      score += 100;
    }

    if (
      /^(siguiente|next|›|»|>|→)$/i.test(text)
    ) {
      score += 90;
    }

    if (
      /[?&](page|paged|pagina|p)=\d+/i.test(
        parsed.search
      )
    ) {
      score += 50;
    }

    if (
      /\/page\/\d+/i.test(pathname)
    ) {
      score += 50;
    }

    /*
     * Los enlaces numéricos de la paginación
     * también son válidos.
     */
    if (/^\d+$/.test(text)) {
      score += 30;
    }

    if (score > 0) {
      candidates.push({
        url: sourceUrl(url),
        score,
        text
      });
    }
  });

  /*
   * Eliminamos la página actual y duplicados.
   */
  const currentUrl = sourceUrl(base);

  const uniqueCandidates = new Map();

  for (const candidate of candidates) {
    if (candidate.url === currentUrl) continue;

    if (!uniqueCandidates.has(candidate.url)) {
      uniqueCandidates.set(
        candidate.url,
        candidate
      );
    } else {
      const old =
        uniqueCandidates.get(candidate.url);

      if (candidate.score > old.score) {
        uniqueCandidates.set(
          candidate.url,
          candidate
        );
      }
    }
  }

  /*
   * Priorizamos "Siguiente".
   */
  return [...uniqueCandidates.values()]
    .sort((a, b) => b.score - a.score)
    .map(x => x.url);
}

/*
 * Recorre TODAS las páginas de una temporada.
 *
 * IMPORTANTE:
 * No existe un límite de episodios.
 * MAX_PAGINATION_PAGES solo evita bucles infinitos
 * causados por una web mal formada.
 */
async function scrapeSeasonPages(
  firstSeasonUrl,
  onProgress
) {
  const visited = new Set();
  const pending = [sourceUrl(firstSeasonUrl)];

  const allEpisodes = new Map();

  let pagesRead = 0;

  while (
    pending.length > 0 &&
    pagesRead < MAX_PAGINATION_PAGES
  ) {
    const seasonPageUrl =
      pending.shift();

    if (visited.has(seasonPageUrl)) {
      continue;
    }

    visited.add(seasonPageUrl);
    pagesRead++;

    let html;

    try {
      html = await fetchHTML(
        seasonPageUrl,
        {
          referer: firstSeasonUrl
        }
      );
    } catch (error) {
      onProgress(
        `⚠️ Página de temporada omitida: ${error.message}`
      );
      continue;
    }

    const $ = cheerio.load(html);

    const pageEpisodes =
      parseEpisodePage(
        html,
        seasonPageUrl
      );

    let added = 0;

    for (const episode of pageEpisodes) {
      const key =
        episode.number !== null
          ? `number:${episode.number}`
          : `url:${episode.url}`;

      if (!allEpisodes.has(key)) {
        allEpisodes.set(
          key,
          episode
        );
        added++;
      }
    }

    onProgress(
      `      📄 Página ${pagesRead}: +${added} episodios (total: ${allEpisodes.size})`
    );

    /*
     * Buscamos más páginas.
     */
    const nextPages =
      extractPaginationLinks(
        $,
        seasonPageUrl,
        pageEpisodes.map(x => x.url)
      );

    for (const nextPage of nextPages) {
      if (!visited.has(nextPage)) {
        pending.push(nextPage);
      }
    }
  }

  if (
    pagesRead >= MAX_PAGINATION_PAGES
  ) {
    onProgress(
      `⚠️ Se alcanzó la protección de ${MAX_PAGINATION_PAGES} páginas de paginación.`
    );
  }

  return [...allEpisodes.values()]
    .sort((a, b) => {
      if (
        a.number === null &&
        b.number === null
      ) {
        return a.url.localeCompare(b.url);
      }

      if (a.number === null) return 1;
      if (b.number === null) return -1;

      return a.number - b.number;
    });
}

/*
 * Obtiene los servidores REALES desde la página
 * individual del episodio.
 *
 * No fabricamos URLs /embed/...
 */
async function parseEpisodeDetails(
  episode,
  referer
) {
  try {
    const html =
      await fetchHTML(
        episode.url,
        { referer }
      );

    const $ = cheerio.load(html);

    const title =
      clean(
        $('h1').first().text() ||
        $('h2').first().text() ||
        $('title').first().text()
      ) ||
      episode.title;

    const servers = [];

    /*
     * Enlaces directos a servidores.
     */
    $('a[href]').each((_, element) => {
      const name =
        clean($(element).text());

      const href =
        absoluteUrl(
          $(element).attr('href'),
          episode.url
        );

      if (!href || !name) return;

      const combined =
        `${name} ${href}`;

      if (
        /rumble|dailymotion|youtube|ok\.ru|stream|vidoza|filemoon|voe|mixdrop|mega|mp4upload|vidmoly|sibnet|streamtape|streamwish|vidhide|myvi|sendvid/i.test(
          combined
        )
      ) {
        addServer(
          servers,
          name,
          href,
          false
        );
      }
    });

    /*
     * Iframes y fuentes de vídeo.
     */
    $('iframe, video source').each(
      (_, element) => {
        const src =
          absoluteUrl(
            $(element).attr('src') ||
            $(element).attr('data-src'),
            episode.url
          );

        if (src) {
          addServer(
            servers,
            hostName(src),
            src,
            true
          );
        }
      }
    );

    /*
     * Algunos reproductores esconden la URL
     * dentro de atributos/data-*.
     */
    $('*[data-src], *[data-url], *[data-video]').each(
      (_, element) => {
        const candidates = [
          $(element).attr('data-src'),
          $(element).attr('data-url'),
          $(element).attr('data-video')
        ];

        for (const candidate of candidates) {
          const src =
            absoluteUrl(
              candidate,
              episode.url
            );

          if (!src) continue;

          if (
            /rumble|dailymotion|youtube|ok\.ru|stream|vidoza|filemoon|voe|mixdrop|mega|mp4upload|vidmoly|sibnet|streamtape|streamwish|vidhide|myvi|sendvid/i.test(
              src
            )
          ) {
            addServer(
              servers,
              hostName(src),
              src,
              true
            );
          }
        }
      }
    );

    const previousUrl =
      absoluteUrl(
        $('a')
          .filter((_, element) =>
            /Anterior|Previous/i.test(
              clean($(element).text())
            )
          )
          .first()
          .attr('href'),
        episode.url
      );

    const nextUrl =
      absoluteUrl(
        $('a')
          .filter((_, element) =>
            /Siguiente|Next/i.test(
              clean($(element).text())
            )
          )
          .first()
          .attr('href'),
        episode.url
      );

    return {
      id: slugFromUrl(episode.url),
      slug: slugFromUrl(episode.url),

      title,

      sourceUrl:
        sourceUrl(episode.url),

      number:
        episode.number,

      releaseDate:
        episode.releaseDate || null,

      servers,

      previousUrl:
        previousUrl
          ? sourceUrl(previousUrl)
          : null,

      nextUrl:
        nextUrl
          ? sourceUrl(nextUrl)
          : null,

      updatedAt:
        new Date().toISOString()
    };
  } catch (error) {
    return {
      id: slugFromUrl(episode.url),
      slug: slugFromUrl(episode.url),

      title:
        episode.title ||
        `Episodio ${episode.number ?? ''}`.trim(),

      sourceUrl:
        sourceUrl(episode.url),

      number:
        episode.number,

      releaseDate:
        episode.releaseDate || null,

      servers: [],

      previousUrl: null,
      nextUrl: null,

      updatedAt:
        new Date().toISOString(),

      scrapeError:
        error.message
    };
  }
}

/*
 * Busca páginas de catálogo de series.
 *
 * Esto permite que no dependamos exclusivamente
 * de /series.
 */
async function discoverSeriesUrls(
  onProgress
) {
  const seeds = [
    `${BASE_URL}/series`,
    `${BASE_URL}/donghuas`,
    `${BASE_URL}/en-emision`,
    `${BASE_URL}/finalizado`,
    `${BASE_URL}/en-pausa`,
    BASE_URL
  ];

  const seriesUrls = new Set();

  for (const seed of seeds) {
    try {
      const html =
        await fetchHTML(seed);

      const $ =
        cheerio.load(html);

      const links =
        extractSeriesLinks(
          $,
          seed
        );

      for (const link of links) {
        seriesUrls.add(link);
      }

      onProgress(
        `📚 Fuente: ${seed} → ${links.length} series encontradas`
      );

      /*
       * También buscamos paginación del catálogo.
       */
      const pagination =
        extractPaginationLinks(
          $,
          seed,
          []
        );

      for (
        const pageUrl of pagination
      ) {
        try {
          const pageHtml =
            await fetchHTML(
              pageUrl,
              { referer: seed }
            );

          const $page =
            cheerio.load(pageHtml);

          const pageLinks =
            extractSeriesLinks(
              $page,
              pageUrl
            );

          for (
            const link of pageLinks
          ) {
            seriesUrls.add(link);
          }
        } catch (error) {
          onProgress(
            `⚠️ Página de catálogo omitida: ${error.message}`
          );
        }
      }
    } catch (error) {
      onProgress(
        `⚠️ Fuente omitida: ${error.message}`
      );
    }
  }

  return [...seriesUrls];
}

/*
 * Carga el catálogo anterior.
 *
 * Si la web tiene un fallo temporal, no destruimos
 * el catálogo que ya funciona en Cloudflare Pages.
 */
async function loadExistingCatalog() {
  try {
    const text =
      await fs.readFile(
        OUT_FILE,
        'utf8'
      );

    const catalog =
      JSON.parse(text);

    return {
      meta: catalog.meta || {},
      series: Array.isArray(catalog.series)
        ? catalog.series
        : [],
      seasons: Array.isArray(catalog.seasons)
        ? catalog.seasons
        : [],
      episodes: Array.isArray(catalog.episodes)
        ? catalog.episodes
        : [],
      movies: Array.isArray(catalog.movies)
        ? catalog.movies
        : [],
      genres: Array.isArray(catalog.genres)
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

async function saveCatalog(catalog) {
  await fs.mkdir(
    path.dirname(OUT_FILE),
    { recursive: true }
  );

  const tempFile =
    `${OUT_FILE}.tmp`;

  await fs.writeFile(
    tempFile,
    JSON.stringify(
      catalog,
      null,
      2
    ),
    'utf8'
  );

  await fs.rename(
    tempFile,
    OUT_FILE
  );
}

/*
 * Sincronización principal.
 */
async function scrapeDonghuaFlix() {
  console.log(
    '🚀 Iniciando sincronización del catálogo...'
  );

  const startedAt =
    new Date().toISOString();

  const oldCatalog =
    await loadExistingCatalog();

  let seriesUrls = [];

  try {
    seriesUrls =
      await discoverSeriesUrls(
        message => console.log(message)
      );
  } catch (error) {
    console.error(
      `❌ Error descubriendo series: ${error.message}`
    );
  }

  /*
   * Si no podemos encontrar ninguna serie,
   * conservamos el catálogo anterior.
   */
  if (!seriesUrls.length) {
    console.error(
      '❌ No se encontraron series en la web principal.'
    );

    console.error(
      '🛡️ Se conserva el catalog.json existente.'
    );

    return;
  }

  console.log(
    `📊 Series descubiertas: ${seriesUrls.length}`
  );

  /*
   * Empezamos desde el catálogo anterior.
   *
   * Esto hace que un fallo puntual de una serie
   * no destruya su información anterior.
   */
  const seriesMap =
    new Map(
      oldCatalog.series.map(
        item => [item.id, item]
      )
    );

  const seasonsMap =
    new Map(
      oldCatalog.seasons.map(
        item => [item.id, item]
      )
    );

  const episodesMap =
    new Map(
      oldCatalog.episodes.map(
        item => [item.id, item]
      )
    );

  const genresSet =
    new Set(
      oldCatalog.genres
        .filter(Boolean)
    );

  let successfulSeries = 0;

  for (
    let seriesIndex = 0;
    seriesIndex < seriesUrls.length;
    seriesIndex++
  ) {
    const seriesUrl =
      seriesUrls[seriesIndex];

    try {
      console.log(
        `\n[${seriesIndex + 1}/${seriesUrls.length}] 🔎 ${seriesUrl}`
      );

      const html =
        await fetchHTML(
          seriesUrl
        );

      const series =
        parseSeriesPage(
          html,
          seriesUrl
        );

      if (!series.id) {
        throw new Error(
          'No se pudo determinar el slug de la serie.'
        );
      }

      seriesMap.set(
        series.id,
        series
      );

      for (
        const genre of series.genres
      ) {
        genresSet.add(genre);
      }

      successfulSeries++;

      console.log(
        `   ✅ ${series.title}`
      );

      console.log(
        `   📚 Temporadas encontradas: ${series.seasonUrls.length}`
      );

      /*
       * Procesamos todas las temporadas.
       */
      for (
        let seasonIndex = 0;
        seasonIndex < series.seasonUrls.length;
        seasonIndex++
      ) {
        const seasonUrl =
          series.seasonUrls[seasonIndex];

        try {
          console.log(
            `   📖 Temporada ${seasonIndex + 1}/${series.seasonUrls.length}: ${seasonUrl}`
          );

          /*
           * Obtenemos la primera página para
           * sacar título e imagen.
           */
          const seasonHtml =
            await fetchHTML(
              seasonUrl,
              {
                referer: seriesUrl
              }
            );

          const $season =
            cheerio.load(
              seasonHtml
            );

          const seasonSlug =
            slugFromUrl(
              seasonUrl
            );

          const seasonTitle =
            clean(
              $season('h1').first().text() ||
              $season('h2').first().text() ||
              $season('title').first().text()
            ) ||
            formatTitle(
              seasonSlug
            );

          const season = {
            id: seasonSlug,
            slug: seasonSlug,

            title:
              isGenericHeading(
                seasonTitle
              )
                ? formatTitle(
                    seasonSlug
                  )
                : seasonTitle,

            seriesId:
              series.id,

            sourceUrl:
              sourceUrl(
                seasonUrl
              ),

            image:
              extractCleanImage(
                $season,
                seasonUrl
              ),

            updatedAt:
              new Date().toISOString()
          };

          seasonsMap.set(
            season.id,
            season
          );

          /*
           * AQUÍ está la corrección principal:
           *
           * recorremos TODAS las páginas de episodios.
           */
          const episodeLinks =
            await scrapeSeasonPages(
              seasonUrl,
              message =>
                console.log(
                  message
                )
            );

          console.log(
            `   🎬 Total episodios encontrados: ${episodeLinks.length}`
          );

          /*
           * Ahora visitamos cada episodio para
           * obtener los servidores reales.
           */
          for (
            let episodeIndex = 0;
            episodeIndex < episodeLinks.length;
            episodeIndex++
          ) {
            const episode =
              episodeLinks[
                episodeIndex
              ];

            try {
              const details =
                await parseEpisodeDetails(
                  episode,
                  seasonUrl
                );

              details.seriesId =
                series.id;

              details.seasonId =
                season.id;

              /*
               * El número obtenido de la lista
               * de episodios tiene prioridad.
               */
              details.number =
                episode.number;

              details.releaseDate =
                episode.releaseDate ||
                details.releaseDate ||
                null;

              episodesMap.set(
                details.id,
                details
              );

              console.log(
                `      🎬 Ep. ${details.number ?? '?'}`
                +
                (
                  details.servers.length
                    ? ` → ${details.servers.length} servidor(es)`
                    : ' → sin servidor detectado'
                )
              );
            } catch (error) {
              console.log(
                `      ⚠️ Ep. ${episode.number ?? '?'} omitido: ${error.message}`
              );
            }
          }
        } catch (error) {
          console.log(
            `   ⚠️ Temporada omitida: ${error.message}`
          );
        }
      }
    } catch (error) {
      console.log(
        `⚠️ Serie omitida: ${error.message}`
      );
    }
  }

  /*
   * Si no hemos podido procesar ninguna serie,
   * no reemplazamos el catálogo.
   */
  if (successfulSeries === 0) {
    console.error(
      '❌ Ninguna serie pudo sincronizarse correctamente.'
    );

    console.error(
      '🛡️ Se conserva el catalog.json existente.'
    );

    return;
  }

  const finishedAt =
    new Date().toISOString();

  const catalog = {
    meta: {
      version: 2,

      source:
        BASE_URL + '/',

      syncedAt:
        finishedAt,

      lastSync: {
        status: 'success',

        startedAt,

        finishedAt,

        error: null
      }
    },

    series:
      [...seriesMap.values()]
        .sort((a, b) =>
          String(a.title)
            .localeCompare(
              String(b.title),
              'es'
            )
        ),

    seasons:
      [...seasonsMap.values()],

    episodes:
      [...episodesMap.values()]
        .sort((a, b) => {
          const seriesCompare =
            String(a.seriesId)
              .localeCompare(
                String(b.seriesId)
              );

          if (seriesCompare !== 0) {
            return seriesCompare;
          }

          const seasonCompare =
            String(a.seasonId)
              .localeCompare(
                String(b.seasonId)
              );

          if (seasonCompare !== 0) {
            return seasonCompare;
          }

          const na =
            Number.isFinite(a.number)
              ? a.number
              : Number.MAX_SAFE_INTEGER;

          const nb =
            Number.isFinite(b.number)
              ? b.number
              : Number.MAX_SAFE_INTEGER;

          return na - nb;
        }),

    movies:
      oldCatalog.movies,

    genres:
      [...genresSet]
        .sort((a, b) =>
          a.localeCompare(
            b,
            'es'
          )
        )
  };

  await saveCatalog(
    catalog
  );

  console.log(
    '\n✅ Sincronización terminada.'
  );

  console.log(
    `📚 Series: ${catalog.series.length}`
  );

  console.log(
    `📖 Temporadas: ${catalog.seasons.length}`
  );

  console.log(
    `🎬 Episodios: ${catalog.episodes.length}`
  );

  console.log(
    `🎭 Géneros: ${catalog.genres.length}`
  );

  console.log(
    `💾 Guardado en: ${OUT_FILE}`
  );
}

scrapeDonghuaFlix()
  .catch(error => {
    console.error(
      '\n❌ Error fatal:',
      error
    );

    process.exitCode = 1;
  });
