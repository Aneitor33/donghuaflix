// ══════════════════════════════════════════════════════════
//  sync-dramasflix.js — DonghuaFlix
//  Scraper del catálogo de dramas desde:
//    · https://doramasflix.io/paises/china  (tema WordPress DooPlay)
//
//  Arquitectura heredada de syncdoramas.js / sync-source.js:
//   - Descubrimiento con paginación BFS + sondeo numérico /page/N/.
//   - Series (/doramas|/series/) y películas (/peliculas|/movies): cada
//     película = 1 entrada tipo 'movie' con 1 episodio (la película).
//   - La ficha NO lista episodios (JS) → se parsean los enlaces que haya
//     y se sintetizan /episodios/{slug}-…-{n}/ validados por rastreo.
//   - Extracción de servidores multi-método: iframes, atributos data-*,
//     options/botones/enlaces, mp4/m3u8 directos, hosts conocidos y las
//     pestañas del reproductor DooPlay (data-post/data-nume →
//     admin-ajax.php action=doo_player_ajax → embed_url).
//   - Limpieza de títulos de la plantilla de la web.
//   - Portadas TMDB (es-ES) como mejora; se respeta la de la web.
//   - Incremental: raws + failures + checkpoints git con push (máx 1/10min)
//     + tope de tiempo. FRESH=1 reinicia el catálogo.
//   - Selftest: FLIX_SELFTEST=1 node sync-dramasflix.js
//
//  Genera public/data/catalog-dramasflix.json (mismo formato de db que
//  los demás catálogos → compatible con app.js / split-catalog.js).
//
//  Variables de entorno:
//    WORKERS=5  POLITENESS_MS=200  HOST_LIMIT=2  MAX_RUNTIME_MINUTES=300
//    MAX_EPISODE_CRAWLS=20000  SYNTH_DEFAULT_EPS=16
//    TMDB_API_KEY=...   FRESH=1
//    FLIX_PROXY_URL / FLIX_PROXY_KEY (si GitHub recibe 403; igual esquema
//    que DORAMAS_PROXY_URL en syncdoramas.js)
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as cheerio from 'cheerio';

const OUT_FILE = path.resolve('public/data/catalog-dramasflix.json');
const FAILURES_FILE = path.resolve('public/data/catalog-dramasflix-failures.json');
const RAWS_FILE = path.resolve('public/data/catalog-dramasflix-raws.json');

const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 5)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 200);
const HOST_LIMIT = Math.max(1, Math.min(8, Number(process.env.HOST_LIMIT || 2)));
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 20000));
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const SYNTH_DEFAULT_EPS = Math.max(1, Math.min(100, Number(process.env.SYNTH_DEFAULT_EPS || 24)));
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 120000);
const FETCH_RETRIES = 3;
const FRESH = process.env.FRESH === '1';

/* Proxy opcional si la web bloquea las IPs de GitHub (403) */
const PROXY_URL = (process.env.FLIX_PROXY_URL || process.env.DORAMAS_PROXY_URL || '').replace(/\/+$/, '');
const PROXY_KEY = process.env.FLIX_PROXY_KEY || process.env.DORAMAS_PROXY_KEY || '';
const PROXY_HOSTS = (process.env.FLIX_PROXY_HOSTS || process.env.PROXY_HOSTS || 'doramasflix.io,www.doramasflix.io')
  .split(',').map(s => s.trim()).filter(Boolean);

const hostSem = new Map();
const hostFails = new Map();
const logged403 = new Set();
async function withHostLimit(host, fn) {
  let sem = hostSem.get(host);
  if (!sem) { sem = { active: 0, queue: [] }; hostSem.set(host, sem); }
  if (sem.active >= HOST_LIMIT) await new Promise(r => sem.queue.push(r));
  sem.active++;
  try { return await fn(); }
  finally { sem.active--; const n = sem.queue.shift(); if (n) n(); }
}

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* ══════════════════════════════════════════════════════════
   FUENTE — doramasflix.io (DooPlay)
══════════════════════════════════════════════════════════ */

const SOURCE = {
  id: 'dramasflix',
  base: 'https://doramasflix.io',
  seeds: ['/paises/china'],
  maxPages: 80,
  seriesTest: p => /^\/(dorama|doramas|series|tv-shows?|programas)\/(?!page\/)[a-z0-9-]+\/?$/i.test(p) &&
                    !/\/temporada\//.test(p),
  movieTest:  p => /^\/(pelicula|peliculas|movies|films)\/(?!page\/)[a-z0-9-]+\/?$/i.test(p),
  episodeTest: p => /^\/(episodios|episodes|ver)\/[a-z0-9-]+/i.test(p),
  isPageLink: p => /\/page\/\d+\/?$/.test(p) || /[?&]page=\d+/.test(p),
  pageProbe: (seed, n) => `${seed.replace(/\/+$/, '')}?page=${n}`,
  epBelongs: (epSlug, seriesSlug) =>
    epSlug.toLowerCase().startsWith(seriesSlug.toLowerCase()),
  synthUrl: (slug, n) => `/episodios/${slug}-1x${n}/`
};

/* ══════════════════════════════════════════════════════════
   UTILIDADES
══════════════════════════════════════════════════════════ */

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function absolute(raw, base) {
  if (!raw) return null;
  const v = String(raw).trim();
  if (!v || /^(javascript:|mailto:|tel:|#)/i.test(v)) return null;
  try { return new URL(v, base).href; } catch { return null; }
}
function sameOrigin(url, base) {
  try { return new URL(url).origin === new URL(base).origin; } catch { return false; }
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
    let target = url;
    let proxied = false;
    try {
      if (PROXY_URL && PROXY_KEY && PROXY_HOSTS.includes(new URL(url).hostname)) {
        target = `${PROXY_URL}/?u=${encodeURIComponent(url)}`;
        proxied = true;
      }
    } catch {}

    const reqPromise = fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: proxied ? { 'x-proxy-key': PROXY_KEY } : {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.7,en;q=0.6',
        'Referer': 'https://www.google.com/',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    reqPromise.catch(() => {});
    const res = await withHostLimit(new URL(url).hostname, () => Promise.race([
      reqPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout duro')), FETCH_TIMEOUT_MS + 10000))
    ]));
    if (proxied && attempt === 1 && !res.ok) {
      console.log(`   🔀 Proxy respondió ${res.status} para ${url}`);
    }
    if (!res.ok) {
      if (res.status === 403) {
        const host = new URL(url).hostname;
        if (!logged403.has(host)) {
          logged403.add(host);
          const body = await res.text().catch(() => '');
          console.log(`   🛡️ 403 en ${host}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
          if (PROXY_URL) console.log('   💡 Hay proxy configurado; si persiste, revisa FLIX_PROXY_KEY.');
          else console.log('   💡 Configura FLIX_PROXY_URL/FLIX_PROXY_KEY en los secrets del repo para enrutar por proxy.');
        }
      }
      if (attempt < FETCH_RETRIES && [408, 425, 429, 500, 502, 503, 504].includes(res.status)) {
        await sleep(1000 * attempt);
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} en ${url}`);
    }
    try { hostFails.set(new URL(url).hostname, 0); } catch {}
    const txtPromise = res.text();
    txtPromise.catch(() => {});
    return await Promise.race([
      txtPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout de lectura')), FETCH_TIMEOUT_MS))
    ]);
  } catch (err) {
    try {
      const msg = String((err && err.message) || '');
      if (!msg.includes('HTTP 404')) {
        const h = new URL(url).hostname;
        const f = (hostFails.get(h) || 0) + 1;
        hostFails.set(h, f);
        if (f >= 4) {
          console.log(`   🥵 ${h} nos está limitando: pausa de 45s para enfriar…`);
          await sleep(45000);
          hostFails.set(h, 0);
        }
      }
    } catch {}
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
   TÍTULOS — plantilla tipo:
   "Ver Nombre Del Drama Capitulos Online Sub Español - DoramasFlix"
══════════════════════════════════════════════════════════ */

function cleanTitle(raw) {
  let t = clean(String(raw || '')).split('|')[0].split('»')[0];
  t = t.replace(/^ver\s+/i, ' ');
  t = t.replace(/[\[【(][^\]】)]{0,60}[\]】)]/g, ' ');
  t = t.replace(/\s+capitulos?\s+(?:online|gratis|sub\s+espa.*)$/i, ' ');
  t = t.replace(/\b(?:doramasflix|doramas?\s*flix)\b.*$/i, ' ');
  let prev;
  do {
    prev = t;
    t = t
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+/gu, ' ')
      .replace(/(?:sub\s*)?(?:espa[ñn]ol|online|gratis|hd|full\s*hd|completo|completa|subtitulad[oa]|latino|castellano|audio\s+latino|doblado|doblada|pel[ií]cula|capitulos?|temporadas?)\s*$/i, ' ')
      .replace(/[\s,·•\-–—]+$/g, '')
      .trim();
  } while (t !== prev);
  return clean(t);
}

function titleKey(rawTitle) {
  const t0 = cleanTitle(rawTitle);
  let t = t0;
  let offset = null;
  let m = t.match(/^(.*?)[\s\-–—]+(?:temporada|season|parte|part)\s*(\d{1,2})$/i);
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
const mapSeason = (cand, offset) => (offset != null && cand === 1) ? offset : cand;

/* ══════════════════════════════════════════════════════════
   EPISODIOS — número/temporada desde el slug de la URL
   /episodios/pull-strings-1x7/  |  /episodios/x-cap-7/  |  /episodios/x-temporada-2-capitulo-7/
══════════════════════════════════════════════════════════ */

function epCode(slug, pathname) {
  let m = slug.match(/(\d{1,3})x(\d{1,4})(?:-|$)/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = slug.match(/-temporada-(\d{1,3})-cap[ií]tulo-x?(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = slug.match(/-(\d{1,3})-cap[ií]tulo-x?(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = slug.match(/-cap[ií]tulo-x?(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };
  m = slug.match(/-episodio-x?(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };
  m = slug.match(/-cap-x?(\d{1,4})(?:-|$)/i);
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
   SERVIDORES — iframes + data-* + hosts conocidos + AJAX DooPlay
══════════════════════════════════════════════════════════ */

const PLAYER_PATH = /\/(?:player|play|embed|goto|stream|e|video|reproductor|vidurl|multijugadora|tio)[\/.]/i;
const IMAGE_ASSET_RE = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?)(\?|#|$)/i;
const UPLOADS_RE = /\/wp-content\/uploads\/|\/uploads\//i;
const KNOWN_VIDEO_HOST = /(?:ok\.ru|okcdn\.ru|byse|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|vox|1fichier|johnfullwonder|seeks|fastream|luluvdo|voe\.sx|netu\.tv|tamamo|tioplayer|fcdn|streamlare|slmaxed|sltube|playhydrax|hydrax|mp4upload|krakenfiles|filelions|lulustream|streamtape|mixdrop|vidmoly|yourupload|voe)\b/i;
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

function parseServers(html, url) {
  const $ = cheerio.load(html);
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

  let watchUrl = null;
  let selfPath = '';
  try { selfPath = new URL(url).pathname; } catch {}
  $('a[href]').each((_, el) => {
    const raw = $(el).attr('href');
    const txt = clean($(el).text());
    let host = 'Servidor';
    try { if (raw) host = new URL(absolute(raw, url) || raw).hostname.replace(/^www\./, ''); } catch {}
    addServer(txt && txt.length < 30 ? txt : host, raw, false);
    try {
      const full = absolute(raw, url);
      if (full && sameOrigin(full, url) && !watchUrl && raw) {
        const pp = new URL(full).pathname;
        if (pp !== selfPath &&
            (/\/(ver|reproducir|mirar|play|online|video)\//i.test(pp) ||
             /ver online|reproducir|ver ahora|mirar ahora|watch now/i.test(txt))) {
          watchUrl = full;
        }
      }
    } catch {}
  });

  const directRe = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|webm|m3u8)(\?[^\s"'<>\\]*)?/gi;
  for (const m of html.match(directRe) || []) {
    let host = 'Video directo';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, false);
  }
  const hostRe = /https?:\/\/[^\s"'<>\\]*(?:ok\.ru|okcdn\.ru|byse|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|netu|hqq|waaw|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|luluvdo|fastream|mp4upload|filelions|lulustream)[^\s"'<>\\]*/gi;
  for (const m of html.match(hostRe) || []) {
    let host = 'Servidor';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, true);
  }

  /* Pestañas del reproductor DooPlay: data-post + data-nume → AJAX */
  const playerOpts = [];
  $('[data-post]').each((_, el) => {
    const node = $(el);
    const post = node.attr('data-post');
    const nume = node.attr('data-nume') || '1';
    const type = node.attr('data-type') || 'tv';
    if (post && !playerOpts.some(o => o.post === post && o.nume === nume && o.type === type)) {
      playerOpts.push({ post, nume, type });
    }
  });

  return { servers, watchUrl, playerOpts };
}

/* Plantillas candidatas de URL de episodio (se sondean si la ficha no
   muestra enlaces; la que devuelva 200 se guarda y se reutiliza). */
const EP_TEMPLATES = [
  '/episodio/{slug}-1x{n}',
  '/episodio/{slug}-1x{n}/',
  '/episodios/{slug}-1x{n}/',
  '/episodios/{slug}-{n}/',
  '/episodios/{slug}/{n}/',
  '/ver/{slug}-{n}/',
  '/ver/{slug}-1x{n}/',
  '/{slug}-capitulo-{n}/',
  '/capitulo/{slug}-{n}/',
  '/doramas/{slug}-1x{n}/',
  '/doramas/{slug}/{n}/',
  '/episodio/{slug}-{n}/',
  '/episode/{slug}-{n}/',
  '/{slug}-1x{n}/',
  '/{slug}-{n}/'
];
const PATTERN_FILE = path.resolve('public/data/catalog-dramasflix-pattern.json');

function epUrlFromTemplate(tpl, slug, n) {
  return SOURCE.base + tpl.split('{slug}').join(slug).split('{n}').join(String(n));
}

/* Deriva la plantilla a partir de los enlaces reales de la ficha:
   sustituye el slug y los números por tokens y se queda con la más frecuente. */
function detectTemplateFromLinks(html, seriesSlug, pageUrl) {
  const $ = cheerio.load(html);
  const counts = new Map();
  $('a[href]').each((_, el) => {
    const full = absolute($(el).attr('href'), pageUrl);
    if (!full || !sameOrigin(full, SOURCE.base)) return;
    let p;
    try { p = new URL(full).pathname.toLowerCase(); } catch { return; }
    const linkSlug = slugFromUrl(full).toLowerCase();
    const sl = seriesSlug.toLowerCase();
    if (!linkSlug || linkSlug === sl || !linkSlug.startsWith(sl)) return;
    let t = p.split(sl).join('{slug}');
    t = t.replace(/(\d{1,3})x(\d{1,4})/g, '$1x{n}').replace(/-(\d{1,4})(?=\/|$)/g, '-{n}');
    if (t === p) return;                       // sin número -> no es episodio
    if (!t.includes('{slug}') || !t.includes('{n}')) return;
    counts.set(t, (counts.get(t) || 0) + 1);
  });
  let best = null, bn = 0;
  for (const [t, c] of counts) if (c > bn) { best = t; bn = c; }
  return best;
}

/* Sondeo rápido de plantillas (una sola petición, sin reintentos) */
async function probeEpisodeTemplate(seriesSlug) {
  for (const tpl of EP_TEMPLATES) {
    const url = epUrlFromTemplate(tpl, seriesSlug, 1);
    try {
      const html = await fetchHtml(url, FETCH_RETRIES + 1);   // sin reintentos: 404 = fail rápido
      if (html && html.length > 500) {
        console.log(`   🧭 Patrón de episodio detectado: ${tpl}`);
        return tpl;
      }
    } catch { /* 404 -> siguiente */ }
    await sleep(150);
  }
  return null;
}

function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(url)
  ).replace(/\s*(?:sub espa.?ol).*$/i, '').trim();
  return { title, ...parseServers(html, url) };
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Servidor'; }
}
function collectUrlsFromJson(obj, out = []) {
  if (typeof obj === 'string') {
    if (/^https?:\/\//.test(obj)) out.push(obj);
  } else if (Array.isArray(obj)) {
    for (const v of obj) collectUrlsFromJson(v, out);
  } else if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) collectUrlsFromJson(v, out);
  }
  return out;
}

/* Réplica de la llamada AJAX del reproductor DooPlay */
async function postAjax(opt, referer) {
  const origin = new URL(SOURCE.base).origin;
  const url = `${origin}/wp-admin/admin-ajax.php`;
  const res = await withHostLimit(new URL(url).hostname, () => fetch(url, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': referer
    },
    body: new URLSearchParams({ action: 'doo_player_ajax', post: opt.post, type: opt.type, nume: opt.nume }).toString()
  }));
  if (!res.ok) throw new Error(`admin-ajax HTTP ${res.status}`);
  return await res.text();
}

/* ══════════════════════════════════════════════════════════
   SERIE / PELÍCULA (ficha)
══════════════════════════════════════════════════════════ */

function parseSeries(html, url, isMovie) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  let title = cleanTitle(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') || ''
  );
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
      if (/logo|icon|favicon|banner|avatar/.test(low)) return;
      if (/\.(jpg|jpeg|png|webp)(\?|$)/i.test(full)) image = full;
    });
  }

  let synopsis = clean(
    $('meta[name="description"]').attr('content') ||
    $('[itemprop="description"], [class*="synopsis"], [class*="sinopsis"], [class*="description"], [class*="resumen"], #sinopsis, .wp-content p').first().text()
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
  const stM = bodyTxt.match(/(en emisi[oó]n|finalizad[oa]s?|completad[oa]s?|en emision|en pausa)/i);
  if (stM) status = stM[1];
  if (isMovie) status = status || 'Finalizada';

  let year = null;
  const yM = title.match(/\b((?:19|20)\d{2})\b/) ||
            bodyTxt.match(/(?:estreno|año)[^\d]{0,15}((?:19|20)\d{2})/i) ||
            bodyTxt.match(/\b((?:19|20)\d{2})\b/);
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
    country: 'China',
    type: isMovie ? 'movie' : 'dorama'
  };
}

/* Nº de episodios declarado en la ficha ("Capitulos: N" / "N episodios") */
function declaredEpCount(html) {
  const txt = clean(cheerio.load(html)('body').text());
  let m = txt.match(/cap[ií]tulos?\s*[:=]\s*(\d{1,4})/i);
  if (m) return Math.min(Number(m[1]), 2000);
  m = txt.match(/(\d{1,4})\s*(?:cap[ií]tulos|episodios)\b/i);
  if (m) return Math.min(Number(m[1]), 2000);
  return null;
}

/* ══════════════════════════════════════════════════════════
   DESCUBRIMIENTO (BFS + sondeo numérico)
══════════════════════════════════════════════════════════ */

function parseLinks(html, pageUrl, test) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const raw = absolute($(el).attr('href'), pageUrl);
    if (!raw || !sameOrigin(raw, SOURCE.base)) return;
    try {
      const p = new URL(raw).pathname;
      if (test(p)) links.push(raw);
    } catch {}
  });
  return uniqueUrls(links);
}

async function discover() {
  const series = new Set();
  const movies = new Set();

  for (const seed of SOURCE.seeds) {
    if (timeUp()) break;
    const first = absolute(seed, SOURCE.base);
    if (!first) continue;
    const queue = [first];
    const visited = new Set();

    while (queue.length && visited.size < SOURCE.maxPages) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      let html;
      try { html = await fetchHtml(pageUrl); }
      catch (e) { console.log(`   ⚠️ ${e.message}`); continue; }

      parseLinks(html, pageUrl, SOURCE.seriesTest).forEach(u => series.add(u));
      parseLinks(html, pageUrl, SOURCE.movieTest).forEach(u => movies.add(u));

      for (const next of parseLinks(html, pageUrl, SOURCE.isPageLink)) {
        if (!visited.has(next) && !queue.includes(next)) queue.push(next);
      }
      if (visited.size % 10 === 0) {
        console.log(`   📄 ${visited.size} páginas · ${series.size} series · ${movies.size} películas`);
      }
      await sleep(POLITENESS_MS);
    }

    /* Sondeo numérico por si la paginación era "invisible" */
    let probeFails = 0;
    for (let n = 2; n <= SOURCE.maxPages; n++) {
      if (timeUp()) break;
      const url = absolute(SOURCE.pageProbe(first, n), SOURCE.base);
      if (!url || visited.has(url)) continue;
      let html;
      try { html = await fetchHtml(url); probeFails = 0; }
      catch {
        probeFails++;
        if (probeFails >= 3) { console.log(`   🛑 página ${n}: errores seguidos — se pospone`); break; }
        await sleep(2000);
        continue;
      }
      const s = parseLinks(html, url, SOURCE.seriesTest);
      const mv = parseLinks(html, url, SOURCE.movieTest);
      const fresh = s.filter(l => !series.has(l)).length + mv.filter(l => !movies.has(l)).length;
      if (!fresh) {
        console.log(`   🛑 página ${n}: sin novedades — fin del listado`);
        break;
      }
      s.forEach(l => series.add(l));
      mv.forEach(l => movies.add(l));
      visited.add(url);
      if (n % 10 === 0) console.log(`   📄 ${n} páginas sondeadas · ${series.size} series`);
      await sleep(POLITENESS_MS);
    }
  }

  console.log(`\n🎯 [${SOURCE.id}] Descubiertas: ${series.size} series · ${movies.size} películas`);
  return { seriesUrls: [...series], movieUrls: [...movies] };
}

/* ════════════════════════════════════════════
   FICHA + CANDIDATOS DE EPISODIOS
══════════════════════════════════════════════════════════ */

let EP_TEMPLATE = null;   // patrón aprendido/persistido de URL de episodio

async function scrapeSeriesPage(url) {
  const html = await fetchHtml(url);
  const isMovie = SOURCE.movieTest(new URL(url).pathname);
  const parsed = parseSeries(html, url, isMovie);
  const $ = cheerio.load(html);
  const seriesSlug = slugFromUrl(url);

  const candidates = new Map(); // "season|number" → {season, number, urls}
  const addCandidate = rawUrl => {
    if (!sameOrigin(rawUrl, SOURCE.base)) return;
    let pathname = '';
    try { pathname = new URL(rawUrl).pathname; } catch { return; }
    if (!SOURCE.episodeTest(pathname) && !(EP_TEMPLATE && pathname.includes(seriesSlug))) return;
    const slug = slugFromUrl(rawUrl);
    if (!SOURCE.epBelongs(slug, seriesSlug)) return;
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

  /* La ficha enlaza a /dorama/{slug}/temporada/{n} (página que SÍ lista los
     episodios): se rastrea para obtener los enlaces reales. */
  const seasonLinks = [];
  $('a[href]').each((_, el) => {
    const full = absolute($(el).attr('href'), url);
    if (!full || !sameOrigin(full, SOURCE.base)) return;
    if (/\/dorama\/[^/]+\/temporada\/\d+\/?$/i.test(new URL(full).pathname) &&
        !seasonLinks.includes(full)) seasonLinks.push(full);
  });
  for (const sl of seasonLinks.slice(0, 4)) {
    if (timeUp()) break;
    try {
      const sh = await fetchHtml(sl, FETCH_RETRIES + 1);
      const $s = cheerio.load(sh);
      $s('a[href]').each((_, el) => {
        const full = absolute($s(el).attr('href'), sl);
        if (full) addCandidate(full);
      });
      console.log(`   📑 Temporada: ${sl} → ${[...candidates.values()].length} eps acumulados`);
    } catch { /* temporada caída: se sigue con síntesis */ }
    await sleep(POLITENESS_MS);
  }

  /* Sin enlaces de episodio en la ficha: aprender el patrón REAL.
     1) de los enlaces propios de la página (aunque no casen episodeTest),
     2) del patrón persistido entre runs,
     3) sondeando plantillas candidatas con la serie actual. */
  if (!isMovie && !candidates.size) {
    let tpl = detectTemplateFromLinks(html, seriesSlug, url);
    if (tpl) console.log(`   🧭 Plantilla desde enlaces: ${tpl} (${seriesSlug})`);
    if (!tpl && EP_TEMPLATE) tpl = EP_TEMPLATE;
    if (!tpl) {
      tpl = await probeEpisodeTemplate(seriesSlug);
      if (tpl) {
        EP_TEMPLATE = tpl;
        await saveJson(PATTERN_FILE, { template: tpl, updatedAt: new Date().toISOString() });
      }
    }
    if (tpl) {
      const total = declaredEpCount(html) ?? SYNTH_DEFAULT_EPS;
      for (let n = 1; n <= total; n++) {
        candidates.set(`1|${n}`, {
          season: 1, number: n,
          urls: [epUrlFromTemplate(tpl, seriesSlug, n)]
        });
      }
    }
  } else if (isMovie && !candidates.size) {
    candidates.set('1|1', { season: 1, number: 1, urls: [url] });
  }

  await sleep(POLITENESS_MS);
  return {
    src: SOURCE.id, url, slug: parsed.slug,
    key: titleKey(parsed.title),
    parsed,
    candidates: [...candidates.values()]
  };
}

/* ════════════════════════════════════════════
   CATÁLOGO / ESTADO / CHECKPOINTS
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
async function loadJson(file, fallback) {
  try { const d = JSON.parse(await fs.readFile(file, 'utf8')); return d ?? fallback; }
  catch { return fallback; }
}
const saveJson = async (file, data) => {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data), 'utf8');
  await fs.rename(tmp, file);
};
function upsert(array, item, key = 'id') {
  const i = array.findIndex(e => e[key] === item[key]);
  if (i === -1) array.push(item);
  else array[i] = { ...array[i], ...item };
}

let lastPush = 0;
function gitCheckpoint(db) {
  const now = Date.now();
  if (now - lastPush < 600000) return;
  lastPush = now;
  saveCatalog(db).then(() => {
    try {
      execSync('git config --local user.email "github-actions[bot]@users.noreply.github.com"');
      execSync('git config --local user.name "github-actions[bot]"');
      execSync('git add public/data/catalog-dramasflix.json public/data/catalog-dramasflix-raws.json public/data/catalog-dramasflix-failures.json');
      execSync('git diff --staged --quiet || git commit -m "sync(dramasflix): progreso"');
      execSync('git pull --rebase origin main || true');
      execSync('git push');
      console.log(`\n🚀 Checkpoint subido (${elapsedMin()} min) — a salvo ante cortes\n`);
    } catch {
      console.log('⚠️  Push intermedio falló (se reintenta en el siguiente bloque)');
    }
  });
}

/* ════════════════════════════════════════════
   TMDB (mejora de portada; se respeta la de la web si existe)
══════════════════════════════════════════════════════════ */

async function tmdbFindPoster(title, isMovie) {
  if (!TMDB_API_KEY || !title) return null;
  try {
    const kind = isMovie ? 'movie' : 'tv';
    const res = await fetch(
      `https://api.themoviedb.org/3/search/${kind}?api_key=${TMDB_API_KEY}&language=es-ES&include_adult=false&query=${encodeURIComponent(title)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const results = (data.results || []).filter(r => {
      const oc = r.origin_country || [];
      return !oc.length || oc.includes('CN');
    });
    const hit = results.find(r => r.poster_path);
    if (!hit) return null;
    return `${TMDB_IMG}${hit.poster_path}`;
  } catch { return null; }
}

/* ════════════════════════════════════════════
   SELFTEST
══════════════════════════════════════════════════════════ */

function selftest() {
  const eq = (a, b, label) => {
    const ok = JSON.stringify(a) === JSON.stringify(b);
    console.log(`${ok ? '✅' : '❌'} ${label}${ok ? '' : ` → ${JSON.stringify(a)}`}`);
    if (!ok) process.exitCode = 1;
  };
  eq(epCode('mi-drama-1x7', '/episodios/x'), { season: 1, number: 7 }, '1x7');
  eq(epCode('mi-drama-temporada-2-capitulo-5', '/x'), { season: 2, number: 5 }, 'temporada+capítulo');
  eq(epCode('mi-drama-capitulo-30', '/x'), { season: 1, number: 30 }, 'capítulo básico');
  eq(SOURCE.seriesTest('/dorama/the-masked-lover'), true, 'seriesTest /dorama/ (real)');
  eq(SOURCE.seriesTest('/dorama/a-prophet/temporada/1'), false, 'seriesTest excluye temporada');
  eq(SOURCE.seriesTest('/doramas/pull-strings/'), true, 'seriesTest /doramas/');
  eq(SOURCE.seriesTest('/series/pull-strings/'), true, 'seriesTest /series/');
  eq(SOURCE.seriesTest('/doramas/page/2/'), false, 'seriesTest excluye paginación');
  eq(SOURCE.movieTest('/peliculas/la-peli/'), true, 'movieTest /peliculas/');
  eq(SOURCE.episodeTest('/episodios/pull-strings-1x3/'), true, 'episodeTest');
  eq(SOURCE.epBelongs('pull-strings-1x3', 'pull-strings'), true, 'pertenencia propia');
  eq(SOURCE.epBelongs('otro-drama-1x3', 'pull-strings'), false, 'pertenencia ajena');
  eq(cleanTitle('Ver Pull Strings Capitulos Online Sub Español - DoramasFlix'), 'Pull Strings', 'plantilla web');
  eq(cleanTitle('Nombre » DoramasFlix'), 'Nombre', 'separador »');
  eq(titleKey('Mi Drama Temporada 2').offset, 2, 'temporada en título');
  eq(epUrlFromTemplate('/episodios/{slug}-1x{n}/', 'the-masked-lover', 7),
     'https://doramasflix.io/episodios/the-masked-lover-1x7/', 'template epUrl');
  eq(epUrlFromTemplate('/ver/{slug}-{n}/', 'amante-enmascarado', 1),
     'https://doramasflix.io/ver/amante-enmascarado-1/', 'template sin 1x');
  eq(SOURCE.pageProbe('/paises/china', 2), '/paises/china?page=2', 'pageProbe ?page=N');
  console.log('\nSelftest terminado.');
}

/* ════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════════════ */

async function runPool(items, workers, fn, shouldStop = () => false) {
  let i = 0;
  const worker = async () => {
    while (i < items.length && !shouldStop()) {
      const it = items[i++];
      try { await fn(it); } catch (e) { console.log(`   ⚠️ ${e.message}`); }
    }
  };
  await Promise.all(Array.from({ length: workers }, worker));
}

async function main() {
  console.log('\n==============================================');
  console.log(`🚀 DRAMASFLIX SYNC — ${SOURCE.base}${SOURCE.seeds.join('')}`);
  console.log(`   workers: ${WORKERS} · tope episodios: ${MAX_EPISODE_CRAWLS} · tope: ${MAX_RUNTIME_MS / 60000} min · fresh: ${FRESH}`);
  console.log('==============================================\n');

  let db = await loadCatalog();
  let failures = await loadJson(FAILURES_FILE, {});
  const startedAt = new Date().toISOString();

  /* Patrón de URL de episodio aprendido en runs anteriores (si existe) */
  const pat = await loadJson(PATTERN_FILE, null);
  if (pat && pat.template) {
    EP_TEMPLATE = pat.template;
    console.log(`   🧭 Patrón de episodio persistido: ${EP_TEMPLATE}`);
  }

  if (FRESH) {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
    failures = {};
    await fs.rm(RAWS_FILE, { force: true });
    console.log('🧹 FRESH=1: catálogo, fallos y caché de fichas reiniciados.\n');
  }

  /* ── Fase 1: descubrimiento ── */
  const { seriesUrls, movieUrls } = await discover();
  const tasks = [
    ...seriesUrls.map(u => ({ url: u, isMovie: false })),
    ...movieUrls.map(u => ({ url: u, isMovie: true }))
  ];

  /* ── Fase 2a: fichas ── */
  const prevRaws = (await loadJson(RAWS_FILE, [])).filter(r => tasks.some(t => t.url === r.url));
  const doneUrls = new Set(prevRaws.map(r => r.url));
  const pending = tasks.filter(t => !doneUrls.has(t.url));
  if (prevRaws.length) console.log(`   ↻ ${prevRaws.length} fichas ya analizadas · ${pending.length} pendientes`);
  const raws = [...prevRaws];
  const total = tasks.length;
  let done = raws.length;
  const hb = setInterval(() => console.log(`   💓 vivo: ${done}/${total} fichas (${elapsedMin()} min)`), 30000);
  await runPool(pending, WORKERS, async (t) => {
    const r = await scrapeSeriesPage(t.url);
    raws.push(r);
    done++;
    console.log(`   📄 [${done}/${total}] ${r.slug}${r.parsed.type === 'movie' ? ' 🎬' : ''}`);
    if (done % 5 === 0) await saveJson(RAWS_FILE, raws);
    if (done % 10 === 0) gitCheckpoint(db);
  }, timeUp);
  clearInterval(hb);
  await saveJson(RAWS_FILE, raws);

  /* ── Fase 2b: fusionar + cola de episodios ── */
  const existingById = new Map(db.series.map(s => [s.id, s]));
  const existingByBase = new Map();
  for (const s of db.series) {
    const k = titleKey(s.title).base;
    if (k && !existingByBase.has(k)) existingByBase.set(k, s.id);
  }
  const existingSeasons = new Map();
  for (const s of db.seasons) {
    if (s.seriesId && Number.isFinite(Number(s.number))) {
      existingSeasons.set(`${s.seriesId}|${Number(s.number)}`, s.id);
    }
  }
  const existingEp = new Map();
  for (const e of db.episodes) existingEp.set(`${e.seasonId}|${Number(e.number)}`, e);

  const canons = new Map();
  const allGenres = new Set(db.genres);

  for (const r of raws) {
    const { base, baseTitle, offset } = r.key;
    if (!base) continue;
    let canon = canons.get(base);
    if (!canon) {
      const exId = existingByBase.get(base) || (existingById.has(r.slug) ? r.slug : null);
      canon = {
        id: exId || r.slug,
        series: {
          id: exId || r.slug, slug: exId || r.slug, title: baseTitle,
          image: null, synopsis: null, status: null, year: null,
          genres: [], type: r.parsed.type, sourceUrls: [],
          updatedAt: new Date().toISOString()
        },
        epMap: new Map()
      };
      canons.set(base, canon);
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

  const epQueue = [];
  let skippedExisting = 0, recrawlEmpty = 0, skippedFailed = 0;

  for (const canon of canons.values()) {
    const S = canon.series;
    S.genres.forEach(g => allGenres.add(g));
    const merged = existingById.get(S.id);
    upsert(db.series, { ...(merged || {}), ...S, updatedAt: new Date().toISOString() });

    for (const [k, slot] of canon.epMap) {
      const seasonNum = slot.season;
      let seasonId = existingSeasons.get(`${S.id}|${seasonNum}`);
      if (!seasonId) {
        seasonId = `${S.id}-t${seasonNum}`;
        upsert(db.seasons, {
          id: seasonId, slug: seasonId, seriesId: S.id, number: seasonNum,
          image: S.image || null, updatedAt: new Date().toISOString()
        });
        existingSeasons.set(`${S.id}|${seasonNum}`, seasonId);
      }
      const epKey = `${seasonId}|${slot.number}`;
      const oldEp = existingEp.get(epKey);
      if (oldEp && (oldEp.servers || []).length > 0) { skippedExisting++; continue; }
      if (oldEp) recrawlEmpty++;
      if ((failures[epKey] || 0) >= 2) { skippedFailed++; continue; }
      if (epQueue.length >= MAX_EPISODE_CRAWLS) continue;
      epQueue.push({
        seriesId: S.id, seasonId, season: seasonNum, number: slot.number,
        urls: slot.urls.slice(0, 3)
      });
    }
  }

  console.log(`\n🎬 Episodios ya en catálogo (se respetan): ${skippedExisting}`);
  if (recrawlEmpty) console.log(`↻  Sin servidores (se reintentan): ${recrawlEmpty}`);
  if (skippedFailed) console.log(`🚫 Omitidos (2+ fallos): ${skippedFailed}`);
  console.log(`🎬 A rastrear: ${epQueue.length}`);

  await saveCatalog(db);
  await saveJson(FAILURES_FILE, failures);
  gitCheckpoint(db);

  /* ── Fase 3: rastreo de episodios ── */
  let newEps = 0, failedEps = 0, crawled = 0;
  let stoppedByBudget = false, stoppedByCircuit = false, diagCount = 0;
  const hb2 = setInterval(() => console.log(`   💓 vivo: ${crawled}/${epQueue.length} · +${newEps} (${elapsedMin()} min)`), 60000);

  await runPool(epQueue, WORKERS, async (job) => {
    if (timeUp()) { stoppedByBudget = true; return; }
    const servers = [];
    const seenSrv = new Set();
    let pageTitle = null;
    let lastErr = null;
    let lastHtml = null;

    for (const u of job.urls) {
      if (timeUp()) { stoppedByBudget = true; break; }
      try {
        const html = await fetchHtml(u);
        lastHtml = html;
        let parsed = parseEpisode(html, u);
        if (parsed.title) pageTitle = parsed.title;
        if (!parsed.servers.length && parsed.watchUrl) {
          try {
            const html2 = await fetchHtml(parsed.watchUrl);
            lastHtml = html2;
            const parsed2 = parseEpisode(html2, parsed.watchUrl);
            parsed = { ...parsed, servers: parsed2.servers, title: parsed.title || parsed2.title };
            if (parsed2.title && !pageTitle) pageTitle = parsed2.title;
            console.log(`      📺 Ver Online → ${parsed.watchUrl}`);
          } catch (e2) { lastErr = e2.message; }
        }
        if (!parsed.servers.length && parsed.playerOpts && parsed.playerOpts.length) {
          for (const opt of parsed.playerOpts.slice(0, 6)) {
            try {
              const resp = await postAjax(opt, u);
              if (resp) {
                lastHtml = resp;
                const added = [];
                try {
                  for (const u2 of collectUrlsFromJson(JSON.parse(resp))) {
                    if (isPlayableAbs(u2)) added.push({ name: hostOf(u2), url: u2, embed: true });
                  }
                } catch {}
                const parsed2 = parseEpisode(resp.replace(/\\\//g, '/'), u);
                for (const s of parsed2.servers) added.push(s);
                if (added.length) {
                  parsed = { ...parsed, servers: [...parsed.servers, ...added] };
                  console.log(`      ⚡ AJAX DooPlay (post ${opt.post} · nume ${opt.nume}) → +${added.length}`);
                }
              }
            } catch (e3) { lastErr = e3.message; }
            await sleep(POLITENESS_MS);
          }
        }
        for (const s of parsed.servers) {
          if (seenSrv.has(s.url)) continue;
          seenSrv.add(s.url);
          servers.push(s);
        }
      } catch (e) { lastErr = e.message; }
      await sleep(POLITENESS_MS);
    }

    crawled++;
    if (servers.length) {
      delete failures[`${job.seasonId}|${job.number}`];
      upsert(db.episodes, {
        id: `${job.seasonId}-e${job.number}`,
        slug: `${job.seasonId}-e${job.number}`,
        title: (() => {
          const m = pageTitle && pageTitle.match(/(?:cap[ií]tulo|episodio|episode)\s*x?(\d{1,4})/i);
          if (m) return `Capítulo ${Number(m[1])}`;
          const x = pageTitle && pageTitle.match(/(\d{1,3})x(\d{1,4})\s*$/);
          if (x) return `Capítulo ${Number(x[2])}`;
          return pageTitle ? cleanTitle(pageTitle) : `Capítulo ${job.number}`;
        })(),
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
      const fk = `${job.seasonId}|${job.number}`;
      failures[fk] = (failures[fk] || 0) + 1;
      if (diagCount < 4) {
        diagCount++;
        let snippet;
        if (lastHtml) {
          const kws = ['admin-ajax', 'dooplay', 'playeroptions', 'data-post', 'data-nume', 'ajaxurl', 'action=', 'nonce', 'iframe'];
          const hits = [];
          for (const kw of kws) {
            const i = lastHtml.indexOf(kw);
            if (i !== -1) hits.push(`[${kw}] …${lastHtml.slice(Math.max(0, i - 80), i + 240).replace(/\s+/g, ' ')}…`);
            if (hits.length >= 2) break;
          }
          snippet = hits.length ? hits.join('  |  ')
            : `HTTP 200 sin servidores. Muestra: ${lastHtml.replace(/\s+/g, ' ').slice(0, 240)}`;
        } else {
          snippet = `no se pudo descargar (${lastErr || 'error'})`;
        }
        console.log(`   🔎 DIAG [${diagCount}/4] ${job.seasonId} e${job.number}: ${snippet}`);
      }
    }

    if (crawled >= 30 && newEps === 0 && !stoppedByCircuit) {
      stoppedByCircuit = true;
      console.log('\n⛔ Cortacircuito: 30 episodios, 0 servidores. La web bloquea /episodios/ o cambió su estructura. Revisa los 🔎 DIAG. Si es bloqueo, activa FLIX_PROXY_URL/KEY.\n');
    }

    if (crawled % 10 === 0) {
      await saveCatalog(db);
      await saveJson(FAILURES_FILE, failures);
      gitCheckpoint(db);
      console.log(`   📄 ep ${crawled}/${epQueue.length} · +${newEps} · ${elapsedMin()} min`);
    }
  }, () => stoppedByBudget || stoppedByCircuit);
  clearInterval(hb2);

  if (stoppedByBudget) console.log(`\n⏱️  Tiempo agotado (${MAX_RUNTIME_MS / 60000} min). Se guarda y la próxima ejecución retoma.`);

  /* Contadores por temporada + limpieza de vacías */
  const countBySeason = new Map();
  for (const e of db.episodes) countBySeason.set(e.seasonId, (countBySeason.get(e.seasonId) || 0) + 1);
  for (const s of db.seasons) s.episodeCount = countBySeason.get(s.id) || 0;
  db.seasons = db.seasons.filter(s => s.episodeCount > 0);

  /* ── Fase 4: portadas TMDB ── */
  if (TMDB_API_KEY && !timeUp()) {
    console.log('\n🖼️  Buscando portadas en TMDB…');
    let posters = 0;
    for (const s of db.series) {
      if (timeUp()) break;
      if (s.image && s.image.includes('image.tmdb.org')) continue;
      const poster = await tmdbFindPoster(s.title, s.type === 'movie');
      if (poster) {
        s.image = poster;
        posters++;
        if (posters % 25 === 0) console.log(`   🖼️ ${posters}…`);
      }
      await sleep(150);
    }
    console.log(`🖼️  Portadas TMDB: ${posters}`);
  }

  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));
  db.meta = {
    ...(db.meta || {}),
    version: 1,
    source: SOURCE.base + SOURCE.seeds.join(''),
    syncedAt: new Date().toISOString(),
    lastSync: {
      status: 'success', type: 'full', startedAt,
      finishedAt: new Date().toISOString(), error: null,
      stoppedByBudget, stoppedByCircuit,
      series: db.series.length, seasons: db.seasons.length,
      episodes: db.episodes.length, newEpisodes: newEps,
      crawled, failedEps
    }
  };

  await saveCatalog(db);
  await saveJson(FAILURES_FILE, failures);
  gitCheckpoint(db);

  console.log('\n====================================================');
  console.log('🎉 DRAMASFLIX SYNC TERMINADO');
  console.log(`📚 Series/películas: ${db.series.length} · 📖 Temporadas: ${db.seasons.length} · 🎬 Episodios: ${db.episodes.length} (+${newEps}, ${failedEps} sin servidores)`);
  console.log(`⏱️  Duración: ${elapsedMin()} min`);
  console.log('====================================================\n');
}

/* ── Arranque ── */
if (process.env.FLIX_SELFTEST === '1') {
  selftest();
} else {
  main().catch(async e => {
    console.error('\n💥 ERROR FATAL:', e);
    try {
      const db = await loadCatalog();
      db.meta = { ...(db.meta || {}), lastSync: { status: 'error', finishedAt: new Date().toISOString(), error: e.message } };
      await saveCatalog(db);
    } catch {}
    process.exitCode = 1;
  });
}
