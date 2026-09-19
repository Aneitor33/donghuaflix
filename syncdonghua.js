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

/* Un archivo de catálogo POR WEB: catalog-donghualife.json,
   catalog-mundodonghua.json, catalog-seriesdonghua.json… */
const SOURCE_IDS = (process.env.SOURCES_ENABLED || 'donghualife,mundodonghua,seriesdonghua')
  .split(',').map(s => s.trim()).filter(Boolean);
const catalogFile = (srcId) => path.resolve(`public/data/catalog-${srcId}.json`);
const OUT_FILE = catalogFile(SOURCE_IDS[0]); // compat (referencia para otras rutinas)
const FAILURES_FILE = path.resolve('public/data/catalog-failures.json');

const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 7)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 6000));
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_URLS_PER_EP = Math.max(1, Math.min(4, Number(process.env.MAX_URLS_PER_EP || 3)));
const TMDB_API_KEY = process.env.TMDB_API_KEY || '';
const TMDB_IMG = 'https://image.tmdb.org/t/p/w300';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 120000);
const FETCH_RETRIES = 3;
const logged403 = new Set();

/* Proxy opcional para fuentes que bloquean las IPs de GitHub
   (p. ej. tiodonghua.lat → 403). Se activa SOLO si defines las
   variables de entorno; si no, todo funciona como siempre. */
const PROXY_URL = (process.env.TIODONGHUA_PROXY_URL || '').replace(/\/+$/, '');
const PROXY_KEY = process.env.TIODONGHUA_PROXY_KEY || '';
const PROXY_HOSTS = (process.env.PROXY_HOSTS || 'tiodonghua.lat,www.tiodonghua.lat')
  .split(',').map(s => s.trim()).filter(Boolean);
/* La web penaliza por concurrencia: máx. 2 peticiones simultáneas
   al mismo host y, si fallan varias seguidas, una pausa larga para
   que el servidor "enfríe" la penalización antes de seguir. */
const hostSem = new Map();
const hostFails = new Map();
async function withHostLimit(host, fn) {
  let sem = hostSem.get(host);
  if (!sem) { sem = { active: 0, queue: [] }; hostSem.set(host, sem); }
  if (sem.active >= 2) await new Promise(r => sem.queue.push(r));
  sem.active++;
  try { return await fn(); }
  finally { sem.active--; const n = sem.queue.shift(); if (n) n(); }
}


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
    epBelongs: (slug, p, ss) => belongsToSeries(slug, ss),
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
    /* el slug del episodio es SOLO el número: la pertenencia se
       comprueba por el path /ver/{slug-de-la-serie}/{n} */
    epBelongs: (slug, p, ss) => p.toLowerCase().startsWith('/ver/' + ss.toLowerCase() + '/'),
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

const ACTIVE_SOURCES = SOURCES.filter(s => SOURCE_IDS.includes(s.id));
      if (/-episodio-\d+/i.test(slug)) return false;
      if (SD_EXCLUDE.has(slug)) return false;
      return true;
    },
    episodeTest: p => /-episodio-\d+/i.test(p),
    /* la ficha NO lista los episodios en el HTML (los carga con JS):
       se sintetizan las URLs /{slug}-episodio-{n}/ a partir del
       "Episodios: N" que sí trae la página */
    synthesize: true,
    epBelongs: (slug, p, ss) => slug.toLowerCase().startsWith(ss.toLowerCase()),
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
    epBelongs: (slug, p, ss) => belongsToSeries(slug, ss),
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
            console.log(`   🛡️ 403 en ${host}: ${body.replace(/\s+/g, ' ').replace(/</g, '<').slice(0, 200)}`);
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
      if (!msg.includes('HTTP 404')) {           // 404 = respuesta legítima, no castigo
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
   TÍTULOS — clave canónica + temporada explícita
   "Martial Peak 5" → base "martial peak" + offset 5
   "Wu Dong Qian Kun 3ra Temporada" → base + offset 3
══════════════════════════════════════════════════════════ */

/* Limpia el título de las plantillas de las webs:
   "Yuan Long Manhua, Novela Ligera 【Sub Español】 | SeriesDonghua"
   "The Nine Heaven… 🥇 DONGHUA【Sub Español】"  →  título real */
function cleanTitle(raw) {
  let t = clean(String(raw || '')).split('|')[0];
  t = t.replace(/[\[【(][^\]】)]{0,60}[\]】)]/g, ' ');
  t = t.replace(/\b(?:donghuaflix|donghualife|mundodonghua|seriesdonghua|tiodonghua)\b.*$/i, ' ');
  t = t.replace(/\b(?:manhua|manhwa|webtoon|novela(?:\s+ligera)?)\b/gi, ' ');
  let prev;
  do {
    prev = t;
    t = t
      .replace(/(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]+\s*)*(?:sub\s*)?(?:espa[ñn]ol|online|gratis|hd|completo|subtitulad[oa]|latino|castellano|audio\s+latino|doblado|donghua)\s*$/iu, ' ')
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
};

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

/* ¿Pertenece este episodio a la serie? Evita que las secciones
   "últimos episodios / relacionados" de las fichas contaminen la
   serie con capítulos de OTROS donghuas (jugaban el contenido
   equivocado). */
function belongsToSeries(epSlug, seriesSlugs) {
  if (!epSlug) return false;
  const list = Array.isArray(seriesSlugs) ? seriesSlugs : [seriesSlugs];
  const es = String(epSlug).toLowerCase();
  for (const raw of list) {
    if (!raw) continue;
    const ss = String(raw).toLowerCase();
    if (es.startsWith(ss)) return true;
    /* tiodonghua: la ficha es 'wu-dong-qian-kun-3-sub-espanol' pero
       sus episodios son 'wu-dong-qian-kun-3-episodio-8-sub-espanol' */
    const clean = ss.replace(/-(?:sub-espanol|subtitulado|latino|castellano|espanol|en-espanol)$/i, '');
    if (clean.length >= 4 &&
        (es.startsWith(clean + '-episodio') || es.startsWith(clean + '-episode'))) return true;
    if (clean.length >= 4 && es.startsWith(clean + '-')) {
      const rest = es.slice(clean.length + 1);
      if (/^\d{1,3}x/i.test(rest)) return true;
    }
  }
  return false;
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

  let title = cleanTitle(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
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
  const seriesSlug = slugFromUrl(url);

  const candidates = new Map(); // "season|number" → {season, number, urls:[]}
  const addCandidate = rawUrl => {
    if (!sameOrigin(rawUrl, source.base)) return;
    let pathname = '';
    try { pathname = new URL(rawUrl).pathname; } catch { return; }
    if (!source.episodeTest(pathname)) return;
    const slug = slugFromUrl(rawUrl);
    if (!source.epBelongs(slug, pathname, seriesSlug)) return;   // ← descarta "relacionados"
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

  /* seriesdonghua: el listado de episodios se genera con JavaScript;
     la ficha solo declara "Episodios: N". Sintetizamos las URLs
     /{slug}-episodio-{n}/ que falten — el rastreo valida cada una. */
  if (source.synthesize) {
    const m = clean($('body').text()).match(/episodios?\s*:\s*(\d{1,4})/i);
    if (m) {
      const total = Math.min(Number(m[1]), 2000);
      for (let n = 1; n <= total; n++) {
        if (candidates.has(`1|${n}`)) continue;
        candidates.set(`1|${n}`, {
          season: 1, number: n,
          urls: [`${source.base}/${seriesSlug}-episodio-${n}/`]
        });
      }
    }
  }

  if (source.seasonTest) {
    const seasonLinks = [];
    $('a[href]').each((_, el) => {
      const full = absolute($(el).attr('href'), url);
      if (!full || !sameOrigin(full, source.base)) return;
      try {
        if (source.seasonTest(new URL(full).pathname) &&
            slugFromUrl(full).startsWith(seriesSlug) &&
            !seasonLinks.includes(full)) seasonLinks.push(full);
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
  const db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  for (const srcId of SOURCE_IDS) {
    try {
      const d = JSON.parse(await fs.readFile(catalogFile(srcId), 'utf8'));
      db.series.push(...(Array.isArray(d.series) ? d.series : []));
      db.seasons.push(...(Array.isArray(d.seasons) ? d.seasons : []));
      db.episodes.push(...(Array.isArray(d.episodes) ? d.episodes : []));
      db.genres.push(...(Array.isArray(d.genres) ? d.genres : []));
      if (d.meta) db.meta = d.meta;
    } catch {}
  }
  return db;
}

async function loadFailures() {
  try {
    const data = JSON.parse(await fs.readFile(FAILURES_FILE, 'utf8'));
    return (data && typeof data === 'object') ? data : {};
  } catch { return {}; }
}

async function saveFailures(failures) {
  await fs.mkdir(path.dirname(FAILURES_FILE), { recursive: true });
  const tmp = `${FAILURES_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(failures), 'utf8');
  await fs.rename(tmp, FAILURES_FILE);
}

const MAX_FAILS = 2; // reintentos de un episodio fallido antes de ignorarlo

async function saveCatalog(db) {
  for (const srcId of SOURCE_IDS) {
    const sSeries = db.series.filter(s => s.src === srcId);
    if (!sSeries.length) continue; // no pisa el archivo si la fuente no dio nada
    const ids = new Set(sSeries.map(s => s.id));
    const sSeasons = db.seasons.filter(s => ids.has(s.seriesId));
    const sIds = new Set(sSeasons.map(s => s.id));
    const sEps = db.episodes.filter(e => sIds.has(e.seasonId));
    const out = catalogFile(srcId);
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify({
      meta: {
        ...(db.meta || {}),
        source: srcId,
        series: sSeries.length,
        seasons: sSeasons.length,
        episodes: sEps.length
      },
      series: sSeries,
      seasons: sSeasons,
      episodes: sEps,
      genres: db.genres || []
    }), 'utf8');
  }
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
  if (now - lastPush < 600000) return;  // máx. 1 push cada 10 min // máx 1 push cada 2 min
  lastPush = now;
  saveCatalog(db).then(() => {
    try {
      execSync('git config --local user.email "github-actions[bot]@users.noreply.github.com"');
      execSync('git config --local user.name "github-actions[bot]"');
      execSync(`git add -A ${SOURCE_IDS.map(x => `'public/data/catalog-${x}*'`).join(' ')} 'public/data/catalog-failures*'`);
      execSync('git diff --staged --quiet || git commit -m "sync(donghua): progreso"');
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

  eq(belongsToSeries('ancient-god-sovereign-1-episodio-x5', 'spirit-realm-walker'), false, 'BASURA: episodio de otro donghua rechazado');
  eq(belongsToSeries('wan-jie-du-zun-1-x31', 'spirit-realm-walker'), false, 'BASURA: wan-jie-du-zun rechazado');
  eq(belongsToSeries('spirit-realm-walker-1-episodio-x5', 'spirit-realm-walker'), true, 'propio: spirit-realm-walker aceptado');
  eq(belongsToSeries('martial-peak-1-x18', 'martial-peak'), true, 'propio: martial-peak-1-x18 aceptado');
  eq(belongsToSeries('martial-peak-episodio-680', 'martial-peak'), true, 'propio: martial-peak-episodio-680 aceptado');
  eq(belongsToSeries('cinderella-chef-3-episodio-8-sub-espanol', 'cinderella-chef-3-sub-espanol'), true, 'tiodonghua: sufijo -sub-espanol gestionado');
  eq(belongsToSeries('beyond-timescape-1x7', 'beyond-timescape'), true, 'propio: formato 1x7 aceptado');

  eq(SOURCES[1].epBelongs('26', '/ver/wu-geng-ji/26', 'wu-geng-ji'), true, 'mundodonghua: /ver/{slug}/{n} aceptado');
  eq(SOURCES[1].epBelongs('26', '/ver/otra-serie/26', 'wu-geng-ji'), false, 'mundodonghua: episodio ajeno rechazado');
  eq(SOURCES[2].epBelongs('yuan-long-episodio-12', '/yuan-long-episodio-12/', 'yuan-long'), true, 'seriesdonghua: propio aceptado');
  eq(SOURCES[2].epBelongs('otro-episodio-12', '/otro-episodio-12/', 'yuan-long'), false, 'seriesdonghua: ajeno rechazado');
  eq(cleanTitle('The Nine Heaven of the Mistic Emperor \u{1F947} DONGHUA【Sub Español】'), 'The Nine Heaven of the Mistic Emperor', 'limpieza: emoji + 【Sub Español】');
  eq(cleanTitle('Yuan Long Manhua, Novela Ligera 【Sub Español】 | SeriesDonghua'), 'Yuan Long', 'limpieza: manhua/novela + web');

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
  console.log(`   fuentes: ${ACTIVE_SOURCES.map(s => s.id).join(', ')}`);
  console.log(`   workers: ${WORKERS} · tope episodios: ${MAX_EPISODE_CRAWLS} · tope tiempo: ${MAX_RUNTIME_MS / 60000} min`);
  console.log('==============================================\n');

  const db = await loadCatalog();
  const failures = await loadFailures();
  const startedAt = new Date().toISOString();

  /* ── Reinicio de estructura: el catálogo se reconstruye desde cero
     una vez (los datos antiguos venían de la estructura fusionada y
     no son compatibles con "una ficha por web"). */
  if (!db.meta || !String(db.meta.source || '').startsWith('multi-v2')) {
    console.log('\n🔄 Estructura multi-v2: se reconstruye el catálogo de donghuas desde cero.');
    db.series = [];
    db.seasons = [];
    db.episodes = [];
    db.genres = [];
  }

  /* ── Fusión retroactiva: series que ahora comparten clave de título
     (antes quedaron con basura de las webs: 【Sub Español】, 🥇 DONGHUA…)
     y remapeo de temporadas/episodios duplicados. */
  {
    const byBase = new Map();
    const remap = new Map();
    for (const s of db.series) {
      const k = `${s.src || 'legacy'}|${titleKey(s.title).base}`;
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
        if ((!keep.image || !keep.image.includes('image.tmdb.org')) && s.image) keep.image = s.image;
        if ((!keep.synopsis || keep.synopsis.length < 60) && s.synopsis) keep.synopsis = s.synopsis;
        if (!keep.status && s.status) keep.status = s.status;
        if (!keep.year && s.year) keep.year = s.year;
        keep.genres = keep.genres || [];
        for (const g of (s.genres || [])) if (!keep.genres.includes(g)) keep.genres.push(g);
        keep.sourceUrls = keep.sourceUrls || [];
        for (const u of (s.sourceUrls || [])) if (!keep.sourceUrls.includes(u)) keep.sourceUrls.push(u);
      }
      db.series = db.series.filter(s => !remap.has(s.id));
      for (const seas of db.seasons) if (remap.has(seas.seriesId)) seas.seriesId = remap.get(seas.seriesId);
      for (const ep of db.episodes) if (remap.has(ep.seriesId)) ep.seriesId = remap.get(ep.seriesId);
      console.log(`\n🧹 Fusión retroactiva: ${remap.size} series duplicadas unificadas`);
    }

    const seenSeas = new Map();
    const remapSeas = new Map();
    for (const seas of db.seasons) {
      const num = Number(seas.number);
      const k2 = `${seas.seriesId}|${num}`;
      if (seenSeas.has(k2)) remapSeas.set(seas.id, seenSeas.get(k2));
      else seenSeas.set(k2, seas.id);
    }
    if (remapSeas.size) {
      for (const ep of db.episodes) if (remapSeas.has(ep.seasonId)) ep.seasonId = remapSeas.get(ep.seasonId);
      db.seasons = db.seasons.filter(s => !remapSeas.has(s.id));
      console.log(`🧹 Temporadas duplicadas unificadas: ${remapSeas.size}`);
    }
  }

  /* ── Limpieza: episodios que NO pertenecen a su serie ──
     Ejecuciones anteriores colaron capítulos de "relacionados". */
  {
    const seasonsById = new Map(db.seasons.map(s => [s.id, s]));
    const seriesById = new Map(db.series.map(s => [s.id, s]));
    const before = db.episodes.length;
    db.episodes = db.episodes.filter(ep => {
      const season = seasonsById.get(ep.seasonId);
      const serie = season && seriesById.get(season.seriesId);
      if (!serie) return true; // sin referencia: no tocar
      const allowed = (serie.sourceUrls && serie.sourceUrls.length)
        ? serie.sourceUrls.map(slugFromUrl)
        : [serie.id];
      return belongsToSeries(slugFromUrl(ep.sourceUrl || ''), allowed);
    });
    globalThis.__removedJunk = before - db.episodes.length;
    if (globalThis.__removedJunk) {
      console.log(`\n🧹 Limpieza: ${globalThis.__removedJunk} episodios ajenos eliminados (pertenecían a otras series)`);
    }
  }

  /* ── Fase 1: descubrimiento ── */
  const tasks = [];
  for (const source of ACTIVE_SOURCES) {
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
  {
    const bySrc = {};
    for (const r of raws) bySrc[r.src] = (bySrc[r.src] || 0) + r.candidates.length;
    console.log('🎴 Candidatos por fuente:', JSON.stringify(bySrc));
  }

  /* ── Fase 2b: fusionar duplicados entre webs ── */
  const existingById = new Map(db.series.map(s => [s.id, s]));
  const existingByBase = new Map();
  for (const s of db.series) {
    const k = `${s.src || 'legacy'}|${titleKey(s.title).base}`;
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

    /* Cada web tiene su PROPIA ficha: no se fusionan entre fuentes */
    const ck = `${r.src}|${base}`;
    let canon = canons.get(ck);
    if (!canon) {
      const exId = existingByBase.get(`${r.src}|${base}`) || (existingById.has(r.slug) ? r.slug : null);
      canon = {
        id: exId || r.slug,
        hasPlainTitle: offset == null,
        series: {
          id: exId || r.slug,
          slug: exId || r.slug,
          title: baseTitle,
          image: null, synopsis: null, status: null,
          year: null, genres: [], type: 'donghua',
          src: r.src,
          sourceUrls: [], updatedAt: new Date().toISOString()
        },
        epMap: new Map() // "seasonFinal|number" → {season, number, urls:[]}
      };
      canons.set(ck, canon);
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

  console.log(`\n🧩 Fichas de serie (una por web, sin fusionar): ${canons.size} (de ${raws.length} fichas)`);

  /* ── Series + temporadas al catálogo y cola de episodios ── */
  const epQueue = [];
  const createdSeasonIds = new Set();
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

      /* Episodios que ya fallaron demasiadas veces: se omiten para
         no quemar el tope en repeticiones inútiles en cada ejecución. */
      if ((failures[epKey] || 0) >= MAX_FAILS) {
        skippedFailed++;
        continue;
      }

      if (epQueue.length >= MAX_EPISODE_CRAWLS) continue;

      epQueue.push({
        seriesId: S.id, seasonId,
        season: seasonNum, number: slot.number,
        urls: slot.urls.slice(0, MAX_URLS_PER_EP)
      });
    }
  }

  /* ── Re-verificación retroactiva ("lookback") ──
     En donghualife los últimos capítulos a veces son VIP y se abren a
     todos con el tiempo. Re-rastreamos los últimos LOOKBACK_EPS con
     servidores de cada temporada (priorizando las series activas) y
     SUMAMOS los servidores que se hayan liberado. */
  const LOOKBACK = Math.max(0, Number(process.env.LOOKBACK_EPS || 10));
  const LOOKBACK_MAX = Math.max(0, Number(process.env.LOOKBACK_MAX || 400));
  if (LOOKBACK && LOOKBACK_MAX) {
    const bySeason = new Map();
    for (const e of db.episodes) {
      if (!(e.servers || []).length || !e.sourceUrl) continue;
      const t = Date.parse(e.updatedAt || 0) || 0;
      if (!bySeason.has(e.seasonId)) bySeason.set(e.seasonId, { latest: t, eps: [] });
      const info = bySeason.get(e.seasonId);
      info.eps.push(e);
      if (t > info.latest) info.latest = t;
    }
    const ordered = [...bySeason.entries()].sort((a, b) => b[1].latest - a[1].latest);
    let lookbackCount = 0;
    for (const [seasonId, info] of ordered) {
      if (lookbackCount >= LOOKBACK_MAX) break;
      const tail = info.eps
        .sort((a, b) => (Number(a.number) || 0) - (Number(b.number) || 0))
        .slice(-LOOKBACK);
      for (const e of tail) {
        if (lookbackCount >= LOOKBACK_MAX) break;
        if (epQueue.length >= MAX_EPISODE_CRAWLS) break;
        const num = Number(e.number);
        if (epQueue.some(j => j.seasonId === seasonId && j.number === num)) continue;
        epQueue.push({
          seriesId: e.seriesId,
          seasonId,
          number: num,
          urls: [e.sourceUrl],
          lookback: true,
          oldServers: e.servers || []
        });
        lookbackCount++;
      }
    }
    if (lookbackCount) {
      console.log(`↩  Re-verificación retroactiva: ${lookbackCount} episodios (últimos ${LOOKBACK} por temporada, tope ${LOOKBACK_MAX})`);
    }
  }

  console.log(`\n🎬 Episodios ya en catálogo (se respetan): ${skippedExisting}`);
  if (skippedFailed) console.log(`🚫 Episodios omitidos (fallaron ${MAX_FAILS}+ veces): ${skippedFailed}`);
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
      if (failures[`${job.seasonId}|${job.number}`]) {
        delete failures[`${job.seasonId}|${job.number}`];
      }
      /* lookback: sumar a los servidores que ya tenía (nunca perder) */
      const finalServers = job.lookback
        ? [...(job.oldServers || []), ...servers]
            .filter((s, i, arr) => arr.findIndex(x => x.url === s.url) === i)
        : servers;
      upsert(db.episodes, {
        id: `${job.seasonId}-e${job.number}`,
        slug: `${job.seasonId}-e${job.number}`,
        title: (() => {
          const m = pageTitle && pageTitle.match(/(?:episodio|episode|cap[ií]tulo)\s*x?(\d{1,4})/i);
          return m ? `Episodio ${Number(m[1])}` : (pageTitle ? cleanTitle(pageTitle) : `Episodio ${job.number}`);
        })(),
        sourceUrl: job.urls[0],
        servers: finalServers,
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

    if (crawled % 10 === 0) {
      await saveCatalog(db);
      await saveFailures(failures);
      gitCheckpoint(db);
      console.log(`   📄 ep ${crawled}/${epQueue.length} · +${newEps} · ${elapsedMin()} min`);
    }
    if (crawled % 500 === 0) {
      console.log(`\n💾 checkpoint: ${crawled} episodios rastreados · +${newEps} nuevos\n`);
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

  /* Temporadas que se quedaron vacías tras la limpieza (o que nunca
     tuvieron episodios) y no se han recreado esta ejecución: se
     eliminan para que no aparezcan en el selector de temporadas. */
  {
    const before = db.seasons.length;
    db.seasons = db.seasons.filter(s => s.episodeCount > 0 || createdSeasonIds.has(s.id));
    globalThis.__removedSeasons = before - db.seasons.length;
    if (globalThis.__removedSeasons) {
      console.log(`🧹 Temporadas vacías eliminadas: ${globalThis.__removedSeasons}`);
    }
  }

  /* Series sin NINGÚN episodio: el usuario prefiere que no aparezcan
     en la web. Vuelven solas cuando alguna fuente aporte capítulos. */
  {
    const withEps = new Set(db.episodes.map(e => e.seriesId));
    const before = db.series.length;
    db.series = db.series.filter(s => withEps.has(s.id));
    const removedEmpty = before - db.series.length;
    if (removedEmpty) {
      console.log(`🧹 Series sin episodios eliminadas: ${removedEmpty}`);
      console.log(`   (se conservan ${db.series.length}: ${db.series.slice(0, 5).map(s => s.title).join(' · ')}…)`);
    }
    globalThis.__removedEmpty = removedEmpty;
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
    source: 'multi-v3:' + ACTIVE_SOURCES.map(s => s.id).join('+'),
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
      crawled, failedEps,
      removedJunk: globalThis.__removedJunk || 0,
      removedSeasons: globalThis.__removedSeasons || 0
    }
  };

  await saveCatalog(db);
  await saveFailures(failures);
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
