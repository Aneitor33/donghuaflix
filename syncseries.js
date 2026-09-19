// ══════════════════════════════════════════════════════════
//  syncseries.js — DonghuaFlix
//  Scraper del catálogo de SERIES (sección aparte):
//    · gnula (wnv5.gnula.cc)
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import * as cheerio from 'cheerio';

const OUT_FILE = path.resolve('public/data/catalog-series.json');
const FAILURES_FILE = path.resolve('public/data/catalog-series-failures-v2.json');
const RAWS_FILE = path.resolve('public/data/catalog-series-progress.json');

const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 7)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 20000));
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const SYNTH_DEFAULT_EPS = Math.max(1, Math.min(100, Number(process.env.SYNTH_DEFAULT_EPS || 24)));
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 120000);
const FETCH_RETRIES = 3;
const logged403 = new Set();

/* Proxy opcional si la web bloquea las IPs de GitHub (403) */
const PROXY_URL = (process.env.SERIES_PROXY_URL || process.env.DORAMAS_PROXY_URL || '').replace(/\/+$/, '');
const PROXY_KEY = process.env.SERIES_PROXY_KEY || process.env.DORAMAS_PROXY_KEY || '';
const PROXY_HOSTS = (process.env.PROXY_HOSTS || 'wnv5.gnula.cc')
  .split(',').map(s => s.trim()).filter(Boolean);

const hostSem = new Map();
const hostFails = new Map();
const HOST_LIMIT = Math.max(1, Math.min(8, Number(process.env.HOST_LIMIT || 2)));

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
   FUENTE
══════════════════════════════════════════════════════════ */

const SOURCE = {
  id: 'gnula',
  base: 'https://wnv5.gnula.cc',
  priority: 0,
  seeds: ['/ver-serie/'],
  maxPages: 50,
  seriesTest: p => /^\/ver-serie\/(?!page\/)[a-z0-9-]+\/?$/i.test(p),
  episodeTest: p => /^\/ver-episode\/[a-z0-9-]+/i.test(p),
  epBelongs: (slug, p, ss) => slug.toLowerCase().startsWith(ss.toLowerCase()),
  pageProbe: (seed, n) => `/ver-serie/page/${n}/`,
  isPageLink: p => /^\/ver-serie\/page\/\d+\/?$/i.test(p),
  synthesize: true,
  synthUrl: (slug, n) => `/ver-episode/${slug}-1x${n}/`
};

/* ══════════════════════════════════════════════════════════
   UTILIDADES
══════════════════════════════════════════════════════════ */

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

const fold = s => String(s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
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

function viaProxy(url) {
  try {
    if (PROXY_URL && PROXY_KEY && PROXY_HOSTS.includes(new URL(url).hostname)) {
      return { target: `${PROXY_URL}/?u=${encodeURIComponent(url)}`, proxied: true };
    }
  } catch {}
  return { target: url, proxied: false };
}

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const { target, proxied } = viaProxy(url);

    const reqPromise = fetch(target, {
      signal: controller.signal,
      redirect: 'follow',
      headers: proxied ? { 'x-proxy-key': PROXY_KEY } : {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.8,en;q=0.7',
        'Cache-Control': 'max-age=0',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'sec-ch-ua': '"Chromium";v="128", "Not;A=Brand";v="24", "Google Chrome";v="128"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
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
        try {
          const host = new URL(url).hostname;
          if (!logged403.has(host)) {
            logged403.add(host);
            const body = await res.text().catch(() => '');
            console.log(`   🛡️ 403 en ${host}: ${body.replace(/\s+/g, ' ').slice(0, 200)}`);
          }
        } catch {}
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
   TÍTULOS Y EPISODIOS
══════════════════════════════════════════════════════════ */

function cleanTitle(raw) {
  let t = clean(String(raw || '')).split('|')[0].split('»')[0];
  t = t.replace(/^ver\s+/i, ' ');
  t = t.replace(/[\[【(][^\]】)]{0,60}[\]】)]/g, ' ');
  t = t.replace(/\s+capitulos?\s+(?:online|gratis|sub\s+espa.*)$/i, ' ');
  t = t.replace(/\b(?:doramasmp4|doramasqueen|estrenosdoramas|donghuaflix)\b.*$/i, ' ');
  let prev;
  do {
    prev = t;
    t = t
      .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+/gu, ' ')
      .replace(/(?:sub\s*)?(?:espa[ñn]ol|online|gratis|hd|completo|subtitulad[oa]|latino|castellano|audio\s+latino|doblado|dorama|capitulos?)\s*$/i, ' ')
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

function epCode(slug, pathname) {
  let m = slug.match(/(\d{1,3})x(\d{1,4})(?:-|$)/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };

  m = slug.match(/-temporada-(\d{1,3})-capitulo-x?(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };

  m = slug.match(/-(\d{1,3})-capitulo-x?(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };

  m = slug.match(/-capitulo-x?(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };

  m = slug.match(/-cap[ií]tulo-x?(\d{1,4})(?:-|$)/i);
  if (m) return { season: 1, number: Number(m[1]) };

  m = slug.match(/-episodio-x?(\d{1,4})(?:-|$)/i);
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
   SERVIDORES Y EXTRACCIÓN
══════════════════════════════════════════════════════════ */

const PLAYER_PATH = /\/(?:player|play|embed|goto|stream|e|video|reproductor|vidurl|multijugadora|tio)[\/.]/i;
const IMAGE_ASSET_RE = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?)(\?|#|$)/i;
const UPLOADS_RE = /\/wp-content\/uploads\/|\/uploads\//i;
const KNOWN_VIDEO_HOST = /(?:ok\.ru|okcdn\.ru|byse|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|vox|1fichier|johnfullwonder|byse|seeks|fastream|luluvdo|voe\.sx|netu\.tv|tamamo|tioplayer|fcdn|streamlare|slmaxed|sltube|playhydrax|hydrax|moviebox|mp4upload|krakenfiles|filelions|lulustream|streamtape)/i;
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

  return { title, servers, watchUrl, playerOpts };
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

async function postAjax(opt, referer) {
  const origin = new URL(SOURCE.base).origin;
  const url = `${origin}/wp-admin/admin-ajax.php`;
  const { target, proxied } = viaProxy(url);
  const res = await withHostLimit(new URL(url).hostname, () => fetch(target, {
    method: 'POST',
    signal: AbortSignal.timeout(20000),
    headers: proxied ? {
      'x-proxy-key': PROXY_KEY,
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    } : {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
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
   PARSER DE SERIE
══════════════════════════════════════════════════════════ */

function parseSeries(html, url) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  let title = cleanTitle(
    $('h1').first().text() \vert{}\vert{}$('meta[property="og:title"]').attr('content') ||
    ''
  );
  if (!title) {
    title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  let image = absolute($('meta[property="og:image"]').attr('content'), url);
  if (!image || !/\.(jpg|jpeg|png|webp)(\?|$)/i.test(image)) {
    image = null;
    $('img').each((_, el) => {
      if (image) return;
      const src = $(el).attr('data-src') || $(el).attr('data-original') \vert{}\vert{}$(el).attr('src');
      const full = absolute(src, url);
      if (!full) return;
      const low = full.toLowerCase();
      if (/logo|icon|favicon|banner|avatar/.test(low)) return;
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
  const stM = bodyTxt.match(/(en emisi[oó]n|finalizad[oa]s?|completad[oa]s?|en emision|en pausa)/i);
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
    status, year, genres,
    type: 'series'
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
  $('a[href]').each((_, el) => {
    const raw = absolute($(el).attr('href'), pageUrl);
    if (!raw || !sameOrigin(raw, source.base)) return;
    try {
      const p = new URL(raw).pathname;
      if (source.isPageLink(p, raw)) links.push(raw);
    } catch {}
  });
  return uniqueUrls(links);
}

async function discoverSource(source) {
  const found = new Set();

  for (const seed of source.seeds) {
    if (timeUp()) { console.log('⏱️ Presupuesto de tiempo agotado durante el descubrimiento'); break; }
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
      catch (e) { console.log(`   ⚠️ ${e.message}`); continue; }

      const series = parseSeriesLinks(html, pageUrl, source);
      series.forEach(u => found.add(u));

      for (const next of parsePageLinks(html, pageUrl, source)) {
        if (!visited.has(next) && !queue.includes(next)) queue.push(next);
      }

      if (visited.size % 10 === 0) console.log(`   📄 ${visited.size} páginas, ${found.size} series`);

      await sleep(POLITENESS_MS);
    }

    let probeFails = 0;
    for (let n = 2; n <= source.maxPages; n++) {
      if (timeUp()) break;
      const url = absolute(source.pageProbe(first, n), source.base);
      if (!url || visited.has(url)) continue;

      let html;
      try { html = await fetchHtml(url); probeFails = 0; }
      catch {
        probeFails++;
        if (probeFails >= 3) { console.log(`   🛑 página ${n}: ${probeFails} errores seguidos — se pospone el resto`); break; }
        await sleep(2000);
        continue;
      }

      const links = parseSeriesLinks(html, url, source);
      const fresh = links.filter(l => !found.has(l));

      if (!fresh.length) {
        console.log(`   🛑 página ${n}: sin novedades — fin del listado`);
        break;
      }
      fresh.forEach(l => found.add(l));
      visited.add(url);

      if (n % 10 === 0) console.log(`   📄 ${n} páginas sondeadas, ${found.size} series`);

      await sleep(POLITENESS_MS);
    }
  }

  console.log(`\n🎯 [${source.id}] Series descubiertas: ${found.size}`);
  return [...found];
}

async function scrapeSeriesPage(source, url) {
  const html = await fetchHtml(url);
  const parsed = parseSeries(html, url);
  const $ = cheerio.load(html);
  const seriesSlug = slugFromUrl(url);

  const candidates = new Map();
  const addCandidate = rawUrl => {
    if (!sameOrigin(rawUrl, source.base)) return;
    let pathname = '';
    try { pathname = new URL(rawUrl).pathname; } catch { return; }
    if (!source.episodeTest(pathname)) return;
    const slug = slugFromUrl(rawUrl);
    if (!source.epBelongs(slug, pathname, seriesSlug)) return;
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

  if (source.synthesize) {
    const bodyTxt = clean($('body').text());
    let total = SYNTH_DEFAULT_EPS;
    const m = bodyTxt.match(/cap[ií]tulos?\s*:\s*(\d{1,4})/i);
    if (m) total = Math.min(Number(m[1]), 2000);
    for (let n = 1; n <= total; n++) {
      if (candidates.has(`1|${n}`)) continue;
      candidates.set(`1|${n}`, {
        season: 1, number: n,
        urls: [`${source.base}${source.synthUrl(seriesSlug, n)}`]
      });
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
   GESTIÓN DE CATÁLOGO Y ARCHIVOS
══════════════════════════════════════════════════════════ */

async function ensureDir(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
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
  await ensureDir(OUT_FILE);
  const tmp = `${OUT_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmp, OUT_FILE);
}

async function loadFailures() {
  try {
    const data = JSON.parse(await fs.readFile(FAILURES_FILE, 'utf8'));
    return (data && typeof data === 'object') ? data : {};
  } catch { return {}; }
}

async function saveFailures(failures) {
  await ensureDir(FAILURES_FILE);
  const tmp = `${FAILURES_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(failures, null, 2), 'utf8');
  await fs.rename(tmp, FAILURES_FILE);
}

const MAX_FAILS = 2;

async function loadRaws() {
  try {
    const d = JSON.parse(await fs.readFile(RAWS_FILE, 'utf8'));
    return Array.isArray(d) ? d : [];
  } catch { return []; }
}

async function saveRaws(raws) {
  await ensureDir(RAWS_FILE);
  const tmp = `${RAWS_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(raws, null, 2), 'utf8');
  await fs.rename(tmp, RAWS_FILE);
}

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
      execSync('git add public/data/catalog-series.json public/data/catalog-series-progress.json public/data/catalog-series-failures-v2.json');
      execSync('git diff --staged --quiet || git commit -m "sync(series): progreso"');
      execSync('git pull --rebase origin main || true');
      execSync('git push');
      console.log(`\n🚀 Checkpoint subido al repo (${elapsedMin()} min)\n`);
    } catch {
      console.log('⚠️ Push intermedio falló (se reintenta luego)');
    }
  });
}

/* ══════════════════════════════════════════════════════════
   TMDB Y POOL
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
   MAIN
══════════════════════════════════════════════════════════ */

async function main() {
  console.log('\n==============================================');
  console.log(`🚀 SERIES SYNC — ${SOURCE.base}`);
  console.log(`   workers: ${WORKERS} · tope episodios: ${MAX_EPISODE_CRAWLS} · tope tiempo: ${MAX_RUNTIME_MS / 60000} min`);
  console.log('==============================================\n');

  const db = await loadCatalog();
  const failures = await loadFailures();
  const startedAt = new Date().toISOString();

  /* ── Fase 1: descubrimiento ── */
  const urls = await discoverSource(SOURCE);

  if (urls.length === 0) {
    console.error('\n❌ ERROR CRÍTICO: No se descubrió ninguna serie (posible bloqueo 403 / Cloudflare). Abortando proceso para proteger el catálogo previo.\n');
    process.exit(1);
  }

  const tasks = urls.map(u => ({ source: SOURCE, url: u }));
  console.log(`\n📚 Total de fichas de serie a analizar: ${tasks.length}`);

  /* ── Fase 2a: analizar fichas ── */
  const prevRaws = await loadRaws();
  const raws = prevRaws.filter(r => urls.includes(r.url));
  const doneUrls = new Set(raws.map(r => r.url));
  const pendingTasks = tasks.filter(t => !doneUrls.has(t.url));
  if (raws.length) console.log(`   ↻ ${raws.length} fichas ya analizadas (se saltan) · ${pendingTasks.length} pendientes`);
  const total = raws.length + pendingTasks.length;
  let done = raws.length;
  const hb = setInterval(() => console.log(`   💓 vivo: ${done}/${total} fichas (${elapsedMin()} min)`), 30000);
  
  await runPool(pendingTasks, WORKERS, async ({ source, url }) => {
    const r = await scrapeSeriesPage(source, url);
    raws.push(r);
    done++;
    console.log(`   📄 [${done}/${total}] ${r.slug} (${elapsedMin()} min)`);
    if (done % 5 === 0) await saveRaws(raws);
    if (done % 10 === 0) gitCheckpoint(db);
  }, timeUp);
  clearInterval(hb);
  await saveRaws(raws);

  console.log(`\n📚 Fichas analizadas OK: ${raws.length}`);
  console.log(`🎴 Candidatos de episodios: ${raws.reduce((a, r) => a + r.candidates.length, 0)}`);

  /* ── Fase 2b: fusionar + cola de episodios ── */
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
  const existingEp = new Map();
  for (const e of db.episodes) {
    existingEp.set(`${e.seasonId}|${Number(e.number)}`, e);
  }

  const canons = new Map();
  const allGenres = new Set(db.genres);
  const createdSeasonIds = new Set();

  for (const r of raws) {
    const { base, baseTitle, offset } = r.key;
    if (!base) continue;

    let canon = canons.get(base);
    if (!canon) {
      const exId = existingByBase.get(base) || (existingById.has(r.slug) ? r.slug : null);
      canon = {
        id: exId || r.slug,
        series: {
          id: exId || r.slug,
          slug: exId || r.slug,
          title: baseTitle,
          image: null, synopsis: null, status: null,
          year: null, genres: [], type: 'series',
          sourceUrls: [], updatedAt: new Date().toISOString()
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
        createdSeasonIds.add(seasonId);
        existingSeasonsByNum.set(`${S.id}|${seasonNum}`, seasonId);
      }

      const epKey = `${seasonId}|${slot.number}`;
      const oldEp = existingEp.get(epKey);

      if (oldEp && (oldEp.servers || []).length > 0) {
        skippedExisting++;
        continue;
      }
      if (oldEp) recrawlEmpty++;

      if ((failures[epKey] || 0) >= MAX_FAILS) {
        skippedFailed++;
        continue;
      }

      if (epQueue.length >= MAX_EPISODE_CRAWLS) continue;

      epQueue.push({
        seriesId: S.id, seasonId,
        season: seasonNum, number: slot.number,
        urls: slot.urls.slice(0, 3)
      });
    }
  }

  await saveCatalog(db);
  await saveFailures(failures);
  gitCheckpoint(db);

  /* ── Fase 3: rastrear episodios ── */
  let newEps = 0, failedEps = 0, crawled = 0;
  let stoppedByBudget = false;
  let stoppedByCircuit = false;
  let diagCount = 0;
  const hb2 = setInterval(() => console.log(`   💓 vivo: ${crawled}/${epQueue.length} episodios · +${newEps} (${elapsedMin()} min)`), 60000);

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
      if (failures[`${job.seasonId}|${job.number}`]) {
        delete failures[`${job.seasonId}|${job.number}`];
      }
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
    }

    if (crawled >= 30 && newEps === 0 && !stoppedByCircuit) {
      stoppedByCircuit = true;
      console.log('\n⛔ Cortacircuito: los 30 primeros episodios dieron 0 servidores.\n');
    }

    if (crawled % 10 === 0) {
      await saveCatalog(db);
      await saveFailures(failures);
      gitCheckpoint(db);
    }
  }, () => stoppedByBudget || stoppedByCircuit);
  clearInterval(hb2);

  /* Contadores por temporada */
  const countBySeason = new Map();
  for (const e of db.episodes) {
    countBySeason.set(e.seasonId, (countBySeason.get(e.seasonId) || 0) + 1);
  }
  for (const s of db.seasons) {
    s.episodeCount = countBySeason.get(s.id) || 0;
  }

  /* Limpieza de fuentes y temporadas vacías */
  db.series = db.series.filter(s => {
    const urls = s.sourceUrls || [];
    if (!urls.length) return true;
    return urls.some(u => u.includes('gnula.cc'));
  });

  db.seasons = db.seasons.filter(s => s.episodeCount > 0 || createdSeasonIds.has(s.id));

  /* ── Fase 4: portadas TMDB ── */
  if (TMDB_API_KEY && !timeUp()) {
    console.log('\n🖼️ Buscando portadas en TMDB…');
    let posters = 0;
    for (const s of db.series) {
      if (timeUp()) break;
      if (s.image && s.image.includes('image.tmdb.org')) continue;
      const poster = await tmdbFindPoster(s.title);
      if (poster) {
        s.image = poster;
        posters++;
      }
      await sleep(150);
    }
  }

  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));

  const finishedAt = new Date().toISOString();
  db.meta = {
    ...(db.meta || {}),
    version: 1,
    source: SOURCE.base,
    syncedAt: finishedAt,
    lastSync: {
      status: 'success',
      type: 'full',
      startedAt, finishedAt, error: null,
      series: db.series.length,
      seasons: db.seasons.length,
      episodes: db.episodes.length,
      newEpisodes: newEps,
      crawled, failedEps
    }
  };

  await saveCatalog(db);
  await saveFailures(failures);
  gitCheckpoint(db);

  console.log('\n====================================================');
  console.log('🎉 SYNC DORAMAS TERMINADO CON ÉXITO');
  console.log('====================================================\n');
}

/* ── Arranque ── */
main().catch(async e => {
  console.error('\n💥 ERROR FATAL:', e);
  process.exitCode = 1;
});
