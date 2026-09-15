import fs from 'node:fs/promises';
import { execSync } from 'node:child_process';
import path from 'node:path';
import * as cheerio from 'cheerio';

/*
   DONGHUAFLIX — SCRAPER DE CDRAMAS (doramasflix.io)
   Totalmente independiente del scraper de donghuas.
   Genera: public/data/catalog-cdrama.json
*/
const BASE_URL = process.env.SOURCE_URL || 'https://doramasflix.io';
const OUT_FILE = path.resolve(process.env.OUT_FILE || 'public/data/catalog-cdrama.json');

const SEEDS = (process.env.SEEDS || '/paises/china,/idiomas/mandarin')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const CATALOG_TAG = process.env.CATALOG_TAG || 'cdrama';
// Prefijos de rutas que identifican FICHAS de contenido (series y películas)
const LINK_PREFIXES = (process.env.LINK_PREFIXES || '/doramas/')
  .split(',').map(s => s.trim()).filter(Boolean);
// Prefijos que son PELÍCULAS (sin episodios: un solo "episodio" con los servidores)
const MOVIE_PREFIXES = (process.env.MOVIE_PREFIXES || '')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_PAGES = Number(process.env.MAX_DISCOVERY_PAGES || 60);
// Si se define, solo se guardan las fichas cuyos géneros incluyan este texto
const GENRE_FILTER = (process.env.GENRE_FILTER || '').toLowerCase();
// Permitir fichas enlazadas desde OTRO dominio (clones que enlazan al dominio
// principal, ej. pelisflixhd1.top → pelisflixhd.blog). Se reescriben al BASE_URL.
const ALLOW_CROSS_ORIGIN = process.env.ALLOW_CROSS_ORIGIN === '1';
// Rutas típicas de reproductor: se aceptan aunque sean del mismo dominio
const PLAYER_PATH = /\/(?:player|play|embed|goto|stream|ver|e|video|reproductor)\//i;
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
// Servidores EXCLUIDOS del catálogo (anuncios agresivos/adultos)
const SERVER_BLACKLIST = (process.env.SERVER_BLACKLIST ||
  'streamhg,earnvids,streamruby,smoothie,playerwish,upstream,dropload')
  .split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
const isBlacklisted = host => SERVER_BLACKLIST.some(b => String(host).toLowerCase().includes(b));
// Si está activado, solo se procesan fichas de películas (se ignoran series)
const ONLY_MOVIES = process.env.ONLY_MOVIES === '1';

let diagCount = 0;

// Comparación sin acentos: animación == animacion, ficción == ficcion
const fold = s => String(s || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase();
// Modo de descubrimiento: seeds | sitemap | both
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

const MAX_DISCOVERY_PAGES = 60;
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 150);
// Trabajadores paralelos: acelera la primera sincronización de catálogos grandes
const WORKERS = Math.max(1, Math.min(8, Number(process.env.WORKERS || 4)));

async function sleep(ms) {
  await new Promise(r => setTimeout(r, ms));
}

const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

/* ---------- URLS ---------- */
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

/* ---------- FETCH ---------- */
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

/* ---------- DESCUBRIMIENTO DE SERIES ---------- */
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

/*
   Sondeo secuencial de un listado: prueba ?page=2, 3, 4...
   hasta que la página falle (404) o no aporte fichas nuevas.
*/
async function probeListingPages(baseUrl, known) {
  const found = [];
  const base = absolute(baseUrl);
  if (!base) return found;

  // Detectar el formato de paginación con n=2:
  // formato A: /page/N/ (estándar WordPress) · formato B: ?page=N
  const formats = [
    (n) => { const u = new URL(base); u.pathname = u.pathname.replace(/\/$/, '') + '/page/' + n + '/'; return u.href; },
    (n) => { const u = new URL(base); u.searchParams.set('page', String(n)); return u.href; }
  ];
  let build = null;
  for (const mk of formats) {
    try {
      const html = await fetchHtml(mk(2));
      if (parseSeriesLinks(html, mk(2)).length) { build = mk; break; }
    } catch { /* probar siguiente formato */ }
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

        // 🧪 Si la página no tiene enlaces <a>, comprobar si los datos vienen
        // embebidos en JSON dentro del HTML (apps SPA que hidratan con datos)
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

    // Sondeo secuencial del listado (?page=N hasta error o sin novedades)
    const probed = await probeListingPages(first, all);
    probed.forEach(u => all.add(u));
  }
  console.log(`\n🎯 TOTAL [${CATALOG_TAG}] DESCUBIERTOS: ${all.size}`);
  return [...all];
}

/* ---------- NORMALIZAR PAÍS (gentilicios → nombre) ---------- */
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

/* ---------- PARSEO DE SERIE ---------- */
function extractMetaLine($) {
  // Línea tipo: "2026 · JAPON · 12 Episodios · Subs By Hope"
  const txt = clean($('h1').parent().text() || '');
  return txt;
}

function parseSeries(html, url) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );

  // Portada vertical: primera imagen grande (el sitio muestra banner + poster)
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

  // Sinopsis: párrafo después de "Ver TITULO Online :"
  let synopsis = '';
  $('p').each((_, el) => {
    const t = clean($(el).text());
    if (t.length > 80 && !synopsis) synopsis = t;
  });

  const bodyTxt = clean($('body').text());

  // Año de estreno: "Fecha de Estreno 2012-09-10" / "Estreno 2024" / cualquier año en la ficha
  let year = null;
  const yM = bodyTxt.match(/(?:estreno|fecha de estreno|a\u00f1o)[^\d]{0,20}((?:19|20)\d{2})/i)
    || title.match(/\b((?:19|20)\d{2})\b/)
    || bodyTxt.match(/\b((?:19|20)\d{2})\b/);
  if (yM) year = Number(yM[1]);

  // Detalles (tabla): Estado, País, Estreno, Episodios
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
    // Mayor número acompañado de "episodios/capítulos" (evita coger "1 temporada")
    const nums = [...bodyTxt.matchAll(/(\d{1,4})\s+(?:episodios|cap[ií]tulos)/gi)].map(x => Number(x[1]));
    if (nums.length) details.total = Math.max(...nums);
  }

  // Géneros: enlaces de género (doramasflix) o línea "Género: X, Y" (cuevana)
  const genres = [];
  $('a[href*="/etiquetas/"], a[href*="/generos/"], a[href*="/genero"], a[href*="genre"], a[href*="/categoria/"]').each((_, el) => {
    const g = clean($(el).text());
    if (g && g.length < 30) genres.push(g);
  });
  if (!genres.length) {
    const gm = bodyTxt.match(/G[eé]nero[s]?:\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ, ]{3,80})/);
    if (gm) gm[1].split(',').forEach(g => { const t = clean(g); if (t) genres.push(t); });
  }

  // Enlaces de episodios: rutas tipo /ver/{slug}... o que contengan el slug
  const episodeUrls = [];
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = absolute(href, url);
    if (!full || !sameOrigin(full)) return;
    try {
      const p = new URL(full).pathname;
      if (p.startsWith('/doramas/')) return; // es la propia ficha u otras series
      if (/\/(ver|episodios?|capitulos?|watch|play)\//i.test(p) || p.includes(slug)) {
        episodeUrls.push(full);
      }
    } catch {}
  });

  // Detección de tipo analizando la ficha (no el nº de episodios encontrados)
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


/*
   Recorre todas las páginas de episodios de una ficha.
   La web muestra ~8 por página y el resto en ?page=2, ?page=3...
*/
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
  const pages = [firstUrl];
  const visitedPages = new Set([normalizeEpPage(firstUrl)]);

  let i = 0;
  while (i < pages.length && i < 30) {
    const url = pages[i++];
    let html;
    try { html = await fetchHtml(url); }
    catch { continue; }

    const $ = cheerio.load(html);

    // Enlaces de episodios
    $('a[href]').each((_, el) => {
      const full = absolute($(el).attr('href'), url);
      if (!full || !sameOrigin(full)) return;
      try {
        if (/\/(capitulos?|ver|episodios?|watch|play)\//i.test(new URL(full).pathname)) add(full);
      } catch {}
    });

    // Episodios por parámetros: ?season=N&ep=M (pelisplay y similares)
    const decoded = html.replace(/&amp;/g, '&');
    const seasonRe = /([A-Za-z0-9\-_\/]*\?season=(\d+)&(?:amp;)?ep=(\d+))/g;
    let sm;
    while ((sm = seasonRe.exec(decoded)) !== null) {
      const full = absolute(sm[1], url);
      if (full && sameOrigin(full)) add(full);
    }

    // Paginación de la ficha (misma ruta + ?page=N)
    $('a[href]').each((_, el) => {
      const full = absolute($(el).attr('href'), url);
      if (!full || !sameOrigin(full)) return;
      try {
        const u = new URL(full);
        const pageMatch = u.pathname.match(/^(.*)\/page\/(\d+)\/?$/) || (u.pathname === basePath && u.searchParams.has('page') ? [null, basePath, u.searchParams.get('page')] : null);
        if (pageMatch && u.origin === new URL(firstUrl).origin) {
          if (pageMatch[1] === basePath || u.pathname === basePath) {
            const key = normalizeEpPage(full);
            if (!visitedPages.has(key)) {
              visitedPages.add(key);
              pages.push(full);
              console.log(`      📄 Página de episodios: ${key}`);
            }
          }
        }
      } catch {}
    });
  }

  return found;
}

/* ---------- PARSEO DE EPISODIO ---------- */
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
  // Formatos conocidos: "{slug}-1x36", "{slug}-1-36", "{slug}-episodio-36"
  let m = String(slug).match(/(\d+)x(\d+)$/);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = String(slug).match(/-(\d+)-(\d+)$/);
  if (m) return { season: Number(m[1]), number: Number(m[2]) };
  m = String(slug).match(/(?:episodio|episode|capitulo|ep|e)-?(\d{1,4})$/i);
  if (m) return { season: 1, number: Number(m[1]) };
  return { season: 1, number: null };
}

function episodeNumberFrom(text, slug) {
  const t = String(text || '');
  let m = t.match(/(?:cap[ií]tulo|episodio|episode|cap|ep)[^\d]*(\d{1,4})/i);
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
    if (isBlacklisted(srvHost) || isBlacklisted(name)) return; // servidores vetados
    if (servers.some(s => s.url === u)) return;
    const srv = { name: clean(name) || 'Servidor', url: u, embed: Boolean(embed) };
    if (lang) srv.lang = lang; // 'latino' | 'subtitulado' | etc.
    servers.push(srv);
  };
  $('iframe[src]').each((_, el) => {
    const src = absolute($(el).attr('src'), url);
    if (!isPlayableUrl(src)) return;
    let host = 'Servidor';
    try { host = new URL(src).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, src, true);
  });
  // Botones de opciones con URLs en data-* + DETECCIÓN DE IDIOMA
  // (las pestañas "Español Latino" / "Subtitulado" preceden a sus servidores)
  let currentLang = null;
  $('[data-url], [data-embed], [data-src], [data-link], [data-player], [data-href], button, a').each((_, el) => {
    const node = $(el);
    const txt = clean(node.text());
    if (txt && txt.length < 30) {
      if (/^latino$|espa[nñ]ol latino/i.test(txt)) { currentLang = 'latino'; return; }
      if (/castellano/i.test(txt)) { currentLang = 'castellano'; return; }
      if (/subtitulad|subt[ií]tulad/i.test(txt)) { currentLang = 'subtitulado'; return; }
    }
    const raw = node.attr('data-url') || node.attr('data-embed') || node.attr('data-src') ||
                node.attr('data-link') || node.attr('data-player') || node.attr('data-href');
    if (!raw) return;
    const full = absolute(raw, url);
    if (!isPlayableUrl(full)) return;
    let host = 'Servidor';
    try { host = new URL(full).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, full, true, currentLang);
  });

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = absolute(href, url);
    if (!full) return;
    const known = /ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega/i.test(full);
    if (!known && !isPlayableUrl(full)) return;
    {
      let host = 'Servidor';
      try { host = new URL(full).hostname.replace(/^www\./, ''); } catch {}
      addServer(host, full, false);
    }
  });
  // MÉTODO EXTRA: barrido de TODO el HTML (incluye URLs dentro de <script>)
  const directRe = /https?:\/\/[^\s"'<>\\]+\.(?:mp4|webm)(\?[^\s"'<>\\]*)?/gi;
  for (const m of html.match(directRe) || []) {
    let host = 'Video directo';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, false);
  }

  const hostRe = /https?:\/\/[^\s"'<>\\]*(?:ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|clipwatching|wolfstream|hexupload|netu|hqq|waaw|primeload|upstream|dropload|streamruby|videzz|smoothie|doodstream|playerwish|streamhg|earnvids)[^\s"'<>\\]*/gi;
  for (const m of html.match(hostRe) || []) {
    let host = 'Servidor';
    try { host = new URL(m).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, m, true);
  }

  return { title, servers };
}

/* ---------- BASE DE DATOS ---------- */
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
  await fs.writeFile(tmp, JSON.stringify(db, null, 2), 'utf8');
  await fs.rename(tmp, OUT_FILE);
}

function upsert(array, item, key = 'id') {
  const i = array.findIndex(e => e[key] === item[key]);
  if (i === -1) array.push(item);
  else array[i] = { ...array[i], ...item };
}

/* ---------- MAIN ---------- */
async function main() {
  console.log(`\n🚀 INICIANDO SYNC [${CATALOG_TAG}] → ${BASE_URL} (${SEEDS.join(', ')})\n`);
  const db = await loadCatalog();

  // Limpieza retroactiva: quitar servidores vetados de episodios ya guardados
  let cleaned = 0;
  for (const ep of db.episodes) {
    if (!Array.isArray(ep.servers)) continue;
    const before = ep.servers.length;
    ep.servers = ep.servers.filter(s => !isBlacklisted(s.name) && !isBlacklisted(s.url || ''));
    if (ep.servers.length !== before) cleaned++;
  }
  if (cleaned) console.log(`🧹 Limpieza: ${cleaned} episodios quitados de servidores con anuncios adultos`);

  // Solo-películas: eliminar series ya guardadas (y sus temporadas/episodios)
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
      console.log(`🧹 Solo películas: eliminadas ${removedIds.size} series del catálogo (${before} → ${db.series.length} títulos)`);
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
      // SIN pull/rebase aquí: mutar el árbol de trabajo a mitad de la corrida
      // rompe los guardados concurrentes (ENOENT). El pull--rebase lo hace
      // el paso final del workflow, cuando ya no hay escrituras.
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

    // Modo solo-películas: descartar series por la ruta, sin gastar petición
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
      // Filtro de género: descartar lo que no coincida (ej: solo "animacion")
      if (GENRE_FILTER && !detail.genres.some(g => fold(g).includes(fold(GENRE_FILTER)))) {
        // Excepción: si el propio seed ya es una búsqueda de género (genre=...)
        // y la ficha no expone géneros, la aceptamos (el listado ya venía filtrado)
        const seedEsDeGenero = SEEDS.some(s => s.includes('genre='));
        if (seedEsDeGenero && !detail.genres.length) {
          console.log(`   ⚠️  Género no legible en la ficha, pero el seed ya es de género → se acepta`);
        } else {
          console.log(`   ⏭️  Fuera del género "${GENRE_FILTER}": ${detail.genres.join(', ') || 'sin género'}`);
          doneCount++;
          return;
        }
      }

      // Filtro de país: descartar lo que no sea del país pedido (ej: solo "china")
      if (COUNTRY_FILTER && !fold(detail.country).includes(fold(COUNTRY_FILTER))) {
        console.log(`   ⏭️  Fuera del país "${COUNTRY_FILTER}": ${detail.country || 'sin país'}`);
        doneCount++;
        return;
      }

      upsert(db.series, seriesItem);
      detail.genres.forEach(g => allGenres.add(g));

      // CHECKPOINT cada 10 items (disco) + PUSH cada 500 (repo, a prueba de cortes)
      if (doneCount % 10 === 0) {
        await withLock(() => saveCatalog(db));
        console.log(`💾 Checkpoint: ${doneCount}/${discovered.length}`);
      }
      if (doneCount - lastPush >= 500) {
        lastPush = doneCount;
        pushProgress();
      }

      const isMovie = MOVIE_PREFIXES.some(pre => new URL(url).pathname.startsWith(pre));

      // Modo solo-películas: ignorar series por completo
      if (ONLY_MOVIES && !isMovie) {
        console.log(`   ⏭️  Solo películas: se ignora la serie ${slug}`);
        continue;
      }

      // Completar episodios: la web pagina vía JS, así que aprendemos el
      // patrón de los enlaces visibles y sondeamos hacia adelante.
      // Soporta DOS formatos:
      //   A) doramasflix:  .../capitulos/slug-1x24      → genera slug-1x25, -1x26...
      //   B) pelisplay:    .../series/slug?season=1&ep=3 → genera ?ep=4, 5, 6...
      // Parada: 4 seguidos que no existen (404 o soft-404 validado).
      let totalKnown = null;
      if (!isMovie) {
        const urls = [...new Set(detail.episodeUrls)];
        const mx = urls.find(u => /(\d+)x(\d+)$/.test(u));
        const ms = urls.find(u => /[?&]season=\d+/.test(u) && /[?&]ep=\d+/.test(u));

        let build = null;   // (n) => url del episodio n
        let numOf = null;   // (url) => nº de episodio
        if (mx) {
          const m = mx.match(/^(.*)-(\d+)x(\d+)(\/?)$/);
          build = (n) => `${m[1]}-${m[2]}x${n}${m[4] || ''}`;
          numOf = (u) => { const mm = u.match(/(\d+)x(\d+)\/?$/); return mm ? Number(mm[2]) : 0; };
        } else if (ms) {
          build = (n) => { const u = new URL(ms); u.searchParams.set('ep', String(n)); return u.href; };
          numOf = (u) => { try { const uu = new URL(u); const e = uu.searchParams.get('ep'); return e ? Number(e) : 0; } catch { return 0; } };
        }

        if (build) {
          const set = new Set(urls);
          const maxKnown = Math.max(0, ...urls.map(numOf));
          totalKnown = detail.totalEpisodes || detail.onlineEpisodes || null;

          // Sondeo abierto: maxKnown+1 → +500 (tope de seguridad)
          for (let n = 1; n <= maxKnown + 500; n++) set.add(build(n));
          const complete = [...set].sort((a, b) => numOf(a) - numOf(b));
          if (complete.length > urls.length) {
            console.log(`   🔧 Sondeo: ${urls.length} visibles → probando hasta el ${maxKnown + 500}${totalKnown ? ` (total declarado: ${totalKnown})` : ' (parada por errores ×4)'}`);
            detail.episodeUrls = complete;
          }
        }
      }

      let episodeSource;
      if (isMovie) {
        // Película: los servidores suelen estar en la subpágina /ver/
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
          } catch { /* usamos la ficha si falla */ }
        }
        episodeSource = [{ url, slug: `${slug}-pelicula`, html: playerHtml }];
      } else {
        const crawled = await collectAllEpisodeUrls(url);

        // 🩺 DIAGNÓSTICO: si no hay enlaces de episodios, la serie usa
        // reproductor embebido (JS). Volcar pistas al log para adaptar el parser.
        if (!crawled.length) {
          console.log('   🩺 SERIE CON REPRODUCTOR EMBEBIDO — volcando diagnóstico completo…');
          const htmlLower = html.toLowerCase();

          // 1) Palabras clave con contexto
          for (const kw of ['episodio', 'episode', 'temporada', 'season']) {
            const i = htmlLower.indexOf(kw);
            if (i !== -1) {
              const frag = html.slice(Math.max(0, i - 60), i + 220)
                .replace(/\s+/g, ' ').replace(/</g, '<').trim();
              console.log(`   🩺 [${kw}] …${frag.slice(0, 260)}`);
            }
          }

          // 2) Elementos con atributos data-* de episodio (botones del selector)
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

          // 3) Variables JS sospechosas
          const vars = new Set();
          for (const m of html.matchAll(/(?:var|let|const)\s+(\w*(?:episode|season|player|eps?|cap)\w*)\s*=/gi)) {
            vars.add(m[1]);
          }
          if (vars.size) console.log(`   🩺 [vars] ${[...vars].slice(0, 8).join(', ')}`);

          // 4) Endpoint AJAX y acciones del reproductor
          const ajax = (html.match(/admin-ajax\.php/g) || []).length;
          if (ajax) {
            console.log(`   🩺 admin-ajax.php ×${ajax}`);
            const actions = new Set();
            for (const m of html.matchAll(/action['"\s:=]+['"]([\w-]+)['"]/gi)) actions.add(m[1]);
            if (actions.size) console.log(`   🩺 [actions] ${[...actions].slice(0, 8).join(', ')}`);
          }
          const postid = html.match(/postid-(\d+)/);
          if (postid) console.log(`   🩺 postid: ${postid[1]}`);

          // 5) Muestra de JSON embebido con episodios
          const jm = html.match(/\{[^{}]{0,400}(?:episode|season|episodio|temporada)[^{}]{0,400}\}/i);
          if (jm) console.log(`   🩺 [json] ${jm[0].replace(/\s+/g, ' ').slice(0, 320)}`);
        }
        // UNIR: lo visto en la página + lo generado por sondeo (detail.episodeUrls)
        const merged = [...new Set([...crawled, ...detail.episodeUrls])]
          .sort((a, b) => {
            const na = a.match(/-(\d+)x(\d+)$/) || a.match(/[?&]ep=(\d+)/);
            const nb = b.match(/-(\d+)x(\d+)$/) || b.match(/[?&]ep=(\d+)/);
            return (na && nb) ? Number(na[2] || na[1]) - Number(nb[2] || nb[1]) : 0;
          });
        if (merged.length > crawled.length) {
          console.log(`   📄 Episodios tras sondeo: ${crawled.length} → ${merged.length}`);
        }
        episodeSource = merged.map(u => ({ url: u, slug: slugFromUrl(u) }));
      }

      const seasonIds = new Set();
      let newCount = 0;
      let missCount = 0;
      for (const ep of episodeSource) {
        const epUrl = ep.url;
        const epSlug = ep.slug || slugFromUrl(epUrl);
        const code = parseEpCodeFromUrl(epUrl) || parseEpCode(epSlug);
        const seasonId = `${slug}-${code.season}`;
        const oldEp = db.episodes.find(e => e.id === epSlug);
        if (oldEp && (oldEp.servers || []).length > 0) {
          // Ya lo tenemos con servidores: nada que hacer
          seasonIds.add(seasonId);
          missCount = 0;
          continue;
        }
        if (oldEp) {
          // Existe pero SIN servidores: probablemente de un run anterior
          // con extracción rota → lo volvemos a procesar y actualizar
          console.log(`   ↻ ${epSlug} — existía sin servidores, re-procesando`);
        }
        // 4 seguidos que no existen = fin de temporada (con o sin total)
        if (missCount >= 4) {
          console.log(`   🛑 Fin de temporada detectado: 4 episodios seguidos no existen`);
          break;
        }
        try {
          console.log(`   ▶ ${epSlug}`);
          const epHtml = ep.html || await fetchHtml(epUrl);
          const parsed = parseEpisode(epHtml, epUrl);

          // 🧪 Si la ficha no da servidores, volcar cómo guarda el reproductor
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

          // SOFT-404: doramasflix devuelve HTTP 200 en páginas de error.
          // Un episodio real tiene servidores O título con "capítulo/episodio".
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
        } catch (e) {
          console.log(`   ⚠️ ${e.message}`);
          missCount++;
        }
        await sleep(POLITENESS_MS);
      }

      // Actualizar todas las temporadas tocadas
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

  // Pool de trabajadores paralelos
  console.log(`\n⚡ Procesando con ${WORKERS} trabajadores en paralelo…`);
  await Promise.all(Array.from({ length: WORKERS }, processItem));

  await ckLock; // esperar pushes/guardados pendientes

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
