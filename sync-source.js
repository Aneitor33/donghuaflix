import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = process.env.SOURCE_URL || 'https://pelicinehd.com';
const OUT_FILE = path.resolve(
  process.env.OUT_FILE || 'public/data/catalog-pelicinehd.json'
);

// ---------------------------------------------------------
// CONFIGURACIÓN
// ---------------------------------------------------------

const CONFIG = {
  // Primera página del catálogo
  moviesIndex: '/peliculas/',

  // Archivo real que utiliza WordPress
  moviesArchive: '/movies/',

  // Ruta de las fichas
  moviePrefix: '/movies/',

  // Número máximo de páginas que se explorarán
  maxDiscoveryPages: Number(
    process.env.MAX_DISCOVERY_PAGES || 150
  ),

  // Tiempo entre peticiones
  politenessMs: Number(
    process.env.POLITENESS_MS || 250
  ),

  // Timeout
  timeoutMs: Number(
    process.env.FETCH_TIMEOUT_MS || 30000
  ),

  // Reintentos
  retries: Number(
    process.env.FETCH_RETRIES || 3
  ),

  // Películas procesadas simultáneamente
  workers: Math.max(
    1,
    Math.min(
      6,
      Number(process.env.WORKERS || 4)
    )
  ),

  // Guardar cada X películas
  checkpointEvery: Number(
    process.env.CHECKPOINT_EVERY || 10
  ),

  // Máximo de páginas que queremos volver a comprobar
  // en una sincronización incremental.
  incrementalPages: Number(
    process.env.INCREMENTAL_PAGES || 5
  )
};

// ---------------------------------------------------------
// UTILIDADES
// ---------------------------------------------------------

const clean = value =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim();

const sleep = ms =>
  new Promise(resolve => setTimeout(resolve, ms));

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

function slugFromUrl(url) {
  try {
    const u = new URL(url);

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
        .filter(Boolean)
        .map(String)
    )
  ];
}

// ---------------------------------------------------------
// FETCH
// ---------------------------------------------------------

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();

  const timer = setTimeout(
    () => controller.abort(),
    CONFIG.timeoutMs
  );

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',

      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
          'AppleWebKit/537.36 (KHTML, like Gecko) ' +
          'Chrome/126.0 Safari/537.36',

        'Accept':
          'text/html,application/xhtml+xml,' +
          'application/xml;q=0.9,image/avif,*/*;q=0.8',

        'Accept-Language':
          'es-ES,es;q=0.9,en-US;q=0.7,en;q=0.6'
      }
    });

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

      if (
        retryable &&
        attempt < CONFIG.retries
      ) {
        await sleep(1000 * attempt);

        return fetchHtml(
          url,
          attempt + 1
        );
      }

      throw new Error(
        `HTTP ${response.status}: ${url}`
      );
    }

    return await response.text();

  } catch (error) {

    if (attempt < CONFIG.retries) {
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

// ---------------------------------------------------------
// IDENTIFICAR FICHAS DE PELÍCULAS
// ---------------------------------------------------------

function isMovieUrl(url) {
  try {
    const u = new URL(url);

    if (u.origin !== new URL(BASE_URL).origin) {
      return false;
    }

    const pathname =
      u.pathname.replace(/\/+$/, '');

    return (
      pathname.startsWith('/movies/') &&
      pathname !== '/movies'
    );

  } catch {
    return false;
  }
}

// ---------------------------------------------------------
// DESCUBRIMIENTO DE PELÍCULAS
// ---------------------------------------------------------

function extractMovieLinks(html, pageUrl) {
  const $ = cheerio.load(html);

  const result = [];

  $('a[href]').each((_, element) => {

    const href =
      $(element).attr('href');

    const url =
      absolute(href, pageUrl);

    if (!url) return;

    if (!isMovieUrl(url)) return;

    result.push(url);
  });

  return unique(result);
}

// ---------------------------------------------------------
// PAGINACIÓN
// ---------------------------------------------------------

function extractPagination(
  html,
  pageUrl
) {
  const $ = cheerio.load(html);

  const pages = [];

  $('a[href]').each((_, element) => {

    const href =
      $(element).attr('href');

    const url =
      absolute(href, pageUrl);

    if (!url) return;

    if (!sameOrigin(url)) return;

    try {

      const u = new URL(url);

      const match =
        u.pathname.match(
          /^\/movies\/page\/(\d+)\/?$/
        );

      if (!match) return;

      const page =
        Number(match[1]);

      if (
        Number.isInteger(page) &&
        page >= 1
      ) {
        pages.push({
          page,
          url
        });
      }

    } catch {}
  });

  return pages;
}

// ---------------------------------------------------------
// GENERAR PÁGINA N
// ---------------------------------------------------------

function archivePageUrl(page) {

  if (page <= 1) {
    return `${BASE_URL}/movies/`;
  }

  return `${BASE_URL}/movies/page/${page}/`;
}

// ---------------------------------------------------------
// DESCUBRIMIENTO INCREMENTAL
// ---------------------------------------------------------

async function discoverMovies(
  existing,
  fullSync = false
) {
  const found = new Set();

  const known = new Set(
    existing.map(movie =>
      movie.sourceUrl
    )
  );

  const maxPages = fullSync
    ? CONFIG.maxDiscoveryPages
    : CONFIG.incrementalPages;

  console.log('');
  console.log(
    fullSync
      ? '🔎 DESCUBRIMIENTO COMPLETO'
      : '⚡ DESCUBRIMIENTO INCREMENTAL'
  );

  for (
    let page = 1;
    page <= maxPages;
    page++
  ) {

    const url =
      archivePageUrl(page);

    console.log(
      `📄 Catálogo ${page}: ${url}`
    );

    let html;

    try {
      html =
        await fetchHtml(url);
    } catch (error) {
      console.log(
        `⚠️ No se pudo leer página ${page}:`,
        error.message
      );

      break;
    }

    const links =
      extractMovieLinks(
        html,
        url
      );

    if (!links.length) {

      console.log(
        `🛑 Página ${page} sin películas`
      );

      break;
    }

    let newOnPage = 0;

    for (const movieUrl of links) {

      if (!known.has(movieUrl)) {
        found.add(movieUrl);
        newOnPage++;
      }
    }

    console.log(
      `   🎬 ${links.length} películas`
    );

    console.log(
      `   🆕 ${newOnPage} nuevas`
    );

    /*
     * En modo incremental:
     *
     * Si una página completa ya está formada
     * exclusivamente por películas conocidas,
     * podemos dejar de recorrer páginas antiguas.
     */

    if (
      !fullSync &&
      newOnPage === 0
    ) {

      console.log(
        '   🛑 No hay películas nuevas.'
      );

      break;
    }

    await sleep(
      CONFIG.politenessMs
    );
  }

  console.log('');
  console.log(
    `🎯 Nuevas fichas encontradas: ${found.size}`
  );

  return [...found];
}

// ---------------------------------------------------------
// EXTRAER TEXTO META
// ---------------------------------------------------------

function meta(
  $,
  selector
) {
  return clean(
    $(selector).attr('content')
  );
}

// ---------------------------------------------------------
// EXTRAER LISTA
// ---------------------------------------------------------

function extractList(
  $,
  selectors
) {
  const result = [];

  for (const selector of selectors) {

    $(selector).each((_, element) => {

      const value =
        clean($(element).text());

      if (
        value &&
        value.length < 100
      ) {
        result.push(value);
      }
    });

    if (result.length) {
      break;
    }
  }

  return unique(result);
}

// ---------------------------------------------------------
// EXTRAER PORTADA
// ---------------------------------------------------------

function extractPoster(
  $,
  url
) {

  const og =
    absolute(
      meta(
        $,
        'meta[property="og:image"]'
      ),
      url
    );

  if (og) {
    return og;
  }

  const twitter =
    absolute(
      meta(
        $,
        'meta[name="twitter:image"]'
      ),
      url
    );

  if (twitter) {
    return twitter;
  }

  let image = null;

  $('img').each((_, element) => {

    if (image) return;

    const src =
      $(element).attr('data-src') ||
      $(element).attr('data-lazy-src') ||
      $(element).attr('src');

    const full =
      absolute(src, url);

    if (!full) return;

    if (
      /logo|icon|avatar|banner/i.test(full)
    ) {
      return;
    }

    image = full;
  });

  return image;
}

// ---------------------------------------------------------
// EXTRAER AÑO
// ---------------------------------------------------------

function extractYear(
  body,
  title
) {

  const patterns = [

    /(?:estreno|año)[^0-9]{0,20}((?:19|20)\d{2})/i,

    /\b((?:19|20)\d{2})\b/
  ];

  for (const regex of patterns) {

    const match =
      body.match(regex);

    if (match) {
      return Number(match[1]);
    }
  }

  const titleMatch =
    title.match(
      /\b((?:19|20)\d{2})\b/
    );

  return titleMatch
    ? Number(titleMatch[1])
    : null;
}

// ---------------------------------------------------------
// DURACIÓN
// ---------------------------------------------------------

function extractRuntime(body) {

  const match =
    body.match(
      /\b(\d{1,2})h(?:\s*(\d{1,2})m)?\b/i
    );

  if (!match) {
    return null;
  }

  const hours =
    Number(match[1]);

  const minutes =
    match[2]
      ? Number(match[2])
      : 0;

  return {
    hours,
    minutes,
    text: `${hours}h${
      minutes
        ? ` ${minutes}m`
        : ''
    }`
  };
}

// ---------------------------------------------------------
// TMDB
// ---------------------------------------------------------

function extractTmdb(body) {

  const match =
    body.match(
      /TMDB\s*([0-9]+(?:\.[0-9]+)?)/i
    );

  if (!match) {
    return null;
  }

  return Number(match[1]);
}

// ---------------------------------------------------------
// SINOPSIS
// ---------------------------------------------------------

function extractSynopsis(
  $,
  body
) {

  const ogDescription =
    meta(
      $,
      'meta[property="og:description"]'
    );

  if (
    ogDescription &&
    ogDescription.length > 30
  ) {
    return ogDescription;
  }

  const description =
    meta(
      $,
      'meta[name="description"]'
    );

  if (
    description &&
    description.length > 30
  ) {
    return description;
  }

  let result = '';

  $('p').each((_, element) => {

    if (result) return;

    const text =
      clean($(element).text());

    if (
      text.length > 80 &&
      !/navegador|adblock|ghostery/i.test(text)
    ) {
      result = text;
    }
  });

  return result || null;
}

// ---------------------------------------------------------
// OPCIONES DEL REPRODUCTOR
// ---------------------------------------------------------

function extractServers(
  $,
  pageUrl,
  html
) {

  const servers = [];

  const seen =
    new Set();

  function addServer({
    name,
    url,
    language = null,
    embed = false
  }) {

    const full =
      absolute(url, pageUrl);

    if (!full) return;

    if (seen.has(full)) {
      return;
    }

    seen.add(full);

    let host = '';

    try {
      host =
        new URL(full)
          .hostname
          .replace(/^www\./, '');
    } catch {}

    servers.push({
      name:
        clean(name) ||
        host ||
        'Servidor',

      host,

      url: full,

      language,

      embed
    });
  }

  /*
   * -------------------------------------------------------
   * 1. IFRAME
   * -------------------------------------------------------
   */

  $('iframe[src]').each((_, element) => {

    const src =
      $(element).attr('src');

    if (!src) return;

    let host = '';

    try {
      host =
        new URL(
          absolute(src, pageUrl)
        )
        .hostname
        .replace(/^www\./, '');

    } catch {}

    addServer({
      name: host || 'Servidor',
      url: src,
      embed: true
    });
  });

  /*
   * -------------------------------------------------------
   * 2. ATRIBUTOS DATA-*
   *
   * Importante porque PeliCineHD utiliza botones
   * de OPCIÓN para seleccionar servidores.
   * -------------------------------------------------------
   */

  const dataSelectors = [
    '[data-url]',
    '[data-embed]',
    '[data-src]',
    '[data-link]',
    '[data-player]',
    '[data-href]',
    '[data-server]'
  ].join(',');

  $(dataSelectors).each((_, element) => {

    const node =
      $(element);

    const raw =
      node.attr('data-url') ||
      node.attr('data-embed') ||
      node.attr('data-src') ||
      node.attr('data-link') ||
      node.attr('data-player') ||
      node.attr('data-href') ||
      node.attr('data-server');

    if (!raw) return;

    const text =
      clean(node.text());

    let language = null;

    if (
      /latino/i.test(text)
    ) {
      language = 'latino';

    } else if (
      /castellano/i.test(text)
    ) {
      language = 'castellano';

    } else if (
      /subtitulado/i.test(text)
    ) {
      language = 'subtitulado';

    } else if (
      /ingles|inglés/i.test(text)
    ) {
      language = 'ingles';
    }

    addServer({
      name: text || null,
      url: raw,
      language,
      embed: true
    });
  });

  /*
   * -------------------------------------------------------
   * 3. ENLACES DE OPCIONES
   * -------------------------------------------------------
   */

  $('a[href]').each((_, element) => {

    const node =
      $(element);

    const href =
      node.attr('href');

    if (!href) return;

    const text =
      clean(node.text());

    const looksLikePlayer =
      /lat|cast|sub|ingles|opci[oó]n|player|ver|servidor/i
        .test(text);

    if (!looksLikePlayer) {
      return;
    }

    addServer({
      name: text,
      url: href,
      embed: false
    });
  });

  /*
   * -------------------------------------------------------
   * 4. URLS EXTERNAS EN EL HTML
   *
   * Solo recogemos URLs que aparecen públicamente
   * en el HTML. No intentamos saltar protecciones.
   * -------------------------------------------------------
   */

  const urlRegex =
    /https?:\/\/[^\s"'<>\\]+/gi;

  const candidates =
    html.match(urlRegex) || [];

  for (const candidate of candidates) {

    let url = candidate
      .replace(/&amp;/g, '&')
      .replace(/[),;]+$/, '');

    let host = '';

    try {
      host =
        new URL(url)
          .hostname
          .replace(/^www\./, '');

    } catch {
      continue;
    }

    if (
      /voe|filemoon|streamwish|smoothpre|dailymotion|ok\.ru|mixdrop|vidmoly|uqload/i
        .test(host)
    ) {

      addServer({
        name: host,
        url,
        embed: true
      });
    }
  }

  return servers;
}

// ---------------------------------------------------------
// PARSEAR FICHA
// ---------------------------------------------------------

function parseMovie(
  html,
  url
) {

  const $ =
    cheerio.load(html);

  const slug =
    slugFromUrl(url);

  const body =
    clean(
      $('body').text()
    );

  const title =
    clean(
      $('h1').first().text()
    ) ||
    meta(
      $,
      'meta[property="og:title"]'
    ) ||
    slug;

  /*
   * Géneros
   */

  const genres = [];

  /*
   * Primero buscamos enlaces que parecen géneros.
   */

  $('a').each((_, element) => {

    const text =
      clean($(element).text());

    if (!text) return;

    const href =
      $(element).attr('href') || '';

    if (
      /genero|genre|categoria/i.test(href) &&
      text.length < 40
    ) {
      genres.push(text);
    }
  });

  /*
   * Fallback:
   *
   * "Acción, Aventura, Comedia 2h 6m..."
   */

  if (!genres.length) {

    const firstLine =
      clean(
        $('h1')
          .first()
          .parent()
          .text()
      );

    const match =
      firstLine.match(
        /^(.+?)\s+\d+h(?:\s*\d+m)?/i
      );

    if (match) {

      match[1]
        .split(',')
        .map(clean)
        .filter(Boolean)
        .forEach(g =>
          genres.push(g)
        );
    }
  }

  /*
   * Director
   */

  let director = null;

  const directorMatch =
    body.match(
      /Director\s+(.+?)(?=\s+Actores|\s+TMDB|$)/i
    );

  if (directorMatch) {
    director =
      clean(directorMatch[1]);
  }

  /*
   * Actores
   */

  let actors = [];

  const actorMatch =
    body.match(
      /Actores\s+(.+?)(?=\s+TMDB|$)/i
    );

  if (actorMatch) {

    actors =
      actorMatch[1]
        .split(',')
        .map(clean)
        .filter(Boolean);
  }

  /*
   * Runtime
   */

  const runtime =
    extractRuntime(body);

  /*
   * Año
   */

  const year =
    extractYear(
      body,
      title
    );

  /*
   * TMDB
   */

  const tmdb =
    extractTmdb(body);

  /*
   * Sinopsis
   */

  const synopsis =
    extractSynopsis(
      $,
      body
    );

  /*
   * Portada
   */

  const image =
    extractPoster(
      $,
      url
    );

  /*
   * Servidores
   */

  const servers =
    extractServers(
      $,
      url,
      html
    );

  return {

    id: slug,

    slug,

    title,

    image,

    synopsis,

    year,

    runtime,

    tmdb,

    genres:
      unique(genres),

    director,

    actors,

    servers,

    sourceUrl: url
  };
}

// ---------------------------------------------------------
// BASE DE DATOS
// ---------------------------------------------------------

async function loadCatalog() {

  try {

    const raw =
      await fs.readFile(
        OUT_FILE,
        'utf8'
      );

    const db =
      JSON.parse(raw);

    return {

      meta:
        db.meta || {},

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

      movies: [],

      genres: []
    };
  }
}

// ---------------------------------------------------------
// GUARDAR CATÁLOGO
// ---------------------------------------------------------

async function saveCatalog(db) {

  await fs.mkdir(
    path.dirname(OUT_FILE),
    {
      recursive: true
    }
  );

  const temporary =
    `${OUT_FILE}.tmp`;

  await fs.writeFile(
    temporary,
    JSON.stringify(
      db,
      null,
      2
    ),
    'utf8'
  );

  await fs.rename(
    temporary,
    OUT_FILE
  );
}

// ---------------------------------------------------------
// UPSERT
// ---------------------------------------------------------

function upsert(
  array,
  item,
  key = 'id'
) {

  const index =
    array.findIndex(
      existing =>
        existing[key] === item[key]
    );

  if (index === -1) {

    array.push(item);

  } else {

    /*
     * Conservamos cualquier dato antiguo
     * que la página no vuelva a mostrar.
     */

    array[index] = {
      ...array[index],
      ...item
    };
  }
}

// ---------------------------------------------------------
// WORKER
// ---------------------------------------------------------

async function processMovie(
  url,
  db,
  genreSet
) {

  const slug =
    slugFromUrl(url);

  console.log(
    `🎬 ${slug}`
  );

  try {

    const html =
      await fetchHtml(url);

    const movie =
      parseMovie(
        html,
        url
      );

    /*
     * No sustituimos una ficha válida
     * por una ficha rota.
     */

    if (
      !movie.title ||
      !movie.slug
    ) {

      throw new Error(
        'Ficha inválida'
      );
    }

    /*
     * Si esta ejecución no encontró servidores,
     * conservamos los servidores anteriores.
     */

    const old =
      db.movies.find(
        movie =>
          movie.id === slug
      );

    if (
      old &&
      old.servers?.length &&
      !movie.servers.length
    ) {

      movie.servers =
        old.servers;
    }

    movie.updatedAt =
      new Date().toISOString();

    upsert(
      db.movies,
      movie
    );

    movie.genres.forEach(
      genre =>
        genreSet.add(genre)
    );

    console.log(
      `   ✓ ${movie.title}`
    );

    console.log(
      `   🖼️ Imagen: ${
        movie.image
          ? 'sí'
          : 'no'
      }`
    );

    console.log(
      `   🎥 Servidores: ${
        movie.servers.length
      }`
    );

    return true;

  } catch (error) {

    console.log(
      `   ❌ ${error.message}`
    );

    return false;
  }
}

// ---------------------------------------------------------
// MAIN
// ---------------------------------------------------------

async function main() {

  console.log('');
  console.log(
    '╔══════════════════════════════════════╗'
  );
  console.log(
    '║      PELICINEHD CATALOG SYNC         ║'
  );
  console.log(
    '╚══════════════════════════════════════╝'
  );
  console.log('');

  console.log(
    `🌐 Fuente: ${BASE_URL}`
  );

  const db =
    await loadCatalog();

  /*
   * -------------------------------------------------------
   * DECIDIR SI ES PRIMERA SINCRONIZACIÓN
   * -------------------------------------------------------
   */

  const firstSync =
    db.movies.length === 0;

  console.log(
    firstSync
      ? '🆕 Primera sincronización'
      : `♻️ Catálogo existente: ${
          db.movies.length
        } películas`
  );

  /*
   * -------------------------------------------------------
   * DESCUBRIR
   * -------------------------------------------------------
   */

  const discovered =
    await discoverMovies(
      db.movies,
      firstSync
    );

  /*
   * -------------------------------------------------------
   * SI NO HAY NADA NUEVO
   * -------------------------------------------------------
   */

  if (!discovered.length) {

    db.meta = {
      ...db.meta,

      source:
        BASE_URL,

      syncedAt:
        new Date().toISOString(),

      lastSync: {
        status: 'success',
        type: firstSync
          ? 'full'
          : 'incremental',

        discovered: 0,

        processed: 0
      }
    };

    await saveCatalog(db);

    console.log('');
    console.log(
      '✅ No hay películas nuevas.'
    );

    return;
  }

  /*
   * -------------------------------------------------------
   * PROCESAMIENTO PARALELO
   * -------------------------------------------------------
   */

  const genreSet =
    new Set(
      db.genres
    );

  let cursor = 0;

  let processed = 0;

  let successful = 0;

  async function worker() {

    while (true) {

      const index =
        cursor++;

      if (
        index >=
        discovered.length
      ) {
        return;
      }

      const url =
        discovered[index];

      const ok =
        await processMovie(
          url,
          db,
          genreSet
        );

      processed++;

      if (ok) {
        successful++;
      }

      /*
       * Checkpoint
       */

      if (
        processed %
        CONFIG.checkpointEvery ===
        0
      ) {

        db.genres =
          [...genreSet]
            .sort(
              (a, b) =>
                a.localeCompare(
                  b,
                  'es'
                )
            );

        db.meta = {
          ...db.meta,

          source:
            BASE_URL,

          syncedAt:
            new Date().toISOString(),

          progress: {
            processed,
            total:
              discovered.length
          }
        };

        await saveCatalog(db);

        console.log(
          `💾 Checkpoint ${
            processed
          }/${discovered.length}`
        );
      }

      await sleep(
        CONFIG.politenessMs
      );
    }
  }

  /*
   * Lanzar workers
   */

  const workerCount =
    Math.min(
      CONFIG.workers,
      discovered.length
    );

  await Promise.all(
    Array.from(
      {
        length: workerCount
      },
      () => worker()
    )
  );

  /*
   * -------------------------------------------------------
   * GUARDADO FINAL
   * -------------------------------------------------------
   */

  db.genres =
    [...genreSet]
      .sort(
        (a, b) =>
          a.localeCompare(
            b,
            'es'
          )
      );

  db.meta = {

    version: 1,

    source:
      BASE_URL,

    syncedAt:
      new Date().toISOString(),

    totalMovies:
      db.movies.length,

    lastSync: {

      status:
        'success',

      type:
        firstSync
          ? 'full'
          : 'incremental',

      discovered:
        discovered.length,

      processed,

      successful,

      failed:
        processed -
        successful
    }
  };

  await saveCatalog(db);

  console.log('');
  console.log(
    '══════════════════════════════════════'
  );

  console.log(
    `🎬 Películas: ${
      db.movies.length
    }`
  );

  console.log(
    `🆕 Descubiertas: ${
      discovered.length
    }`
  );

  console.log(
    `✅ Procesadas: ${
      successful
    }`
  );

  console.log(
    `❌ Fallidas: ${
      processed -
      successful
    }`
  );

  console.log(
    `🎭 Géneros: ${
      db.genres.length
    }`
  );

  console.log(
    '══════════════════════════════════════'
  );
}

main()
  .catch(async error => {

    console.error(
      '💥 ERROR FATAL:',
      error
    );

    try {

      const db =
        await loadCatalog();

      db.meta = {
        ...db.meta,

        lastSync: {

          status:
            'error',

          finishedAt:
            new Date().toISOString(),

          error:
            error.message
        }
      };

      await saveCatalog(db);

    } catch {}

    process.exitCode = 1;
  });
