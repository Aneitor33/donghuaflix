// ══════════════════════════════════════════════════════════
//  syncdonghua.js — DonghuaFlix
//  Scraper MULTI-FUENTE de donghuas:
//    · donghualife.com
//    · mundodonghua.com
//    · seriesdonghua.com
//    · tiodonghua.lat
//
//  QUÉ HACE
//   1. Descubre las series de las 4 webs.
//   2. RECONOCE duplicados entre webs y los fusiona en UN
//      SOLO título: "Martial Peak", "Martial Peak 5",
//      "Wu Dong Qian Kun 3"… acaban siendo un único donghua
//      (las variantes con número se mapean como temporada).
//   3. SUMA episodios y SERVIDORES de todas las fuentes: un
//      episodio nuevo se rastrea en hasta 3 webs y los
//      servidores encontrados se combinan en el mismo episodio.
//   4. Portadas vía TMDB (busca el título).
//   5. Escribe public/data/catalog.json (formato de siempre →
//      compatible con split-catalog.js, app.js, sw.js…).
//   6. LÍMITE DE TIEMPO + CHECKPOINTS: nunca supera el presupuesto
//      de minutos; guarda y hace push al repo cada 500 episodios,
//      así si GitHub corta el workflow a las 6h, lo hecho ya está
//      subido y la siguiente ejecución retoma donde quedó.
//
//  Uso:
//    node syncdonghua.js
//  Variables de entorno:
//    WORKERS=7                  trabajadores en paralelo
//    POLITENESS_MS=150          pausa entre peticiones
//    MAX_EPISODE_CRAWLS=6000    tope de episodios nuevos por ejecución
//    MAX_RUNTIME_MINUTES=300    tope de duración (por debajo del límite de 6h de Actions)
//    MAX_URLS_PER_EP=3          webs distintas rastreadas por episodio nuevo
//    TMDB_API_KEY=...           portadas TMDB
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as cheerio from 'cheerio';

const OUT_FILE = path.resolve('public/data/catalog.json');

const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 7)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 6000));
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_URLS_PER_EP = Math.max(1, Math.min(4, Number(process.env.MAX_URLS_PER_EP || 3)));
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* ══════════════════════════════════════════════════════════
   FUENTES  (priority: menor gana al fusionar; donghualife
   primero para no romper los ids que ya usa tu catálogo)
══════════════════════════════════════════════════════════ */

const SD_EXCLUDE = new Set([
  'todos-los-donghuas', 'episodios', 'donghuas-finalizados',
  'contacto', 'inicio', 'login', 'registro', 'page'
]);

const SOURCES = [
  {
    id: 'donghualife',
    base: 'https://donghualife.com',
    priority: 0,
    seeds: ['/series/', '/series', '/donghuas', '/en-emision', '/finalizado', '/en-pausa'],
    maxPages: 250,
    seriesTest: p => /^\/series\/[a-z0-9-]+\/?$/i.test(p),
    seasonTest: p => /^\/season\/[a-z0-9-]+/i.test(p),
    episodeTest: p => /^\/episode\/[a-z0-9-]+/i.test(p),
    pageProbe: (seed, n) => `${seed}?page=${n}`,
    isPageLink: (curPath, url) => {
      try {
        const u = new URL(url);
        return u.pathname === curPath &&
               (u.searchParams.has('page') || u.searchParams.has('pag'));
      } catch { return false; }
    }
  },
  {
    id: 'mundodonghua',
    base: 'https://www.mundodonghua.com',
    priority: 1,
    seeds: [
      '/lista-donghuas',
      '/lista-donghuas-finalizados',
      '/lista-donghuas-emision'
    ],
    maxPages: 300,
    seriesTest: p => /^\/donghua\/[a-z0-9-]+\/?$/i.test(p),
    episodeTest: p => /^\/ver\/[a-z0-9-]+\/\d+\/?$/i.test(p),
    pageProbe: (seed, n) => `${seed.replace(/\/+$/, '')}/${n}`,
    isPageLink: p => /^\/lista-donghuas(-[a-z]+)?\/\d+\/?$/i.test(p)
  },
  {
    id: 'seriesdonghua',
    base: 'https://seriesdonghua.com',
    priority: 2,
    seeds: ['/todos-los-donghuas'],
    maxPages: 400,
    seriesTest: p => {
      const m = p.match(/^\/([a-z0-9-]+)\/?$/i);
      if (!m) return false;
      const slug = m[1];
      if (/-episodio-\d+/i.test(slug)) return false;
      if (SD_EXCLUDE.has(slug)) return false;
      return true;
    },
    episodeTest: p => /-episodio-\d+/i.test(p),
    pageProbe: (seed, n) => `${seed}?pag=${n}`,
    isPageLink: (curPath, url) => {
      try {
        const u = new URL(url);
        return u.pathname === '/todos-los-donghuas' && u.searchParams.has('pag');
      } catch { return false; }
    }
  },
  {
    id: 'tiodonghua',
    base: 'https://tiodonghua.lat',
    priority: 3,
    seeds: ['/donghua/'],
    maxPages: 250,
    seriesTest: p => /^\/donghua\/(?!page\/)[a-z0-9-]+\/?$/i.test(p),
    episodeTest: p => /^\/episodios\/[a-z0-9-]+/i.test(p),
    pageProbe: (seed, n) => `/donghua/page/${n}/`,
    isPageLink: p => /^\/donghua\/page\/\d+\/?$/i.test(p)
  }
];

/* ══════════════════════════════════════════════════════════
   UTILIDADES
══════════════════════════════════════════════════════════ */

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

const fold = s => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase();

const sleep = ms => new Promise(r => setTimeout(r, ms));

function absolute(raw, base) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v || /^(javascript:|mailto:|tel:|#)/i.test(v)) return null;
  try { return new URL(v, base).href; } catch { return null; }
}

function sameOrigin(url, base) {
  try { return new URL(url).origin === new URL(base).origin; }
  catch { return false; }
}

function slugFromUrl(raw) {
  try {
    const u = new URL(raw);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  } catch { return ''; }
}

const uniqueUrls = vals => [...new Set(vals.map(v => absolute(v)).filter(Boolean))];

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.7,en;q=0.6',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.google.com/',
        'Origin': 'https://www.google.com',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'sec-ch-ua': '"Chromium";v="126", "Google Chrome";v="126", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'DNT': '1',
        'Connection': 'keep-alive'
      }
    });
    if (!res.ok) {
      if (attempt < FETCH_RETRIES && [408, 425, 429, 500, 502, 503, 504].includes(res.status)) {
        await sleep(1000 * attempt);
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} en ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < FETCH_RETRIES) {
      await sleep(1000 * attempt);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ══════════════════════════════════════════════════════════
   TÍTULOS — clave canónica + temporada explícita
   "Martial Peak 5" → base "martial peak" + offset 5
   "Wu Dong Qian Kun 3ra Temporada" → base + offset 3
══════════════════════════════════════════════════════════ */

const TITLE_JUNK = /\s*(?:sub espa.?ol|online|gratis|hd|completo)?\s*[|\-–—]\s*(?:donghualife|mundodonghua|seriesdonghua|tiodonghua|tio donghua).*$/i;

function titleKey(rawTitle) {
  let t = clean(rawTitle).replace(TITLE_JUNK, '').trim();
  t = t.replace(/\s+sub espa.?ol.*$/i, '').trim();

  let offset = null;
  let m = t.match(/^(.*?)[\s\-–—]+(?:temporada|season|parte|part|cour)\s*(\d{1,2})$/i);
  if (m && m[1].trim().length >= 3) {
    t = m[1].trim();
    offset = Number(m[2]);
  } else {
    m = t.match(/^(.*?)[\s\-–—]+(\d{1,2})(?:ra|da|ta|th|st|nd|rd)?$/i);
    if (m && m[1].trim().length >= 3 && /[a-záéíóúñ]/i.test(m[1])) {
      t = m[1].trim();
      offset = Number(m[2]);
    }
  }
  return { base: fold(t), baseTitle: t, offset };
}

/* Temporada final de un episodio: la variante "Serie 5" lista sus
   caps como temporada 1 → se re-mapea a la temporada 5. Si la URL
   ya traía temporada > 1 se respeta tal cual. */
const mapSeason = (candSeason, offset) =>
  (offset != null && candSeason === 1) ? offset : candSeason;

/* ══════════════════════════════════════════════════════════
   EPISODIOS (número / temporada desde la URL)
══════════════════════════════════════════════════════════ */

function epCode(slug, pathname) {
  let m = slug.match(/(\d{1,3})x(\d{1,4})(?:-|$)/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };

  m = slug.match(/-temporada-(\d{1,3})-episodio-x?(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };

  m = slug.match(/-(\d{1,3})-episodio-x?(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };

  m = slug.match(/-episodio-x?(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };

  m = slug.match(/-episode-x?(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };

  m = (pathname || '').match(/\/ver\/[^/]+\/(\d{1,4})\/?$/i);
  if (m) return { season: 1, number: Number(m[1]) };

  m = slug.match(/-x(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };

  m = slug.match(/-(\d{1,4})$/);
  if (m) return { season: 1, number: Number(m[1]) };

  return { season: 1, number: null };
}

/* ══════════════════════════════════════════════════════════
   SERVIDORES — acepta TANTO players externos (ok.ru, voe,
   streamtape, fembed, dailymotion…) COMO players alojados en
   el mismo dominio (/player/, /e/, /embed/, /goto/…). Esto es
   lo que captura TioPlayer, Tamamo, "SERVIDOR VIP", etc.
══════════════════════════════════════════════════════════ */

const PLAYER_PATH = /\/(?:player|play|embed|goto|stream|e|video|reproductor|vidurl|tio)\//i;
const IMAGE_ASSET_RE = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?)(\?|#|$)/i;
const UPLOADS_RE = /\/wp-content\/uploads\/|\/uploads\//i;
const KNOWN_VIDEO_HOST = /(?:ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|fembad|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|vox|1fichier|johnfullwonder|byse|seeks|fastream|luluvdo|voe\.sx|netu\.tv|tamamo|tioplayer|fcdn|streamlare|slmaxed|sltube|playhydrax|hydrax|moviebox)/i;
const DIRECT_MEDIA_RE = /\.(?:mp4|webm|m3u8)(\?|#|$)/i;

function isPlayableAbs(u) {
  if (!u) return false;
  if (IMAGE_ASSET_RE.test(u)) return false;
  if (UPLOADS_RE.test(u)) return false;
  if (KNOWN_VIDEO_HOST.test(u)) return true;
  try {
    const p = new URL(u).pathname;
    return PLAYER_PATH.test(p) || DIRECT_MEDIA_RE.test(p);
  } catch { return false; }
}

const SERVER_BLACKLIST = (process.env.SERVER_BLACKLIST ||
  'streamhg,earnvids,streamruby,smoothie,playerwish,upstream,dropload,t.me,tmdb.org,modagamers')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const isBlacklisted = host =>
  SERVER_BLACKLIST.some(b => String(host).toLowerCase().includes(b));

function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(url)
  ).replace(/\s*(?:sub espa.?ol).*$/i, '').trim();

  const servers = [];
  const seen = new Set();
  const addServer = (name, raw, embed = false, lang = null) => {
    const u = absolute(raw, url);
    if (!u || !isPlayableAbs(u)) return;
    if (seen.has(u)) return;
    let host = name;
    try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {}
    if (isBlacklisted(host) || isBlacklisted(name)) return;
    seen.add(u);
    const srv = { name: clean(name) || host || 'Servidor', url: u, embed: Boolean(embed) };
    if (lang) srv.lang = lang;
    servers.push(srv);
  };

  $('iframe[src]').each((_, el) => {
    const src = absolute($(el).attr('src'), url);
    let host = 'Servidor';
    try { if (src) host = new URL(src).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, src, true);
  });

  let currentLang = null;
  $('[data-url], [data-embed], [data-src], [data-link], [data-player], [data-href], button, a').each((_, el) => {
    const node = $(el);
    const txt = clean(node.text());
    if (txt && txt.length < 30) {
      if (/^latino$|espa[nñ]ol latino/i.test(txt)) { currentLang = 'latino'; return; }
      if (/castellano/i.test(txt)) { currentLang = 'castellano'; return; }
      if (/subtitulad|subt[ií]tulad/i.test(txt)) { currentLang = 'subtitulado'; return; }
    }
    if (el.tagName === 'img') return;
    const raw = node.attr('data-url') || node.attr('data-embed') ||
                node.attr('data-link') || node.attr('data-player') || node.attr('data-href');
    if (!raw) return;
    let host = 'Servidor';
    try { host = new URL(absolute(raw, url) || raw).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, raw, true, currentLang);
  });

  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href');
    const txt = clean($(el).text());
    let host = 'Servidor';
    try { if (raw) host = new URL(absolute(raw, url) || raw).hostname.replace(/^www\./, ''); } catch {}
    addServer(txt && txt.length < 30 ? txt : host, raw, false);
  });

  const directRe = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|webm|m3u8)(\?[^\s"'<>\\]*)?/gi;
  for (const m of html.match(directRe) || []) {
    let host = 'Video directo';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, false);
  }

  const hostRe = /https?:\/\/[^\s"'<>\\]*(?:ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|netu|hqq|waaw|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|luluvdo|fastream)[^\s"'<>\\]*/gi;
  for (const m of html.match(hostRe) || []) {
    let host = 'Servidor';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, true);
  }

  return { title, servers };
}

/* ══════════════════════════════════════════════════════════
   SERIE (parsing genérico: sirve para las 4 webs)
══════════════════════════════════════════════════════════ */

function parseSeries(html, url) {
  const $ = cheerio.load(html);

  const slug = slugFromUrl(url);

  let title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    ''
  );
  title = title.replace(TITLE_JUNK, '').trim();
  if (!title) {
    title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  let image = absolute($('meta[property="og:image"]').attr('content'), url);
  if (!image || !/\.(jpg|jpeg|png|webp)(\?|$)/i.test(image)) {
    image = null;
    $('img').each((_, el) => {
      if (image) return;
      const src = $(el).attr('data-src') || $(el).attr('data-original') || $(el).attr('src');
      const full = absolute(src, url);
      if (!full) return;
      const low = full.toLowerCase();
      if (/logo|icon|favicon|banner|avatar|icoprueba/.test(low)) return;
      if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(full)) image = full;
    });
  }

  let synopsis = clean(
    $('meta[name="description"]').attr('content') ||
    $('[class*="synopsis"], [class*="sinopsis"], [class*="description"], [class*="resumen"], #sinopsis').first().text()
  );
  if (!synopsis || synopsis.length < 60) {
    $('p').each((_, el) => {
      if (synopsis && synopsis.length >= 60) return;
      const t = clean($(el).text());
      if (t.length > 80) synopsis = t;
    });
  }

  const bodyTxt = clean($('body').text());

  let status = null;
  const stM = bodyTxt.match(/(en emisi[oó]n|finalizad[oa]s?|completad[oa]s?|en pausa)/i);
  if (stM) status = stM[1];

  let year = null;
  const yM = title.match(/\b((?:19|20)\d{2})\b/) || bodyTxt.match(/(?:estreno|año)[^\d]{0,15}((?:19|20)\d{2})/i) || bodyTxt.match(/\b((?:19|20)\d{2})\b/);
  if (yM) year = Number(yM[1]);

  const genres = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') || '';
    if (!/\/(genero|generos|genre|categoria|category|etiqueta|tag)\//i.test(href)) return;
    const g = clean($(el).text());
    if (g && g.length < 30 && !genres.includes(g)) genres.push(g);
  });

  return {
    id: slug, slug, title, image,
    synopsis: synopsis || null,
    status, year, genres
  };
}

/* ══════════════════════════════════════════════════════════
   DESCUBRIMIENTO
══════════════════════════════════════════════════════════ */

function parseSeriesLinks(html, pageUrl, source) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const raw = absolute($(el).attr('href'), pageUrl);
    if (!raw || !sameOrigin(raw, source.base)) return;
    try {
      const p = new URL(raw).pathname;
      if (source.seriesTest(p)) links.push(raw);
    } catch {}
  });
  return uniqueUrls(links);
}

function parsePageLinks(html, pageUrl, source) {
  const $ = cheerio.load(html);
  const links = [];
  const curPath = new URL(pageUrl).pathname;
  $('a[href]').each((_, el) => {
    const raw = absolute($(el).attr('href'), pageUrl);
    if (!raw || !sameOrigin(raw, source.base)) return;
    try {
      const p = new URL(raw).pathname;
      if (source.isPageLink(curPath, raw, p)) links.push(raw);
    } catch {}
  });
  return uniqueUrls(links);
}

async function discoverSource(source) {
  const found = new Set();

  for (const seed of source.seeds) {
    if (timeUp()) { console.log(`⏱️  Presupuesto de tiempo agotado durante [${source.id}]`); break; }
    const first = absolute(seed, source.base);
    if (!first) continue;

    const queue = [first];
    const visited = new Set();

    while (queue.length && visited.size < source.maxPages) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);

      let html;
      try { html = await fetchHtml(pageUrl); }
      catch (e) { console.log(`   ⚠️ [${source.id}] ${e.message}`); continue; }

      const series = parseSeriesLinks(html, pageUrl, source);
      series.forEach(u => found.add(u));

      for (const next of parsePageLinks(html, pageUrl, source)) {
        if (!visited.has(next) && !queue.includes(next)) queue.push(next);
      }

      await sleep(POLITENESS_MS);
    }

    for (let n = 2; n <= source.maxPages; n++) {
      if (timeUp()) break;
      const url = absolute(source.pageProbe(first, n), source.base);
      if (!url || visited.has(url)) continue;

      let html;
      try { html = await fetchHtml(url); }
      catch { break; }

      const links = parseSeriesLinks(html, url, source);
      const fresh = links.filter(l => !found.has(l));

      if (!fresh.length) {
        console.log(`   🛑 [${source.id}] página ${n}: sin novedades — fin del listado`);
        break;
      }
      fresh.forEach(l => found.add(l));
      visited.add(url);

      if (n % 10 === 0) console.log(`   📄 [${source.id}] ${n} páginas sondeadas, ${found.size} series`);

      await sleep(POLITENESS_MS);
    }
  }

  console.log(`\n🎯 [${source.id}] Series descubiertas: ${found.size}`);
  return [...found];
}

/* ══════════════════════════════════════════════════════════
   FASE 2a — Analizar fichas de serie (paralelo)
══════════════════════════════════════════════════════════ */

async function scrapeSeriesPage(source, url) {
  const html = await fetchHtml(url);
  const parsed = parseSeries(html, url);
  const $ = cheerio.load(html);

  const candidates = new Map(); // "season|number" → {season, number, urls:[]}
  const addCandidate = rawUrl => {
    if (!sameOrigin(rawUrl, source.base)) return;
    let pathname = '';
    try { pathname = new URL(rawUrl).pathname; } catch { return; }
    if (!source.episodeTest(pathname)) return;
    const slug = slugFromUrl(rawUrl);
    const code = epCode(slug, pathname);
    if (code.number == null) return;
    const key = `${code.season}|${code.number}`;
    if (!candidates.has(key)) candidates.set(key, { season: code.season, number: code.number, urls: [] });
    const c = candidates.get(key);
    if (!c.urls.includes(rawUrl)) c.urls.push(rawUrl);
  };

  $('a[href]').each((_, el) => {
    const full = absolute($(el).attr('href'), url);
    if (full) addCandidate(full);
  });

  if (source.seasonTest) {
    const seasonLinks = [];
    $('a[href]').each((_, el) => {
      const full = absolute($(el).attr('href'), url);
      if (!full || !sameOrigin(full, source.base)) return;
      try {
        if (source.seasonTest(new URL(full).pathname) && !seasonLinks.includes(full)) seasonLinks.push(full);
      } catch {}
    });
    for (const sUrl of seasonLinks.slice(0, 12)) {
      if (timeUp()) break;
      try {
        const sHtml = await fetchHtml(sUrl);
        const $s = cheerio.load(sHtml);
        $s('a[href]').each((_, el) => {
          const full = absolute($s(el).attr('href'), sUrl);
          if (full) addCandidate(full);
        });
      } catch {}
      await sleep(POLITENESS_MS);
    }
  }

  await sleep(POLITENESS_MS);

  return {
    src: source.id,
    priority: source.priority,
    url,
    slug: parsed.slug,
    key: titleKey(parsed.title),
    parsed,
    candidates: [...candidates.values()]
  };
}

/* ══════════════════════════════════════════════════════════
   CATÁLOGO
══════════════════════════════════════════════════════════ */

async function loadCatalog() {
  try {
    const db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
    return {
      meta: db.meta || {},
      series: Array.isArray(db.series) ? db.series : [],
      seasons: Array.isArray(db.seasons) ? db.seasons : [],
      episodes: Array.isArray(db.episodes) ? db.episodes : [],
      genres: Array.isArray(db.genres) ? db.genres : []
    };
  } catch {
    return { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }
}

async function saveCatalog(db) {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  const tmp = `${OUT_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db), 'utf8');
  await fs.rename(tmp, OUT_FILE);
}

function upsert(array, item, key = 'id') {
  const i = array.findIndex(e => e[key] === item[key]);
  if (i === -1) array.push(item);
  else array[i] = { ...array[i], ...item };
}

/* Push intermedio al repo: si GitHub corta el workflow a las 6h,
   lo ya rastreado queda subido y la próxima ejecución continúa. */
let lastPush = 0;
function gitCheckpoint(db) {
  const now = Date.now();
  if (now - lastPush < 120000) return; // máx 1 push cada 2 min
  lastPush = now;
  saveCatalog(db).then(() => {
    try {
      execSync('git config --local user.email "github-actions[bot]@users.noreply.github.com"');
      execSync('git config --local user.name "github-actions[bot]"');
      execSync('git add public/data/catalog.json');
      execSync('git diff --staged --quiet || git commit -m "sync(donghua): progreso [skip ci]"');
      execSync('git pull --rebase origin main || true');
      execSync('git push');
      console.log(`\n🚀 Checkpoint subido al repo (${elapsedMin()} min) — a salvo ante cortes\n`);
    } catch (e) {
      console.log('⚠️  Push intermedio falló (se reintenta en el siguiente bloque)');
    }
  });
}

/* ══════════════════════════════════════════════════════════
   TMDB — buscar portada por título
══════════════════════════════════════════════════════════ */

async function tmdbFindPoster(title) {
  if (!TMDB_API_KEY || !title) return null;
  try {
    const q = encodeURIComponent(title);
    const res = await fetch(
      `https://api.themoviedb.org/3/search/multi?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&query=${q}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = data.results || [];
    const hit = results.find(r => r.poster_path);
    if (!hit) return null;
    return `${TMDB_IMG}${hit.poster_path}`;
  } catch { return null; }
}

/* ══════════════════════════════════════════════════════════
   SELFTEST — SYNC_DONGHUA_SELFTEST=1 node syncdonghua.js
══════════════════════════════════════════════════════════ */

function selftest() {
  const eq = (a, b, label) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → ${JSON.stringify(a)}`}`);
    if (!ok) process.exitCode = 1;
  };
  eq(epCode('wu-dong-qian-kun-1-episodio-x8', '/episodios/x'), { season: 1, number: 8 }, 'tiodonghua 1-episodio-x8');
  eq(epCode('beyond-the-timescape-1x7', '/episodios/x'), { season: 1, number: 7 }, 'tiodonghua 1x7');
  eq(epCode('renegade-immortal-episodio-17-5-sub-espanol', '/episodios/x'), { season: 1, number: 17 }, 'episodio 17.5 → 17');
  eq(epCode('wu-geng-ji', '/ver/wu-geng-ji/26'), { season: 1, number: 26 }, 'mundodonghua /ver/slug/26');
  eq(epCode('yuan-long-episodio-12', '/yuan-long-episodio-12/'), { season: 1, number: 12 }, 'seriesdonghua -episodio-12');
  eq(epCode('martial-peak-1-x18', '/episode/x'), { season: 1, number: 18 }, 'donghualife -1-x18');
  eq(epCode('el-inmortal-renegado-2-episodio-x142', '/episode/x'), { season: 2, number: 142 }, 'donghualife t2 x142');
  eq(epCode('martial-peak-episodio-680', '/episode/x'), { season: 1, number: 680 }, 'donghualife -episodio-680');

  eq(titleKey('Martial Peak'), { base: 'martial peak', baseTitle: 'Martial Peak', offset: null }, 'MP sin número');
  eq(titleKey('Martial Peak 5').offset, 5, 'MP5 → offset 5');
  eq(titleKey('Wu Dong Qian Kun 3').base, 'wu dong qian kun', 'WDKQ3 base');
  eq(titleKey('Quanzhi Fashi 5 Sub Español').base, 'quanzhi fashi', 'strip sub español + offset 5');
  eq(titleKey('Battle Through the Heavens').offset, null, 'sin número → null');
  eq(mapSeason(1, 5), 5, 'variante "Serie 5" temp 1 → temp 5');
  eq(mapSeason(3, 5), 3, 'temp explícita se respeta');

  eq(isPlayableAbs('https://ok.ru/video/123'), true, 'ok.ru');
  eq(isPlayableAbs('https://tiodonghua.lat/player/tio.php?id=88'), true, 'player mismo dominio');
  eq(isPlayableAbs('https://www.mundodonghua.com/donghua/wu-geng-ji'), false, 'enlace normal rechazado');
  eq(isPlayableAbs('https://tiodonghua.lat/wp-content/uploads/poster.jpg'), false, 'imagen rechazada');
  eq(isPlayableAbs('https://fembed.com/v/abc'), true, 'fembed');
  console.log('\nSelftest terminado.');
}

/* ══════════════════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════════════ */

async function runPool(items, workers, fn, shouldStop = () => false) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !shouldStop()) {
      const it = items[i++];
      try { await fn(it); }
      catch (e) { console.log(`   ⚠️ ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

async function main() {
  console.log('\n==============================================');
  console.log('🚀 DONGHUA SYNC MULTI-FUENTE');
  console.log(`   fuentes: ${SOURCES.map(s => s.id).join(', ')}`);
  console.log(`   workers: ${WORKERS} · tope episodios: ${MAX_EPISODE_CRAWLS} · tope tiempo: ${MAX_RUNTIME_MS / 60000} min`);
  console.log('==============================================\n');

  const db = await loadCatalog();
  const startedAt = new Date().toISOString();

  /* ── Fase 1: descubrimiento ── */
  const tasks = [];
  for (const source of SOURCES) {
    if (timeUp()) { console.log('⏱️  Presupuesto agotado antes del descubrimiento'); break; }
    console.log(`\n🔎 Descubriendo [${source.id}]…`);
    let urls = [];
    try { urls = await discoverSource(source); }
    catch (e) { console.log(`❌ [${source.id}] descubrimiento falló: ${e.message}`); }
    for (const u of urls) tasks.push({ source, url: u });
  }

  console.log(`\n📚 Total de fichas de serie a analizar: ${tasks.length}`);

  /* ── Fase 2a: analizar fichas (paralelo) ── */
  const raws = [];
  let done = 0;
  await runPool(tasks, WORKERS, async ({ source, url }) => {
    const r = await scrapeSeriesPage(source, url);
    raws.push(r);
    done++;
    if (done % 25 === 0) console.log(`   📄 ${done}/${tasks.length} fichas analizadas (${elapsedMin()} min)`);
  }, timeUp);

  console.log(`\n📚 Fichas analizadas OK: ${raws.length}`);

  /* ── Fase 2b: fusionar duplicados entre webs ── */
  const existingById = new Map(db.series.map(s => [s.id, s]));
  const existingByBase = new Map();
  for (const s of db.series) {
    const k = titleKey(s.title).base;
    if (!existingByBase.has(k)) existingByBase.set(k, s.id);
  }
  const existingSeasonsByNum = new Map();
  for (const s of db.seasons) {
    if (s.seriesId && Number.isFinite(Number(s.number))) {
      existingSeasonsByNum.set(`${s.seriesId}|${Number(s.number)}`, s.id);
    }
  }
  const existingEp = new Map(); // `${seasonId}|${number}` → episodio
  for (const e of db.episodes) {
    existingEp.set(`${e.seasonId}|${Number(e.number)}`, e);
  }

  raws.sort((a, b) => a.priority - b.priority);

  const canons = new Map(); // baseKey → canon
  const allGenres = new Set(db.genres);

  for (const r of raws) {
    const { base, baseTitle, offset } = r.key;
    if (!base) continue;

    let canon = canons.get(base);
    if (!canon) {
      const exId = existingByBase.get(base) || (existingById.has(r.slug) ? r.slug : null);
      canon = {
        id: exId || r.slug,
        hasPlainTitle: offset == null,
        series: {
          id: exId || r.slug,
          slug: exId || r.slug,
          title: baseTitle,
          image: null, synopsis: null, status: null,
          year: null, genres: [], type: 'donghua',
          sourceUrls: [], updatedAt: new Date().toISOString()
        },
        epMap: new Map() // "seasonFinal|number" → {season, number, urls:[]}
      };
      canons.set(base, canon);
    }

    /* Si llega una variante sin número ("Martial Peak") su título
       limpio pisa al de la variante numerada. */
    if (offset == null && !canon.hasPlainTitle) {
      canon.hasPlainTitle = true;
      canon.series.title = baseTitle;
    }

    const S = canon.series;
    if (!S.image && r.parsed.image) S.image = r.parsed.image;
    if ((!S.synopsis || S.synopsis.length < 60) && r.parsed.synopsis) S.synopsis = r.parsed.synopsis;
    if (!S.status && r.parsed.status) S.status = r.parsed.status;
    if (!S.year && r.parsed.year) S.year = r.parsed.year;
    for (const g of r.parsed.genres) if (!S.genres.includes(g)) S.genres.push(g);
    if (!S.sourceUrls.includes(r.url)) S.sourceUrls.push(r.url);

    for (const c of r.candidates) {
      const seasonFinal = mapSeason(c.season, offset);
      const k = `${seasonFinal}|${c.number}`;
      if (!canon.epMap.has(k)) canon.epMap.set(k, { season: seasonFinal, number: c.number, urls: [] });
      const slot = canon.epMap.get(k);
      for (const u of c.urls) if (!slot.urls.includes(u)) slot.urls.push(u);
    }
  }

  console.log(`\n🧩 Series únicas tras fusionar: ${canons.size} (de ${raws.length} fichas)`);

  /* ── Series + temporadas al catálogo y cola de episodios ── */
  const epQueue = [];
  let skippedExisting = 0, recrawlEmpty = 0;

  for (const canon of canons.values()) {
    const S = canon.series;
    S.genres.forEach(g => allGenres.add(g));

    const merged = existingById.get(S.id);
    upsert(db.series, {
      ...(merged || {}),
      ...S,
      image: (S.image && S.image.includes('image.tmdb.org')) ? S.image : (S.image || (merged && merged.image) || null),
      updatedAt: new Date().toISOString()
    });

    for (const [k, slot] of canon.epMap) {
      const seasonNum = slot.season;
      let seasonId = existingSeasonsByNum.get(`${S.id}|${seasonNum}`);
      if (!seasonId) {
        seasonId = `${S.id}-t${seasonNum}`;
        upsert(db.seasons, {
          id: seasonId, slug: seasonId, seriesId: S.id,
          number: seasonNum,
          image: S.image || null,
          updatedAt: new Date().toISOString()
        });
        existingSeasonsByNum.set(`${S.id}|${seasonNum}`, seasonId);
      }

      const epKey = `${seasonId}|${slot.number}`;
      const oldEp = existingEp.get(epKey);

      if (oldEp && (oldEp.servers || []).length > 0) {
        skippedExisting++;
        continue;
      }
      if (oldEp) recrawlEmpty++;

      if (epQueue.length >= MAX_EPISODE_CRAWLS) continue;

      epQueue.push({
        seriesId: S.id, seasonId,
        season: seasonNum, number: slot.number,
        urls: slot.urls.slice(0, MAX_URLS_PER_EP)
      });
    }
  }

  console.log(`\n🎬 Episodios ya en catálogo (se respetan): ${skippedExisting}`);
  if (recrawlEmpty) console.log(`↻  Episodios existentes SIN servidores (se reintentan): ${recrawlEmpty}`);
  console.log(`🎬 Episodios a rastrear: ${epQueue.length} (tope ${MAX_EPISODE_CRAWLS})`);

  /* Checkpoint de metadatos ANTES de rastrear episodios:
     aunque el tiempo se agote después, las series ya están a salvo. */
  await saveCatalog(db);
  gitCheckpoint(db);

  /* ── Fase 3: rastrear episodios nuevos (paralelo) ── */
  let newEps = 0, failedEps = 0, crawled = 0;
  let stoppedByBudget = false;

  await runPool(epQueue, WORKERS, async (job) => {
    if (timeUp()) { stoppedByBudget = true; return; }

    const servers = [];
    const seenSrv = new Set();
    let pageTitle = null;

    for (const u of job.urls) {
      if (timeUp()) { stoppedByBudget = true; break; }
      try {
        const html = await fetchHtml(u);
        const parsed = parseEpisode(html, u);
        if (parsed.title) pageTitle = parsed.title;
        for (const s of parsed.servers) {
          if (seenSrv.has(s.url)) continue;
          seenSrv.add(s.url);
          servers.push(s);
        }
      } catch {}
      await sleep(POLITENESS_MS);
    }

    crawled++;
    if (servers.length) {
      upsert(db.episodes, {
        id: `${job.seasonId}-e${job.number}`,
        slug: `${job.seasonId}-e${job.number}`,
        title: pageTitle || `Episodio ${job.number}`,
        sourceUrl: job.urls[0],
        servers,
        seriesId: job.seriesId,
        seasonId: job.seasonId,
        number: job.number,
        updatedAt: new Date().toISOString()
      });
      newEps++;
    } else {
      failedEps++;
    }

    if (crawled % 500 === 0) {
      await saveCatalog(db);
      gitCheckpoint(db);
      console.log(`\n💾 ${crawled}/${epQueue.length} episodios rastreados · +${newEps} nuevos · ${elapsedMin()} min\n`);
    }
  }, () => stoppedByBudget);

  if (stoppedByBudget) {
    console.log(`\n⏱️  Presupuesto de tiempo agotado (${MAX_RUNTIME_MS / 60000} min). Se guarda y se sube lo avanzado; la próxima ejecución retoma.`);
  }

  /* ── Contadores por temporada ── */
  const countBySeason = new Map();
  for (const e of db.episodes) {
    countBySeason.set(e.seasonId, (countBySeason.get(e.seasonId) || 0) + 1);
  }
  for (const s of db.seasons) {
    s.episodeCount = countBySeason.get(s.id) || 0;
  }

  /* ── Fase 4: portadas TMDB ── */
  if (TMDB_API_KEY && !timeUp()) {
    console.log('\n🖼️  Buscando portadas en TMDB…');
    let posters = 0;
    for (const s of db.series) {
      if (timeUp()) break;
      if (s.image && s.image.includes('image.tmdb.org')) continue;
      const poster = await tmdbFindPoster(s.title);
      if (poster) {
        s.image = poster;
        posters++;
        if (posters % 25 === 0) console.log(`   🖼️ ${posters} portadas TMDB…`);
      }
      await sleep(150);
    }
    console.log(`🖼️  Portadas TMDB asignadas: ${posters}`);
  } else if (!TMDB_API_KEY) {
    console.log('\n⚠️  TMDB_API_KEY no definido: se conservan las portadas de las webs.');
  }

  /* ── Guardado final ── */
  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));

  const finishedAt = new Date().toISOString();
  db.meta = {
    ...(db.meta || {}),
    version: 5,
    source: 'multi:' + SOURCES.map(s => s.id).join('+'),
    syncedAt: finishedAt,
    lastSync: {
      status: 'success',
      type: 'full',
      startedAt, finishedAt, error: null,
      stoppedByBudget,
      series: db.series.length,
      seasons: db.seasons.length,
      episodes: db.episodes.length,
      newEpisodes: newEps,
      crawled, failedEps
    }
  };

  await saveCatalog(db);
  gitCheckpoint(db);

  console.log('\n====================================================');
  console.log('🎉 SYNC MULTI-FUENTE TERMINADO');
  console.log('====================================================');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`📖 Temporadas: ${db.seasons.length}`);
  console.log(`🎬 Episodios: ${db.episodes.length} (+${newEps} nuevos, ${failedEps} sin servidores)`);
  console.log(`⏱️  Duración: ${elapsedMin()} min`);
  console.log('====================================================\n');
}

/* ── Arranque ── */
if (process.env.SYNC_DONGHUA_SELFTEST === '1') {
  selftest();
} else {
  main().catch(async e => {
    console.error('\n💥 ERROR FATAL:', e);
    try {
      const db = await loadCatalog();
      db.meta = {
        ...(db.meta || {}),
        lastSync: {
          status: 'error',
          finishedAt: new Date().toISOString(),
          error: e.message
        }
      };
      await saveCatalog(db);
    } catch {}
    process.exitCode = 1;
  });
}
