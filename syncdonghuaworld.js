// ══════════════════════════════════════════════════════════
//  syncdonghuaworld.js — DonghuaFlix (VERSIÓN OPTIMIZADA)
//  Scraper Híbrido (HTTP Fast Fetch + Playwright para Vídeos)
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_FILE = path.resolve('public/data/catalog-donghuaworld.json');
const BASE_URL = 'https://donghuaworld.com';

// Configuración
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 300);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

// Instancia global de Playwright (solo se iniciará cuando haga falta extraer vídeo)
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

/**
 * Petición HTTP ultrarrápida para descargar HTML plano de catálogos y fichas.
 */
async function fetchHtml(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    if (!response.ok) throw new Error(`HTTP Error ${response.status}`);
    return await response.text();
  } catch (e) {
    console.error(`⚠️ Error al obtener HTML (${url}): ${e.message}`);
    return null;
  }
}

/**
 * Descubrir TODAS las series usando la lista A-Z + Páginas principales.
 */
async function discoverAllSeries() {
  const seriesFound = new Set();
  console.log('🔍 [1/3] Descubriendo catálogo completo de series...');

  // 1. Escanear Índice A-Z (. , 0-9, A-Z)
  const azLetters = ['.', '0-9', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')];
  for (const letter of azLetters) {
    if (timeUp()) break;
    const url = `${BASE_URL}/a-z-lists/?show=${letter}`;
    const html = await fetchHtml(url);
    if (!html) continue;

    const regex = /href="(?:https?:\/\/donghuaworld\.com)?\/anime\/([a-z0-9-]+)\/?"/gi;
    let match;
    let count = 0;
    while ((match = regex.exec(html)) !== null) {
      const slug = match[1];
      if (slug && !['page', 'category', 'tag', 'status'].includes(slug)) {
        seriesFound.add(`${BASE_URL}/anime/${slug}/`);
        count++;
      }
    }
    console.log(`   🔤 Letra [${letter}]: ${count} series encontradas`);
    await new Promise(r => setTimeout(r, POLITENESS_MS));
  }

  // 2. Escanear las páginas de Novedades (Latest Releases) 1 a 31
  console.log('📄 [2/3] Escaneando páginas de novedades (1 a 31)...');
  for (let page = 1; page <= 31; page++) {
    if (timeUp()) break;
    const url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
    const html = await fetchHtml(url);
    if (!html) continue;

    // Extraer fichas de anime directamente
    const animeRegex = /href="(?:https?:\/\/donghuaworld\.com)?\/anime\/([a-z0-9-]+)\/?"/gi;
    let match;
    while ((match = animeRegex.exec(html)) !== null) {
      const slug = match[1];
      if (slug && !['page', 'category', 'tag'].includes(slug)) {
        seriesFound.add(`${BASE_URL}/anime/${slug}/`);
      }
    }
    await new Promise(r => setTimeout(r, POLITENESS_MS));
  }

  console.log(`\n📚 Total de series únicas catalogadas: ${seriesFound.size}`);
  return [...seriesFound];
}

/**
 * Extraer iframe de reproductor usando Playwright (solo se invoca para extraer vídeo).
 */
async function extractVideo(episodeUrl) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    await page.goto(episodeUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

    // Esperar servidor/iframe
    await page.waitForSelector('iframe, [class*="player"], [class*="video"]', { timeout: 10000 }).catch(() => {});

    // Extraer el src del iframe
    const iframeSrc = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.src;
        if (src && !src.includes('donghuaworld.com') && src.startsWith('http')) {
          return src;
        }
      }
      return null;
    });

    if (iframeSrc) {
      return [{ name: 'Server 1', url: iframeSrc, embed: true }];
    }
    return [];
  } catch {
    return [];
  } finally {
    await page.close();
  }
}

/**
 * Procesar una ficha de serie y obtener sus episodios.
 */
async function processSeries(db, seriesUrl) {
  const slug = seriesUrl.split('/').filter(Boolean).pop();
  const html = await fetchHtml(seriesUrl);
  if (!html) return;

  // Extraer Título
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug.replace(/-/g, ' ');

  // Guardar/Actualizar Serie en DB
  const seriesData = {
    id: slug,
    slug,
    title,
    type: 'donghua',
    src: 'donghuaworld',
    sourceUrls: [seriesUrl],
    updatedAt: new Date().toISOString()
  };

  const existingIdx = db.series.findIndex(s => s.id === slug);
  if (existingIdx >= 0) db.series[existingIdx] = { ...db.series[existingIdx], ...seriesData };
  else db.series.push(seriesData);

  console.log(`\n📝 Serie: ${title}`);

  // 🛠️ REGEX CORREGIDA: Soporta -4k-, rangos (109-112) y variantes
  const epRegex = /href="(?:\/|https?:\/\/donghuaworld\.com\/)?([a-z0-9-]+-episode-(\d+)(?:-(\d+))?(?:-[a-z0-9]+)*-subtitles\/?)"/gi;
  
  const episodes = [];
  const seenPaths = new Set();
  let match;

  while ((match = epRegex.exec(html)) !== null) {
    const epPath = match[1].replace(/^\//, '');
    const from = parseInt(match[2], 10);
    const to = match[3] ? parseInt(match[3], 10) : from;

    if (!seenPaths.has(epPath)) {
      seenPaths.add(epPath);
      episodes.push({
        url: `${BASE_URL}/${epPath}`,
        from,
        to,
        title: from === to ? `Episodio ${from}` : `Episodios ${from}-${to}`
      });
    }
  }

  // Ordenar episodios ascendentemente
  episodes.sort((a, b) => a.from - b.from);
  console.log(`   🎬 ${episodes.length} episodios detectados`);

  // Crear o verificar temporada
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

  // Guardar Episodios
  for (const ep of episodes) {
    if (timeUp()) break;

    const epId = `${slug}-e${ep.from}${ep.to !== ep.from ? '-' + ep.to : ''}`;
    
    // Si el episodio ya existe en el JSON, saltar re-procesamiento
    if (db.episodes.some(e => e.id === epId)) continue;

    // Extraer iframe del reproductor
    const servers = await extractVideo(ep.url);

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

    console.log(`      ✅ ${ep.title} ${servers.length > 0 ? '(Vídeo OK)' : '(Sin reproductor direct)'}`);
    await new Promise(r => setTimeout(r, POLITENESS_MS));
  }
}

/* 🚀 Función Principal */
async function main() {
  console.log('🚀 DONGHUAWORLD SYNC (Versión Optimizada)');
  console.log(`⏱️ Tiempo límite: ${MAX_RUNTIME_MS / 60000} minutos\n`);

  let db;
  try {
    db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }

  // 1. Descubrir todas las URLs de series
  const seriesUrls = await discoverAllSeries();

  // 2. Procesar cada serie
  let done = 0;
  for (const url of seriesUrls) {
    if (timeUp()) break;

    done++;
    console.log(`\n[${done}/${seriesUrls.length}] Procesando...`);
    try {
      await processSeries(db, url);

      // Guardar parcial cada 5 series
      if (done % 5 === 0) {
        await fs.writeFile(OUT_FILE, JSON.stringify(db, null, 2));
        console.log(`💾 Checkpoint guardado (${done}/${seriesUrls.length})`);
      }
    } catch (e) {
      console.error(`   ❌ Error en ${url}: ${e.message}`);
    }
  }

  // Meta final
  db.meta = {
    source: BASE_URL,
    syncedAt: new Date().toISOString(),
    series: db.series.length,
    episodes: db.episodes.length
  };

  await fs.writeFile(OUT_FILE, JSON.stringify(db, null, 2));

  console.log('\n═══════════════════════════════════════');
  console.log('🎉 SINCRONIZACIÓN FINALIZADA');
  console.log(`📚 Series totales: ${db.series.length}`);
  console.log(`🎬 Episodios totales: ${db.episodes.length}`);
  console.log(`⏱️ Tiempo total: ${elapsedMin()} min`);

  if (browser) await browser.close();
}

main().catch(async e => {
  console.error('💥 Error Fatal:', e);
  if (browser) await browser.close();
  process.exit(1);
});
