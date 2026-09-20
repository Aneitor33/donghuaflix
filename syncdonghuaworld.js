// ══════════════════════════════════════════════════════════
//  syncdonghuaworld.js — DonghuaFlix (VERSIÓN PLAYWRIGHT)
//  Scraper para DONGHUAWORLD.COM con navegador (JavaScript)
//  Estructura:
//    - Catálogo: /anime/ (con paginación)
//    - Serie: /anime/nombre-de-la-serie/
//    - Episodio: /nombre-serie-episode-XX-YY-multi-subtitles/
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_FILE = path.resolve('public/data/catalog-donghuaworld.json');
const BASE_URL = 'https://donghuaworld.com';

// Configuración
const WORKERS = Math.max(1, Math.min(4, Number(process.env.WORKERS || 3)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 500);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 5000));

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

// Navegador
let browser = null;
let context = null;

async function getBrowser() {
  if (!browser) {
    const { chromium } = await import('playwright');
    browser = await chromium.launch({ headless: true });
    context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1366, height: 768 }
    });
  }
  return { browser, context };
}

async function fetchPage(url, waitSelector = null) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });

    // Esperar un poco por si acaso hay carga diferida
    await page.waitForTimeout(3000);

    return await page.content();
  } finally {
    await page.close();
  }
}

/* Descubrir series desde /anime/ */
async function discoverSeries() {
  const found = new Set();

  console.log('🔍 Descubriendo series en /anime/...');

  // Sondeo páginas 1-31 (según confirmación del usuario)
  // Estructura real: página 1 es la home, luego /page/N/
  for (let page = 1; page <= 31; page++) {
    if (timeUp()) break;

    const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;

    try {
      // Esperar a que cargue el listado (sin selector específico)
      const html = await fetchPage(url);

      // Extraer enlaces de fichas de series
      const regex = /href="\/anime\/([a-z0-9-]+)\/"[^>]*>/gi;
      let match;
      let count = 0;

      while ((match = regex.exec(html)) !== null) {
        const slug = match[1];
        // Filtrar: no debe ser página de categoría o tag
        if (slug && !slug.includes('page') && !slug.includes('category') && !slug.includes('tag')) {
          const full = `${BASE_URL}/anime/${slug}/`;
          if (!found.has(full)) {
            found.add(full);
            count++;
          }
        }
      }

      console.log(`📄 Página ${page}: ${count} series (total: ${found.size})`);

      if (page > 1 && count === 0) {
        console.log(`🛑 Fin del catálogo`);
        break;
      }

    } catch (e) {
      console.log(`⚠️ Error página ${page}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, POLITENESS_MS));
  }

  return [...found];
}

/* Extraer video de episodio */
async function extractVideo(episodeUrl) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    await page.goto(episodeUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Esperar a que cargue el reproductor
    await page.waitForSelector('iframe, [class*="player"], [class*="video"]', { timeout: 15000 });

    // Intentar hacer clic en botones de servidor si existen
    const buttons = await page.$$('button, a[class*="server"], [class*="tab"], .nav-tabs button');
    for (const btn of buttons) {
      try {
        const text = await btn.textContent();
        if (text && (text.includes('Server') || text.includes('4K') || text.includes('HD') || text.includes('Stream'))) {
          await btn.click();
          await page.waitForTimeout(3000);
          break;
        }
      } catch {}
    }

    // Extraer iframe del video
    const iframeSrc = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.src;
        if (src && !src.includes('donghuaworld.com') && (src.includes('dailymotion') || src.includes('youtube') || src.includes('ok.ru') || src.includes('streamtape') || src.includes('fembed') || src.includes('voe') || src.includes('mp4upload') || src.includes('rumble') || src.includes('vidmoly'))) {
          return src;
        }
      }
      // Si no encuentra específicos, devolver el primero externo
      for (const iframe of iframes) {
        const src = iframe.src;
        if (src && src.startsWith('http') && !src.includes('donghuaworld.com')) {
          return src;
        }
      }
      return null;
    });

    if (iframeSrc) {
      return [{ name: 'Video', url: iframeSrc, embed: true }];
    }

    return [];

  } finally {
    await page.close();
  }
}

/* Procesar una serie */
async function processSeries(db, seriesUrl) {
  const slug = seriesUrl.split('/').filter(Boolean).pop();

  const html = await fetchPage(seriesUrl);

  // Extraer título
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  // Guardar serie
  const seriesData = {
    id: slug,
    slug,
    title,
    type: 'donghua',
    src: 'donghuaworld',
    sourceUrls: [seriesUrl],
    updatedAt: new Date().toISOString()
  };

  const existing = db.series.findIndex(s => s.id === slug);
  if (existing >= 0) db.series[existing] = { ...db.series[existing], ...seriesData };
  else db.series.push(seriesData);

  console.log(`   📝 ${title}`);

  // Extraer episodios (enlaces con patrón -episode-XX-YY-)
  const epRegex = /href="\/([a-z0-9-]+-episode-(\d+)(?:-(\d+))?-multi-subtitles\/)/gi;
  const epMatches = [...html.matchAll(epRegex)];

  const episodes = [];
  const seen = new Set();

  for (const match of epMatches) {
    const epPath = match[1];
    const from = parseInt(match[2], 10);
    const to = match[3] ? parseInt(match[3], 10) : from;

    if (!seen.has(epPath)) {
      seen.add(epPath);
      episodes.push({
        url: `${BASE_URL}/${epPath}`,
        from,
        to,
        title: from === to ? `Episode ${from}` : `Episode ${from}-${to}`
      });
    }
  }

  // Ordenar por número inicial
  episodes.sort((a, b) => a.from - b.from);

  console.log(`   🎬 ${episodes.length} episodios detectados`);

  // Procesar cada episodio
  for (const ep of episodes) {
    if (timeUp()) break;

    const epId = `${slug}-e${ep.from}${ep.to !== ep.from ? '-' + ep.to : ''}`;
    if (db.episodes.some(e => e.id === epId)) continue;

    try {
      const servers = await extractVideo(ep.url);

      if (servers.length === 0) {
        console.log(`      ⚠️ ${ep.title}: sin servidores`);
        continue;
      }

      // Crear temporada
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
        title: ep.title,
        sourceUrl: ep.url,
        servers,
        seriesId: slug,
        seasonId,
        number: ep.from,
        rangeFrom: ep.from,
        rangeTo: ep.to,
        updatedAt: new Date().toISOString()
      });

      console.log(`      ✅ ${ep.title} (${servers.length} servidor)`);

    } catch (e) {
      console.log(`      ❌ ${ep.title}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, POLITENESS_MS));
  }
}

/* Main */
async function main() {
  console.log('🚀 DONGHUAWORLD SYNC (Playwright)');
  console.log(`   workers: ${WORKERS} | tope tiempo: ${MAX_RUNTIME_MS/60000} min\n`);

  let db;
  try {
    db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }

  const seriesUrls = await discoverSeries();
  console.log(`\n📚 Total series: ${seriesUrls.length}`);

  let done = 0;
  for (const url of seriesUrls) {
    if (timeUp()) break;

    console.log(`\n[${++done}/${seriesUrls.length}] ${url.split('/').filter(Boolean).pop()}`);

    try {
      await processSeries(db, url);

      if (done % 3 === 0) {
        await fs.writeFile(OUT_FILE, JSON.stringify(db));
        console.log(`💾 Checkpoint (${done}/${seriesUrls.length})`);
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }
  }

  db.meta = {
    source: BASE_URL,
    syncedAt: new Date().toISOString(),
    series: db.series.length,
    episodes: db.episodes.length
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(db));

  console.log('\n═══════════════════════════════════════');
  console.log('🎉 DONGHUAWORLD TERMINADO');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`🎬 Episodios: ${db.episodes.length}`);
  console.log(`⏱️ Duración: ${elapsedMin()} min`);

  if (browser) await browser.close();
}

main().catch(async e => {
  console.error('💥 FATAL:', e);
  if (browser) await browser.close();
  process.exit(1);
});
