// ══════════════════════════════════════════════════════════
//  syncdonghuasub.js — DonghuaFlix (VERSIÓN PLAYWRIGHT)
//  Scraper para DONGHUASUB.COM con navegador (JavaScript)
//
//  NOVEDADES DE ESTA VERSIÓN:
//   1) Cadena/patrón con VERIFICACIÓN DE SERVIDOR en la misma visita:
//      cada paso de la cadena carga la página del episodio UNA sola
//      vez y, si el episodio no está ya en el catálogo, extrae el
//      iframe del vídeo en ese mismo paso.
//   2) Reanudación: cada serie completada queda marcada (complete +
//      completedAt). Las ejecuciones siguientes SALTAN las series
//      completas y continúan por la primera incompleta; en las
//      completadas solo se miran los episodios NUEVOS que aparezcan
//      en la página de la serie (sin re-recorrer la cadena).
//   3) Re-chequeo profundo: la cadena completa solo se vuelve a
//      recorrer una vez cada CHAIN_RECHECK_Días (por defecto 7) o
//      si la serie nunca se completó.
//   4) Guardado del catálogo tras cada serie (ya existente).
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_FILE = path.resolve('public/data/catalog-donghuasub.json');
const BASE_URL = 'https://donghuasub.com';

// Configuración
const WORKERS = Math.max(1, Math.min(4, Number(process.env.WORKERS || 3)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 500);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;

/* Horas durante las que una serie marcada como completa se considera
   al día: en ese periodo solo se comprueba su página por si hay
   episodios nuevos (sin cadena). Con el cron de 6h, 4h garantiza que
   cada ejecución programada re-mire todas las series. */
const COMPLETE_RECHECK_HOURS = Math.max(1, Number(process.env.COMPLETE_RECHECK_HOURS || 4));
const COMPLETE_FRESH_MS = COMPLETE_RECHECK_HOURS * 3600 * 1000;

/* Días entre re-chequeos PROFUNDOS (cadena completa) de una serie. */
const CHAIN_RECHECK_DAYS = Math.max(1, Number(process.env.CHAIN_RECHECK_DAYS || 7));
const CHAIN_FRESH_MS = CHAIN_RECHECK_DAYS * 24 * 3600 * 1000;

const MAX_CHAIN_STEPS = Math.max(100, Number(process.env.MAX_CHAIN_STEPS || 2000));
const MAX_PATTERN_RECOVERIES = 200;

/* Ruta de guardado: respeta OUT_FILE del workflow si existe */
const CHAIN_SAVE_PATH = path.resolve(process.env.OUT_FILE || OUT_FILE);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Número de episodio al final del path: /donghua/slug/12 -> 12 */
const epNumOf = u => {
  const m = String(u || '').match(/\/(\d+)(?:[/?#]|$)/);
  return m ? parseInt(m[1], 10) : null;
};

/* Cola de guardado: los guardados por serie se encolan para
   nunca escribir el JSON dos veces a la vez */
let saveQueue = Promise.resolve();
function enqueueSave(db) {
  saveQueue = saveQueue
    .then(() => fs.writeFile(CHAIN_SAVE_PATH, JSON.stringify(db)))
    .catch(e => console.log(`⚠️ Error guardando catálogo: ${e.message}`));
  return saveQueue;
}

/* Localiza el enlace "Siguiente" en el HTML ya renderizado:
   1) <link rel="next">
   2) anchors cuyo texto/clase indique siguiente (siguiente, next, », →) */
function findNextEpisodeUrl(html, slug) {
  let m = html.match(/<link[^>]*rel=["']next["'][^>]*href=["']([^"']+)["']/i) ||
          html.match(/<link[^>]*href=["']([^"']+)["'][^>]*rel=["']next["']/i);
  if (m) return m[1];

  const re = /<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi;
  while ((m = re.exec(html)) !== null) {
    const attrs = (m[1] + ' ' + m[3]).toLowerCase();
    const text = m[4].replace(/<[^>]+>/g, '').trim().toLowerCase();
    const href = m[2];
    if (!new RegExp(`/donghua/${slug}/\\d+`).test(href)) continue;
    if (/siguiente|next|pr[oó]ximo/.test(text) || /class=["'][^"']*next/.test(attrs) || /[»→]/.test(text)) {
      return href;
    }
  }
  return null;
}

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

/* Página genérica: espera a la carga completa (networkidle). */
async function fetchPage(url, waitSelector = null) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (waitSelector) {
      await page.waitForSelector(waitSelector, { timeout: 10000 });
    }
    return await page.content();
  } finally {
    await page.close();
  }
}

/* Página de EPISODIO en UNA sola visita:
   - devuelve el HTML (para la cadena: botón Siguiente + lista)
   - y, si needServer, hace clic en el servidor (DM/Dark/Server) y
     extrae el iframe del vídeo EN EL MISMO PASO.
   Así descubrir y verificar cuestan 1 carga de página, no 2. */
async function fetchEpisodePage(url, needServer = true) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForSelector('iframe, [class*="player"], [class*="video"], a', { timeout: 8000 });

    if (needServer) {
      // Intentar activar "DM Player" / "Dark Server" para que cargue el iframe
      const buttons = await page.$$('button, a[class*="server"], [class*="tab"]');
      for (const btn of buttons) {
        const text = await btn.textContent();
        if (text && (text.includes('DM') || text.includes('Dark') || text.includes('Server'))) {
          await btn.click().catch(() => {});
          await page.waitForTimeout(1500);
          break;
        }
      }
      const result = await page.evaluate(() => {
        let iframe = null;
        for (const f of document.querySelectorAll('iframe')) {
          const src = f.src;
          if (src && !src.includes('donghuasub.com')) { iframe = src; break; }
        }
        return { html: document.documentElement.outerHTML, iframe };
      });
      return result;
    }

    return { html: await page.content(), iframe: null };
  } catch (e) {
    // Aunque falle el reproductor, intentamos rescatar el HTML para la cadena
    try {
      return { html: await page.content(), iframe: null, error: e.message };
    } catch {
      return { html: '', iframe: null, error: e.message };
    }
  } finally {
    await page.close();
  }
}

/* Descubrir series desde /directorio (con JS) */
async function discoverSeries() {
  const found = new Set();

  console.log('🔍 Descubriendo series (esperando JavaScript)...');

  for (let page = 1; page <= 10; page++) {
    if (timeUp()) break;

    const url = page === 1 ? `${BASE_URL}/directorio` : `${BASE_URL}/directorio?page=${page}`;

    try {
      const html = await fetchPage(url, 'a[href*="/donghua/"]');

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

    await sleep(POLITENESS_MS);
  }

  return [...found];
}

/* Cadena "Siguiente" + patrón CON VERIFICACIÓN DE SERVIDOR:
   cada paso carga la página del episodio una sola vez y, si el
   episodio todavía no está en el catálogo, extrae el servidor en
   ese mismo paso. Los episodios ya guardados (con servidores) no
   repiten la extracción: solo se lee su HTML para seguir la cadena. */
async function discoverEpisodesByChain(seriesUrl, slug, knownEpisodes, haveServers) {
  const found = new Set(knownEpisodes);
  const serversByNum = new Map();   // num -> [{name,url,embed}]
  const visited = new Set();
  const recoveryAttempted = new Set();
  let patternRecoveries = 0;
  let steps = 0;
  let exhausted = true;

  const abs = h => { try { return new URL(h, BASE_URL).href.split('#')[0]; } catch { return null; } };
  const epRe = new RegExp(`href="/donghua/${slug}/(\\d+)"`, 'gi');

  const seed = knownEpisodes.length ? Math.min(...knownEpisodes) : 1;
  const queue = [`${seriesUrl}/${seed}`];
  let lastGood = seed;

  const tryPatternRecovery = async fromNum => {
    const target = fromNum + 1;
    if (fromNum == null || recoveryAttempted.has(target) || patternRecoveries >= MAX_PATTERN_RECOVERIES) return null;
    recoveryAttempted.add(target);
    const candidate = `${seriesUrl}/${target}`;
    if (visited.has(candidate)) return null;
    patternRecoveries++;
    console.log(`      🔄 Alternando a patrón: episodio ${target} — se reanuda la cadena (sin comprobación previa)`);
    return candidate;
  };

  while (queue.length && steps < MAX_CHAIN_STEPS) {
    if (timeUp()) { exhausted = false; break; }

    const currentUrl = abs(queue.shift());
    if (!currentUrl || visited.has(currentUrl)) continue;
    visited.add(currentUrl);
    steps++;
    const currentNum = epNumOf(currentUrl);

    // ¿Hace falta extraer el servidor en esta visita?
    const needServer = currentNum != null && !haveServers.has(currentNum);
    if (needServer) console.log(`      🔗 Cadena paso ${steps}: E${currentNum} (+servidor)`);
    else console.log(`      🔗 Cadena paso ${steps}: E${currentNum}`);

    let resumed = false;

    try {
      const { html, iframe } = await fetchEpisodePage(currentUrl, needServer);
      if (currentNum != null) lastGood = currentNum;

      // recolectar enlaces numéricos (por si hay lista)
      for (const mm of html.matchAll(epRe)) found.add(parseInt(mm[1], 10));

      // verificación de servidor en la MISMA visita
      if (needServer) {
        if (iframe) {
          serversByNum.set(currentNum, [{ name: 'Video', url: iframe, embed: true }]);
          console.log(`         ✅ Servidor extraído en el paso: E${currentNum}`);
        } else {
          console.log(`         ⚠️ E${currentNum}: página OK pero sin iframe (se reintentará)`);
        }
      }

      // 1) botón "Siguiente"
      const nextHref = findNextEpisodeUrl(html, slug);
      const nextUrl = nextHref ? abs(nextHref) : null;
      const nextNum = nextUrl ? epNumOf(nextUrl) : null;
      if (nextUrl && nextNum != null && !visited.has(nextUrl) && nextNum !== currentNum) {
        queue.push(nextUrl);
        resumed = true;
      }

      // 2) cadena rota -> patrón y reanudar
      if (!resumed) {
        const rec = await tryPatternRecovery(currentNum ?? lastGood);
        if (rec) { queue.push(rec); resumed = true; }
        else console.log(`      🔗 Cadena: fin tras E${currentNum} (el patrón no recuperó E${(currentNum ?? lastGood) + 1})`);
      }
    } catch (e) {
      console.log(`         ⚠️ Cadena: no se pudo leer E${currentNum} (${e.message}) — probando método de patrón...`);
      const rec = await tryPatternRecovery(lastGood);
      if (rec) { queue.push(rec); resumed = true; }
    }

    if (!resumed && !queue.length) break;
    await sleep(POLITENESS_MS);
  }

  if (steps >= MAX_CHAIN_STEPS) exhausted = false;

  return {
    episodeNumbers: [...found].sort((a, b) => a - b),
    serversByNum,
    chainSteps: steps,
    recoveries: patternRecoveries,
    exhausted
  };
}

/* Insertar un episodio en el catálogo (con su temporada) */
function addEpisode(db, slug, epNum, servers) {
  const epId = `${slug}-e${epNum}`;
  if (db.episodes.some(e => e.id === epId)) return false;

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
    sourceUrl: `${BASE_URL}/donghua/${slug}/${epNum}`,
    servers,
    seriesId: slug,
    seasonId,
    number: epNum,
    updatedAt: new Date().toISOString()
  });
  return true;
}

/* Procesar una serie */
async function processSeries(db, seriesUrl) {
  const slug = seriesUrl.split('/').pop();

  // Obtener HTML de la serie
  const html = await fetchPage(seriesUrl);

  // Extraer título
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  // Guardar serie (preservando complete/completedAt/chainSyncedAt)
  const seriesData = {
    id: slug,
    slug,
    title,
    type: 'donghua',
    src: 'donghuasub',
    sourceUrls: [seriesUrl],
    updatedAt: new Date().toISOString()
  };

  let seriesEntry;
  const existing = db.series.findIndex(s => s.id === slug);
  if (existing >= 0) {
    db.series[existing] = { ...db.series[existing], ...seriesData };
    seriesEntry = db.series[existing];
  } else {
    db.series.push(seriesData);
    seriesEntry = db.series[db.series.length - 1];
  }

  console.log(`   📝 ${title}`);

  // Detección clásica (enlaces /donghua/slug/N)
  const epRegex = new RegExp(`href="/donghua/${slug}/(\\d+)"`, 'gi');
  const epMatches = [...html.matchAll(epRegex)];
  const episodes = [...new Set(epMatches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);

  // Estado actual en el catálogo
  const haveNums = new Set(db.episodes.filter(e => e.seriesId === slug).map(e => e.number));
  const haveServers = new Set(
    db.episodes.filter(e => e.seriesId === slug && e.servers && e.servers.length).map(e => e.number)
  );
  const missing = episodes.filter(n => !haveServers.has(n));

  console.log(`   🎬 ${episodes.length} detectados · ${haveNums.size} en catálogo · ${missing.length} sin servidor`);

  // ── Serie COMPLETA y al día + sin episodios nuevos → se omite ──
  const completedAt = Date.parse(seriesEntry.completedAt || 0) || 0;
  const completeFresh = seriesEntry.complete &&
    completedAt && (Date.now() - completedAt) < COMPLETE_FRESH_MS;

  if (completeFresh && missing.length === 0) {
    console.log(`   ⏭️ Serie completa y al día (hace ${((Date.now() - completedAt) / 3600000).toFixed(1)} h) — se omite`);
    return;
  }

  // ── ¿Toca re-chequeo PROFUNDO (cadena completa)? ──
  const chainSyncedAt = Date.parse(seriesEntry.chainSyncedAt || 0) || 0;
  const chainNeeded = !seriesEntry.chainSyncedAt ||
    (Date.now() - chainSyncedAt) > CHAIN_FRESH_MS;

  let chainResult = null;

  if (chainNeeded) {
    try {
      chainResult = await discoverEpisodesByChain(seriesUrl, slug, episodes, haveServers);

      console.log(
        `   🔗 Cadena: ${chainResult.chainSteps} pasos · ${chainResult.serversByNum.size} servidores extraídos` +
        ` · ${chainResult.recoveries} recuperación(es) por patrón` +
        (chainResult.exhausted ? ' · fin alcanzado ✅' : ' · truncada ⚠️')
      );

      // Memoria de la cadena: solo si llegó al final
      if (chainResult.exhausted) {
        seriesEntry.chainSyncedAt = new Date().toISOString();
      }

      // Dar de alta los episodios con servidor obtenido DURANTE la cadena
      let added = 0;
      for (const [num, servers] of chainResult.serversByNum) {
        if (timeUp()) break;
        if (addEpisode(db, slug, num, servers)) {
          console.log(`      ✅ Episodio ${num} (cadena+servidor, ${servers.length} servidor)`);
          added++;
        }
        haveNums.add(num);
        haveServers.add(num);
      }
      if (added) console.log(`   💾 ${added} episodios nuevos dados de alta en la cadena`);
    } catch (e) {
      console.log(`   ⚠️ Cadena no disponible, se conserva la detección clásica: ${e.message}`);
    }
  } else {
    console.log(`   ⏭️ Cadena omitida: re-chequeo profundo a los ${CHAIN_RECHECK_DAYS} días (solo episodios nuevos)`);
  }

  // ── Episodios listados que aún no tienen servidor ──
  for (const epNum of episodes) {
    if (timeUp()) break;
    if (haveServers.has(epNum)) continue;

    const epUrl = `${BASE_URL}/donghua/${slug}/${epNum}`;

    try {
      const { iframe } = await fetchEpisodePage(epUrl, true);

      if (!iframe) {
        console.log(`      ⚠️ Episodio ${epNum}: sin servidores`);
        await sleep(POLITENESS_MS);
        continue;
      }

      const servers = [{ name: 'Video', url: iframe, embed: true }];
      if (addEpisode(db, slug, epNum, servers)) {
        console.log(`      ✅ Episodio ${epNum} (${servers.length} servidor)`);
      }
      haveNums.add(epNum);
      haveServers.add(epNum);
    } catch (e) {
      console.log(`      ❌ Episodio ${epNum}: ${e.message}`);
    }

    await sleep(POLITENESS_MS);
  }

  // ── Marcar completada si: cadena exhausta y TODO lo conocido tiene servidor ──
  const known = chainResult ? chainResult.episodeNumbers : episodes;
  const allWithServers = known.length > 0 && known.every(n => haveServers.has(n));

  if (chainResult && chainResult.exhausted && allWithServers) {
    if (!seriesEntry.complete) {
      console.log(`   🏁 Serie COMPLETADA: ${slug}`);
    }
    seriesEntry.complete = true;
    seriesEntry.completedAt = new Date().toISOString();
  } else if (seriesEntry.complete && missing.length === 0 && allWithServers) {
    // sigue completa (pase ligero) — refrescar fecha
    seriesEntry.completedAt = new Date().toISOString();
  } else if (seriesEntry.complete && !allWithServers) {
    // tenía episodios que perdieron servidor o faltan: ya no es completa
    delete seriesEntry.complete;
    delete seriesEntry.completedAt;
  }

  // 💾 Guardado del catálogo tras completar CADA serie (encolado)
  await enqueueSave(db);
  console.log(`💾 Catálogo guardado tras la serie: ${slug}`);
}

/* Main */
async function main() {
  console.log('🚀 DONGHUASUB SYNC (Playwright)');
  console.log(`   tope tiempo: ${MAX_RUNTIME_MS/60000} min | completa fresca: ${COMPLETE_RECHECK_HOURS} h | re-chequeo profundo: ${CHAIN_RECHECK_DAYS} días\n`);

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

  let done = 0, skipped = 0;
  for (const url of seriesUrls) {
    if (timeUp()) break;

    console.log(`\n[${++done}/${seriesUrls.length}] ${url.split('/').pop()}`);

    try {
      await processSeries(db, url);

      // Checkpoint cada 5 series
      if (done % 5 === 0) {
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

  if (browser) await browser.close();
}

main().catch(async e => {
  console.error('💥 FATAL:', e);
  if (browser) await browser.close();
  process.exit(1);
});
