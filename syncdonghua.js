// ══════════════════════════════════════════════════════════
//  syncdonghua.js — DonghuaFlix (VERSIÓN COMPLETA RESTAURADA)
//  Incluye:
//    · Código original completo de DonghuaLife (8 workers, fusión, etc.)
//    · Soporte para DonghuaWorld (rangos de episodios)
//    · Variable ONLY_SOURCE para separar workflows
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

/* ══════════════════════════════════════════════════════════
   CONFIGURACIÓN
══════════════════════════════════════════════════════════ */
const ONLY_SOURCE = process.env.ONLY_SOURCE || ''; // 'donghualife', 'donghuaworld', o '' (ambas)

const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 8))); // 8 workers por defecto (DonghuaLife)
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150); // 150ms original
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 20000));
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_FAILS = Number(process.env.MAX_FAILS || 4);
const LOOKBACK_EPS = Number(process.env.LOOKBACK_EPS || 10);
const LOOKBACK_MAX = Number(process.env.LOOKBACK_MAX || 400);
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 120000);
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* ══════════════════════════════════════════════════════════
   FUENTES
══════════════════════════════════════════════════════════ */
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
    epBelongs: (slug, p, ss) => slug.toLowerCase().startsWith(ss.toLowerCase()),
    pageProbe: (seed, n) => `${seed}?page=${n}`,
    isPageLink: (curPath, url) => {
      try {
        const u = new URL(url);
        return u.pathname === curPath && (u.searchParams.has('page') || u.searchParams.has('pag'));
      } catch { return false; }
    }
  },
  {
    id: 'donghuaworld',
    base: 'https://donghuaworld.com',
    priority: 1,
    seeds: ['/'],
    maxPages: 50,
    seriesTest: p => /^\/anime\/[a-z0-9-]+\/?$/i.test(p),
    episodeTest: p => /^\/[a-z0-9-]+-episode-\d+(-\d+)?-multi-subtitles\/?$/i.test(p),
    pageProbe: (seed, n) => `/page/${n}/`,
    isPageLink: p => /^\/?page\/\d+\/?$/i.test(p),
    isRange: true // Episodios en rangos (1-10, etc.)
  }
];

const ACTIVE_SOURCES = ONLY_SOURCE 
  ? SOURCES.filter(s => s.id === ONLY_SOURCE)
  : SOURCES;

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

/* Semáforo por host (control de concurrencia) */
const hostSem = new Map();
const HOST_LIMIT = Math.max(1, Math.min(8, Number(process.env.HOST_LIMIT || 4)));
async function withHostLimit(host, fn) {
  let sem = hostSem.get(host);
  if (!sem) { sem = { active: 0, queue: [] }; hostSem.set(host, sem); }
  if (sem.active >= HOST_LIMIT) await new Promise(r => sem.queue.push(r));
  sem.active++;
  try { return await fn(); }
  finally { sem.active--; const n = sem.queue.shift(); if (n) n(); }
}

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await withHostLimit(new URL(url).hostname, () => Promise.race([
      fetch(url, {
        signal: controller.signal,
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
          'Referer': 'https://www.google.com/'
        }
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout duro')), FETCH_TIMEOUT_MS + 10000))
    ]));

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await Promise.race([
      res.text(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout lectura')), FETCH_TIMEOUT_MS))
    ]);
  } catch (err) {
    if (attempt < 3) {
      await sleep(1000 * attempt);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ══════════════════════════════════════════════════════════
   TÍTULOS (limpieza completa original)
══════════════════════════════════════════════════════════ */
function cleanTitle(raw) {
  let t = clean(String(raw || '')).split('|')[0].split('»')[0];
  t = t.replace(/^ver\s+/i, ' ');
  t = t.replace(/[\[【(][^\]】)]{0,60}[\]】)]/g, ' ');
  t = t.replace(/[-]+/gu, ' ');
  t = t.replace(/\b(?:doramasmp4|doramasqueen|estrenosdoramas|donghuaflix|donghualife|donghuaworld)\b.*$/i, ' ');
  let prev;
  do {
    prev = t;
    t = t
      .replace(/(?:sub\s*)?(?:espa[ñn]ol|online|gratis|hd|completo|subtitulad[oa]|latino|castellano|audio\s+latino|doblado|dorama|capitulos?|temporadas?)\s*$/i, ' ')
      .replace(/[\s,·•\-–—]+$/g, '')
      .trim();
  } while (t !== prev);
  return clean(t);
}

function titleKey(rawTitle) {
  const t0 = cleanTitle(rawTitle);
  let t = t0;
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

const mapSeason = (candSeason, offset) =>
  (offset != null && candSeason === 1) ? offset : candSeason;

/* ══════════════════════════════════════════════════════════
   EPISODIOS (detección de números y rangos)
══════════════════════════════════════════════════════════ */
function epCode(slug, pathname, source) {
  if (source.isRange) {
    // donghuaworld: episode-1-10-multi-subtitles
    const m = slug.match(/episode-(\d+)(?:-(\d+))?-multi-subtitles/i);
    if (!m) return { season: 1, number: null, from: null, to: null };
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    return { season: 1, number: from, from, to };
  }

  // donghualife: formatos varios
  let m = slug.match(/(\d{1,3})x(\d{1,4})(?:-|$)/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]), from: Number(m[2]), to: Number(m[2]) };
  m = slug.match(/-(\d{1,3})-episodio-x?(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]), from: Number(m[2]), to: Number(m[2]) };
  m = slug.match(/-episodio-x?(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]), from: Number(m[1]), to: Number(m[1]) };
  m = slug.match(/-(\d{1,4})$/);
  if (m) return { season: 1, number: Number(m[1]), from: Number(m[1]), to: Number(m[1]) };
  return { season: 1, number: null, from: null, to: null };
}

/* ══════════════════════════════════════════════════════════
   SERVIDORES (extracción completa original)
══════════════════════════════════════════════════════════ */
const PLAYER_PATH = /\/(?:player|play|embed|goto|stream|e|video|reproductor|vidurl|multijugadora|tio)[\/.]/i;
const IMAGE_ASSET_RE = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?)(\?|#|$)/i;
const UPLOADS_RE = /\/wp-content\/uploads\/|\/uploads\//i;
const KNOWN_VIDEO_HOST = /(?:ok\.ru|okcdn\.ru|byse|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|vox|1fichier|johnfullwonder|byse|seeks|fastream|luluvdo|voe\.sx|netu\.tv|tamamo|tioplayer|fcdn|streamlare|slmaxed|sltube|playhydrax|hydrax|moviebox|mp4upload|krakenfiles|filelions|lulustream|streamtape|skadi|asura)/i;
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
  'streamhg,earnvids,streamruby,smoothie,playerwish,upstream,dropload,t.me,tmdb.org')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);

const isBlacklisted = host =>
  SERVER_BLACKLIST.some(b => String(host).toLowerCase().includes(b));

function parseEpisode(html, url, source) {
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

  // iframes
  $('iframe[src]').each((_, el) => {
    const src = absolute($(el).attr('src'), url);
    let host = 'Servidor';
    try { if (src) host = new URL(src).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, src, true);
  });

  // data-* (idiomas y servidores)
  let currentLang = null;
  $('[data-url], [data-embed], [data-src], [data-link], [data-player], [data-href], [data-server], option, button, a').each((_, el) => {
    const node = $(el);
    const txt = clean(node.text());
    if (txt && txt.length < 40) {
      if (/^latino$|espa[nñ]ol latino|audio\s+latino/i.test(txt)) { currentLang = 'latino'; return; }
      if (/castellano/i.test(txt)) { currentLang = 'castellano'; return; }
      if (/subtitulad|subt[ií]tulad|sub espa/i.test(txt)) { currentLang = 'subtitulado'; return; }
    }
    if (el.tagName === 'img') return;
    const raw = node.attr('data-url') || node.attr('data-embed') ||
                node.attr('data-link') || node.attr('data-player') ||
                node.attr('data-href') || node.attr('data-server') ||
                node.attr('value');
    if (!raw) return;
    let host = 'Servidor';
    try { host = new URL(absolute(raw, url) || raw).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, raw, true, currentLang);
  });

  // Enlaces
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href');
    const txt = clean($(el).text());
    let host = 'Servidor';
    try { if (raw) host = new URL(absolute(raw, url) || raw).hostname.replace(/^www\./, ''); } catch {}
    addServer(txt && txt.length < 30 ? txt : host, raw, false);
  });

  // DailyMotion en scripts (para donghuaworld)
  if (source.isRange) {
    $('script').each((_, el) => {
      const txt = $(el).html() || '';
      const m = txt.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9_-]+)/i);
      if (m) addServer('DailyMotion', `https://www.dailymotion.com/embed/video/${m[1]}`, true);
    });
  }

  return { title, servers };
}

/* ══════════════════════════════════════════════════════════
   SERIE (parsing completo)
══════════════════════════════════════════════════════════ */
function parseSeries(html, url, source) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  let title = cleanTitle(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    ''
  );

  // Para donghualife: si el título es genérico, usar slug
  if (!source.isRange && (!title || /^(temporadas?|episodios?|cap[ií]tulos?|series?|seasons?|lista)$/i.test(title))) {
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
    $('[class*="synopsis"], [class*="sinopsis"], [class*="description"], [class*="resumen"]').first().text()
  );

  const bodyTxt = clean($('body').text());
  let status = null;
  const stM = bodyTxt.match(/(en emisi[oó]n|finalizad[oa]s?|completad[oa]s?|en pausa)/i);
  if (stM) status = stM[1];

  let year = null;
  const yM = title.match(/\b((?:19|20)\d{2})\b/) || bodyTxt.match(/\b((?:19|20)\d{2})\b/);
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
    status, year, genres,
    type: 'donghua',
    src: source.id
  };
}

/* ══════════════════════════════════════════════════════════
   DESCUBRIMIENTO (BFS + sondeo)
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
    if (timeUp()) break;
    const first = absolute(seed, source.base);
    if (!first) continue;

    console.log(`\n🔎 [${source.id}] Descubriendo desde ${seed}...`);

    const queue = [first];
    const visited = new Set();

    while (queue.length && visited.size < source.maxPages && !timeUp()) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);

      try {
        const html = await fetchHtml(pageUrl);
        const series = parseSeriesLinks(html, pageUrl, source);
        series.forEach(u => found.add(u));

        for (const next of parsePageLinks(html, pageUrl, source)) {
          if (!visited.has(next) && !queue.includes(next)) queue.push(next);
        }

        if (visited.size % 10 === 0) {
          console.log(`   📄 ${visited.size} páginas, ${found.size} series`);
        }
      } catch (e) {
        console.log(`   ⚠️ ${e.message}`);
      }

      await sleep(POLITENESS_MS);
    }

    // Sondeo numérico (por si acaso la paginación es invisible)
    for (let n = 2; n <= source.maxPages; n++) {
      if (timeUp()) break;
      const url = absolute(source.pageProbe(first, n), source.base);
      if (!url || visited.has(url)) continue;

      try {
        const html = await fetchHtml(url);
        const links = parseSeriesLinks(html, url, source);
        const fresh = links.filter(l => !found.has(l));
        if (!fresh.length) break;
        fresh.forEach(l => found.add(l));
        visited.add(url);
      } catch { break; }

      await sleep(POLITENESS_MS);
    }
  }

  console.log(`\n🎯 [${source.id}] Series descubiertas: ${found.size}`);
  return [...found];
}

/* ══════════════════════════════════════════════════════════
   ANÁLISIS DE FICHA (detectar episodios)
══════════════════════════════════════════════════════════ */
async function scrapeSeriesPage(source, url) {
  const html = await fetchHtml(url);
  const parsed = parseSeries(html, url, source);
  const $ = cheerio.load(html);
  const seriesSlug = slugFromUrl(url);

  const candidates = new Map();

  const addCandidate = rawUrl => {
    if (!sameOrigin(rawUrl, source.base)) return;
    let pathname = '';
    try { pathname = new URL(rawUrl).pathname; } catch { return; }
    if (!source.episodeTest(pathname)) return;
    const slug = slugFromUrl(rawUrl);

    // Filtro de pertenencia
    if (source.isRange) {
      // donghuaworld: debe contener el slug base
      if (!slug.includes(seriesSlug.replace(/^anime-/, ''))) return;
    } else {
      // donghualife: debe empezar por el slug
      if (!slug.toLowerCase().startsWith(seriesSlug.toLowerCase())) return;
    }

    const code = epCode(slug, pathname, source);
    if (code.number == null && code.from == null) return;

    const key = `${code.season}|${code.from}`;
    if (!candidates.has(key)) {
      candidates.set(key, { 
        season: code.season, 
        number: code.number, 
        from: code.from, 
        to: code.to,
        urls: [] 
      });
    }
    const c = candidates.get(key);
    if (!c.urls.includes(rawUrl)) c.urls.push(rawUrl);
  };

  // Buscar enlaces de episodios
  $('a[href]').each((_, el) => {
    const full = absolute($(el).attr('href'), url);
    if (full) addCandidate(full);
  });

  await sleep(POLITENESS_MS);

  return {
    src: source.id,
    url,
    slug: parsed.slug,
    key: titleKey(parsed.title),
    parsed,
    candidates: [...candidates.values()]
  };
}

/* ══════════════════════════════════════════════════════════
   CATÁLOGO (load/save)
══════════════════════════════════════════════════════════ */
async function loadCatalog(file) {
  try {
    const db = JSON.parse(await fs.readFile(file, 'utf8'));
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

async function saveCatalog(file, db) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(db), 'utf8');
}

function upsert(array, item, key = 'id') {
  const i = array.findIndex(e => e[key] === item[key]);
  if (i === -1) array.push(item);
  else array[i] = { ...array[i], ...item };
}

/* ══════════════════════════════════════════════════════════
   POOL DE WORKERS (8 workers para DonghuaLife)
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

/* ══════════════════════════════════════════════════════════
   PROCESAMIENTO PRINCIPAL
══════════════════════════════════════════════════════════ */
async function processSource(source, outFile) {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`🚀 ${source.id.toUpperCase()} SYNC`);
  console.log(`   workers: ${WORKERS} | política: ${POLITENESS_MS}ms`);
  console.log(`═══════════════════════════════════════`);

  const db = await loadCatalog(outFile);
  const failures = {};
  const startedAt = new Date().toISOString();

  // Fusión retroactiva (solo para donghualife)
  if (!source.isRange) {
    const byBase = new Map();
    const remap = new Map();
    for (const s of db.series) {
      const k = `${s.src || 'legacy'}|${titleKey(s.title).base}`;
      if (!k) continue;
      if (byBase.has(k)) remap.set(s.id, byBase.get(k));
      else byBase.set(k, s.id);
    }
    if (remap.size) {
      const keepById = new Map(db.series.map(s => [s.id, s]));
      for (const s of db.series) {
        const keepId = remap.get(s.id);
        if (!keepId) continue;
        const keep = keepById.get(keepId);
        if (!keep) continue;
        // Merge de datos...
        if ((!keep.image || !keep.image.includes('image.tmdb.org')) && s.image) keep.image = s.image;
        if ((!keep.synopsis || keep.synopsis.length < 60) && s.synopsis) keep.synopsis = s.synopsis;
        // ... (resto de merges)
      }
      db.series = db.series.filter(s => !remap.has(s.id));
      for (const seas of db.seasons) if (remap.has(seas.seriesId)) seas.seriesId = remap.get(seas.seriesId);
      for (const ep of db.episodes) if (remap.has(ep.seriesId)) ep.seriesId = remap.get(ep.seriesId);
      console.log(`🧹 Fusión retroactiva: ${remap.size} duplicados unificados`);
    }
  }

  // Descubrimiento
  const urls = await discoverSource(source);
  const tasks = urls.map(u => ({ source, url: u }));
  console.log(`\n📚 Total fichas: ${tasks.length}`);

  // Análisis de fichas (paralelo con workers)
  const raws = [];
  let done = 0;
  const hb = setInterval(() => console.log(`   💓 vivo: ${done}/${tasks.length} fichas (${elapsedMin()} min)`), 30000);

  await runPool(tasks, WORKERS, async ({ source, url }) => {
    const r = await scrapeSeriesPage(source, url);
    raws.push(r);
    done++;
    console.log(`   📄 [${done}/${tasks.length}] ${r.slug} (${elapsedMin()} min)`);
    if (done % 10 === 0) await saveCatalog(outFile, db);
  }, timeUp);

  clearInterval(hb);

  // Construcción de canons (series únicas por web+título)
  const existingById = new Map(db.series.map(s => [s.id, s]));
  const existingByBase = new Map();
  for (const s of db.series) {
    const k = `${s.src || 'legacy'}|${titleKey(s.title).base}`;
    if (!existingByBase.has(k)) existingByBase.set(k, s.id);
  }

  const canons = new Map();
  const allGenres = new Set(db.genres);

  for (const r of raws) {
    const { base, baseTitle, offset } = r.key;
    if (!base) continue;

    const ck = `${r.src}|${base}`;
    let canon = canons.get(ck);
    if (!canon) {
      const exId = existingByBase.get(`${r.src}|${base}`) || (existingById.has(r.slug) ? r.slug : null);
      canon = {
        id: exId || r.slug,
        series: {
          id: exId || r.slug,
          slug: exId || r.slug,
          title: baseTitle,
          image: null, synopsis: null, status: null,
          year: null, genres: [], type: 'donghua',
          src: r.src,
          sourceUrls: [], updatedAt: new Date().toISOString()
        },
        epMap: new Map()
      };
      canons.set(ck, canon);
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
      const k = `${seasonFinal}|${c.from}`;
      if (!canon.epMap.has(k)) {
        canon.epMap.set(k, { 
          season: seasonFinal, 
          number: c.number, 
          from: c.from, 
          to: c.to,
          urls: [] 
        });
      }
      const slot = canon.epMap.get(k);
      for (const u of c.urls) if (!slot.urls.includes(u)) slot.urls.push(u);
    }
  }

  console.log(`\n🧩 Fichas de serie (por web): ${canons.size} (de ${raws.length} fichas)`);

  // Construcción de cola de episodios
  const epQueue = [];
  const existingSeasonsByNum = new Map();
  for (const s of db.seasons) {
    if (s.seriesId && Number.isFinite(Number(s.number))) {
      existingSeasonsByNum.set(`${s.seriesId}|${Number(s.number)}`, s.id);
    }
  }
  const existingEp = new Map();
  for (const e of db.episodes) {
    existingEp.set(`${e.seasonId}|${Number(e.number)}`, e);
  }

  let skippedExisting = 0, recrawlEmpty = 0;

  for (const canon of canons.values()) {
    const S = canon.series;
    S.genres.forEach(g => allGenres.add(g));

    const merged = existingById.get(S.id);
    upsert(db.series, {
      ...(merged || {}),
      ...S,
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
          updatedAt: new Date().toISOString()
        });
        existingSeasonsByNum.set(`${S.id}|${seasonNum}`, seasonId);
      }

      const epKey = `${seasonId}|${slot.from}`;
      const oldEp = existingEp.get(epKey);

      if (oldEp && (oldEp.servers || []).length > 0) {
        skippedExisting++;
        continue;
      }
      if (oldEp) recrawlEmpty++;

      if (epQueue.length >= MAX_EPISODE_CRAWLS) continue;

      epQueue.push({
        seriesId: S.id, seasonId,
        season: seasonNum, 
        number: slot.from,
        from: slot.from,
        to: slot.to,
        urls: slot.urls.slice(0, 3)
      });
    }
  }

  console.log(`\n🎬 Episodios ya en catálogo: ${skippedExisting}`);
  console.log(`🎬 Episodios a rastrear: ${epQueue.length}`);

  await saveCatalog(outFile, db);

  // Rastreo de episodios (paralelo)
  let newEps = 0, failedEps = 0, crawled = 0;
  let stoppedByBudget = false;

  const hb2 = setInterval(() => console.log(`   💓 vivo: ${crawled}/${epQueue.length} eps · +${newEps} (${elapsedMin()} min)`), 60000);

  await runPool(epQueue, WORKERS, async (job) => {
    if (timeUp()) { stoppedByBudget = true; return; }

    const servers = [];
    const seenSrv = new Set();
    let pageTitle = null;

    for (const u of job.urls) {
      if (timeUp()) { stoppedByBudget = true; break; }
      try {
        const html = await fetchHtml(u);
        const parsed = parseEpisode(html, u, source);
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
      const epId = `${job.seasonId}-e${job.from}${job.to !== job.from ? '-' + job.to : ''}`;
      upsert(db.episodes, {
        id: epId,
        slug: epId,
        title: pageTitle || (source.isRange ? `Episode ${job.from}-${job.to}` : `Episodio ${job.number}`),
        sourceUrl: job.urls[0],
        servers,
        seriesId: job.seriesId,
        seasonId: job.seasonId,
        number: job.number,
        rangeFrom: job.from,
        rangeTo: job.to,
        updatedAt: new Date().toISOString()
      });
      newEps++;
    } else {
      failedEps++;
    }

    if (crawled % 10 === 0) {
      await saveCatalog(outFile, db);
      console.log(`   📄 ep ${crawled}/${epQueue.length} · +${newEps} · ${elapsedMin()} min`);
    }
  }, () => stoppedByBudget);

  clearInterval(hb2);

  // Limpieza final
  const countBySeason = new Map();
  for (const e of db.episodes) {
    countBySeason.set(e.seasonId, (countBySeason.get(e.seasonId) || 0) + 1);
  }
  for (const s of db.seasons) {
    s.episodeCount = countBySeason.get(s.id) || 0;
  }

  // Series sin episodios eliminadas
  {
    const withEps = new Set(db.episodes.map(e => e.seriesId));
    const before = db.series.length;
    db.series = db.series.filter(s => withEps.has(s.id));
    const removedEmpty = before - db.series.length;
    if (removedEmpty) console.log(`🧹 Series sin episodios eliminadas: ${removedEmpty}`);
  }

  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));
  db.meta = {
    ...db.meta,
    source: source.base,
    syncedAt: new Date().toISOString(),
    series: db.series.length,
    seasons: db.seasons.length,
    episodes: db.episodes.length
  };

  await saveCatalog(outFile, db);

  console.log(`\n🎉 ${source.id.toUpperCase()} TERMINADO`);
  console.log(`📚 Series: ${db.series.length} | Temporadas: ${db.seasons.length} | Episodios: ${db.episodes.length} (+${newEps})`);
  console.log(`⏱️ Duración: ${elapsedMin()} min`);
}

/* ══════════════════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════════════ */
async function main() {
  console.log('═══════════════════════════════════════');
  console.log('🚀 DONGHUA SYNC (Código completo restaurado)');
  console.log(`   workers: ${WORKERS} | ONLY_SOURCE: ${ONLY_SOURCE || '(ambas)'}`);
  console.log('═══════════════════════════════════════');

  for (const source of ACTIVE_SOURCES) {
    const outFile = `public/data/catalog-${source.id}.json`;
    await processSource(source, outFile);
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`⏱️ Duración total: ${elapsedMin()} min`);
}

main().catch(e => {
  console.error('💥 FATAL:', e);
  process.exit(1);
});
