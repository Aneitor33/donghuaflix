import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import * as cheerio from 'cheerio';

/*
   DONGHUAFLIX — SCRAPER GENÉRICO (doramasflix.io, pelicinehd.com, ...)
   Genera el catálogo configurado por variables de entorno.
*/
const BASE_URL = process.env.SOURCE_URL || 'https://doramasflix.io';
const OUT_FILE = path.resolve(process.env.OUT_FILE || 'public/data/catalog-cdrama.json');

const SEEDS = (process.env.SEEDS || '/paises/china,/idiomas/mandarin')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const CATALOG_TAG = process.env.CATALOG_TAG || 'cdrama';
const LINK_PREFIXES = (process.env.LINK_PREFIXES || '/doramas/')
  .split(',').map(s => s.trim()).filter(Boolean);
const MOVIE_PREFIXES = (process.env.MOVIE_PREFIXES || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_PAGES = Math.min(500, Math.max(1, Number(process.env.MAX_DISCOVERY_PAGES || 60)));
const GENRE_FILTER = (process.env.GENRE_FILTER || '').toLowerCase();
const ALLOW_CROSS_ORIGIN = process.env.ALLOW_CROSS_ORIGIN === '1';

/*
   ══ FIX pelicinehd: validación estricta de reproductores ══
   Los grids de "relacionadas" usan <img data-src="...pelisflixhd.blog/...jpg">
   y el barrido de data-* las capturaba como 24-30 "servidores" falsos.
*/
const PLAYER_PATH = /\/(?:player|play|embed|goto|stream|ver|e|video|reproductor|vidurl)\//i;
const IMAGE_ASSET_RE = /\.(?:jpe?g|png|gif|webp|svg|ico|css|js|woff2?)(\?|#|$)/i;
const UPLOADS_RE = /\/wp-content\/uploads\/|\/uploads\//i;
const KNOWN_VIDEO_HOST = /(?:ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat|vidhide|vox|1fichier|johnfullwonder)/i;

function looksLikePlayer(u) {
  if (!u) return false;
  if (IMAGE_ASSET_RE.test(u)) return false;
  if (UPLOADS_RE.test(u)) return false;
  try {
    if (PLAYER_PATH.test(new URL(u).pathname)) return true;
  } catch {}
  return KNOWN_VIDEO_HOST.test(u);
}

function isPlayableUrl(u) {
  if (!u) return false;
  if (!sameOrigin(u)) return true;
  try { return PLAYER_PATH.test(new URL(u).pathname); } catch { return false; }
}

function rewriteToBase(url) {
  try {
    const u = new URL(url);
    if (u.origin === new URL(BASE_URL).origin) return url;
    if (!ALLOW_CROSS_ORIGIN) return null;
    return `${new URL(BASE_URL).origin}${u.pathname}${u.search}`;
  } catch { return null; }
}
const COUNTRY_FILTER = (process.env.COUNTRY_FILTER || '').toLowerCase();
const SERVER_BLACKLIST = (process.env.SERVER_BLACKLIST ||
  'streamhg,earnvids,streamruby,smoothie,playerwish,upstream,dropload,t.me,tmdb.org')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isBlacklisted = host => SERVER_BLACKLIST.some(b => String(host).toLowerCase().includes(b));
const ONLY_MOVIES = process.env.ONLY_MOVIES === '1';

let diagCount = 0;
let movieDiag = 0;

const fold = s => String(s || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase();
const DISCOVERY = (process.env.DISCOVERY || 'seeds').toLowerCase();

async function discoverFromSitemap() {
  const found = new Set();
  const seenMaps = new Set();
  const queue = [`${BASE_URL}/sitemap.xml`];
  while (queue.length && seenMaps.size < 60) {
    const url = queue.shift();
    if (seenMaps.has(url)) continue;
    seenMaps.add(url);
    let text;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      text = await res.text();
    } catch { continue; }
    for (const m of text.matchAll(/<loc>([^<]+)<\/loc>/gi)) {
      const loc = m[1].trim();
      if (/sitemap[^<]*\.xml$/i.test(loc)) {
        if (!seenMaps.has(loc)) queue.push(loc);
      } else {
        try {
          const p = new URL(loc).pathname;
          if (LINK_PREFIXES.some(pre => p.startsWith(pre))) found.add(loc);
        } catch {}
      }
    }
    await sleep(POLITENESS_MS);
  }
  console.log(`🗺️  Sitemap: ${found.size} fichas encontradas`);
  return [...found];
}

const MAX_DISCOVERY_PAGES = Math.min(500, Math.max(1, Number(process.env.MAX_DISCOVERY_PAGES || 60)));
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);
const WORKERS = Math.max(1, Math.min(8, Number(process.env.WORKERS || 4)));

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms));
}

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

function absolute(raw, base = BASE_URL) {
  if (!raw) return null;
  const value = String(raw).trim();
  if (!value || /^(javascript:|mailto:|tel:|#)/i.test(value)) return null;
  try { return new URL(value, base).href; } catch { return null; }
}
function sameOrigin(url) {
  try { return new URL(url).origin === new URL(BASE_URL).origin; }
  catch { return false; }
}
function slugFromUrl(raw) {
  try {
    const u = new URL(raw, BASE_URL);
    return decodeURIComponent(u.pathname.split('/').filter(Boolean).pop() || '');
  } catch { return ''; }
}
const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function uniqueUrls(values) {
  return [...new Set(values.map(u => absolute(u)).filter(Boolean))];
}

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en-US;q=0.7,en;q=0.6',
        'Referer': 'https://www.google.com/',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control': 'max-age=0'
      }
    });
    if (!res.ok) {
      if (attempt < FETCH_RETRIES && [408, 425, 429, 500, 502, 503, 504].includes(res.status)) {
        await sleep(1200 * attempt);
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${res.status} en ${url}`);
    }
    return await res.text();
  } catch (err) {
    if (attempt < FETCH_RETRIES) {
      await sleep(1200 * attempt);
      return fetchHtml(url, attempt + 1);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function parseSeriesLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const raw = absolute($(el).attr('href'), pageUrl);
    if (!raw) return;
    try {
      const p = new URL(raw).pathname;
      if (!LINK_PREFIXES.some(pre => p.startsWith(pre))) return;
      const url = rewriteToBase(raw);
      if (url) links.push(url);
    } catch {}
  });
  return uniqueUrls(links);
}

function extractPagination(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const raw = absolute($(el).attr('href'), pageUrl);
    if (!raw) return;
    try {
      const u0 = new URL(raw);
      if (u0.origin !== new URL(BASE_URL).origin && !ALLOW_CROSS_ORIGIN) return;
      const url = rewriteToBase(raw) || raw;
      const u = new URL(url);
      if (u.searchParams.has('page')) {
        const p = Number(u.searchParams.get('page'));
        if (Number.isInteger(p) && p >= 2) links.push(url);
      } else {
        const m = u.pathname.match(/\/page\/(\d+)\/?$/);
        if (m && Number(m[1]) >= 2) links.push(url);
      }
    } catch {}
  });
  return uniqueUrls(links);
}

async function probeListingPages(baseUrl, known) {
  const found = [];
  const base = absolute(baseUrl);
  if (!base) return found;

  const formats = [
    (n) => { const u = new URL(base); u.pathname = u.pathname.replace(/\/$/, '') + '/page/' + n + '/'; return u.href; },
    (n) => { const u = new URL(base); u.searchParams.set('page', String(n)); return u.href; }
  ];
  let build = null;
  for (const mk of formats) {
    try {
      const html = await fetchHtml(mk(2));
      if (parseSeriesLinks(html, mk(2)).length) { build = mk; break; }
    } catch {}
    await sleep(300);
  }
  if (!build) {
    console.log('   🛑 Sin paginación detectada en este listado');
    return found;
  }

  for (let n = 2; n <= MAX_PAGES; n++) {
    const url = build(n);
    try {
      const html = await fetchHtml(url);
      const links = parseSeriesLinks(html, url);
      const fresh = links.filter(l => !known.has(l) && !found.includes(l));
      if (!fresh.length) {
        console.log(`   🛑 página ${n}: sin fichas nuevas — fin del listado`);
        break;
      }
      fresh.forEach(l => found.push(l));
      console.log(`   📄 página ${n}: +${fresh.length} fichas (total ${known.size + found.length})`);
    } catch (e) {
      console.log(`   🛑 página ${n}: ${e.message} — fin del listado`);
      break;
    }
    await sleep(POLITENESS_MS);
  }
  return found;
}

async function discoverSeries() {
  const all = new Set();
  for (const seed of SEEDS) {
    const first = absolute(seed);
    const queue = [first];
    const visited = new Set();
    while (queue.length && visited.size < MAX_PAGES) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);
      console.log(`📄 Página ${visited.size}: ${pageUrl}`);
      try {
        const html = await fetchHtml(pageUrl);
        const links = parseSeriesLinks(html, pageUrl);
        links.forEach(u => all.add(u));

        if (!links.length) {
          for (const pre of LINK_PREFIXES) {
            const n = (html.match(new RegExp(escapeRe(pre), 'g')) || []).length;
            if (n) {
              const i = html.indexOf(pre);
              const sample = html.slice(Math.max(0, i - 80), i + 220)
                .replace(/\s+/g, ' ').replace(/</g, '<');
              console.log(`   🧪 [${pre}] aparece ×${n} en el HTML sin enlaces <a>. Muestra: …${sample.slice(0, 280)}`);
            }
          }
          if (!LINK_PREFIXES.some(pre => html.includes(pre))) {
            console.log('   🧪 La página no contiene referencias a fichas (¿listado 100% JS?)');
          }
        }

        for (const next of extractPagination(html, pageUrl)) {
          if (!visited.has(next) && !queue.includes(next)) queue.push(next);
        }
      } catch (e) {
        console.log(`   ⚠️ ${e.message}`);
      }
      await sleep(POLITENESS_MS);
    }

    const probed = await probeListingPages(first, all);
    probed.forEach(u => all.add(u));
  }
  console.log(`\n🎯 TOTAL [${CATALOG_TAG}] DESCUBIERTOS: ${all.size}`);
  return [...all];
}

function normalizeCountry(raw) {
  const t = String(raw || '').toLowerCase();
  if (!t) return null;
  if (/chin/.test(t)) return 'China';
  if (/core/.test(t)) return 'Corea';
  if (/japon/.test(t)) return 'Japón';
  if (/tailand/.test(t)) return 'Tailandia';
  if (/taiw/.test(t)) return 'Taiwán';
  if (/filipin/.test(t)) return 'Filipinas';
  if (/hong ?kong/.test(t)) return 'Hong Kong';
  return raw;
}

function parseSeries(html, url) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );

  let image = null;
  const og = absolute($('meta[property="og:image"]').attr('content'), url);
  if (og) image = og;
  if (!image) {
    $('img').each((_, el) => {
      if (image) return;
      const src = $(el).attr('data-src') || $(el).attr('src');
      const full = absolute(src, url);
      if (full && /\.(jpg|jpeg|png|webp)(\?|$)/i.test(full) && !/logo|icon|banner/i.test(full)) image = full;
    });
  }

  let synopsis = '';
  $('p').each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 80 && !synopsis) synopsis = t;
  });

  const bodyTxt = clean($('body').text());

  let year = null;
  const yM = bodyTxt.match(/(?:estreno|fecha de estreno|año)[^\d]{0,20}((?:19|20)\d{2})/i)
    || title.match(/\b((?:19|20)\d{2})\b/)
    || bodyTxt.match(/\b((?:19|20)\d{2})\b/);
  if (yM) year = Number(yM[1]);

  const details = {};
  $('dl, table, [class*="detail"], [class*="info"]').each((_, el) => {
    const t = clean($(el).text());
    if (/Estado/i.test(t)) {
      const m = t.match(/Estado\s+(.+?)(?:Pa[ií]s|Estreno|Episodios|$)/i);
      if (m) details.status = clean(m[1]);
      const c = t.match(/Pa[ií]s\s+(.+?)(?:Estreno|Episodios|Idiomas|$)/i);
      if (c) details.country = clean(c[1]);
      const ep = t.match(/Episodios\s+(\d+)\s*de\s*(\d+)/i);
      if (ep) { details.online = Number(ep[1]); details.total = Number(ep[2]); }
    }
  });
  if (!details.status) {
    const m = bodyTxt.match(/Estado\s+(En emisi[oó]n|Finalizado|Completado|En producci[oó]n)/i);
    if (m) details.status = clean(m[1]);
    const c = bodyTxt.match(/Pa[ií]s\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{3,25})/);
    if (c) details.country = clean(c[1]);
  }
  const epM = bodyTxt.match(/(\d+)\s+de\s+(\d+)\s+online/i);
  if (epM) { details.online = Number(epM[1]); details.total = Number(epM[2]); }
  if (!details.total) {
    const capM = bodyTxt.match(/total de\s+(\d+)\s+cap/i);
    if (capM) details.total = Number(capM[1]);
  }
  if (!details.total) {
    const nums = [...bodyTxt.matchAll(/(\d{1,4})\s+(?:episodios|cap[ií]tulos)/gi)].map(x => Number(x[1]));
    if (nums.length) details.total = Math.max(...nums);
  }

  const genres = [];
  $('a[href*="/etiquetas/"], a[href*="/generos/"], a[href*="/genero"], a[href*="genre"], a[href*="/categoria/"]').each((_, el) => {
    const g = clean($(el).text());
    if (g && g.length < 30) genres.push(g);
  });
  if (!genres.length) {
    const gm = bodyTxt.match(/G[eé]nero[s]?:\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ, ]{3,80})/);
    if (gm) gm[1].split(',').forEach(g => { const t = clean(g); if (t) genres.push(t); });
  }

  const episodeUrls = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = absolute(href, url);
    if (!full || !sameOrigin(full)) return;
    try {
      const p = new URL(full).pathname;
      if (p.startsWith('/doramas/')) return;
      if (/\/(ver|episodios?|capitulos?|watch|play)\//i.test(p) || p.includes(slug)) {
        episodeUrls.push(full);
      }
    } catch {}
  });

  let contentType = null;
  if (/serie de tv/i.test(bodyTxt) ||
      /\d{1,3}\s*(?:temporada|temporadas)\b/i.test(bodyTxt) ||
      /(?:episodios|cap[ií]tulos)\b[^.]{0,15}\d/i.test(bodyTxt)) {
    contentType = 'series';
  } else if (/pel[ií]cula\b/i.test(bodyTxt) && !/pel[ií]cula de tv/i.test(bodyTxt)) {
    contentType = 'movie';
  } else if (details.total) {
    contentType = 'series';
  } else if (/\b\d{1,2}\s*h(?:\s*\d{1,2}\s*m)?\b/i.test(bodyTxt)) {
    contentType = 'movie';
  }

  return {
    id: slug, slug, title, image: image || null, synopsis: synopsis || null,
    contentType,
    status: details.status || null,
    country: normalizeCountry(details.country),
    year,
    genres: [...new Set(genres)],
    totalEpisodes: details.total || null,
    onlineEpisodes: details.online || null,
    episodeUrls: uniqueUrls(episodeUrls),
    sourceUrl: absolute(url)
  };
}

function normalizeEpPage(url) {
  try {
    const u = new URL(url);
    const page = u.searchParams.get('page');
    if (page === '1' || page === '0') u.searchParams.delete('page');
    return u.href;
  } catch { return url; }
}

async function collectAllEpisodeUrls(firstUrl) {
  const found = [];
  const seen = new Set();
  const add = u => {
    const n = normalizeEpPage(u);
    if (!seen.has(n)) { seen.add(n); found.push(n); }
  };

  const basePath = new URL(firstUrl).pathname;
  const seriesSlug = slugFromUrl(firstUrl);

  /*
     FIX series: las fichas enlazan páginas de temporada
     (/temporada/{slug}-{N}/, a veces en dominio espejo)
     donde vive la lista de episodios. Las recorremos.
  */
  const seasonPages = [];
  try {
    const html0 = await fetchHtml(firstUrl);
    const $0 = cheerio.load(html0);
    $0('a[href*="/temporada/"]').each((_, el) => {
      const full = absolute($0(el).attr('href'), firstUrl);
      if (!full) return;
      if (!full.toLowerCase().includes(seriesSlug.toLowerCase())) return;
      const rw = rewriteToBase(full) || full;
      if (!seasonPages.includes(rw)) seasonPages.push(rw);
    });
  } catch {}
  if (seasonPages.length) {
    console.log(`   📖 Temporadas detectadas: ${seasonPages.length}`);
  }

  const pages = [firstUrl, ...seasonPages];
  const visitedPages = new Set(pages.map(normalizeEpPage));

  let i = 0;
  while (i < pages.length && i < 30) {
    const url = pages[i++];
    let html;
    try { html = await fetchHtml(url); }
    catch { continue; }

    const $ = cheerio.load(html);

    $('a[href]').each((_, el) => {
      let full = absolute($(el).attr('href'), url);
      if (!full) return;
      if (!sameOrigin(full)) {
        full = rewriteToBase(full);          // dominio espejo → origen base
        if (!full) return;
      }
      try {
        if (/\/(capitulos?|ver|episodios?|episodio|watch|play)\//i.test(new URL(full).pathname)) add(full);
      } catch {}
    });

    const decoded = html.replace(/&amp;/g, '&');
    const seasonRe = /([A-Za-z0-9\-_\/]*\?season=(\d+)&(?:amp;)?ep=(\d+))/g;
    let sm;
    while ((sm = seasonRe.exec(decoded)) !== null) {
      const full = absolute(sm[1], url);
      if (full && sameOrigin(full)) add(full);
    }

    $('a[href]').each((_, el) => {
      let full = absolute($(el).attr('href'), url);
      if (!full) return;
      if (!sameOrigin(full)) full = rewriteToBase(full);
      if (!full) return;
      try {
        const u = new URL(full);
        const m = u.pathname.match(/^\/temporada\//);
        const pageMatch = u.pathname.match(/^(.*)\/page\/(\d+)\/?$/) || (u.searchParams.has('page') ? [null, u.pathname.replace(/\/page\/\d+\/?$/, ''), u.searchParams.get('page')] : null);
        const pertenece = pageMatch && (pageMatch[1] === basePath || m || u.pathname.startsWith('/temporada/'));
        if (pertenece) {
          const key = normalizeEpPage(full);
          if (!visitedPages.has(key)) {
            visitedPages.add(key);
            pages.push(full);
            console.log(`      📄 Página de episodios: ${key}`);
          }
        }
      } catch {}
    });
  }

  return { urls: found, seasonPages: seasonPages.length };
}

function parseEpCodeFromUrl(u) {
  try {
    const url = new URL(u);
    const s = url.searchParams.get('season');
    const e = url.searchParams.get('ep') || url.searchParams.get('episode');
    if (s && e) return { season: Number(s), number: Number(e) };
  } catch {}
  return null;
}

function parseEpCode(slug) {
  let m = String(slug).match(/(\d+)x(\d+)$/);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = String(slug).match(/temporada\/(\d{1,3})\/capitulo\/(\d{1,4})/i);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = String(slug).match(/-(\d+)-(\d+)$/);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = String(slug).match(/(?:episodio|episode|capitulo|ep|e)-?(\d{1,4})$/i);
  if (m) return { season: 1, number: Number(m[1]) };
  return { season: 1, number: null };
}

function episodeNumberFrom(text, slug) {
  const t = String(text || '');
  let m = t.match(/temporada[^\d]{0,10}(\d{1,3})[^\d]{0,20}cap[ií]tulo[^\d]{0,5}(\d{1,4})/i);
  if (m) return Number(m[2]);
  m = t.match(/(?:cap[ií]tulo|episodio|episode|cap|ep)[^\d]*(\d{1,4})/i);
  if (m) return Number(m[1]);
  m = t.match(/(\d{1,4})(?:\s*(?:\||–|-)\s*\d+)?\s*$/);
  if (m) return Number(m[1]);
  return null;
}

function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(url)
  );
  const servers = [];
  const addServer = (name, raw, embed = false, lang = null) => {
    const u = absolute(raw, url);
    if (!u) return;
    let srvHost = name;
    try { srvHost = new URL(u).hostname; } catch {}
    if (isBlacklisted(srvHost) || isBlacklisted(name)) return;
    if (servers.some(s => s.url === u)) return;
    const srv = { name: clean(name) || 'Servidor', url: u, embed: Boolean(embed) };
    if (lang) srv.lang = lang;
    servers.push(srv);
  };
  $('iframe[src]').each((_, el) => {
    const src = absolute($(el).attr('src'), url);
    if (!isPlayableUrl(src)) return;
    let host = 'Servidor';
    try { host = new URL(src).hostname.replace(/^www\./, ''); } catch {}
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
    if (el.tagName === 'img') return;   // ← las miniaturas lazy-load jamás son servidores
    const raw = node.attr('data-url') || node.attr('data-embed') ||
                node.attr('data-link') || node.attr('data-player') || node.attr('data-href');
    if (!raw) return;
    const full = absolute(raw, url);
    if (!looksLikePlayer(full)) return; // ← FIX: ya no entran imágenes del grid
    let host = 'Servidor';
    try { host = new URL(full).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, full, true, currentLang);
  });

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = absolute(href, url);
    if (!full) return;
    const known = /ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega|ibra\.lat/i.test(full);
    if (!known && !looksLikePlayer(full)) return;
    {
      let host = 'Servidor';
      try { host = new URL(full).hostname.replace(/^www\./, ''); } catch {}
      addServer(host, full, false);
    }
  });
  const directRe = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|webm)(\?[^\s"'<>\\]*)?/gi;
  for (const m of html.match(directRe) || []) {
    let host = 'Video directo';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, false);
  }

  const hostRe = /https?:\/\/[^\s"'<>\\]*(?:ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids|ibra\.lat)[^\s"'<>\\]*/gi;
  for (const m of html.match(hostRe) || []) {
    let host = 'Servidor';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, true);
  }

  /*
     Diagnóstico: si acumula demasiados "servidores", volcar
     muestras de URLs para ver qué se está colando.
  */
  if (servers.length > 8) {
    console.log(`   🔎 Muestra de URLs capturadas (${servers.length}):`);
    servers.slice(0, 5).forEach(s => console.log(`   🔎   ${s.url}`));
  }

  return { title, servers };
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

/*
   Cloudflare Pages limita archivos a 25 MiB.
   Si el catálogo supera ~20 MiB lo dividimos en
   partes (catalog-x.part1.json, part2…) y dejamos
   en OUT_FILE un manifiesto pequeño {sharded, parts}.
   La app une las partes al cargar.
*/
const SHARD_LIMIT = 20 * 1024 * 1024;

async function removeStaleParts(keepCount) {
  const dir = path.dirname(OUT_FILE);
  const base = path.basename(OUT_FILE, '.json');
  try {
    const files = await fs.readdir(dir);
    for (const f of files) {
      const m = f.match(new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.part(\\d+)\\.json$`));
      if (m && Number(m[1]) > keepCount) {
        await fs.unlink(path.join(dir, f));
        console.log(`🗑️  Parte obsoleta eliminada: ${f}`);
      }
    }
  } catch {}
}

async function saveCatalog(db) {
  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  const full = JSON.stringify(db);
  const size = Buffer.byteLength(full, 'utf8');

  if (size <= SHARD_LIMIT) {
    await removeStaleParts(0);
    const tmp = `${OUT_FILE}.tmp`;
    await fs.writeFile(tmp, full, 'utf8');
    await fs.rename(tmp, OUT_FILE);
    return;
  }

  const dir = path.dirname(OUT_FILE);
  const base = path.basename(OUT_FILE, '.json');
  const nParts = Math.ceil(size / SHARD_LIMIT) + 1;
  const per = Math.max(1, Math.ceil((db.series.length || 1) / nParts));
  const names = [];

  for (let i = 0, part = 1; i < (db.series.length || 1); i += per, part++) {
    const chunkSeries = (db.series || []).slice(i, i + per);
    const ids = new Set(chunkSeries.map(s => s.id));
    const partDb = {
      meta: part === 1 ? db.meta : {},
      series: chunkSeries,
      seasons: (db.seasons || []).filter(s => ids.has(s.seriesId)),
      episodes: (db.episodes || []).filter(e => ids.has(e.seriesId)),
      genres: []
    };
    const name = `${base}.part${part}.json`;
    await fs.writeFile(path.join(dir, name), JSON.stringify(partDb), 'utf8');
    names.push(`./public/data/${name}`);
    console.log(`🧩 Parte ${part}: ${chunkSeries.length} títulos (${Math.round(Buffer.byteLength(JSON.stringify(partDb)) / 1024 / 1024)} MB)`);
  }

  await removeStaleParts(names.length);

  const manifest = {
    meta: db.meta,
    genres: db.genres || [],
    sharded: true,
    parts: names
  };
  await fs.writeFile(OUT_FILE, JSON.stringify(manifest), 'utf8');
  console.log(`🧩 Catálogo dividido en ${names.length} partes (manifiesto en ${path.basename(OUT_FILE)})`);
}

function upsert(array, item, key = 'id') {
  const i = array.findIndex(e => e[key] === item[key]);
  if (i === -1) array.push(item);
  else array[i] = { ...array[i], ...item };
}

async function main() {
  console.log(`\n🚀 INICIANDO SYNC [${CATALOG_TAG}] → ${BASE_URL} (${SEEDS.join(', ')})\n`);
  const db = await loadCatalog();

  // Limpieza retroactiva: servidores vetados + falsos positivos (imágenes)
  let cleaned = 0;
  for (const ep of db.episodes) {
    if (!Array.isArray(ep.servers)) continue;
    const before = ep.servers.length;
    ep.servers = ep.servers.filter(s => {
      const u = String(s.url || '');
      if (isBlacklisted(s.name) || isBlacklisted(u)) return false;
      if (IMAGE_ASSET_RE.test(u)) return false;   // miniaturas
      if (UPLOADS_RE.test(u)) return false;
      /*
         URLs de pelisflixhd.blog que NO sean ruta de reproductor
         (/e/ /embed/ /player/...) eran falsos positivos del barrido
         antiguo → se purgan. El player real sí conserva su ruta /e/.
      */
      if (/pelisflixhd\./i.test(u)) {
        try {
          if (!PLAYER_PATH.test(new URL(u).pathname)) return false;
        } catch { return false; }
      }
      return true;
    });
    if (ep.servers.length !== before) cleaned++;
  }
  if (cleaned) console.log(`🧹 Limpieza: ${cleaned} episodios depurados (vetados o falsos positivos)`);

  if (ONLY_MOVIES) {
    const removedIds = new Set();
    const before = db.series.length;
    db.series = db.series.filter(s => {
      try {
        const isPeli = MOVIE_PREFIXES.some(pre => new URL(s.sourceUrl).pathname.startsWith(pre));
        if (!isPeli) removedIds.add(s.id);
        return isPeli;
      } catch { return true; }
    });
    if (removedIds.size) {
      db.seasons = db.seasons.filter(se => !removedIds.has(se.seriesId));
      db.episodes = db.episodes.filter(ep => !removedIds.has(ep.seriesId));
      console.log(`🧹 Solo películas: eliminadas ${removedIds.size} series (${before} → ${db.series.length} títulos)`);
    }
  }

  let discovered = [];
  if (DISCOVERY === 'seeds' || DISCOVERY === 'both') {
    discovered = discovered.concat(await discoverSeries());
  }
  if (DISCOVERY === 'sitemap' || DISCOVERY === 'both') {
    discovered = discovered.concat(await discoverFromSitemap());
  }
  discovered = [...new Set(discovered)];

  const startedAt = new Date().toISOString();
  const allGenres = new Set(db.genres);

  let cursor = 0;
  let doneCount = 0;
  let lastPush = 0;
  let ckLock = Promise.resolve();
  const withLock = fn => { const p = ckLock.then(fn); ckLock = p.catch(() => {}); return p; };

  const pushProgress = () => withLock(async () => {
    try {
      await saveCatalog(db);
      execSync('git config --local user.email "github-actions[bot]@users.noreply.github.com"');
      execSync('git config --local user.name "github-actions[bot]"');
      execSync('git add .');
      execSync('git diff-index --quiet HEAD || git commit -m "sync: progreso parcial"');
      execSync('git pull --rebase origin main || true');
      execSync('git push');
      console.log(`\n🚀 Progreso subido al repo (${doneCount}/${discovered.length}) — a salvo ante cortes\n`);
    } catch (e) {
      console.log(`⚠️ Push intermedio falló (se reintenta en el próximo bloque): ${String(e.message).slice(0, 90)}`);
    }
  });

  const processItem = async () => {
    while (cursor < discovered.length) {
    const i = cursor++;
    const url = discovered[i];
    const slug = slugFromUrl(url);

    if (ONLY_MOVIES && !MOVIE_PREFIXES.some(pre => { try { return new URL(url).pathname.startsWith(pre); } catch { return false; } })) {
      console.log(`⏭️  [${doneCount + 1}/${discovered.length}] Solo películas: ${slug}`);
      doneCount++;
      continue;
    }

    console.log(`\n[${doneCount + 1}/${discovered.length}] — ${slug}`);

    try {
      const html = await fetchHtml(url);
      const detail = parseSeries(html, url);

      const seriesItem = {
        ...(db.series.find(s => s.id === slug) || {}),
        id: slug, slug, title: detail.title, image: detail.image,
        synopsis: detail.synopsis, status: detail.status,
        country: detail.country, genres: detail.genres,
        totalEpisodes: detail.totalEpisodes,
        sourceUrl: detail.sourceUrl,
        type: CATALOG_TAG,
        updatedAt: new Date().toISOString()
      };
      if (GENRE_FILTER && !detail.genres.some(g => fold(g).includes(fold(GENRE_FILTER)))) {
        const seedEsDeGenero = SEEDS.some(s => s.includes('genre='));
        if (seedEsDeGenero && !detail.genres.length) {
          console.log(`   ⚠️  Género no legible, pero el seed ya es de género → se acepta`);
        } else {
          console.log(`   ⏭️  Fuera del género "${GENRE_FILTER}": ${detail.genres.join(', ') || 'sin género'}`);
          doneCount++;
          return;
        }
      }

      if (COUNTRY_FILTER && !fold(detail.country).includes(fold(COUNTRY_FILTER))) {
        console.log(`   ⏭️  Fuera del país "${COUNTRY_FILTER}": ${detail.country || 'sin país'}`);
        doneCount++;
        return;
      }

      upsert(db.series, seriesItem);
      detail.genres.forEach(g => allGenres.add(g));

      if (doneCount % 10 === 0) {
        await withLock(() => saveCatalog(db));
        console.log(`💾 Checkpoint: ${doneCount}/${discovered.length}`);
      }
      if (doneCount - lastPush >= 500) {
        lastPush = doneCount;
        pushProgress();
      }

      const isMovie = MOVIE_PREFIXES.some(pre => new URL(url).pathname.startsWith(pre));

      if (ONLY_MOVIES && !isMovie) {
        console.log(`   ⏭️  Solo películas: se ignora la serie ${slug}`);
        continue;
      }

      let mk = null;
      let epNumOf = null;
      let epSeasonOf = null;
      if (!isMovie) {
        const urls0 = [...new Set(detail.episodeUrls)];
        const mx = urls0.find(u => /(\d+)x(\d+)$/.test(u));
        const ms = urls0.find(u => /[?&]season=\d+/.test(u) && /[?&]ep=\d+/.test(u));
        const mt = urls0.find(u => /temporada\/(\d+)\/capitulo\/(\d+)/i.test(u));
        if (mt) {
          const mm2 = mt.match(/^(.*)\/temporada\/(\d{1,3})\/capitulo\/(\d{1,4})\/?$/i);
          if (mm2) {
            const base = mm2[1];
            mk = (s, n) => `${base}/temporada/${s}/capitulo/${n}/`;
            epNumOf = (u) => { const x = u.match(/capitulo\/(\d{1,4})/i); return x ? Number(x[1]) : 0; };
            epSeasonOf = (u) => { const x = u.match(/temporada\/(\d{1,3})/i); return x ? Number(x[1]) : 1; };
          }
        } else if (mx) {
          const m = mx.match(/^(.*)-(\d+)x(\d+)(\/?)$/);
          mk = (s, n) => `${m[1]}-${s}x${n}${m[4] || ''}`;
          epNumOf = (u) => { const mm = u.match(/(\d+)x(\d+)\/?$/); return mm ? Number(mm[2]) : 0; };
          epSeasonOf = (u) => { const mm = u.match(/(\d+)x(\d+)\/?$/); return mm ? Number(mm[1]) : 1; };
        } else if (ms) {
          mk = (s, n) => { const u = new URL(ms); u.searchParams.set('season', String(s)); u.searchParams.set('ep', String(n)); return u.href; };
          epNumOf = (u) => { try { const uu = new URL(u); const e = uu.searchParams.get('ep'); return e ? Number(e) : 0; } catch { return 0; } };
          epSeasonOf = (u) => { try { const uu = new URL(u); const s = uu.searchParams.get('season'); return s ? Number(s) : 1; } catch { return 1; } };
        }

        /*
           FIX series: si la lista venía vacía (carga dinámica) pero
           detectamos páginas de temporada, construimos el patrón
           {slug}-{T}x{E}/ y el sondeo validará cada episodio.
        */
        if (!mk && seasonCount > 0) {
          mk = (s, n) => `${BASE_URL}/episode/${slug}-${s}x${n}/`;
          epNumOf = (u) => { const mm = u.match(/(\d+)x(\d+)\/?$/); return mm ? Number(mm[2]) : 0; };
          epSeasonOf = (u) => { const mm = u.match(/(\d+)x(\d+)\/?$/); return mm ? Number(mm[1]) : 1; };
          console.log(`   🧭 Lista dinámica: sondeo por patrón ${slug}-{T}x{E}/ (${seasonCount} temporadas)`);
        }
      }

      let episodeSource;
      if (isMovie) {
        let playerHtml = html;
        let verUrl = null;
        const $m = cheerio.load(html);
        $m('a[href]').each((_, el) => {
          const h = absolute($m(el).attr('href'), url);
          if (h && h !== url && /\/ver\/?(\?|#|$)/.test(h)) verUrl = h;
        });
        if (verUrl) {
          try {
            playerHtml = await fetchHtml(verUrl);
            console.log(`   📺 Página de reproducción: ${verUrl}`);
          } catch {}
        }
        episodeSource = [{ url, slug: `${slug}-pelicula`, html: playerHtml }];

        if (movieDiag < 5) {
          movieDiag++;
          const $d = cheerio.load(playerHtml);
          const cands = [];
          $d('a[href]').each((_, el) => {
            const h = absolute($d(el).attr('href'), url);
            if (h && sameOrigin(h) && cands.length < 15) cands.push(h);
          });
          const datas = [];
          $d('[data-url], [data-embed], [data-player], [data-server], [data-link], [data-href], [data-src], [data-id], [data-post]').each((_, el) => {
            if (datas.length >= 12) return;
            const a = Object.entries(el.attribs || {}).filter(([k]) => k.startsWith('data'))
              .map(([k, v]) => `${k}="${String(v).slice(0, 60)}"`).join(' ');
            if (a) datas.push(a);
          });
          const ifr = [];
          $d('iframe[src]').each((_, el) => { if (ifr.length < 6) ifr.push(absolute($d(el).attr('src'), url)); });
          console.log(`   🧪 [${slug}] CANDIDATOS href internos:`);
          cands.forEach(c => console.log(`   🧪   ${c}`));
          console.log(`   🧪 [${slug}] data-* :`);
          datas.forEach(d => console.log(`   🧪   <${d}>`));
          console.log(`   🧪 [${slug}] iframes: ${ifr.join(' | ') || 'ninguno'}`);
          const scriptUrls = new Set();
          for (const m of playerHtml.matchAll(/['"]((?:https?:)?\/(?:\/[^'"]+|wp-admin\/admin-ajax\.php[^'"]*|[^'"]*(?:player|embed|stream|ajax|api|go|reproducir)[^'"]*))['"]/gi)) {
            const u = absolute(m[1].replace(/^\//, '/'), url);
            if (u && scriptUrls.size < 15) scriptUrls.add(String(u).slice(0, 120));
          }
          console.log(`   🧪 [${slug}] URLs en scripts (endpoints):`);
          [...scriptUrls].forEach(u => console.log(`   🧪   ${u}`));
          const forms = [];
          $d('form[action]').each((_, el) => { if (forms.length < 5) forms.push(absolute($d(el).attr('action'), url)); });
          if (forms.length) console.log(`   🧪 [${slug}] formularios: ${forms.join(' | ')}`);
        }
      } else {
        const crawlRes = await collectAllEpisodeUrls(url);
        const crawled = crawlRes.urls;
        const seasonCount = crawlRes.seasonPages || 0;

        if (!crawled.length) {
          console.log('   🩺 SERIE CON REPRODUCTOR EMBEBIDO — volcando diagnóstico completo…');
          const htmlLower = html.toLowerCase();
          for (const kw of ['episodio', 'episode', 'temporada', 'season']) {
            const i = htmlLower.indexOf(kw);
            if (i !== -1) {
              const frag = html.slice(Math.max(0, i - 60), i + 220)
                .replace(/\s+/g, ' ').replace(/</g, '<').trim();
              console.log(`   🩺 [${kw}] …${frag.slice(0, 260)}`);
            }
          }
          const $diag = cheerio.load(html);
          const dataAttrs = [];
          $diag('[data-episode], [data-ep], [data-season], [data-num]').each((_, el) => {
            if (dataAttrs.length >= 3) return;
            const attribs = Object.entries(el.attribs || {})
              .filter(([k]) => k.startsWith('data-'))
              .map(([k, v]) => `${k}="${String(v).slice(0, 40)}"`).join(' ');
            if (attribs) dataAttrs.push(attribs);
          });
          dataAttrs.forEach(a => console.log(`   🩺 [data] <elem ${a}>`));
          const vars = new Set();
          for (const m of html.matchAll(/(?:var|let|const)\s+(\w*(?:episode|season|player|eps?|cap)\w*)\s*=/gi)) {
            vars.add(m[1]);
          }
          if (vars.size) console.log(`   🩺 [vars] ${[...vars].slice(0, 8).join(', ')}`);
          const ajax = (html.match(/admin-ajax\.php/g) || []).length;
          if (ajax) {
            console.log(`   🩺 admin-ajax.php ×${ajax}`);
            const actions = new Set();
            for (const m of html.matchAll(/action['"\s:=]+['"]([\w-]+)['"]/gi)) actions.add(m[1]);
            if (actions.size) console.log(`   🩺 [actions] ${[...actions].slice(0, 8).join(', ')}`);
          }
          const postid = html.match(/postid-(\d+)/);
          if (postid) console.log(`   🩺 postid: ${postid[1]}`);
          const jm = html.match(/\{[^{}]{0,400}(?:episode|season|episodio|temporada)[^{}]{0,400}\}/i);
          if (jm) console.log(`   🩺 [json] ${jm[0].replace(/\s+/g, ' ').slice(0, 320)}`);
        }
        const merged = [...new Set([...crawled, ...detail.episodeUrls])]
          .sort((a, b) => {
            const na = a.match(/-(\d+)x(\d+)$/) || a.match(/[?&]ep=(\d+)/);
            const nb = b.match(/-(\d+)x(\d+)$/) || b.match(/[?&]ep=(\d+)/);
            return (na && nb) ? Number(na[2] || na[1]) - Number(nb[2] || nb[1]) : 0;
          });
        if (merged.length > crawled.length) {
          console.log(`   📄 Episodios tras sondeo: ${crawled.length} → ${merged.length}`);
        }
        episodeSource = merged.map(u => ({ url: u, slug: slugFromUrl(u) }))
          .sort((a, b) =>
            ((epSeasonOf && epSeasonOf(a.url)) || 1) - ((epSeasonOf && epSeasonOf(b.url)) || 1) ||
            ((epNumOf && epNumOf(a.url)) || 0) - ((epNumOf && epNumOf(b.url)) || 0));
      }

      const seasonIds = new Set();
      let newCount = 0;
      let missCount = 0;
      const seenEps = new Set(episodeSource.map(e => e.url));
      const queueEps = [...episodeSource];
      if (!queueEps.length && mk) {
        const first = mk(1, 1);
        if (!seenEps.has(first)) {
          seenEps.add(first);
          queueEps.push({ url: first, slug: slugFromUrl(first) });
        }
      }
      let seasonJumps = 0;
      while (queueEps.length) {
        const ep = queueEps.shift();
        const epUrl = ep.url;
        const epSlug = ep.slug || slugFromUrl(epUrl);
        const code = parseEpCodeFromUrl(epUrl) || parseEpCode(epSlug);
        const seasonId = `${slug}-${code.season}`;
        const oldEp = db.episodes.find(e => e.id === epSlug);
        if (oldEp && (oldEp.servers || []).length > 0) {
          seasonIds.add(seasonId);
          missCount = 0;
          continue;
        }
        if (oldEp) {
          console.log(`   ↻ ${epSlug} — existía sin servidores, re-procesando`);
        }
        if (missCount >= 4) {
          const ns = code.season + 1;
          if (mk && seasonJumps < 3 && ns <= 20) {
            seasonJumps++;
            missCount = 0;
            const u = mk(ns, 1);
            if (!seenEps.has(u)) {
              seenEps.add(u);
              queueEps.push({ url: u, slug: slugFromUrl(u) });
            }
            console.log(`   🧭 Temporada ${code.season} terminada — probando temporada ${ns}…`);
            continue;
          }
          console.log(`   🛑 Fin de serie detectado (temporada ${code.season} agotada)`);
          break;
        }
        try {
          console.log(`   ▶ ${epSlug}`);
          const epHtml = ep.html || await fetchHtml(epUrl);
          const parsed = parseEpisode(epHtml, epUrl);

          if (!parsed.servers.length && diagCount < 5) {
            diagCount++;
            console.log(`   🧪 [${epSlug}] sin servidores — analizando reproductor…`);
            for (const kw of ['reproducir', 'player', 'opcion', 'iframe', 'embed', 'data-server', 'data-url', 'source']) {
              const low = epHtml.toLowerCase();
              const i = low.indexOf(kw.toLowerCase());
              if (i !== -1) {
                const frag = epHtml.slice(Math.max(0, i - 60), i + 240)
                  .replace(/\s+/g, ' ').replace(/</g, '<');
                console.log(`   🧪 [${kw}] …${frag.slice(0, 280)}`);
              }
            }
          }

          const pareceReal = parsed.servers.length > 0 ||
            /cap[ií]tulo|episodio|temporada|episode/i.test(parsed.title);
          if (!pareceReal) {
            missCount++;
            console.log(`   ⚠️ No existe (soft-404): "${parsed.title.slice(0, 50)}" — fallo ${missCount}/4`);
            continue;
          }

          const srvNames = parsed.servers.map(x => x.lang ? `${x.name}[${x.lang}]` : x.name).join(', ') || 'NINGUNO';
          console.log(`      🎥 ${parsed.servers.length} servidores: ${srvNames}`);
          const fallbackNum = db.episodes.filter(e => e.seasonId === seasonId).length + 1;
          const num = code.number ?? episodeNumberFrom(parsed.title, slug) ?? fallbackNum;
          upsert(db.episodes, {
            id: epSlug, slug: epSlug,
            title: parsed.title || `Episodio ${num}`,
            sourceUrl: epUrl,
            servers: parsed.servers,
            seriesId: slug, seasonId, number: num,
            updatedAt: new Date().toISOString()
          });
          seasonIds.add(seasonId);
          newCount++;
          missCount = 0;
          if (mk && code.number) {
            const nx = mk(code.season, code.number + 1);
            if (code.number < 500 && !seenEps.has(nx)) {
              seenEps.add(nx);
              queueEps.push({ url: nx, slug: slugFromUrl(nx) });
            }
          }
        } catch (e) {
          console.log(`   ⚠️ ${e.message}`);
          missCount++;
        }
        await sleep(POLITENESS_MS);
      }

      for (const seasonId of seasonIds) {
        const sn = Number(seasonId.split('-').pop());
        const seasonEps = db.episodes.filter(e => e.seasonId === seasonId);
        upsert(db.seasons, {
          id: seasonId, slug: seasonId, seriesId: slug,
          sourceUrl: detail.sourceUrl, number: sn,
          image: detail.image,
          episodeCount: seasonEps.length,
          initialSyncComplete: sn === 1 && detail.totalEpisodes
            ? seasonEps.length >= detail.totalEpisodes
            : seasonEps.length > 0,
          updatedAt: new Date().toISOString()
        });
      }
      const totalEps = db.episodes.filter(e => e.seriesId === slug).length;
      console.log(`   🎬 Episodios: ${totalEps}${newCount ? ` (${newCount} nuevos)` : ''}`);

    } catch (e) {
      console.log(`❌ Error serie: ${e.message}`);
    }
    doneCount++;
    await sleep(POLITENESS_MS);
    }
  };

  console.log(`\n⚡ Procesando con ${WORKERS} trabajadores en paralelo…`);
  await Promise.all(Array.from({ length: WORKERS }, processItem));

  await ckLock;

  db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));
  db.meta = {
    ...(db.meta || {}),
    version: 1,
    source: `${BASE_URL}/`,
    syncedAt: new Date().toISOString(),
    lastSync: { status: 'success', type: 'full', startedAt, finishedAt: new Date().toISOString(), error: null }
  };
  await saveCatalog(db);

  console.log('\n====================================================');
  console.log(`🎉 SYNC [${CATALOG_TAG}] TERMINADO`);
  console.log(`📚 Series: ${db.series.length} | 🎬 Episodios: ${db.episodes.length} | 🎭 Géneros: ${db.genres.length}`);
  console.log('====================================================\n');
}

main().catch(async e => {
  console.error('\n💥 ERROR FATAL:', e);
  try {
    const db = await loadCatalog();
    db.meta = { ...(db.meta || {}), lastSync: { status: 'error', finishedAt: new Date().toISOString(), error: e.message } };
    await saveCatalog(db);
  } catch {}
  process.exitCode = 1;
});
