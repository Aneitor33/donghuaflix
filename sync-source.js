import fs from 'node:fs/promises';
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

const MAX_DISCOVERY_PAGES = 60;
const FETCH_TIMEOUT_MS = 30000;
const FETCH_RETRIES = 3;
const POLITENESS_MS = 600;

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
    const url = absolute($(el).attr('href'), pageUrl);
    if (!url || !sameOrigin(url)) return;
    try {
      const p = new URL(url).pathname;
      if (LINK_PREFIXES.some(pre => p.startsWith(pre))) links.push(url);
    } catch {}
  });
  return uniqueUrls(links);
}

function extractPagination(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $('a[href]').each((_, el) => {
    const url = absolute($(el).attr('href'), pageUrl);
    if (!url || !sameOrigin(url)) return;
    try {
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
        parseSeriesLinks(html, pageUrl).forEach(u => all.add(u));
        for (const next of extractPagination(html, pageUrl)) {
          if (!visited.has(next) && !queue.includes(next)) queue.push(next);
        }
      } catch (e) {
        console.log(`   ⚠️ ${e.message}`);
      }
      await sleep(POLITENESS_MS);
    }
  }
  console.log(`\n🎯 TOTAL [${CATALOG_TAG}] DESCUBIERTOS: ${all.size}`);
  return [...all];
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
    const c = bodyTxt.match(/Pa[ií]s\s+(China|Corea|Jap[oó]n|Tailandia)/i);
    if (c) details.country = clean(c[1]);
  }
  const epM = bodyTxt.match(/(\d+)\s+de\s+(\d+)\s+online/i);
  if (epM) { details.online = Number(epM[1]); details.total = Number(epM[2]); }

  // Géneros: enlaces de género (doramasflix) o línea "Género: X, Y" (cuevana)
  const genres = [];
  $('a[href*="/etiquetas/"], a[href*="/generos/"], a[href*="/genero"]').each((_, el) => {
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

  return {
    id: slug, slug, title, image: image || null, synopsis: synopsis || null,
    status: details.status || null,
    country: details.country || null,
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
  const addServer = (name, raw, embed = false) => {
    const u = absolute(raw, url);
    if (!u) return;
    const key = name.toLowerCase();
    if (servers.some(s => s.url === u)) return;
    servers.push({ name: clean(name) || 'Servidor', url: u, embed: Boolean(embed) });
  };
  $('iframe[src]').each((_, el) => {
    const src = absolute($(el).attr('src'), url);
    if (!src || sameOrigin(src)) return;
    let host = 'Servidor';
    try { host = new URL(src).hostname.replace(/^www\./, ''); } catch {}
    addServer(host, src, true);
  });
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = absolute(href, url);
    if (!full || sameOrigin(full)) return;
    if (/ok\.ru|streamtape|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega/i.test(full)) {
      let host = 'Servidor';
      try { host = new URL(full).hostname.replace(/^www\./, ''); } catch {}
      addServer(host, full, false);
    }
  });
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
  const discovered = await discoverSeries();

  const startedAt = new Date().toISOString();
  const allGenres = new Set(db.genres);

  for (let i = 0; i < discovered.length; i++) {
    const url = discovered[i];
    const slug = slugFromUrl(url);
    console.log(`\n${i + 1}/${discovered.length} — ${slug}`);

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
      if (GENRE_FILTER && !detail.genres.some(g => g.toLowerCase().includes(GENRE_FILTER))) {
        console.log(`   ⏭️  Fuera del género "${GENRE_FILTER}": ${detail.genres.join(', ') || 'sin género'}`);
        continue;
      }

      upsert(db.series, seriesItem);
      detail.genres.forEach(g => allGenres.add(g));

      // CHECKPOINT cada 10 series
      if ((i + 1) % 10 === 0) {
        await saveCatalog(db);
        console.log(`💾 Checkpoint: ${i + 1}/${discovered.length}`);
      }

      const isMovie = MOVIE_PREFIXES.some(pre => new URL(url).pathname.startsWith(pre));

      let episodeSource;
      if (isMovie) {
        // Película: un único episodio cuyos servidores están en la propia ficha
        episodeSource = [{ url, slug: `${slug}-pelicula`, html }];
      } else {
        const all = await collectAllEpisodeUrls(url);
        if (all.length > detail.episodeUrls.length) {
          console.log(`   📄 Episodios con paginación: ${detail.episodeUrls.length} → ${all.length}`);
        }
        episodeSource = all.map(u => ({ url: u, slug: slugFromUrl(u) }));
      }

      const seasonIds = new Set();
      let newCount = 0;
      for (const ep of episodeSource) {
        const epUrl = ep.url;
        const epSlug = ep.slug || slugFromUrl(epUrl);
        const code = parseEpCodeFromUrl(epUrl) || parseEpCode(epSlug);
        const seasonId = `${slug}-${code.season}`;
        const oldEp = db.episodes.find(e => e.id === epSlug);
        if (oldEp) { seasonIds.add(seasonId); continue; } // ya lo tenemos (incremental)
        try {
          console.log(`   ▶ ${epSlug}`);
          const epHtml = ep.html || await fetchHtml(epUrl);
          const parsed = parseEpisode(epHtml, epUrl);
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
        } catch (e) {
          console.log(`   ⚠️ ${e.message}`);
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
    await sleep(POLITENESS_MS);
  }

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
