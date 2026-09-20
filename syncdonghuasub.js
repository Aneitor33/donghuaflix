// ══════════════════════════════════════════════════════════
//  syncdonghuasub.js — DonghuaFlix (VERSIÓN PLAYWRIGHT)
//  Scraper para DONGHUASUB.COM con navegador (JavaScript)
//  Estructura:
//    - Directorio: /directorio?page=N (se carga por JS)
//    - Serie: /donghua/slug
//    - Episodio: /donghua/slug/N (videos cargan por JS)
//  Requiere: PLAYWRIGHT instalado en el workflow
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_FILE = path.resolve('public/data/catalog-donghuasub.json');
const BASE_URL = 'https://donghuasub.com';

// Configuración
const WORKERS = Math.max(1, Math.min(4, Number(process.env.WORKERS || 3))); // Menos workers por ser navegador
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 500);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 5000));

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

// Navegador global
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
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });

    // Si se especifica un selector, esperar a que aparezca
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 10000 });
    }

    // Extraer el HTML renderizado
    const html = await page.content();
    return html;
  } finally {
    await page.close();
  }
}

/* Descubrir series desde /directorio (con JS) */
async function discoverSeries() {
  const found = new Set();

  console.log('🔍 Descubriendo series (esperando JavaScript)...');

  // Sondeo páginas 1-10 (o hasta que no haya más)
  for (let page = 1; page <= 10; page++) {
    if (timeUp()) break;

    const url = page === 1 ? `${BASE_URL}/directorio` : `${BASE_URL}/directorio?page=${page}`;

    try {
      // Esperar a que cargue el listado de series
      const html = await fetchPage(url, 'a[href*="/donghua/"]');

      // Extraer enlaces de series
      const regex = /href="\/donghua\/([a-z0-9-]+)"/gi;
      let match;
      let count = 0;

      while ((match = regex.exec(html)) !== null) {
        const slug = match[1];
        const full = `${BASE_URL}/donghua/${slug}`;
        if (!found.has(full)) {
          found.add(full);
          count++;
        }
      }

      console.log(`📄 Página ${page}: ${count} series (total: ${found.size})`);

      if (page > 1 && count === 0) {
        console.log(`🛑 Fin del directorio`);
        break;
      }

    } catch (e) {
      console.log(`⚠️ Error página ${page}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, POLITENESS_MS));
  }

  return [...found];
}

/* Extraer video de un episodio (haciendo clic en los botones) */
async function extractVideo(episodeUrl) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    await page.goto(episodeUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Esperar a que cargue el reproductor
    await page.waitForSelector('iframe, [class*="player"], [class*="video"]', { timeout: 10000 });

    // Intentar hacer clic en "DM Player" o "Dark Server" para cargar el video
    const buttons = await page.$$('button, a[class*="server"], [class*="tab"]');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && (text.includes('DM') || text.includes('Dark') || text.includes('Server'))) {
        await btn.click();
        await page.waitForTimeout(2000); // Esperar a que cargue el iframe
        break;
      }
    }

    // Extraer el iframe del video
    const iframeSrc = await page.evaluate(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.src;
        if (src && !src.includes('donghuasub.com')) {
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
  const slug = seriesUrl.split('/').pop();

  // Obtener HTML de la serie
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
    src: 'donghuasub',
    sourceUrls: [seriesUrl],
    updatedAt: new Date().toISOString()
  };

  const existing = db.series.findIndex(s => s.id === slug);
  if (existing >= 0) db.series[existing] = { ...db.series[existing], ...seriesData };
  else db.series.push(seriesData);

  console.log(`   📝 ${title}`);

  // Extraer episodios (enlaces /donghua/slug/N)
  const epRegex = new RegExp(`href="/donghua/${slug}/(\\d+)"`, 'gi');
  const epMatches = [...html.matchAll(epRegex)];
  const episodes = [...new Set(epMatches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);

  console.log(`   🎬 ${episodes.length} episodios detectados`);

  // Procesar cada episodio
  for (const epNum of episodes) {
    if (timeUp()) break;

    const epId = `${slug}-e${epNum}`;
    if (db.episodes.some(e => e.id === epId)) continue;

    const epUrl = `${seriesUrl}/${epNum}`;

    try {
      const servers = await extractVideo(epUrl);

      if (servers.length === 0) {
        console.log(`      ⚠️ Episodio ${epNum}: sin servidores`);
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
        title: `Episodio ${epNum}`,
        sourceUrl: epUrl,
        servers,
        seriesId: slug,
        seasonId,
        number: epNum,
        updatedAt: new Date().toISOString()
      });

      console.log(`      ✅ Episodio ${epNum} (${servers.length} servidor)`);

    } catch (e) {
      console.log(`      ❌ Episodio ${epNum}: ${e.message}`);
    }

    await new Promise(r => setTimeout(r, POLITENESS_MS));
  }
}

/* Main */
async function main() {
  console.log('🚀 DONGHUASUB SYNC (Playwright)');
  console.log(`   workers: ${WORKERS} | tope tiempo: ${MAX_RUNTIME_MS/60000} min\n`);

  // Cargar catálogo
  let db;
  try {
    db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }

  // Descubrir series
  const seriesUrls = await discoverSeries();
  console.log(`\n📚 Total series: ${seriesUrls.length}`);

  // Procesar series (con límite de concurrencia por ser navegador)
  let done = 0;
  for (const url of seriesUrls) {
    if (timeUp()) break;

    console.log(`\n[${++done}/${seriesUrls.length}] ${url.split('/').pop()}`);

    try {
      await processSeries(db, url);

      // Checkpoint cada 3 series
      if (done % 3 === 0) {
        await fs.writeFile(OUT_FILE, JSON.stringify(db));
        console.log(`💾 Checkpoint (${done}/${seriesUrls.length})`);
      }
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }
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

  // Cerrar navegador
  if (browser) await browser.close();
}

main().catch(async e => {
  console.error('💥 FATAL:', e);
  if (browser) await browser.close();
  process.exit(1);
});
