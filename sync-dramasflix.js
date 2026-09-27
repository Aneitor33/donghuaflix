// ══════════════════════════════════════════════════════════
//  sync-dramasflix.js — DonghuaFlix
//  Scraper del catálogo de dramas desde:
//    · https://doramasflix.io/paises/china  (tema WordPress DooPlay)
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import * as cheerio from 'cheerio';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const FETCH_RETRIES = Math.max(1, Math.min(4, Number(process.env.FETCH_RETRIES || 2)));

/* fetch que devuelve {status, contentType, text} descomprimiendo gzip a mano */
async function fetchRaw(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
      'Accept': '*/*',
      'Accept-Encoding': 'gzip'
    }
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let text;
  if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    try { text = gunzipSync(buf).toString('utf8'); }
    catch { text = buf.toString('utf8'); }
  } else {
    text = buf.toString('utf8');
  }
  return { status: res.status, contentType: res.headers.get('content-type') || '', text };
}

const OUT_FILE = path.resolve('public/data/catalog-dramasflix.json');
const FAILURES_FILE = path.resolve('public/data/catalog-dramasflix-failures.json');
const RAWS_FILE = path.resolve('public/data/catalog-dramasflix-raws.json');

const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 5)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 200);
const HOST_LIMIT = Math.max(1, Math.min(8, Number(process.env.HOST_LIMIT || 2)));
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 20000));
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const SYNTH_DEFAULT_EPS = Math.max(1, Math.min(100, Number(process.env.SYNTH_DEFAULT_EPS || 24)));
const FRESH = process.env.FRESH === '1';
/* Aborta la fase de episodios tras esta racha de fallos consecutivos (posible bloqueo) */
const EP_FAIL_STREAK_ABORT = Math.max(10, Number(process.env.EP_FAIL_STREAK_ABORT || 40));

/* Proxy opcional */
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

const SOURCE = {
  id: 'dramasflix',
  base: 'https://doramasflix.io',
  seeds: ['/paises/china'],
  maxPages: 80,
  seriesTest: p => /^\/(dorama|doramas|series|tv-shows?|programas)\/(?!page\/)[a-z0-9-]+\/?$/i.test(p) &&
                    !/\/temporada\//.test(p),
  movieTest:  p => /^\/(pelicula|peliculas|movies|films)\/(?!page\/)[a-z0-9-]+\/?$/i.test(p),
  episodeTest: p => /^\/(episodio|episodios|episodes|capitulo|capitulos|ver)\/[a-z0-9-]+/i.test(p),
  isPageLink: p => /\/page\/\d+\/?$/.test(p) || /[?&]page=\d+/.test(p),
  epBelongs: (epSlug, seriesSlug) => epSlug.toLowerCase().startsWith(seriesSlug.toLowerCase())
};

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
const fold = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
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

    if (!res.ok) {
      if (res.status === 403) {
        const host = new URL(url).hostname;
        const body = await res.text().catch(() => '');
        if (!logged403.has(host)) {
          logged403.add(host);
          console.log(`   🛡️ 403 en ${host}: ${body.replace(/\s+/g, ' ').slice(0, 160)}`);
        }
        const cf = /just a moment|cf-chl|cloudflare|attention required/i.test(body) ? ' [parece Cloudflare]' : '';
        throw new Error(`HTTP 403${cf} en ${url}`);
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
    if (attempt < FETCH_RETRIES) {
      await sleep(1000 * attempt);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

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
  m = (pathname || '').match(/\/(?:ver|capitulos)\/[^/]+\/(\d{1,4})\/?$/i);
  if (m) return { season: 1, number: Number(m[1]) };
  m = slug.match(/-x(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };
  m = slug.match(/-(\d{1,4})$/);
  if (m) return { season: 1, number: Number(m[1]) };
  return { season: 1, number: null };
}

const PLAYER_PATH = /\/(?:player|play|embed|goto|stream|e|video|reproductor|vidurl|multijugadora|tio)[\/.]/i;
const IMAGE_ASSET_RE = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?)(\?|#|$)/i;
const UPLOADS_RE = /\/wp-content\/uploads\/|\/uploads\//i;

const KNOWN_VIDEO_HOST = /(?:ok\.ru|okcdn\.ru|byse|voe\.sx|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|1fichier|johnfullwonder|seeks|fastream|luluvdo|netu\.tv|tamamo|tioplayer|fcdn|streamlare|slmaxed|sltube|playhydrax|hydrax|mp4upload|krakenfiles|filelions|lulustream|streamtape)\b/i;
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
  const hostRe = /https?:\/\/[^\s"'<>\\]*(?:ok\.ru|okcdn\.ru|byse|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|luluvdo|fastream|mp4upload|krakenfiles|filelions|lulustream)[^\s"'<>\\]*/gi;
  for (const m of html.match(hostRe) || []) {
    let host = 'Servidor';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, true);
  }

  const un = html
    .replace(/\\\//g, '/')
    .replace(/\\u0026/g, '&')
    .replace(/\\"/g, '"');
  const serPair = /"(?:src|url|embed|file|source|link|href|iframeSrc|iframe|player)":"(https?:\/\/[^"]{10,600})"/g;
  for (const m of un.matchAll(serPair)) {
    addServer(hostOf(m[1]), m[1], true);
  }

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

const EP_TEMPLATES = [
  '/capitulos/{slug}-1x{n}',
  '/capitulos/{slug}-1x{n}/',
  '/capitulo/{slug}-1x{n}',
  '/capitulo/{slug}-1x{n}/',
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
    if (t === p) return;
    if (!t.includes('{slug}') || !t.includes('{n}')) return;
    counts.set(t, (counts.get(t) || 0) + 1);
  });
  let best = null, bn = 0;
  for (const [t, c] of counts) if (c > bn) { best = t; bn = c; }
  return best;
}

function looksLikeEpisodePage(html, seriesSlug) {
  const $ = cheerio.load(html);
  const headTxt = clean(($('title').text() || '') + ' ' + ($('h1').first().text() || ''));
  if (/404|no encontrado|not found/i.test(headTxt)) return false;
  const norm = s => fold(s).replace(/[-_]+/g, ' ');
  const toks = norm(seriesSlug).split(' ').filter(Boolean);
  const titleNorm = norm(headTxt);
  const mentionsSeries = toks.length > 0 && toks.slice(0, 2).every(t => titleNorm.includes(t));
  const hasPlayer = $('iframe[src]').length > 0 || html.includes('doo_player_ajax') ||
                    $('[data-post]').length > 0;
  return hasPlayer || mentionsSeries;
}

async function probeEpisodeTemplate(seriesSlug) {
  for (const tpl of EP_TEMPLATES) {
    const url = epUrlFromTemplate(tpl, seriesSlug, 1);
    try {
      const html = await fetchHtml(url, FETCH_RETRIES + 1);
      if (html && html.length > 500 && looksLikeEpisodePage(html, seriesSlug)) {
        console.log(`   🧭 Patrón de episodio detectado: ${tpl}`);
        return tpl;
      }
    } catch {}
    await sleep(150);
  }
  return null;
}

function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  const title = clean(
    $('h1').first().text() || $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(url)
  ).replace(/\s*(?:sub espa.?ol).*$/i, '').trim();
  return { title, ...parseServers(html, url) };
}

function hostOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'Servidor'; }
}

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

function parseSeries(html, url, isMovie) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  let title = cleanTitle(
    $('h1').first().text() || $('meta[property="og:title"]').attr('content') || ''
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

  let country = null;
  const cM = bodyTxt.match(/\b(China|Corea(?: del Sur)?|Jap[oó]n|Tailandia|Filipinas|Taiw[aá]n|Vietnam|Hong\s?Kong)\b/i);
  if (cM) country = cM[1];

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
    country: country || 'China',
    type: isMovie ? 'movie' : 'dorama'
  };
}

function declaredEpCount(html) {
  const txt = clean(cheerio.load(html)('body').text());
  let m = txt.match(/cap[ií]tulos?\s*[:=]\s*(\d{1,4})/i);
  if (m) return Math.min(Number(m[1]), 2000);
  m = txt.match(/(\d{1,4})\s*(?:cap[ií]tulos|episodios)\b/i);
  if (m) return Math.min(Number(m[1]), 2000);
  return null;
}

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

function parseLinksRaw(html, pageUrl, test) {
  const un = html.replace(/\\\//g, '/').replace(/\\"/g, '"');
  const out = [];
  for (const re of [/"href":"([^"]+)"/g, /href="([^"]+)"/g]) {
    for (const m of un.matchAll(re)) {
      const full = absolute(m[1], pageUrl);
      if (!full || !sameOrigin(full, SOURCE.base)) continue;
      try { if (test(new URL(full).pathname)) out.push(full); } catch {}
    }
  }
  return out;
}

function parseLinksAll(html, pageUrl, test) {
  return uniqueUrls([...parseLinks(html, pageUrl, test), ...parseLinksRaw(html, pageUrl, test)]);
}

async function discoverSitemap() {
  let xml;
  try {
    console.log('🗺️  Intentando descubrimiento vía sitemap...');
    const r = await fetchRaw(`${SOURCE.base}/sitemap.xml`);
    if (r.status !== 200 || !r.text.includes('<loc')) return null;
    xml = r.text;
  } catch {
    return null;
  }

  const locsOf = x => [...new Set([...x.matchAll(/https?:\/\/[\w.-]+[^\s<"'\\)\]]*/g)].map(m => m[0].trim()))];
  let urls = locsOf(xml);
  const submaps = urls.filter(u => /\.xml(\?|#|$)/.test(u));
  if (submaps.length) {
    urls = urls.filter(u => !submaps.includes(u));
    for (const sm of submaps.slice(0, 60)) {
      if (timeUp()) break;
      try {
        const r = await fetchRaw(sm);
        if (r.status === 200) urls.push(...locsOf(r.text));
      } catch {}
      await sleep(150);
    }
  }
  const series = new Set(), movies = new Set();
  for (const u of urls) {
    let path;
    try { path = new URL(u).pathname; } catch { continue; }
    if (SOURCE.seriesTest(path)) series.add(u);
    else if (SOURCE.movieTest(path)) movies.add(u);
  }
  if (series.size + movies.size < 10) return null;
  console.log(`🗺️  Sitemap OK: ${series.size} series, ${movies.size} películas`);
  return { seriesUrls: [...series], movieUrls: [...movies] };
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
      try { html = await fetchHtml(pageUrl); } catch { continue; }

      parseLinksAll(html, pageUrl, SOURCE.seriesTest).forEach(u => series.add(u));
      parseLinksAll(html, pageUrl, SOURCE.movieTest).forEach(u => movies.add(u));

      for (const next of parseLinks(html, pageUrl, SOURCE.isPageLink)) {
        if (!visited.has(next) && !queue.includes(next)) queue.push(next);
      }
      if (visited.size % 5 === 0) {
        console.log(`   🗺️  Páginas rastreadas: ${visited.size} | series: ${series.size} | películas: ${movies.size}`);
      }
      await sleep(POLITENESS_MS);
    }
  }
  return { seriesUrls: [...series], movieUrls: [...movies] };
}

let EP_TEMPLATE = null;

async function scrapeSeriesPage(url) {
  const html = await fetchHtml(url);
  const isMovie = SOURCE.movieTest(new URL(url).pathname);
  const parsed = parseSeries(html, url, isMovie);
  const $ = cheerio.load(html);
  const seriesSlug = slugFromUrl(url);

  const candidates = new Map();
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

  const preServers = new Map();
  {
    const un = html.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/\\"/g, '"');
    const epObjRe = new RegExp('"slug":"(' + seriesSlug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-[0-9]{1,3}x[0-9]{1,4})"', 'gi');
    for (const m of un.matchAll(epObjRe)) {
      const epSlug = m[1];
      const code = epCode(epSlug, '/' + epSlug);
      if (code.number == null) continue;
      const win = un.slice(m.index, m.index + 1200);
      const srvs = [];
      for (const pm of win.matchAll(/"(?:url|src|embed|file|link|href)":"(https?:\/\/[^"]{10,600})"/g)) {
        const u = pm[1];
        if (isPlayableAbs(u) && !srvs.some(s => s.url === u)) {
          srvs.push({ name: hostOf(u), url: u, embed: true });
        }
      }
      const key = `${code.season}|${code.number}`;
      if (!preServers.has(key)) preServers.set(key, []);
      for (const s of srvs) {
        if (!preServers.get(key).some(x => x.url === s.url)) preServers.get(key).push(s);
      }
      if (!candidates.has(key)) candidates.set(key, { season: code.season, number: code.number, urls: [] });
      const cand = candidates.get(key);
      const epUrl = `${SOURCE.base}/capitulos/${epSlug}`;
      if (!cand.urls.includes(epUrl)) cand.urls.push(epUrl);
    }
  }

  if (!isMovie && !candidates.size) {
    let tpl = detectTemplateFromLinks(html, seriesSlug, url) || EP_TEMPLATE;
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
        const urls = [epUrlFromTemplate(tpl, seriesSlug, n)];
        candidates.set(`1|${n}`, { season: 1, number: n, urls });
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
    candidates: [...candidates.values()].map(c => ({
      ...c,
      servers: preServers.get(`${c.season}|${c.number}`) || []
    }))
  };
}

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
  try { return JSON.parse(await fs.readFile(file, 'utf8')) ?? fallback; }
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
let checkpointBusy = false;
function gitCheckpoint(db) {
  const now = Date.now();
  if (now - lastPush < 600000 || checkpointBusy) return;
  checkpointBusy = true;
  lastPush = now;
  saveCatalog(db)
    .then(() => {
      try {
        execSync('git config --local user.email "github-actions[bot]@users.noreply.github.com"');
        execSync('git config --local user.name "github-actions[bot]"');
        execSync('git add public/data/catalog-dramasflix.json public/data/catalog-dramasflix-raws.json public/data/catalog-dramasflix-failures.json');
        execSync('git diff --staged --quiet || git commit -m "sync(dramasflix): progreso"');
        execSync('git pull --rebase origin main || true');
        execSync('git push');
        console.log('   💾 Checkpoint: progreso guardado y enviado al repo');
      } catch (e) {
        console.log(`   ⚠️ Checkpoint falló: ${e.message}`);
      }
    })
    .catch(e => console.log(`   ⚠️ No se pudo guardar el catálogo: ${e.message}`))
    .finally(() => { checkpointBusy = false; });
}

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
  console.log('🚀 DRAMASFLIX SYNC INICIADO');
  console.log(`⚙️  Config: workers=${WORKERS} timeout=${FETCH_TIMEOUT_MS}ms reintentos=${FETCH_RETRIES} hostLimit=${HOST_LIMIT} proxy=${PROXY_URL ? 'sí' : 'NO (directo)'}`);

  let db = await loadCatalog();
  let failures = await loadJson(FAILURES_FILE, {});

  const pat = await loadJson(PATTERN_FILE, null);
  if (pat && pat.template) EP_TEMPLATE = pat.template;

  if (FRESH) {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
    failures = {};
    await fs.rm(RAWS_FILE, { force: true });
  }

  let discovered = await discoverSitemap().catch(() => null);
  if (discovered) {
    console.log(`📚 Descubrimiento vía sitemap: ${discovered.seriesUrls.length} series, ${discovered.movieUrls.length} películas`);
  } else {
    console.log('🗺️  Sitemap no disponible, rastreando desde semillas...');
    discovered = await discover();
    console.log(`📚 Descubrimiento vía rastreo: ${discovered.seriesUrls.length} series, ${discovered.movieUrls.length} películas`);
  }

  const tasks = [
    ...discovered.seriesUrls.map(u => ({ url: u, isMovie: false })),
    ...discovered.movieUrls.map(u => ({ url: u, isMovie: true }))
  ];

  /* Fail-fast: si no se descubrió nada, el sitio o el proxy no responden */
  if (!tasks.length) {
    throw new Error('Descubrimiento vacío: doramasflix.io no respondió o el proxy no está configurado. Revisa FLIX_PROXY_URL / FLIX_PROXY_KEY.');
  }

  const prevRaws = (await loadJson(RAWS_FILE, [])).filter(r => tasks.some(t => t.url === r.url));
  const doneUrls = new Set(prevRaws.map(r => r.url));
  const pending = tasks.filter(t => !doneUrls.has(t.url));
  let raws = [...prevRaws];

  console.log(`⏭️  Ya procesadas previamente: ${doneUrls.size} | pendientes esta corrida: ${pending.length}`);

  let doneSeries = 0;
  await runPool(pending, WORKERS, async (t) => {
    const r = await scrapeSeriesPage(t.url);
    raws.push(r);
    doneSeries++;
    if (doneSeries % 10 === 0) {
      console.log(`   📄 Series rastreadas: ${doneSeries}/${pending.length}`);
      gitCheckpoint(db);
    }
  }, timeUp);
  await saveJson(RAWS_FILE, raws);
  console.log(`✅ Fase de series terminada: ${raws.length} páginas en bruto`);

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
      if (!canon.epMap.has(k)) canon.epMap.set(k, { season: seasonFinal, number: c.number, urls: [], servers: [] });
      const slot = canon.epMap.get(k);
      for (const u of c.urls) if (!slot.urls.includes(u)) slot.urls.push(u);
      for (const s of (c.servers || [])) {
        if (!slot.servers.some(x => x.url === s.url)) slot.servers.push(s);
      }
    }
  }

  let newEps = 0;
  const epQueue = [];

  for (const canon of canons.values()) {
    const S = canon.series;
    S.genres.forEach(g => allGenres.add(g));
    const merged = existingById.get(S.id);
    upsert(db.series, { ...(merged || {}), ...S, updatedAt: new Date().toISOString() });

    for (const [, slot] of canon.epMap) {
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
      if (oldEp && (oldEp.servers || []).length > 0) continue;

      if (slot.servers && slot.servers.length) {
        upsert(db.episodes, {
          id: `${seasonId}-e${slot.number}`,
          slug: `${seasonId}-e${slot.number}`,
          title: `Capítulo ${slot.number}`,
          sourceUrl: slot.urls[0] || null,
          servers: slot.servers,
          seriesId: S.id, seasonId, number: slot.number,
          updatedAt: new Date().toISOString()
        });
        existingEp.set(epKey, { servers: slot.servers });
        newEps++;
        continue;
      }

      if ((failures[epKey] || 0) >= 2) continue;
      if (epQueue.length >= MAX_EPISODE_CRAWLS) continue;
      epQueue.push({
        seriesId: S.id, seasonId, season: seasonNum, number: slot.number,
        urls: slot.urls.slice(0, 3)
      });
    }
  }

  /* Persistir series/seasons antes de la fase larga de episodios */
  gitCheckpoint(db);

  if (epQueue.length) {
    console.log(`🎞️  Fase de episodios: ${epQueue.length} capítulos pendientes de rastrear`);
  } else {
    console.log('🎞️  Fase de episodios: nada pendiente (todo ya tiene servidores o está en lista de fallos)');
  }

  let failedEps = 0, crawled = 0;
  let epFailStreak = 0;
  const failReasons = new Map();
  let epAbortEarly = false;
  const t0Eps = Date.now();

  await runPool(epQueue, WORKERS, async (job) => {
    if (timeUp()) return;
    const servers = [];
    const seenSrv = new Set();
    let pageTitle = null;
    const errs = [];

    for (const u of job.urls) {
      if (timeUp()) break;
      try {
        const html = await fetchHtml(u);
        let parsed = parseEpisode(html, u);
        if (parsed.title) pageTitle = parsed.title;
        for (const s of parsed.servers) {
          if (seenSrv.has(s.url)) continue;
          seenSrv.add(s.url);
          servers.push(s);
        }

        if (!servers.length && parsed.playerOpts && parsed.playerOpts.length) {
          for (const opt of parsed.playerOpts) {
            try {
              const ajaxRes = await postAjax(opt, u);
              const ajaxParsed = parseServers(ajaxRes, u);
              for (const s of ajaxParsed.servers) {
                if (!seenSrv.has(s.url)) {
                  seenSrv.add(s.url);
                  servers.push(s);
                }
              }
            } catch {}
          }
        }
      } catch (e) { errs.push(`${u} → ${(e && e.message) ? e.message : e}`); }
      await sleep(POLITENESS_MS);
    }

    crawled++;
    if (servers.length) {
      epFailStreak = 0;
      delete failures[`${job.seasonId}|${job.number}`];
      upsert(db.episodes, {
        id: `${job.seasonId}-e${job.number}`,
        slug: `${job.seasonId}-e${job.number}`,
        title: pageTitle ? cleanTitle(pageTitle) : `Capítulo ${job.number}`,
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
      epFailStreak++;
      const reason = errs.length ? errs[errs.length - 1].split(' → ')[1] : 'página cargada pero sin servidores detectados';
      failReasons.set(reason, (failReasons.get(reason) || 0) + 1);
      if (failedEps <= 5) {
        console.log(`   ❌ Fallo #${failedEps} (${job.seasonId} · cap ${job.number}):`);
        for (const e of errs.slice(0, 3)) console.log(`      ${e}`);
        if (!errs.length) console.log(`      ${job.urls[0]} → cargó pero 0 servidores detectados`);
      }
      if (epFailStreak >= EP_FAIL_STREAK_ABORT && !epAbortEarly) {
        epAbortEarly = true;
        const topAbort = [...failReasons.entries()].sort((a, b) => b[1] - a[1])[0];
        console.log(`   🛑 ${epFailStreak} episodios fallidos consecutivos. Motivo más frecuente: ${topAbort ? `${topAbort[0]} (×${topAbort[1]})` : 'desconocido'}. Abortando la fase de episodios.`);
      }
    }

    if (crawled % 20 === 0) {
      const epsPerMin = (crawled / ((Date.now() - t0Eps) / 60000)).toFixed(1);
      console.log(`   🎞️  Episodios: ${crawled}/${epQueue.length} (ok acumulados: ${newEps}, fallos: ${failedEps}, ~${epsPerMin}/min)`);
      gitCheckpoint(db);
    }
  }, () => timeUp() || epAbortEarly);

  /* Auto-sanación: si el aborto fue por 404 masivos, la plantilla guardada es incorrecta */
  if (epAbortEarly) {
    const topAbortReason = [...failReasons.entries()].sort((a, b) => b[1] - a[1])[0];
    if (topAbortReason && /404/.test(topAbortReason[0])) {
      console.log('   🔄 404 masivos: la plantilla de episodios guardada es incorrecta. Invalidando plantilla, raws y contadores de fallo para la próxima corrida.');
      EP_TEMPLATE = null;
      await fs.rm(PATTERN_FILE, { force: true });
      await fs.rm(RAWS_FILE, { force: true });
      for (const k of Object.keys(failures)) delete failures[k];
    }
  }

  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));
  db.meta = {
    source: SOURCE.base + SOURCE.seeds.join(''),
    syncedAt: new Date().toISOString(),
    lastSync: { status: 'success', finishedAt: new Date().toISOString(), series: db.series.length, episodes: db.episodes.length, newEpisodes: newEps }
  };

  await saveCatalog(db);
  await saveJson(FAILURES_FILE, failures);
  gitCheckpoint(db);
  if (failReasons.size) {
    const top = [...failReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    console.log(`📉 Motivos de fallo: ${top.map(([r, c]) => `${r} (×${c})`).join(' | ')}`);
  }
  console.log(`🎉 SYNC TERMINADO — series: ${db.series.length} | episodios: ${db.episodes.length} | nuevos: ${newEps} | fallidos: ${failedEps} | rastreados: ${crawled}`);
}

if (process.env.FLIX_SELFTEST === '1') {
  console.log('Selftest completado');
} else {
  main().catch(async e => {
    console.error('💥 ERROR FATAL:', e);
    process.exitCode = 1;
  });
}
