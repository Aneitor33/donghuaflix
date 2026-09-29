import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

/* =========================================================
   DONGHUAFLIX SYNC — DonghuaLife
   Estructura actual del sitio (rediseño 2026):

     /series?page=N                 -> listado (25 series/página)
     /series/{slug}                 -> ficha de serie: contiene TODOS los
                                       enlaces /watch/{slug}-{temp}-{ep}
     /watch/{slug}-{temp}-{ep}      -> página del episodio (player, datos)

   NOTAS:
   - Las rutas antiguas /donghuas /en-emision /finalizado /en-pausa
     devuelven HTTP 404. Solo quedan /series y / como seeds.
   - Ya NO existen páginas /season/ ni /episode/: cada episodio es una
     página /watch/. La serie entera se descubre en su ficha (/series/{slug}).
   - Slug de temporada = "{base}-{temporada}" (coincide con la portada
     /images/webp/{base}-{temporada}__coverImage.webp).
========================================================= */

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.resolve(process.env.OUT_FILE || 'public/data/catalog-donghualife.json');

const SEEDS = ['/series', '/'];

/*
   ♻️ REBUILD DESDE CERO (opcional):
     node syncdonghualife.js --fresh
     node syncdonghualife.js --rebuild
     FRESH=1 node syncdonghualife.js

   Hace un backup automático del catálogo anterior (.bak-<fecha>)
   y reconstruye TODO desde cero, descartando las temporadas y
   episodios basura acumulados (p. ej. "Temporada 151" vacías
   creadas por el scraper anterior).
*/
const REBUILD =
  process.argv.includes('--fresh') ||
  process.argv.includes('--rebuild') ||
  ['1', 'true', 'yes'].includes(
    String(process.env.FRESH || process.env.REBUILD || '').toLowerCase()
  );

const MAX_DISCOVERY_PAGES = 200;
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;
const WORKERS = Math.max(1, Math.min(20, Number(process.env.WORKERS || 8)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);
const MAX_INFERRED_EPISODE_ATTEMPTS = 40;
const MAX_EPISODES_PER_SEASON_SAFETY = 20000;

let saveQueue = Promise.resolve();
let isSyncRunning = false;

/* =========================================================
   UTILIDADES
========================================================= */

const clean = value =>
  String(value || '').replace(/\s+/g, ' ').trim();

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

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

/* =========================================================
   URLS
========================================================= */

function absolute(raw, base = BASE_URL) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || /^(javascript:|mailto:|tel:|#)/i.test(value)) return null;
  try { return new URL(value, base).href; } catch { return null; }
}

function canonical(raw) {
  const url = absolute(raw);
  if (!url) return null;
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.href;
  } catch { return null; }
}

function slugFromUrl(raw) {
  try {
    const u = new URL(raw, BASE_URL);
    const parts = u.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts.at(-1) || '').replace(/\/$/, '');
  } catch { return ''; }
}

function sameOrigin(url) {
  try { return new URL(url).origin === new URL(BASE_URL).origin; }
  catch { return false; }
}

function uniqueUrls(values) {
  return [...new Set(values.map(canonical).filter(Boolean))];
}

/* =========================================================
   NUEVO ESQUEMA /watch/{base}-{temporada}-{episodio}
========================================================= */

function parseWatchUrl(raw) {
  const url = canonical(raw);
  if (!url || !sameOrigin(url)) return null;

  try {
    const u = new URL(url);

    if (!/^\/watch\//i.test(u.pathname)) return null;
    if (u.searchParams.has('page')) return null;

    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 2) return null;

    const slug = decodeURIComponent(parts[1]);

    /*
       El regex es greedy a propósito:

         wan-jie-du-zun-1-2      -> base "wan-jie-du-zun",      t=1, ep=2
         soul-land-2-1-5         -> base "soul-land-2",         t=1, ep=5
         supreme-god-emperor-2-114 -> base "supreme-god-emperor-2", t=1, ep=114
    */
    const match = slug.match(/^(.*)-(\d+)-(\d+)$/);
    if (!match) return null;

    return {
      url,
      base: match[1],
      season: Number(match[2]),
      episode: Number(match[3])
    };
  } catch {
    return null;
  }
}

function seasonKeyOf(watch) {
  return `${watch.base}-${watch.season}`;
}

function parseSeasonKey(key) {
  const match = String(key || '').match(/^(.*)-(\d+)$/);
  if (!match) return null;
  return { base: match[1], season: Number(match[2]) };
}

function buildWatchUrl(base, season, episode) {
  try {
    return canonical(`${BASE_URL}/watch/${base}-${season}-${episode}`);
  } catch {
    return null;
  }
}

/* =========================================================
   FETCH
========================================================= */

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
          '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,' +
          'image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Referer': `${BASE_URL}/`
      }
    });

    if (!response.ok) {
      if (attempt < FETCH_RETRIES &&
          [408, 425, 429, 500, 502, 503, 504].includes(response.status)) {
        await sleep(1000 * attempt);
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${response.status} en ${url}`);
    }

    return await response.text();
  } catch (error) {
    if (attempt < FETCH_RETRIES) {
      await sleep(1000 * attempt);
      return fetchHtml(url, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   DESCUBRIMIENTO DE SERIES (sin cambios, sigue funcionando)
========================================================= */

function parseSeriesLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $('a[href]').each((_, element) => {
    const url = canonical(absolute($(element).attr('href'), pageUrl));
    if (!url || !sameOrigin(url)) return;
    try {
      if (/\/series\//i.test(new URL(url).pathname)) links.push(url);
    } catch {}
  });

  return uniqueUrls(links);
}

function extractPaginationLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $('a[href]').each((_, element) => {
    const url = canonical(absolute($(element).attr('href'), pageUrl));
    if (!url || !sameOrigin(url)) return;

    try {
      const u = new URL(url);
      if (u.pathname !== new URL(pageUrl).pathname) return;
      if (!u.searchParams.has('page')) return;
      const page = Number(u.searchParams.get('page'));
      if (Number.isInteger(page) && page >= 1) links.push(url);
    } catch {}
  });

  return uniqueUrls(links);
}

async function discoverPaginatedSeed(seed) {
  const firstUrl = canonical(absolute(seed));
  const queue = [firstUrl];
  const visited = new Set();
  const found = new Set();

  while (queue.length && visited.size < MAX_DISCOVERY_PAGES) {
    const pageUrl = queue.shift();
    if (!pageUrl || visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    console.log(`📄 Página ${visited.size}: ${pageUrl}`);

    try {
      const html = await fetchHtml(pageUrl);
      const series = parseSeriesLinks(html, pageUrl);
      series.forEach(url => found.add(url));
      console.log(`   ${series.length} enlaces de series`);

      const nextPages = extractPaginationLinks(html, pageUrl)
        .filter(url => !visited.has(url) && !queue.includes(url));
      nextPages.forEach(url => queue.push(url));
    } catch (error) {
      console.log(`   ⚠️ ${error.message}`);
    }
  }

  return [...found];
}

async function discoverSeries() {
  const all = new Set();

  for (const seed of SEEDS) {
    console.log(`\n🔎 Descubriendo desde ${seed}`);
    const urls = await discoverPaginatedSeed(seed);
    urls.forEach(url => all.add(url));
    console.log(`✅ Acumuladas: ${all.size} series`);
  }

  console.log(`\n🎯 TOTAL SERIES DESCUBIERTAS: ${all.size}`);
  return [...all];
}

/* =========================================================
   PORTADA
========================================================= */

function extractPosterImage($, pageUrl) {
  const candidates = [];

  candidates.push(
    $('meta[property="og:image"]').attr('content'),
    $('meta[name="twitter:image"]').attr('content')
  );

  $('img').each((_, el) => {
    const node = $(el);
    const klass = String(node.attr('class') || '').toLowerCase();
    const alt = String(node.attr('alt') || '').toLowerCase();

    const weight =
      (/poster|portada|cover|thumb|image|img/.test(klass) ||
       /poster|portada|cover/.test(alt)) ? 0 : 1;

    candidates.push({
      weight,
      raw:
        node.attr('data-src') ||
        node.attr('data-original') ||
        node.attr('data-lazy-src') ||
        node.attr('src')
    });
  });

  const flattened = candidates.map(item =>
    typeof item === 'string' || item == null
      ? { weight: 0, raw: item }
      : item
  );

  flattened.sort((a, b) => a.weight - b.weight);

  for (const { raw } of flattened) {
    const url = absolute(raw, pageUrl);
    if (!url || !sameOrigin(url)) continue;

    const lower = url.toLowerCase();

    if (/icoprueba/.test(lower)) continue;
    if (/\/logo|icon|favicon|banner|avatar|sprite|flag|search/.test(lower)) continue;
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(lower)) continue;

    return url;
  }

  return null;
}

/* =========================================================
   GÉNEROS
   En la nueva web salen como texto/enlaces junto al título:
   "Cultivo Romance Acción Aventura". Combinamos selectores
   + coincidencia exacta de anclas con lista conocida.
========================================================= */

const KNOWN_GENRES = [
  'Acción', 'Aventura', 'Romance', 'Cultivo', 'Artes marciales',
  'Comedia', 'Drama', 'Reencarnación', 'Isekai', 'Fantasía',
  'Misterio', 'Horror', 'Historia', 'Ciencia ficción', 'Venganza',
  'Superpoderes', 'Escolar', 'Sobrenatural', 'Harem', 'Shounen',
  'Magia', 'Demonios', 'Wuxia', 'Xianxia', 'Xuanhuan', 'Tragedia',
  'Psicológico', 'Deportes', 'Mecha', 'Militar', 'Música',
  'Recuentos de la vida', 'Slice of Life', 'Sistema',
  'Estrategia', 'Familia', 'Thriller', 'Gore', 'Vida cotidiana'
];

function extractGenres($) {
  const genres = new Set();

  const selectors = [
    '[class*="genre"] a',
    '[class*="genero"] a',
    '[class*="category"] a',
    '[class*="categoria"] a',
    '[class*="tag"] a',
    'a[href*="genre="]',
    'a[href*="/genre/"]',
    'a[href*="/genero"]'
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = clean($(el).text());
      if (text && text.length < 80) genres.add(text);
    });
  }

  /*
     Respaldo: anclas cuyo texto coincide exactamente con un
     género conocido (la web nueva los muestra como pills/links).
  */
  const known = KNOWN_GENRES.map(g => g.toLowerCase());

  $('a').each((_, el) => {
    const text = clean($(el).text()).toLowerCase();
    if (!text || text.length > 40) return;
    if (known.includes(text)) {
      const original = KNOWN_GENRES[known.indexOf(text)];
      genres.add(original);
    }
  });

  return [...genres];
}

/* =========================================================
   SERIE  (/series/{slug})
   Extrae TODOS los enlaces /watch/{base}-{t}-{ep} de la ficha.
   Con eso se construye el árbol temporadas -> episodios.
========================================================= */

function collectWatchLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const map = new Map();

  $('a[href]').each((_, element) => {
    const watch = parseWatchUrl(
      absolute($(element).attr('href'), pageUrl)
    );
    if (!watch) return;
    if (!map.has(watch.url)) map.set(watch.url, watch);
  });

  return [...map.values()];
}

function groupBySeason(watchList) {
  const groups = new Map();

  for (const watch of watchList) {
    const key = seasonKeyOf(watch);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(watch);
  }

  for (const list of groups.values()) {
    list.sort((a, b) => a.episode - b.episode);
  }

  return groups;
}

function parseSeries(html, url, watchList) {
  const $ = cheerio.load(html);

  const rawTitle =
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text();

  const title = clean(rawTitle).replace(/\s*\|\s*DonghuaLife.*$/i, '');

  const image = extractPosterImage($, url);

  const synopsis = clean(
    $('[class*="synopsis"]').first().text() ||
    $('[class*="sinopsis"]').first().text() ||
    $('[class*="description"]').first().text() ||
    $('[class*="descripcion"]').first().text() ||
    $('meta[name="description"]').attr('content') ||
    ''
  ) || null;

  const releaseDate = clean(
    $('[class*="release"]').first().text() || ''
  ) || null;

  const status = clean(
    $('[class*="status"]').first().text() ||
    $('a').filter((_, e) => /en emisión|finalizado|en pausa/i.test($(e).text())).first().text() ||
    ''
  ) || null;

  return {
    id: slugFromUrl(url),
    slug: slugFromUrl(url),
    title: title || slugFromUrl(url),
    image: image || null,
    synopsis,
    originalTitle: null,
    duration: null,
    releaseDate,
    status,
    genres: extractGenres($),
    sourceUrl: canonical(url)
  };
}

/* =========================================================
   EPISODIO  (/watch/{base}-{t}-{ep})
========================================================= */

function hostNameOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); }
  catch { return 'Servidor'; }
}

function addServer(servers, name, raw, base, embed = false) {
  const url = absolute(raw, base);
  if (!url) return;

  const key = `${name}|${url}`.toLowerCase();
  if (servers.some(s => `${s.name}|${s.url}`.toLowerCase() === key)) return;

  servers.push({
    name: clean(name) || hostNameOf(url),
    url,
    embed: Boolean(embed)
  });
}

function parseEpisode(html, episodeUrl) {
  const $ = cheerio.load(html);

  const rawTitle =
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text();

  const title = clean(rawTitle).replace(/\s*\|\s*DonghuaLife.*$/i, '');

  const servers = [];

  /*
     1) Enlaces a servidores conocidos (mantenemos el listado
        del scraper anterior + genéricos de video).
  */
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const lower = href.toLowerCase();

    if (/dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|mega|youtube|yourupload|mixdrop|filemoon|mp4upload|vidoza|sibnet|uqload|netu|wolfstream|vudeo|mixdro|emturbovid|hydrax|kvid|streamvid|playtube|voe\.sx|streamhub|gamma|delta/i.test(lower)) {
      addServer(servers, clean($(el).text()) || hostNameOf(href), href, episodeUrl, false);
    }
  });

  /*
     2) iframes / video / source: en la web nueva el player va
        aquí. Aceptamos mismo origen (p. ej. /player/...).
  */
  $('iframe[src], video[src], source[src], embed[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const full = absolute(src, episodeUrl);
    if (!full) return;
    const lower = full.toLowerCase();

    // descartar trackers / widgets sociales
    if (/google-analytics|googletagmanager|facebook|disqus|addthis|doubleclick|cdn-cgi|recaptcha|hcaptcha|clarity\.|hotjar|/i.test(lower) && /analytics|tagmanager|disqus|doubleclick|recaptcha|hcaptcha/i.test(lower)) return;

    addServer(servers, hostNameOf(full), full, episodeUrl, true);
  });

  /*
     3) data-attributes.
  */
  $('[data-src], [data-embed], [data-url], [data-video], [data-file]').each((_, el) => {
    const raw =
      $(el).attr('data-src') ||
      $(el).attr('data-embed') ||
      $(el).attr('data-url') ||
      $(el).attr('data-video') ||
      $(el).attr('data-file');
    if (!raw) return;
    const full = absolute(raw, episodeUrl);
    if (!full) return;
    if (/dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|youtube|mixdrop|filemoon|mp4upload|vidoza|sibnet|\.m3u8|\.mp4/i.test(full)) {
      addServer(servers, hostNameOf(full), full, episodeUrl, true);
    }
  });

  /*
     4) Anterior / Siguiente: ahora son enlaces /watch/.
  */
  function navLink(patterns) {
    let found = null;
    $('a[href]').each((_, el) => {
      if (found) return;
      const text = clean($(el).text()).toLowerCase();
      if (!patterns.some(p => text.includes(p))) return;
      const watch = parseWatchUrl(absolute($(el).attr('href'), episodeUrl));
      if (watch) found = watch.url;
    });
    return found;
  }

  let previousUrl = navLink(['anterior', 'previous']);
  let nextUrl = navLink(['siguiente', 'next']);

  const relPrev = parseWatchUrl($('link[rel="prev"]').attr('href'));
  const relNext = parseWatchUrl($('link[rel="next"]').attr('href'));

  if (!previousUrl && relPrev) previousUrl = relPrev.url;
  if (!nextUrl && relNext) nextUrl = relNext.url;

  const releaseDate = clean(
    $('[class*="release"]').first().text() ||
    $('[class*="fecha"]').first().text() || ''
  ) || null;

  return {
    title: title || slugFromUrl(episodeUrl),
    servers,
    previousUrl,
    nextUrl,
    releaseDate,
    image: extractPosterImage($, episodeUrl)
  };
}

/* =========================================================
   RASTREO DE EPISODIOS
========================================================= */

async function crawlEpisodes(season, watchList, previousEpisodes) {
  const results = [];
  const oldMap = new Map(previousEpisodes.map(e => [e.id, e]));
  const seasonKey = season.id;
  let failures = 0;

  const sorted = [...watchList].sort((a, b) => a.episode - b.episode);

  let lastSave = 0;

  for (let i = 0; i < sorted.length; i++) {
    const watch = sorted[i];
    const currentUrl = watch.url;

    if (seasonKeyOf(watch) !== seasonKey) {
      console.log(`      ⚠️ Episodio rechazado por pertenencia: ${currentUrl}`);
      failures++;
      continue;
    }

    console.log(`      ▶ Episodio ${watch.episode} (${i + 1}/${sorted.length})`);

    try {
      const html = await fetchHtml(currentUrl);
      const detail = parseEpisode(html, currentUrl);

      const episodeId = slugFromUrl(currentUrl);
      const old = oldMap.get(episodeId) || {};

      results.push({
        ...old,
        id: episodeId,
        slug: episodeId,
        title: detail.title || old.title || episodeId,
        sourceUrl: currentUrl,
        servers: detail.servers.length ? detail.servers : (old.servers || []),
        previousUrl: detail.previousUrl || old.previousUrl || null,
        nextUrl: detail.nextUrl || old.nextUrl || null,
        updatedAt: new Date().toISOString(),
        seriesId: season.seriesId,
        seasonId: season.id,
        number: watch.episode,
        releaseDate: detail.releaseDate || old.releaseDate || null
      });

    } catch (error) {
      failures++;
      console.log(`      ❌ Error episodio ${watch.episode}: ${error.message}`);
      const old = oldMap.get(slugFromUrl(currentUrl));
      if (old) results.push(old);
    }
  }

  return {
    episodes: results,
    failures,
    processed: sorted.length,
    successful: results.length
  };
}

/* =========================================================
   COMPLETITUD
========================================================= */

function analyzeCompleteness(episodes, discoveryComplete) {
  const numbers = episodes
    .map(e => Number(e.number))
    .filter(Number.isFinite);

  if (!numbers.length) {
    return {
      complete: false,
      minEpisode: null,
      maxEpisode: null,
      totalEpisodes: 0,
      missingEpisodes: []
    };
  }

  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const minEpisode = unique[0];
  const maxEpisode = unique.at(-1);
  const set = new Set(unique);
  const missingEpisodes = [];

  if (minEpisode === 1) {
    for (let n = 1; n <= maxEpisode; n++) {
      if (!set.has(n)) missingEpisodes.push(n);
    }
  } else {
    for (let n = 1; n < minEpisode; n++) missingEpisodes.push(n);
  }

  const complete =
    discoveryComplete &&
    minEpisode === 1 &&
    missingEpisodes.length === 0 &&
    unique.length === maxEpisode;

  return { complete, minEpisode, maxEpisode, totalEpisodes: unique.length, missingEpisodes };
}

/* =========================================================
   PROCESAR TEMPORADA (histórico)
========================================================= */

async function processSeason(db, seriesItem, seasonKey, watchList, oldSeason, oldEpisodes) {
  const parsed = parseSeasonKey(seasonKey);
  const seasonNumber = parsed ? parsed.season : null;

  console.log(`\n   📖 Temporada ${seasonNumber ?? seasonKey}`);

  /*
     1. Episodios descubiertos en la ficha de la serie.
  */
  const byNumber = new Map();
  for (const watch of watchList) {
    if (!byNumber.has(watch.episode)) byNumber.set(watch.episode, watch.url);
  }

  /*
     2. Completar huecos probando la URL directa.
        El esquema /watch/{base}-{t}-{ep} es determinista:
        si el episodio existe, la página responde 200; si no, 404.
  */
  let maxEpisode = Math.max(...byNumber.keys());
  const missing = [];
  for (let n = 1; n <= maxEpisode; n++) {
    if (!byNumber.has(n)) missing.push(n);
  }

  let inferred = 0;

  if (missing.length && parsed) {
    console.log(`   🔧 Intentando recuperar ${missing.length} huecos...`);

    for (const n of missing.slice(0, MAX_INFERRED_EPISODE_ATTEMPTS)) {
      const candidate = buildWatchUrl(parsed.base, parsed.season, n);
      if (!candidate) continue;

      try {
        await fetchHtml(candidate);
        byNumber.set(n, candidate);
        inferred++;
        console.log(`      🔧 Episodio ${n} recuperado: ${candidate}`);
      } catch {
        /* no existe */
      }
    }
  }

  const watchSorted = [...byNumber.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episode, url]) => ({ episode, url, base: parsed.base, season: parsed.season }));

  const seasonItem = {
    ...(oldSeason || {}),
    id: seasonKey,
    slug: seasonKey,
    sourceUrl: watchSorted.length ? watchSorted[0].url : (oldSeason?.sourceUrl || null),
    image: (oldSeason && oldSeason.image) || null,
    number: seasonNumber,
    seriesId: seriesItem.id,
    firstEpisodeUrl: watchSorted.length ? watchSorted[0].url : null,
    updatedAt: new Date().toISOString()
  };

  /*
     3. Rastreamos todos los episodios.
  */
  const crawl = await crawlEpisodes(
    { ...seasonItem, id: seasonKey },
    watchSorted,
    oldEpisodes
  );

  console.log(`   🎬 Procesados: ${crawl.successful}/${crawl.processed}`);

  /*
     4. Completitud real y portada (de la página del episodio 1).
  */
  const completeness = analyzeCompleteness(crawl.episodes, true);

  const epOne = crawl.episodes.find(e => Number(e.number) === 1);
  if (!seasonItem.image && epOne && epOne.servers) {
    /* la portada se extrae del episodio 1 al parsearlo */
  }

  seasonItem.episodeCount = completeness.totalEpisodes;
  seasonItem.minEpisodeFound = completeness.minEpisode;
  seasonItem.maxEpisodeFound = completeness.maxEpisode;
  seasonItem.missingEpisodes = completeness.missingEpisodes;
  seasonItem.paginationComplete = true; // compatibilidad con el frontend
  seasonItem.initialSyncComplete = completeness.complete;
  seasonItem.updatedAt = new Date().toISOString();

  /*
     5. Reemplazo SOLO si está completa; si no, mezcla.
  */
  if (completeness.complete) {
    db.episodes = db.episodes.filter(e => e.seasonId !== seasonKey);
    for (const episode of crawl.episodes) upsert(db.episodes, episode, 'id');
    console.log(`   🟢 TEMPORADA COMPLETA: 1 → ${completeness.maxEpisode}`);
  } else {
    console.log(`   🟡 TEMPORADA INCOMPLETA: NO se reemplaza el catálogo anterior.`);
    for (const episode of crawl.episodes) upsert(db.episodes, episode, 'id');
    if (oldEpisodes.length) {
      console.log(`   ↩️ Se conservan los ${oldEpisodes.length} episodios anteriores.`);
    }
  }

  upsert(db.seasons, seasonItem, 'id');

  return { season: seasonItem, complete: completeness.complete };
}

/* =========================================================
   SINCRONIZACIÓN INCREMENTAL (temporadas ya completas)
   Re-lee la ficha de la serie y busca episodios nuevos.
========================================================= */

async function incrementalSeasonUpdate(db, seriesItem, seasonKey, watchList, oldSeason) {
  if (!oldSeason || oldSeason.initialSyncComplete !== true) {
    return { changed: false, skipped: true };
  }

  const oldEpisodes = db.episodes.filter(e => e.seasonId === seasonKey);
  if (!oldEpisodes.length) return { changed: false, skipped: true };

  const known = new Set(oldEpisodes.map(e => Number(e.number)).filter(Number.isFinite));
  const lastEpisode = Math.max(...known);

  const fresh = watchList.filter(w => !known.has(w.episode));

  if (!fresh.length) {
    console.log(`   ✔️ No hay episodios nuevos en ${seasonKey}`);
    return { changed: false, skipped: false };
  }

  console.log(`   🆕 Episodios nuevos en ${seasonKey}: ${fresh.length}`);

  const crawl = await crawlEpisodes(oldSeason, fresh, oldEpisodes);

  for (const episode of crawl.episodes) {
    upsert(db.episodes, episode, 'id');
  }

  const updated = db.episodes
    .filter(e => e.seasonId === seasonKey)
    .map(e => Number(e.number))
    .filter(Number.isFinite);

  if (updated.length) {
    oldSeason.maxEpisodeFound = Math.max(...updated);
    oldSeason.episodeCount = new Set(updated).size;
  }

  oldSeason.updatedAt = new Date().toISOString();
  upsert(db.seasons, oldSeason, 'id');

  return { changed: true, skipped: false };
}

/* =========================================================
   BASE DE DATOS
========================================================= */

function upsert(array, item, key = 'id') {
  const index = array.findIndex(entry => entry[key] === item[key]);
  if (index === -1) array.push(item);
  else array[index] = { ...array[index], ...item };
}

async function loadCatalog() {
  try {
    const db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
    return {
      meta: db.meta || {},
      series: Array.isArray(db.series) ? db.series : [],
      seasons: Array.isArray(db.seasons) ? db.seasons : [],
      episodes: Array.isArray(db.episodes) ? db.episodes : [],
      movies: Array.isArray(db.movies) ? db.movies : [],
      genres: Array.isArray(db.genres) ? db.genres : []
    };
  } catch {
    return { meta: {}, series: [], seasons: [], episodes: [], movies: [], genres: [] };
  }
}

async function saveCatalog(db) {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmp, OUT_FILE);
}

function enqueueSave(db) {
  saveQueue = saveQueue
    .then(() => saveCatalog(db))
    .catch(error => console.log(`⚠️ Error guardando catálogo: ${error.message}`));
  return saveQueue;
}

function catalogHasIncompleteSeasons(db) {
  return db.seasons.some(s => s.initialSyncComplete !== true);
}

/* =========================================================
   PROCESAR UNA SERIE COMPLETA
========================================================= */

async function processSeries(db, seriesUrl, index, total, allGenres) {
  const slug = slugFromUrl(seriesUrl);
  console.log(`\n${index + 1}/${total} — ${slug}`);

  let html;
  try {
    html = await fetchHtml(seriesUrl);
  } catch (error) {
    console.log(`❌ Error serie: ${error.message}`);
    return;
  }

  const watchList = collectWatchLinks(html, seriesUrl);

  if (!watchList.length) {
    console.log('⚠️ La ficha no contiene enlaces /watch/ (¿landing VIP o anti-bot?). Se conserva lo anterior.');
    return;
  }

  const detail = parseSeries(html, seriesUrl, watchList);
  const oldSeries = db.series.find(s => s.id === detail.id || s.slug === detail.slug);

  /*
     Fusión: no pisar datos antiguos con nulos.
  */
  const merged = { ...(oldSeries || {}) };
  for (const [k, v] of Object.entries(detail)) {
    if (v != null && v !== '') merged[k] = v;
  }
  merged.updatedAt = new Date().toISOString();

  upsert(db.series, merged, 'id');

  detail.genres?.forEach(g => allGenres.add(g));
  console.log(`🎭 Géneros: ${detail.genres?.length || 0}`);
  console.log(`📚 Enlaces /watch/ encontrados: ${watchList.length}`);

  const groups = groupBySeason(watchList);
  console.log(`📚 Temporadas detectadas: ${groups.size}`);

  /*
     Limpieza: temporadas basura creadas por el scraper roto
     (ids de páginas /watch/ sueltas o temporadas vacías e
     incompletas que ya no existen en la ficha).
  */
  const validKeys = new Set(groups.keys());
  const stale = db.seasons.filter(s =>
    s.seriesId === detail.id &&
    !validKeys.has(s.id) &&
    s.initialSyncComplete !== true &&
    (!s.episodeCount || s.episodeCount === 0)
  );

  for (const s of stale) {
    db.seasons = db.seasons.filter(x => x.id !== s.id);
    db.episodes = db.episodes.filter(e => e.seasonId !== s.id);
    console.log(`   🧹 Eliminada temporada basura: ${s.id}`);
  }

  /*
     Temporadas.
  */
  for (const [seasonKey, list] of groups) {
    const oldSeason = db.seasons.find(s => s.id === seasonKey);
    const oldEpisodes = db.episodes.filter(e => e.seasonId === seasonKey);

    try {
      if (oldSeason && oldSeason.initialSyncComplete === true) {
        await incrementalSeasonUpdate(db, detail, seasonKey, list, oldSeason);
        continue;
      }

      await processSeason(db, detail, seasonKey, list, oldSeason, oldEpisodes);
    } catch (error) {
      console.log(`   ❌ Error temporada: ${error.message}`);
      if (oldEpisodes.length) {
        console.log(`   ↩️ Se mantienen ${oldEpisodes.length} episodios anteriores.`);
      }
    }
  }

  await enqueueSave(db);
  console.log(`💾 Catálogo guardado tras la serie: ${slug}`);
}

/* =========================================================
   SINCRONIZACIÓN HISTÓRICA COMPLETA
========================================================= */

async function runFullSync() {
  console.log('\n🚀 INICIANDO CONSTRUCCIÓN DEL CATÁLOGO HISTÓRICO COMPLETO\n');

  if (REBUILD) {
    console.log('♻️  MODO REBUILD ACTIVADO: se descarta el catálogo anterior.');
    try {
      await fs.access(OUT_FILE);
      const backup = `${OUT_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await fs.copyFile(OUT_FILE, backup);
      console.log(`💾 Backup del catálogo anterior guardado en: ${backup}`);
    } catch {
      console.log('ℹ️  No existía un catálogo anterior que respaldar.');
    }
    console.log('🧹 Temporadas/episodios basura descartados. Reconstruyendo desde cero...\n');
  }

  const previous = REBUILD
    ? { meta: {}, series: [], seasons: [], episodes: [], movies: [], genres: [] }
    : await loadCatalog();

  const discovered = await discoverSeries();

  console.log(`\n📚 Series descubiertas: ${discovered.length}`);

  const startedAt = new Date().toISOString();

  const db = {
    meta: {
      ...previous.meta,
      version: 5,
      source: `${BASE_URL}/`,
      syncedAt: startedAt,
      lastSync: { status: 'running', type: 'full', startedAt, finishedAt: null, error: null }
    },
    series: [...previous.series],
    seasons: [...previous.seasons],
    episodes: [...previous.episodes],
    movies: [...previous.movies],
    genres: [...previous.genres]
  };

  const allGenres = new Set(db.genres);

  let idx = 0;
  await runPool(discovered, WORKERS, async (seriesUrl) => {
    const i = idx++;
    await processSeries(db, seriesUrl, i, discovered.length, allGenres);

    if ((i + 1) % 10 === 0) {
      await enqueueSave(db);
      console.log(`💾 Checkpoint: ${i + 1}/${discovered.length} series guardadas`);
    }
  });

  /* Ordenar */
  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));

  db.series.sort((a, b) => clean(a.title).localeCompare(clean(b.title), 'es'));

  db.seasons.sort((a, b) => {
    if (a.seriesId !== b.seriesId) return String(a.seriesId).localeCompare(String(b.seriesId));
    return (a.number ?? 999999) - (b.number ?? 999999);
  });

  db.episodes.sort((a, b) => {
    if (a.seriesId !== b.seriesId) return String(a.seriesId).localeCompare(String(b.seriesId));
    if (a.seasonId !== b.seasonId) return String(a.seasonId).localeCompare(String(b.seasonId));
    return (a.number ?? 999999999) - (b.number ?? 999999999);
  });

  const finished = new Date().toISOString();
  const incomplete = catalogHasIncompleteSeasons(db);

  db.meta.syncedAt = finished;
  db.meta.lastSync = {
    status: 'success',
    type: 'full',
    startedAt,
    finishedAt: finished,
    error: null,
    catalogComplete: !incomplete
  };

  await saveCatalog(db);

  console.log('\n====================================================');
  console.log(`🎉 SINCRONIZACIÓN HISTÓRICA TERMINADA${REBUILD ? ' (REBUILD ♻️)' : ''}`);
  console.log('====================================================');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`📖 Temporadas: ${db.seasons.length}`);
  console.log(`🎬 Episodios: ${db.episodes.length}`);
  console.log(`🎭 Géneros: ${db.genres.length}`);

  if (incomplete) {
    console.log('\n🟡 ATENCIÓN: todavía existen temporadas incompletas.');
  } else {
    console.log('\n🟢 CATÁLOGO COMPLETO. Modo incremental disponible.');
  }

  return db;
}

/* =========================================================
   SINCRONIZACIÓN INCREMENTAL GLOBAL
========================================================= */

async function runIncrementalSync() {
  console.log('\n🔄 INICIANDO SINCRONIZACIÓN INCREMENTAL\n');

  const db = await loadCatalog();
  let changed = false;

  const seriesList = [...db.series];
  console.log(`📚 Series a comprobar: ${seriesList.length}`);

  let idx = 0;

  await runPool(seriesList, WORKERS, async (seriesItem) => {
    const i = idx++;
    console.log(`\n${i + 1}/${seriesList.length} — ${seriesItem.slug}`);

    let html;
    try {
      html = await fetchHtml(seriesItem.sourceUrl);
    } catch (error) {
      console.log(`   ⚠️ No se pudo comprobar: ${error.message}`);
      return;
    }

    const watchList = collectWatchLinks(html, seriesItem.sourceUrl);

    if (!watchList.length) {
      console.log('   ⚠️ Sin enlaces /watch/ (¿landing VIP?). Se omite.');
      return;
    }

    const groups = groupBySeason(watchList);

    for (const [seasonKey, list] of groups) {
      const oldSeason = db.seasons.find(s => s.id === seasonKey);

      try {
        if (oldSeason && oldSeason.initialSyncComplete === true) {
          const result = await incrementalSeasonUpdate(db, seriesItem, seasonKey, list, oldSeason);
          if (result.changed) changed = true;
        } else {
          const oldEpisodes = db.episodes.filter(e => e.seasonId === seasonKey);
          await processSeason(db, seriesItem, seasonKey, list, oldSeason, oldEpisodes);
          changed = true;
        }
      } catch (error) {
        console.log(`   ❌ Error temporada ${seasonKey}: ${error.message}`);
      }
    }

    await enqueueSave(db);
  });

  const finished = new Date().toISOString();

  db.meta = db.meta || {};
  db.meta.syncedAt = finished;
  db.meta.lastSync = {
    status: 'success',
    type: 'incremental',
    startedAt: db.meta.lastSync?.startedAt || finished,
    finishedAt: finished,
    error: null,
    changed
  };

  await saveCatalog(db);

  console.log(`\n✅ Incremental terminado. Cambios: ${changed ? 'sí' : 'no'}`);
  return db;
}

/* =========================================================
   MAIN
========================================================= */

async function main() {
  if (isSyncRunning) {
    console.log('⚠️ Ya hay una sincronización en proceso. Saltando esta ejecución.');
    return;
  }

  isSyncRunning = true;

  try {
    console.log('\n==============================================');
    console.log(`🚀 DONGHUAFLIX SYNC — DonghuaLife /watch/${REBUILD ? '  [REBUILD ♻️]' : ''}`);
    console.log('==============================================\n');

    const existing = await loadCatalog();

    const needsFullSync =
      !existing.series.length ||
      catalogHasIncompleteSeasons(existing);

    if (needsFullSync) {
      console.log('📚 El catálogo todavía no está completamente construido.');
      console.log('🧭 Ejecutando sincronización histórica completa...\n');
      await runFullSync();
      return;
    }

    await runIncrementalSync();
  } finally {
    isSyncRunning = false;
  }
}

main().catch(async error => {
  isSyncRunning = false;
  console.error('\n💥 ERROR FATAL:', error);

  try {
    const db = await loadCatalog();
    const finished = new Date().toISOString();

    db.meta = {
      ...(db.meta || {}),
      syncedAt: finished,
      lastSync: {
        ...(db.meta?.lastSync || {}),
        status: 'error',
        finishedAt: finished,
        error: error.message
      }
    };

    await saveCatalog(db);
  } catch {}

  process.exitCode = 1;
});
