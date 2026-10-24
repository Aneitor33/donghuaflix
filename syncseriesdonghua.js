import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

/* =========================================================
   SERIESDONGHUA SYNC — seriesdonghua.com
   Estructura del sitio (2026):

     /todos-los-donghuas?page=N      -> catálogo paginado
     /donghuas-en-emision            -> en emisión
     /donghuas-finalizados           -> finalizados
     /sitemap.xml                    -> índice → sitemap-series.xml
     /{slug}/                        -> ficha de serie (lista de episodios)
     /{slug}-episodio-{N}/           -> página del episodio (player + fuentes)

   NOTAS:
   - Cada temporada es una serie independiente ("Xi Xing Ji: Asura 2",
     "Swallowed Star 3"): se modela como 1 temporada por serie.
   - Las fuentes (Dailymotion / OK.ru / Rumble / VOE...) salen como
     pastillas en el episodio; se extraen con barrido genérico de
     atributos + iframes + datos de React, y con la API de tokens si
     el sitio usa el mismo esquema que donghualife.

   MODOS:
     node syncseriesdonghua.js                    # incremental automático
     node syncseriesdonghua.js --fresh            # rebuild total (backup .bak)
     node syncseriesdonghua.js --refresh-servers  # re-extraer servidores
     ONLY_SERIES=slug1,slug2 node syncseriesdonghua.js --refresh-servers
     REFRESH_EMPTY_ONLY=1 node syncseriesdonghua.js --refresh-servers
========================================================= */

const BASE_URL = 'https://seriesdonghua.com';
const OUT_FILE = path.resolve(process.env.OUT_FILE || 'public/data/catalog-seriesdonghua.json');

const REBUILD =
  process.argv.includes('--fresh') ||
  process.argv.includes('--rebuild') ||
  ['1', 'true', 'yes'].includes(
    String(process.env.FRESH || process.env.REBUILD || '').toLowerCase()
  );

const REFRESH_SERVERS =
  process.argv.includes('--refresh-servers') ||
  process.argv.includes('--servers') ||
  process.argv.includes('--fix-servers') ||
  ['1', 'true', 'yes'].includes(
    String(process.env.REFRESH_SERVERS || '').toLowerCase()
  );

/*
   NOTA: no usar clean() aquí — este bloque se evalúa ANTES de que
   clean esté inicializada (TDZ). La normalización va inline.
*/
const ONLY_SERIES = new Set(
  String(process.env.ONLY_SERIES || '')
    .split(',')
    .map(s => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
);

const REFRESH_EMPTY_ONLY =
  ['1', 'true', 'yes'].includes(
    String(process.env.REFRESH_EMPTY_ONLY || '').toLowerCase()
  );

const MAX_REFRESH = Math.max(
  1,
  Number(process.env.MAX_REFRESH || Number.MAX_SAFE_INTEGER)
);

const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;
const WORKERS = Math.max(1, Math.min(20, Number(process.env.WORKERS || 8)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);

const SEEDS = ['/todos-los-donghuas', '/donghuas-en-emision', '/donghuas-finalizados'];

/* Rutas de un solo segmento que NO son series (filtro del descubrimiento) */
const NON_SERIES_PATHS = new Set([
  'todos-los-donghuas', 'donghuas-en-emision', 'donghuas-finalizados',
  'inicio', 'auth', 'politica-de-privacidad', 'cookies', 'app-release.apk',
  'accion', 'aventura', 'fantasia', 'historico', 'artes-marciales',
  'comedia', 'drama', 'romance', 'cultivo', 'isekai', 'reencarnacion',
  'sobrenatural', 'escolar', 'wuxia', 'xianxia', 'xuanhuan', 'harem',
  'misterio', 'thriller', 'gore', 'mecha', 'deportes', 'musica',
  'ciencia-ficcion', 'vida-cotidiana', 'recuentos-de-la-vida',
  'sistema', 'estrategia', 'familia', 'psicologico', 'tragedia',
  'superpoderes', 'magia', 'demonios', 'shounen', 'slice-of-life',
  'venganza', 'militar', 'horror'
]);

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
   EPISODIOS  /{slug}-episodio-{N}/
========================================================= */

function parseEpisodeUrl(raw) {
  const url = canonical(raw);
  if (!url || !sameOrigin(url)) return null;

  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length !== 1) return null;

    const slug = decodeURIComponent(parts[0]);
    const match = slug.match(/^(.*)-episodio-(\d+)$/i);
    if (!match) return null;

    return {
      url,
      seriesSlug: match[1],
      episode: Number(match[2])
    };
  } catch {
    return null;
  }
}

function buildEpisodeUrl(seriesSlug, episode) {
  return canonical(`${BASE_URL}/${seriesSlug}-episodio-${episode}`);
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

async function fetchJson(url, options = {}) {
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
        'Accept': 'application/json, */*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9',
        'Origin': BASE_URL,
        'Referer': `${BASE_URL}/`,
        ...(options.headers || {})
      },
      ...(options.method ? { method: options.method } : {}),
      ...(options.body ? { body: options.body } : {})
    });

    if (!response.ok) {
      const error = new Error(`HTTP ${response.status} en ${url}`);
      error.status = response.status;
      throw error;
    }
    return await response.json().catch(() => ({}));
  } finally {
    clearTimeout(timer);
  }
}

/* =========================================================
   DESCUBRIMIENTO
   1) sitemap.xml → sitemap-series.xml (lista autorizada de series)
   2) seeds paginados como respaldo
========================================================= */

function parseSitemapUrls(xml) {
  const urls = [];
  const re = /<loc>\s*([^<]+?)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml)) !== null) urls.push(m[1].trim());
  return urls;
}

async function discoverFromSitemap() {
  console.log('\n🗺️  Descubriendo vía sitemap...');
  try {
    const indexXml = await fetchHtml(`${BASE_URL}/sitemap.xml`);
    const children = parseSitemapUrls(indexXml)
      .filter(u => /sitemap-series/i.test(u));

    const found = new Set();
    for (const child of children) {
      console.log(`   📄 ${child}`);
      try {
        const xml = await fetchHtml(child);
        for (const u of parseSitemapUrls(xml)) {
          const c = canonical(u);
          if (c && sameOrigin(c)) found.add(c);
        }
      } catch (e) {
        console.log(`   ⚠️ ${e.message}`);
      }
    }
    console.log(`✅ Sitemap: ${found.size} series`);
    return [...found];
  } catch (e) {
    console.log(`   ⚠️ Sitemap no disponible: ${e.message}`);
    return [];
  }
}

function parseSeriesLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $('a[href]').each((_, element) => {
    const url = canonical(absolute($(element).attr('href'), pageUrl));
    if (!url || !sameOrigin(url)) return;
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      // serie = path de UN segmento que no sea un episodio ni ruta conocida
      if (parts.length !== 1) return;
      const seg = decodeURIComponent(parts[0]).toLowerCase();
      if (/-episodio-\d+$/i.test(seg)) return;
      if (NON_SERIES_PATHS.has(seg)) return;
      if (/^(sitemap|api|auth|tag|genre|page)/i.test(seg)) return;
      links.push(url);
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
      if (!u.searchParams.has('page')) return;
      const page = Number(u.searchParams.get('page'));
      if (Number.isInteger(page) && page >= 1) links.push(url);
    } catch {}
  });

  return uniqueUrls(links);
}

async function discoverFromSeed(seed) {
  const firstUrl = canonical(absolute(seed));
  const queue = [firstUrl];
  const visited = new Set();
  const found = new Set();
  const maxPages = 60;

  while (queue.length && visited.size < maxPages) {
    const pageUrl = queue.shift();
    if (!pageUrl || visited.has(pageUrl)) continue;
    visited.add(pageUrl);

    console.log(`📄 Página ${visited.size}: ${pageUrl}`);

    try {
      const html = await fetchHtml(pageUrl);
      const series = parseSeriesLinks(html, pageUrl);
      series.forEach(url => found.add(url));
      extractPaginationLinks(html, pageUrl)
        .filter(url => !visited.has(url) && !queue.includes(url))
        .forEach(url => queue.push(url));
    } catch (error) {
      console.log(`   ⚠️ ${error.message}`);
    }
  }

  return [...found];
}

async function discoverSeries() {
  // 1) sitemap (autoritativo)
  const fromSitemap = await discoverFromSitemap();
  if (fromSitemap.length) return fromSitemap;

  // 2) respaldo: seeds
  const all = new Set();
  for (const seed of SEEDS) {
    console.log(`\n🔎 Descubriendo desde ${seed}`);
    const urls = await discoverFromSeed(seed);
    urls.forEach(url => all.add(url));
  }
  console.log(`\n🎯 TOTAL SERIES DESCUBIERTAS: ${all.size}`);
  return [...all];
}

/* =========================================================
   PORTADA / GÉNEROS / SERIE
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
    if (/icoprueba|logo|icon|favicon|banner|avatar|sprite|flag|search/.test(lower)) continue;
    if (!/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(lower)) continue;
    return url;
  }

  return null;
}

function extractGenres($) {
  const genres = new Set();

  const selectors = [
    '[class*="genre"] a', '[class*="genero"] a',
    'a[href*="/accion/"]', 'a[href*="/aventura/"]', 'a[href*="/fantasia/"]',
    'a[href*="/romance/"]', 'a[href*="/comedia/"]', 'a[href*="/drama/"]',
    'a[href*="/artes-marciales/"]', 'a[href*="/cultivo/"]'
  ];

  for (const selector of selectors) {
    $(selector).each((_, el) => {
      const text = clean($(el).text());
      if (text && text.length < 40) genres.add(text);
    });
  }

  return [...genres];
}

/*
   Ficha de serie: /{slug}/
   Debe contener enlaces /{slug}-episodio-{N}/; si no, no es serie
   (página de género, legal, etc.) y se descarta.
*/
function collectEpisodeLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const map = new Map();

  $('a[href]').each((_, element) => {
    const ep = parseEpisodeUrl(absolute($(element).attr('href'), pageUrl));
    if (!ep) return;
    if (!map.has(ep.episode)) map.set(ep.episode, ep.url);
  });

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([episode, url]) => ({ episode, url }));
}

function parseSeries(html, url) {
  const $ = cheerio.load(html);

  const rawTitle =
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text();

  const title = clean(rawTitle).replace(/\s*(sub español|online).*$/i, '');

  const image = extractPosterImage($, url);

  const synopsis = clean(
    $('[class*="synopsis"]').first().text() ||
    $('[class*="sinopsis"]').first().text() ||
    $('meta[name="description"]').attr('content') ||
    ''
  ) || null;

  const status = clean(
    $('a,span,div').filter((_, e) =>
      /^(en emisión|finalizado|en pausa)$/i.test(clean($(e).text()))
    ).first().text()
  ) || null;

  return {
    id: slugFromUrl(url),
    slug: slugFromUrl(url),
    title: title || slugFromUrl(url),
    image: image || null,
    synopsis,
    originalTitle: null,
    duration: null,
    releaseDate: null,
    status,
    genres: extractGenres($),
    sourceUrl: canonical(url)
  };
}

/* =========================================================
   SERVIDORES  (episodio)
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

const SERVER_URL_RE = new RegExp([
  'dailymotion', 'rumble\\.com', 'ok\\.ru', 'odysee\\.com',
  'voe\\.', 'vidmoly', 'mega\\.', 'youtube\\.com', 'youtu\\.be',
  'streamtape', 'mixdrop', 'filemoon', 'mp4upload', 'vidoza',
  'sibnet', 'uqload', 'netu', 'wolfstream', 'vudeo', 'hydrax',
  'streamhub', 'dood(?:stream)?\\.', 'streamwish', 'filelions',
  'fembed', 'feurl', 'vimeo', 'bitchute', 'archive\\.org',
  'googlevideo', 'vk\\.com', 'sendvid', 'peertube',
  '\\.(m3u8|mp4|webm|mkv)'
].join('|'), 'i');

const TRACKER_RE = /google-analytics|googletagmanager|facebook|disqus|addthis|doubleclick|cdn-cgi|recaptcha|hcaptcha|clarity\.|hotjar/i;

function looksLikeServerUrl(raw) {
  if (!raw) return false;
  const lower = String(raw).toLowerCase();
  if (TRACKER_RE.test(lower)) return false;
  return (
    SERVER_URL_RE.test(lower) ||
    /\\.(m3u8|mp4|webm|mkv)(\\?|#|$)/i.test(lower)
  );
}

function extractServerUrlsFromText(text) {
  const found = [];
  const re = /https?:\\?\/\\?\/[^"'<>\s]+/g;
  let m;
  while ((m = re.exec(String(text || ''))) !== null) {
    let u = m[0]
      .replace(/\\u002f/gi, '/')
      .replace(/\\\//g, '/')
      .replace(/&amp;/g, '&')
      .replace(/[.,;!\]}]+$/, '');
    if (looksLikeServerUrl(u)) found.push(u);
  }
  return found;
}

function serverNameFromElement($, el, fallbackUrl) {
  const $el = $(el);
  const name = clean(
    $el.attr('data-server') ||
    $el.attr('data-name') ||
    $el.attr('data-title') ||
    $el.text()
  );
  const short = clean(String(name).split(/[•|·–—]/)[0]);
  if (short && short.length <= 30) return short;
  if (name && name.length <= 30) return name;
  return hostNameOf(fallbackUrl);
}

function isEmbedFromElement($, el, url) {
  const $el = $(el);
  const hint = clean(
    ($el.attr('data-type') || '') + ' ' +
    ($el.attr('data-embed') || '') + ' ' +
    ($el.attr('class') || '') + ' ' +
    $el.text()
  ).toLowerCase();

  if (/embed/.test(hint)) return true;
  if (/video directo|\bdirecto\b|\bdirect\b|download/.test(hint)) return false;
  if (/\\.(m3u8|mp4|webm|mkv)(\\?|#|$)/i.test(url)) return false;
  return true;
}

function extractServers($, html, episodeUrl) {
  const servers = [];
  const push = (name, raw, embed) => addServer(servers, name, raw, episodeUrl, embed);

  const DATA_ATTRS = [
    'data-url', 'data-embed', 'data-src', 'data-video',
    'data-file', 'data-link', 'data-href', 'data-source', 'data-player',
    'data-server-url', 'data-iframe', 'data-play'
  ];
  $(DATA_ATTRS.map(a => `[${a}]`).join(',')).each((_, el) => {
    for (const attr of DATA_ATTRS) {
      const raw = $(el).attr(attr);
      if (!raw) continue;
      const full = absolute(raw, episodeUrl);
      if (!full || !looksLikeServerUrl(full)) continue;
      push(serverNameFromElement($, el, full), full, isEmbedFromElement($, el, full));
      break;
    }
  });

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const full = absolute(href, episodeUrl);
    if (!full || !looksLikeServerUrl(full)) return;
    push(serverNameFromElement($, el, full), full, isEmbedFromElement($, el, full));
  });

  $('iframe[src], video[src], source[src], embed[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;
    const full = absolute(src, episodeUrl);
    if (!full || !looksLikeServerUrl(full)) return;
    push(serverNameFromElement($, el, full), full, isEmbedFromElement($, el, full));
  });

  $('script').each((_, el) => {
    const txt = $(el).html();
    if (!txt || txt.length > 2_000_000) return;
    for (const u of extractServerUrlsFromText(txt)) {
      push(hostNameOf(u), u, !/\\.(m3u8|mp4|webm|mkv)(\\?|#|$)/i.test(u));
    }
  });

  for (const u of extractServerUrlsFromText(html)) {
    push(hostNameOf(u), u, !/\\.(m3u8|mp4|webm|mkv)(\\?|#|$)/i.test(u));
  }

  return servers;
}

/* =========================================================
   🔑 SERVIDORES VÍA API INTERNA (descubierto en el JS de la página)
   ------------------------------------------------------------
   Las pastillas de servidor son <button class="server-tab-btn"
   data-video-id="10750" data-server-index="0..3"> sin URL: la URL
   del embed se pide al servidor al hacer clic:

     POST /api/player/get-server
     headers: Content-Type: application/json
              X-CSRF-TOKEN: <meta name="csrf-token">
              X-Requested-With: XMLHttpRequest
     body:    {video_id: 10750, server_index: 0}
     →        {success: true, embed_url: "https://..."}
========================================================= */

function extractCsrfToken(html) {
  const m = String(html).match(/<meta[^>]+name=["']csrf-token["'][^>]+content=["']([^"']+)["']/i)
        || String(html).match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']csrf-token["']/i);
  return m ? m[1] : null;
}

/*
   Lee las pastillas .server-tab-btn del episodio y devuelve
   [{name, videoId, serverIndex}].
*/
function extractServerButtons($) {
  const buttons = [];

  $('.server-tab-btn').each((_, el) => {
    const $el = $(el);
    const videoId = $el.attr('data-video-id');
    const serverIndex = $el.attr('data-server-index');
    if (videoId == null || serverIndex == null) return;

    // nombre: primer span corto (el primero es el nombre; los otros
    // son badges tipo "Sub ES" / "1080p")
    let name = null;
    $el.find('span').each((__, span) => {
      if (name) return;
      const t = clean($(span).text());
      if (t && t.length <= 25 &&
          !/^(sub|dub|es|en|jp|lat|castellano|\d{3,4}p|hd|full hd)$/i.test(t)) {
        name = t;
      }
    });
    if (!name) name = clean($el.text()).split(/\s+/).slice(0, 2).join(' ');
    if (!name) name = `Servidor ${serverIndex}`;

    buttons.push({
      name,
      videoId: Number(videoId),
      serverIndex: Number(serverIndex)
    });
  });

  return buttons;
}

async function fetchServerEmbedUrl(csrfToken, videoId, serverIndex) {
  const data = await fetchJson(`${BASE_URL}/api/player/get-server`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-TOKEN': csrfToken,
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify({ video_id: videoId, server_index: serverIndex })
  });

  if (data && data.success && typeof data.embed_url === 'string' && data.embed_url) {
    return data.embed_url;
  }
  throw new Error(data?.message || data?.error || 'API respondió sin embed_url');
}

/* =========================================================
   EPISODIO
========================================================= */

async function parseEpisode(html, episodeUrl) {
  const $ = cheerio.load(html);

  const rawTitle =
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    $('title').text();

  const title = clean(rawTitle).replace(/\s*\|\s*SeriesDonghua.*$/i, '');

  const servers = extractServers($, html, episodeUrl);

  // resolución vía API interna: pastillas .server-tab-btn
  const csrfToken = extractCsrfToken(html);
  const serverButtons = extractServerButtons($);

  /*
     🔍 DIAGNÓSTICO: si no hay ni pastillas ni URLs, imprimimos qué
     es lo que el scraper realmente está recibiendo (puede ser una
     página de Cloudflare, un redirect, una versión lite, etc.)
  */
  if (!serverButtons.length && !servers.length) {
    const title = ($('title').first().text() || '').trim();
    console.log(`      🔍 DIAG html=${html.length}B title="${title.slice(0, 60)}"`);
    console.log(`      🔍 tiene server-tab-btn: ${html.includes('server-tab-btn')}`);
    console.log(`      🔍 tiene csrf-token: ${html.includes('csrf-token')}`);
    console.log(`      🔍 tiene cloudflare/just-a-moment: ${/just a moment|cf-chl|challenge-platform/i.test(html)}`);
    const vid = html.match(/data-video-id=["'](\d+)["']/);
    console.log(`      🔍 data-video-id: ${vid ? vid[1] : 'no'}`);
    if (process.env.DEBUG_DUMP === '1') {
      await fs.writeFile(`debug-episode-${Date.now()}.html`, html).catch(() => {});
    }
  }

  if (serverButtons.length) {
    if (!csrfToken) {
      console.log('      ⚠️ No se encontró el csrf-token en la página');
    }
    for (const btn of serverButtons) {
      try {
        const embedUrl = await fetchServerEmbedUrl(csrfToken, btn.videoId, btn.serverIndex);
        addServer(servers, btn.name, embedUrl, episodeUrl, true);
        console.log(`      🔗 ${btn.name}: ${embedUrl.slice(0, 90)}`);
      } catch (error) {
        console.log(`      ⚠️ Servidor ${btn.name}: ${error.message}`);
      }
      await sleep(POLITENESS_MS);
    }
  }

  function navLink(patterns) {
    let found = null;
    $('a[href]').each((_, el) => {
      if (found) return;
      const text = clean($(el).text()).toLowerCase();
      if (!patterns.some(p => text.includes(p))) return;
      const ep = parseEpisodeUrl(absolute($(el).attr('href'), episodeUrl));
      if (ep) found = ep.url;
    });
    return found;
  }

  const previousUrl = navLink(['anterior', 'previous']);
  const nextUrl = navLink(['siguiente', 'next']);

  return {
    title: title || slugFromUrl(episodeUrl),
    servers,
    previousUrl,
    nextUrl,
    releaseDate: null,
    image: extractPosterImage($, episodeUrl)
  };
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

/* =========================================================
   RASTREO DE EPISODIOS
========================================================= */

async function crawlEpisodes(seriesItem, seasonItem, episodeList, previousEpisodes) {
  const results = [];
  const oldMap = new Map(previousEpisodes.map(e => [e.number, e]));

  for (const { episode, url } of episodeList) {
    console.log(`      ▶ Episodio ${episode}`);

    try {
      const html = await fetchHtml(url);
      const detail = await parseEpisode(html, url);

      const episodeId = slugFromUrl(url);
      const old = oldMap.get(episode) || {};

      results.push({
        ...old,
        id: episodeId,
        slug: episodeId,
        title: detail.title || old.title || episodeId,
        sourceUrl: url,
        servers: detail.servers.length ? detail.servers : (old.servers || []),
        previousUrl: detail.previousUrl || old.previousUrl || null,
        nextUrl: detail.nextUrl || old.nextUrl || null,
        updatedAt: new Date().toISOString(),
        seriesId: seriesItem.id,
        seasonId: seasonItem.id,
        number: episode,
        releaseDate: detail.releaseDate || old.releaseDate || null
      });
    } catch (error) {
      console.log(`      ❌ Error episodio ${episode}: ${error.message}`);
      const old = oldMap.get(episode);
      if (old) results.push(old);
    }
  }

  return results;
}

/* =========================================================
   PROCESAR SERIE (una sola temporada)
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

  const episodeList = collectEpisodeLinks(html, seriesUrl);

  if (!episodeList.length) {
    console.log('⚠️ Sin episodios (no es ficha de serie). Se omite.');
    return;
  }

  const detail = parseSeries(html, seriesUrl);
  const oldSeries = db.series.find(s => s.id === detail.id || s.slug === detail.slug);

  const merged = { ...(oldSeries || {}) };
  for (const [k, v] of Object.entries(detail)) {
    if (v != null && v !== '') merged[k] = v;
  }
  merged.updatedAt = new Date().toISOString();
  upsert(db.series, merged, 'id');

  detail.genres?.forEach(g => allGenres.add(g));
  console.log(`📚 Episodios detectados: ${episodeList.length}`);

  const seasonId = `${slug}-1`;
  const oldSeason = db.seasons.find(s => s.id === seasonId);
  const oldEpisodes = db.episodes.filter(e => e.seasonId === seasonId);

  const known = new Set(oldEpisodes.map(e => Number(e.number)).filter(Number.isFinite));
  const fresh = episodeList.filter(e => !known.has(e.episode));

  let episodes;
  if (oldSeason && oldSeason.initialSyncComplete === true && fresh.length === 0) {
    console.log('   ✔️ No hay episodios nuevos');
    return;
  }

  if (oldSeason && oldSeason.initialSyncComplete === true && fresh.length > 0) {
    console.log(`   🆕 Episodios nuevos: ${fresh.length}`);
    const crawled = await crawlEpisodes(merged, { id: seasonId }, fresh, oldEpisodes);
    episodes = [...oldEpisodes, ...crawled];
  } else {
    episodes = await crawlEpisodes(merged, { id: seasonId }, episodeList, oldEpisodes);
  }

  const numbers = episodes.map(e => Number(e.number)).filter(Number.isFinite);
  const unique = [...new Set(numbers)].sort((a, b) => a - b);
  const minEpisode = unique[0] ?? null;
  const maxEpisode = unique.at(-1) ?? null;
  const complete = unique.length > 0 && minEpisode === 1 && unique.length === maxEpisode;

  for (const ep of episodes) upsert(db.episodes, ep, 'id');

  const seasonItem = {
    ...(oldSeason || {}),
    id: seasonId,
    slug: seasonId,
    sourceUrl: seriesUrl,
    image: merged.image || null,
    number: 1,
    seriesId: merged.id,
    firstEpisodeUrl: episodeList.length ? episodeList[0].url : null,
    episodeCount: unique.length,
    minEpisodeFound: minEpisode,
    maxEpisodeFound: maxEpisode,
    missingEpisodes: [],
    paginationComplete: true,
    initialSyncComplete: complete,
    updatedAt: new Date().toISOString()
  };
  upsert(db.seasons, seasonItem, 'id');

  console.log(`   ${complete ? '🟢' : '🟡'} Temporada: ${unique.length} episodios (max ${maxEpisode})`);

  await enqueueSave(db);
  console.log(`💾 Catálogo guardado tras la serie: ${slug}`);
}

/* =========================================================
   SINCRONIZACIÓN COMPLETA
========================================================= */

async function runFullSync() {
  console.log('\n🚀 INICIANDO CONSTRUCCIÓN DEL CATÁLOGO COMPLETO\n');

  if (REBUILD) {
    console.log('♻️  MODO REBUILD ACTIVADO.');
    try {
      await fs.access(OUT_FILE);
      const backup = `${OUT_FILE}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      await fs.copyFile(OUT_FILE, backup);
      console.log(`💾 Backup: ${backup}`);
    } catch { /* no había catálogo */ }
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
      version: 1,
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
      console.log(`💾 Checkpoint: ${i + 1}/${discovered.length}`);
    }
  });

  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));
  db.series.sort((a, b) => clean(a.title).localeCompare(clean(b.title), 'es'));

  const finished = new Date().toISOString();
  db.meta.syncedAt = finished;
  db.meta.lastSync = { status: 'success', type: 'full', startedAt, finishedAt: finished, error: null };

  await saveCatalog(db);

  console.log('\n====================================================');
  console.log('🎉 SINCRONIZACIÓN TERMINADA');
  console.log('====================================================');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`📖 Temporadas: ${db.seasons.length}`);
  console.log(`🎬 Episodios: ${db.episodes.length}`);
  console.log(`🎭 Géneros: ${db.genres.length}`);

  return db;
}

/* =========================================================
   SINCRONIZACIÓN INCREMENTAL
========================================================= */

async function runIncrementalSync() {
  console.log('\n🔄 INICIANDO SINCRONIZACIÓN INCREMENTAL\n');

  const db = await loadCatalog();
  const seriesList = [...db.series];
  console.log(`📚 Series a comprobar: ${seriesList.length}`);

  let changed = false;
  let idx = 0;

  await runPool(seriesList, WORKERS, async (seriesItem) => {
    const i = idx++;
    console.log(`\n${i + 1}/${seriesList.length} — ${seriesItem.slug}`);

    try {
      const html = await fetchHtml(seriesItem.sourceUrl);
      const episodeList = collectEpisodeLinks(html, seriesItem.sourceUrl);
      if (!episodeList.length) return;

      const known = new Set(
        db.episodes
          .filter(e => e.seriesId === seriesItem.id)
          .map(e => Number(e.number))
          .filter(Number.isFinite)
      );
      const fresh = episodeList.filter(e => !known.has(e.episode));

      if (!fresh.length) {
        console.log('   ✔️ Sin novedades');
        return;
      }

      console.log(`   🆕 Episodios nuevos: ${fresh.length}`);
      const seasonId = `${seriesItem.id}-1`;
      const season = db.seasons.find(s => s.id === seasonId) || { id: seasonId };
      const oldEpisodes = db.episodes.filter(e => e.seasonId === seasonId);
      const crawled = await crawlEpisodes(seriesItem, season, fresh, oldEpisodes);
      for (const ep of crawled) upsert(db.episodes, ep, 'id');

      const numbers = db.episodes.filter(e => e.seasonId === seasonId).map(e => Number(e.number)).filter(Number.isFinite);
      const max = numbers.length ? Math.max(...numbers) : null;
      upsert(db.seasons, {
        ...season,
        episodeCount: new Set(numbers).size,
        maxEpisodeFound: max,
        initialSyncComplete: numbers.length > 0 && Math.min(...numbers) === 1 && new Set(numbers).size === max,
        updatedAt: new Date().toISOString()
      }, 'id');

      changed = true;
      await enqueueSave(db);
    } catch (error) {
      console.log(`   ❌ ${error.message}`);
    }
  });

  const finished = new Date().toISOString();
  db.meta.syncedAt = finished;
  db.meta.lastSync = {
    status: 'success', type: 'incremental',
    startedAt: db.meta.lastSync?.startedAt || finished,
    finishedAt: finished, error: null, changed
  };
  await saveCatalog(db);

  console.log(`\n✅ Incremental terminado. Cambios: ${changed ? 'sí' : 'no'}`);
  return db;
}

/* =========================================================
   🔧 REFRESCO DE SERVIDORES
========================================================= */

function serverKeySet(servers) {
  return new Set(
    (servers || []).map(s => `${s.name}|${s.url}|${s.embed ? 1 : 0}`.toLowerCase())
  );
}

function sameServers(a, b) {
  const ka = serverKeySet(a);
  const kb = serverKeySet(b);
  if (ka.size !== kb.size) return false;
  for (const k of ka) if (!kb.has(k)) return false;
  return true;
}

async function runRefreshServers() {
  console.log('\n🔧 INICIANDO REFRESCO DE SERVIDORES\n');

  const db = await loadCatalog();

  let targets = [...db.episodes];

  if (ONLY_SERIES.size) {
    targets = targets.filter(e => ONLY_SERIES.has(e.seriesId));
    console.log(`🎯 Filtro ONLY_SERIES: ${[...ONLY_SERIES].join(', ')}`);
  }

  if (REFRESH_EMPTY_ONLY) {
    const before = targets.length;
    targets = targets.filter(e => !e.servers || !e.servers.length);
    console.log(`🎯 REFRESH_EMPTY_ONLY: ${before} → ${targets.length}`);
  }

  targets = targets.slice(0, MAX_REFRESH);
  console.log(`🎬 Episodios a refrescar: ${targets.length}`);
  console.log(`👷 Workers: ${WORKERS}\n`);

  if (!targets.length) {
    console.log('✅ Nada que refrescar.');
    return db;
  }

  const startedAt = new Date().toISOString();
  let done = 0, changed = 0, errors = 0, gained = 0;

  await runPool(targets, WORKERS, async (episode) => {
    const label = `${episode.seriesId} · EP${episode.number ?? '?'}`;

    try {
      const html = await fetchHtml(episode.sourceUrl);
      const detail = await parseEpisode(html, episode.sourceUrl);

      const oldServers = episode.servers || [];
      const newServers = detail.servers.length ? detail.servers : oldServers;

      if (!sameServers(oldServers, newServers)) {
        changed++;
        if (newServers.length > oldServers.length) gained += newServers.length - oldServers.length;
      }

      upsert(db.episodes, {
        ...episode,
        title: detail.title || episode.title,
        servers: newServers,
        previousUrl: detail.previousUrl || episode.previousUrl || null,
        nextUrl: detail.nextUrl || episode.nextUrl || null,
        updatedAt: new Date().toISOString()
      }, 'id');

      done++;
      console.log(`   [${done}/${targets.length}] ${label} — ${newServers.length} servidor(es)`);
    } catch (error) {
      errors++;
      done++;
      console.log(`   ⚠️ [${done}/${targets.length}] ${label}: ${error.message}`);
    }

    if (done % 100 === 0) {
      await enqueueSave(db);
      console.log(`💾 Checkpoint: ${done}/${targets.length} · cambios: ${changed} · errores: ${errors}`);
    }
  });

  const finishedAt = new Date().toISOString();
  db.meta.syncedAt = finishedAt;
  db.meta.lastSync = {
    status: errors ? 'partial' : 'success',
    type: 'refresh-servers',
    startedAt, finishedAt,
    error: errors ? `${errors} episodios fallaron` : null,
    refreshed: done, changed, gained, errors
  };
  await saveCatalog(db);

  console.log('\n====================================================');
  console.log('🔧 REFRESCO TERMINADO');
  console.log('====================================================');
  console.log(`🎬 Revisados: ${done} · ✏️ Modificados: ${changed} · ➕ Ganados: ${gained} · ❌ Errores: ${errors}`);

  return db;
}

/* =========================================================
   MAIN
========================================================= */

async function main() {
  if (isSyncRunning) {
    console.log('⚠️ Ya hay una sincronización en proceso. Saltando.');
    return;
  }
  isSyncRunning = true;

  try {
    console.log('\n==============================================');
    console.log(`🚀 SERIESDONGHUA SYNC${REBUILD ? '  [REBUILD ♻️]' : ''}`);
    console.log('==============================================\n');

    if (REFRESH_SERVERS && !REBUILD) {
      console.log('🔧 Modo REFRESCO DE SERVIDORES activado.');
      await runRefreshServers();
      return;
    }

    const existing = await loadCatalog();
    const needsFullSync =
      REBUILD ||
      !existing.series.length ||
      existing.seasons.some(s => s.initialSyncComplete !== true);

    if (needsFullSync) {
      console.log('📚 Catálogo incompleto o rebuild solicitado: sincronización completa...\n');
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
