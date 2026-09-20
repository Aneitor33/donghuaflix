// ══════════════════════════════════════════════════════════
//  syncdonghuasub.js — DonghuaFlix
//  Scraper para DONGHUASUB.COM
//  Estructura:
//    - Directorio: /directorio?page=N
//    - Serie: /donghua/slug
//    - Episodio: /donghua/slug/N
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const OUT_FILE = path.resolve('public/data/catalog-donghuasub.json');
const BASE_URL = 'https://donghuasub.com';

// 8 workers como en donghualife
const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 8)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 300);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 20000));
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 30000);

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* Utilidades */
const clean = v => String(v || '').replace(/\s+/g, ' ').trim();

async function sleep(ms) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

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
    const parts = u.pathname.split('/').filter(Boolean);
    return decodeURIComponent(parts.at(-1) || '').replace(/\/$/, '');
  } catch { return ''; }
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

/* Pool de workers (8 workers) */
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

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9'
      }
    });
    if (!response.ok) {
      if (attempt < 3 && [408, 429, 500, 502, 503, 504].includes(response.status)) {
        await sleep(1000 * attempt);
        return fetchHtml(url, attempt + 1);
      }
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (attempt < 3) {
      await sleep(1000 * attempt);
      return fetchHtml(url, attempt + 1);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/* Descubrir series desde /directorio?page=N */
async function discoverSeries() {
  const found = new Set();

  // Sondeo páginas 1-50 (o hasta que no haya más)
  for (let page = 1; page <= 50; page++) {
    if (timeUp()) break;

    const url = page === 1 ? `${BASE_URL}/directorio` : `${BASE_URL}/directorio?page=${page}`;

    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      let count = 0;

      // Buscar enlaces /donghua/ (fichas de series)
      $('a[href*="/donghua/"]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;

        // Filtrar: debe ser /donghua/slug (sin número al final = no es episodio)
        const match = href.match(/\/donghua\/([a-z0-9-]+)\/?$/i);
        if (match) {
          const full = canonical(absolute(href, url));
          if (full && sameOrigin(full) && !found.has(full)) {
            found.add(full);
            count++;
          }
        }
      });

      console.log(`📄 Página ${page}: ${count} series (total: ${found.size})`);

      // Si no hay nuevas en esta página y no es la primera, puede ser el final
      if (page > 1 && count === 0) {
        console.log(`🛑 Fin del directorio (página ${page})`);
        break;
      }

    } catch (e) {
      console.log(`⚠️ Error página ${page}: ${e.message}`);
    }

    await sleep(POLITENESS_MS);
  }

  console.log(`\n🎯 Total series descubiertas: ${found.size}`);
  return [...found];
}

/* Parsear episodio (extraer video) */
function parseEpisode(html, episodeUrl) {
  const $ = cheerio.load(html);

  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(episodeUrl)
  );

  const servers = [];

  // Buscar iframes de video (DailyMotion, etc.)
  $('iframe[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (src && /dailymotion|youtube|vimeo|ok\.ru|streamtape|fembed|voe|vidmoly|rumble|mp4upload/i.test(src)) {
      servers.push({ name: 'Servidor', url: src, embed: true });
    }
  });

  // Buscar en scripts por si está el video embebido
  $('script').each((_, el) => {
    const txt = $(el).html() || '';
    const m = txt.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9_-]+)/i);
    if (m) {
      const u = `https://www.dailymotion.com/embed/video/${m[1]}`;
      if (!servers.some(s => s.url === u)) {
        servers.push({ name: 'DailyMotion', url: u, embed: true });
      }
    }
  });

  return { title, servers };
}

/* Parsear serie: extraer info + lista de episodios */
function parseSeries(html, url) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  let title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );

  // Limpiar sufijos
  title = title.replace(/\s*[-|]\s*DonghuaSub.*$/i, '').trim();

  const synopsis = clean(
    $('meta[name="description"]').attr('content') ||
    $('[class*="description"], [class*="synopsis"]').first().text()
  );

  // Detectar episodios: buscar enlaces /donghua/slug/N
  const episodes = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;

    // Patrón: /donghua/slug/N (donde N es el número de episodio)
    const match = href.match(/\/donghua\/([a-z0-9-]+)\/(\d+)\/?$/i);
    if (match && match[1] === slug) {
      const num = parseInt(match[2], 10);
      const full = canonical(absolute(href, url));
      if (full && sameOrigin(full)) {
        episodes.push({
          url: full,
          number: num,
          title: `Episodio ${num}`
        });
      }
    }
  });

  // Ordenar por número
  episodes.sort((a, b) => a.number - b.number);

  // Eliminar duplicados
  const seen = new Set();
  const unique = episodes.filter(ep => {
    if (seen.has(ep.number)) return false;
    seen.add(ep.number);
    return true;
  });

  return {
    slug,
    title,
    synopsis: synopsis || null,
    image: absolute($('meta[property="og:image"]').attr('content'), url),
    episodes: unique
  };
}

/* Procesar una serie completa */
async function processSeries(db, seriesUrl) {
  const slug = slugFromUrl(seriesUrl);

  const html = await fetchHtml(seriesUrl);
  const series = parseSeries(html, seriesUrl);

  // Guardar/actualizar serie
  const seriesData = {
    id: slug,
    slug,
    title: series.title,
    synopsis: series.synopsis,
    image: series.image,
    type: 'donghua',
    src: 'donghuasub',
    sourceUrls: [seriesUrl],
    updatedAt: new Date().toISOString()
  };

  const existing = db.series.findIndex(s => s.id === slug);
  if (existing >= 0) db.series[existing] = { ...db.series[existing], ...seriesData };
  else db.series.push(seriesData);

  console.log(`   📝 ${series.title}`);
  console.log(`   🎬 ${series.episodes.length} episodios detectados`);

  // Procesar episodios
  for (const ep of series.episodes) {
    if (timeUp()) break;

    const epId = `${slug}-e${ep.number}`;

    // Verificar si ya existe
    if (db.episodes.some(e => e.id === epId)) {
      continue;
    }

    try {
      const epHtml = await fetchHtml(ep.url);
      const parsed = parseEpisode(epHtml, ep.url);

      if (parsed.servers.length === 0) {
        console.log(`      ⚠️ ${ep.title}: sin servidores`);
        continue;
      }

      // Crear temporada si no existe
      const seasonId = `${slug}-t1`;
      if (!db.seasons.some(s => s.id === seasonId)) {
        db.seasons.push({
          id: seasonId,
          slug: seasonId,
          seriesId: slug,
          number: 1,
          updatedAt: new Date().toISOString()
        });
      }

      db.episodes.push({
        id: epId,
        slug: epId,
        title: parsed.title || ep.title,
        sourceUrl: ep.url,
        servers: parsed.servers,
        seriesId: slug,
        seasonId,
        number: ep.number,
        updatedAt: new Date().toISOString()
      });

      console.log(`      ✅ ${ep.title} (${parsed.servers.length} servidor)`);
    } catch (e) {
      console.log(`      ❌ ${ep.title}: ${e.message}`);
    }

    await sleep(POLITENESS_MS);
  }
}

/* Main */
async function main() {
  console.log('🚀 DONGHUASUB SYNC');
  console.log(`   workers: ${WORKERS} | tope tiempo: ${MAX_RUNTIME_MS/60000} min\n`);

  // Cargar catálogo
  let db;
  try {
    db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }

  // Descubrir series
  console.log('🔍 Descubriendo series en /directorio...');
  const seriesUrls = await discoverSeries();
  console.log(`\n📚 Total series: ${seriesUrls.length}`);

  // Procesar con pool de workers (8 workers)
  let done = 0;
  await runPool(seriesUrls, WORKERS, async (url) => {
    const i = ++done;
    console.log(`\n[${i}/${seriesUrls.length}] ${slugFromUrl(url)}`);

    try {
      await processSeries(db, url);

      // Checkpoint cada 5 series
      if (i % 5 === 0) {
        await fs.writeFile(OUT_FILE, JSON.stringify(db));
        console.log(`💾 Checkpoint guardado (${i}/${seriesUrls.length})`);
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  });

  // Actualizar contadores
  for (const season of db.seasons) {
    season.episodeCount = db.episodes.filter(e => e.seasonId === season.id).length;
  }

  // Guardar final
  db.meta = {
    source: BASE_URL,
    syncedAt: new Date().toISOString(),
    series: db.series.length,
    episodes: db.episodes.length
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(db));

  console.log('\n═══════════════════════════════════════');
  console.log('🎉 DONGHUASUB TERMINADO');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`🎬 Episodios: ${db.episodes.length}`);
  console.log(`⏱️ Duración: ${elapsedMin()} min`);
}

main().catch(e => {
  console.error('💥 FATAL:', e);
  process.exit(1);
});
