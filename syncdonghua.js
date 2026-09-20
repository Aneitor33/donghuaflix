// ══════════════════════════════════════════════════════════
//  syncdonghuaworld.js — DonghuaFlix
//  Scraper de DONGHUAWORLD.COM
//  - Episodios en rangos (1-10, 15-18, etc.)
//  - Sondeo de enlaces desde la ficha de cada serie
//  - Filtro por slug para descartar relacionados
//  - Servidor: DailyMotion (extraído del iframe)
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const OUT_FILE = path.resolve('public/data/catalog-donghuaworld.json');
const FAILURES_FILE = path.resolve('public/data/catalog-donghuaworld-failures.json');

const WORKERS = Math.max(1, Math.min(8, Number(process.env.WORKERS || 4)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 800);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 10000));

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

const SOURCE = {
  id: 'donghuaworld',
  base: 'https://donghuaworld.com',
  listPattern: /^\/?page\/\d+\/?$/i,
  seriesPattern: /^\/anime\/[a-z0-9-]+\/?$/i,
  episodePattern: /^\/[a-z0-9-]+-episode-\d+(-\d+)?-multi-subtitles\/?$/i
};

/* Utilidades */
const clean = v => String(v || '').replace(/\s+/g, ' ').trim();
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

async function fetchHtml(url, attempt = 1) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9'
      }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
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

/* Extraer video de DailyMotion del HTML del episodio */
function parseEpisode(html, url) {
  const $ = cheerio.load(html);
  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(url)
  );

  const servers = [];

  // Buscar iframe de DailyMotion
  $('iframe[src*="dailymotion"]').each((_, el) => {
    const src = $(el).attr('src');
    if (src) servers.push({ name: 'DailyMotion', url: src, embed: true });
  });

  // Buscar en scripts por si está el ID del video
  $('script').each((_, el) => {
    const txt = $(el).html() || '';
    const m = txt.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9_-]+)/i) ||
              txt.match(/video\/([a-zA-Z0-9_-]{6,20})/i);
    if (m && m[1]) {
      const videoUrl = `https://www.dailymotion.com/embed/video/${m[1]}`;
      if (!servers.some(s => s.url === videoUrl)) {
        servers.push({ name: 'DailyMotion', url: videoUrl, embed: true });
      }
    }
  });

  return { title, servers };
}

/* Extraer info de la serie + lista de episodios */
function parseSeries(html, url) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  // El título suele estar en h1 o en el título de la página
  let title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );

  // Limpiar " - DonghuaWorld" del título si existe
  title = title.replace(/\s*[-|]\s*DonghuaWorld.*$/i, '').trim();

  const synopsis = clean(
    $('meta[name="description"]').attr('content') ||
    $('.description, .synopsis, [class*="desc"]').first().text()
  );

  // Detectar todos los enlaces de episodios que pertenecen a ESTA serie
  const episodes = [];
  const baseSlug = slug.replace(/^anime-/, '').replace(/\/$/, '');

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = absolute(href, url);
    if (!full || !sameOrigin(full, url)) return;

    try {
      const path = new URL(full).pathname;
      // Debe coincidir con el patrón de episodio Y contener el slug base
      if (SOURCE.episodePattern.test(path)) {
        const epSlug = slugFromUrl(full);
        // Filtrar: el slug del episodio debe empezar con el slug de la serie (o ser muy similar)
        // Ej: serie "yao-dao-supreme-season-2", episodio "yao-dao-supreme-season-2-episode-1-10-multi-subtitles"
        if (epSlug.startsWith(baseSlug) || epSlug.includes(baseSlug)) {
          // Extraer el rango del episodio del slug
          const rangeMatch = epSlug.match(/episode-(\d+)(?:-(\d+))?-multi-subtitles/i);
          if (rangeMatch) {
            const from = parseInt(rangeMatch[1], 10);
            const to = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : from;
            episodes.push({
              url: full,
              slug: epSlug,
              from,
              to,
              title: `Episode ${rangeMatch[1]}${rangeMatch[2] ? '-' + rangeMatch[2] : ''}`
            });
          }
        }
      }
    } catch {}
  });

  // Ordenar por número de episodio inicial
  episodes.sort((a, b) => a.from - b.from);

  // Eliminar duplicados por slug
  const seen = new Set();
  const uniqueEpisodes = episodes.filter(ep => {
    if (seen.has(ep.slug)) return false;
    seen.add(ep.slug);
    return true;
  });

  return {
    slug,
    title,
    synopsis: synopsis || null,
    image: absolute($('meta[property="og:image"]').attr('content'), url),
    episodes: uniqueEpisodes
  };
}

/* Descubrimiento: navegar páginas del listado */
async function discoverSeries() {
  const found = new Set();
  let page = 1;
  let emptyPages = 0;

  while (page <= 50 && emptyPages < 3 && !timeUp()) {
    const url = page === 1 ? SOURCE.base : `${SOURCE.base}/page/${page}/`;
    console.log(`📄 Página ${page}: ${url}`);

    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      let pageCount = 0;

      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const full = absolute(href, url);
        if (!full || !sameOrigin(full, url)) return;
        try {
          const path = new URL(full).pathname;
          if (SOURCE.seriesPattern.test(path)) {
            if (!found.has(full)) {
              found.add(full);
              pageCount++;
            }
          }
        } catch {}
      });

      console.log(`   → ${pageCount} series nuevas (total: ${found.size})`);

      if (pageCount === 0) {
        emptyPages++;
      } else {
        emptyPages = 0;
      }
    } catch (e) {
      console.log(`   ⚠️ Error: ${e.message}`);
      emptyPages++;
    }

    page++;
    await sleep(POLITENESS_MS);
  }

  return [...found];
}

/* Procesar un episodio */
async function scrapeEpisode(ep, seriesSlug) {
  const html = await fetchHtml(ep.url);
  const parsed = parseEpisode(html, ep.url);

  if (parsed.servers.length === 0) {
    throw new Error('Sin servidores');
  }

  return {
    id: `${seriesSlug}-e${ep.from}${ep.to !== ep.from ? '-' + ep.to : ''}`,
    slug: ep.slug,
    title: ep.title,
    sourceUrl: ep.url,
    servers: parsed.servers,
    seriesId: seriesSlug,
    seasonId: `${seriesSlug}-t1`, // DonghuaWorld no tiene temporadas separadas, todo es temp 1
    number: ep.from, // Usamos el número inicial como identificador
    rangeFrom: ep.from,
    rangeTo: ep.to,
    updatedAt: new Date().toISOString()
  };
}

/* Main */
async function main() {
  console.log('🚀 DONGHUAWORLD SYNC');
  console.log(`   workers: ${WORKERS} · tope episodios: ${MAX_EPISODE_CRAWLS} · tope tiempo: ${MAX_RUNTIME_MS/60000} min\n`);

  // Cargar catálogo existente
  let db;
  try {
    db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }

  // 1. Descubrir series
  console.log('🔍 Descubriendo series...');
  const seriesUrls = await discoverSeries();
  console.log(`\n📚 Total series encontradas: ${seriesUrls.length}`);

  // 2. Procesar cada serie
  let done = 0;
  let newEpisodes = 0;
  let failed = 0;

  for (const seriesUrl of seriesUrls) {
    if (timeUp()) break;

    const seriesSlug = slugFromUrl(seriesUrl);
    console.log(`\n[${++done}/${seriesUrls.length}] ${seriesSlug}`);

    try {
      // Verificar si ya tenemos esta serie completa
      const existingEps = db.episodes.filter(e => e.seriesId === seriesSlug);

      const html = await fetchHtml(seriesUrl);
      const series = parseSeries(html, seriesUrl);

      // Guardar/actualizar serie
      const seriesData = {
        id: seriesSlug,
        slug: seriesSlug,
        title: series.title,
        synopsis: series.synopsis,
        image: series.image,
        type: 'donghua',
        src: 'donghuaworld',
        sourceUrls: [seriesUrl],
        updatedAt: new Date().toISOString()
      };

      const existingSeries = db.series.findIndex(s => s.id === seriesSlug);
      if (existingSeries >= 0) {
        db.series[existingSeries] = { ...db.series[existingSeries], ...seriesData };
      } else {
        db.series.push(seriesData);
      }

      // Asegurar temporada 1 existe
      const seasonId = `${seriesSlug}-t1`;
      if (!db.seasons.some(s => s.id === seasonId)) {
        db.seasons.push({
          id: seasonId,
          slug: seasonId,
          seriesId: seriesSlug,
          number: 1,
          updatedAt: new Date().toISOString()
        });
      }

      console.log(`   📝 ${series.title}`);
      console.log(`   🎬 ${series.episodes.length} episodios detectados`);

      // 3. Scrapear episodios que faltan
      for (const ep of series.episodes) {
        if (timeUp()) break;
        if (newEpisodes >= MAX_EPISODE_CRAWLS) break;

        // Verificar si ya existe
        const epId = `${seriesSlug}-e${ep.from}${ep.to !== ep.from ? '-' + ep.to : ''}`;
        if (db.episodes.some(e => e.id === epId)) {
          continue;
        }

        try {
          const epData = await scrapeEpisode(ep, seriesSlug);
          db.episodes.push(epData);
          newEpisodes++;
          console.log(`      ✅ ${ep.title} (${epData.servers.length} servidor)`);
        } catch (e) {
          failed++;
          console.log(`      ❌ ${ep.title}: ${e.message}`);
        }

        await sleep(POLITENESS_MS);
      }

      // Guardar cada 5 series
      if (done % 5 === 0) {
        await fs.writeFile(OUT_FILE, JSON.stringify(db));
        console.log(`💾 Checkpoint guardado (${done}/${seriesUrls.length})`);
      }

    } catch (e) {
      console.log(`   ❌ Error serie: ${e.message}`);
    }

    await sleep(POLITENESS_MS);
  }

  // 4. Actualizar contadores de temporadas
  for (const season of db.seasons) {
    season.episodeCount = db.episodes.filter(e => e.seasonId === season.id).length;
  }

  // 5. Guardar final
  db.meta = {
    ...db.meta,
    source: 'donghuaworld.com',
    syncedAt: new Date().toISOString(),
    series: db.series.length,
    episodes: db.episodes.length
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(db));

  console.log('\n═══════════════════════════════════════');
  console.log('🎉 SYNC DONGHUAWORLD TERMINADO');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`🎬 Episodios nuevos: ${newEpisodes}`);
  console.log(`❌ Fallidos: ${failed}`);
  console.log(`⏱️  Duración: ${elapsedMin()} min`);
}

main().catch(e => {
  console.error('💥 FATAL:', e);
  process.exit(1);
});
