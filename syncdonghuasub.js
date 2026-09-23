// ══════════════════════════════════════════════════════════
//  syncdonghuasub.js — DonghuaFlix (VERSIÓN PLAYWRIGHT)
//  Scraper para DONGHUASUB.COM con navegador (JavaScript)
//
//  ESTRATEGIA DE ESTA VERSIÓN (rápida, con reanudación):
//   · Serie YA en catálogo: solo se comprueba la COLA DE 5 episodios
//     por encima del último que tienes (41→45). Si una página no
//     existe, se da la cola por terminada y se pasa a la siguiente
//     serie. Las páginas de episodio listan a las demás: los números
//     vistos en esas listas se procesan DIRECTO pidiendo el servidor,
//     sin volver a comprobar su existencia uno a uno.
//   · Serie NUEVA: los episodios listados por la web se procesan
//     directo; la cola NO listada se explora DE 3 EN 3 y, al
//     encontrar un hueco, se ajusta el límite fino (41,44,47… si 44
//     falla → 42,43).
//   · Extracción de servidores EN LA MISMA VISITA y EN PARALELO
//     (WORKERS páginas simultáneas): cada episodio cuesta 1 carga.
//   · Cada serie completada queda marcada (complete + completedAt):
//     si el tiempo se acaba, la siguiente ejecución sigue exactamente
//     por la primera serie sin completar. Nada de empezar de cero.
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_FILE = path.resolve('public/data/catalog-donghuasub.json');
const BASE_URL = 'https://donghuasub.com';

// Configuración
const WORKERS = Math.max(1, Math.min(5, Number(process.env.WORKERS || 3))); // páginas de episodio en paralelo
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 500);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;

/* Horas durante las que una serie completa se considera al día:
   en ese periodo solo se mira su página por si hay episodios
   listados nuevos (sin comprobar cola). */
const COMPLETE_RECHECK_HOURS = Math.max(1, Number(process.env.COMPLETE_RECHECK_HOURS || 4));
const COMPLETE_FRESH_MS = COMPLETE_RECHECK_HOURS * 3600 * 1000;

/* Cuántos episodios por encima del máximo guardado se comprueban
   en las series ya catalogadas (la "cola de 5"). */
const TAIL_WINDOW = Math.max(1, Number(process.env.TAIL_WINDOW || 5));

/* Salto para explorar colas no listadas en series nuevas: 3 = de
   tres en tres hasta el primer hueco, luego ajuste fino. */
const PROBE_STRIDE = Math.max(1, Number(process.env.PROBE_STRIDE || 3));

const MAX_PROBE_STEPS = Math.max(50, Number(process.env.MAX_PROBE_STEPS || 1000));

/* Ruta de guardado: respeta OUT_FILE del workflow si existe */
const CHAIN_SAVE_PATH = path.resolve(process.env.OUT_FILE || OUT_FILE);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* Cola de guardado: los guardados por serie se encolan para
   nunca escribir el JSON dos veces a la vez */
let saveQueue = Promise.resolve();
function enqueueSave(db) {
  saveQueue = saveQueue
    .then(() => fs.writeFile(CHAIN_SAVE_PATH, JSON.stringify(db)))
    .catch(e => console.log(`⚠️ Error guardando catálogo: ${e.message}`));
  return saveQueue;
}

/* Pool de concurrencia: ejecuta fn sobre items con hasta `limit`
   trabajos en paralelo (cada uno respeta POLITENESS_MS entre tareas). */
async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = { error: e.message };
      }
      await sleep(POLITENESS_MS);
    }
  });
  await Promise.all(workers);
  return results;
}

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
   - devuelve el HTML (contiene la lista de episodios de la serie)
   - y, si needServer, activa el servidor (DM/Dark/Server) y espera
     a que el iframe del vídeo aparezca de verdad (hasta 6 s),
     extrayéndolo EN EL MISMO PASO. */
async function fetchEpisodePage(url, needServer = true) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    if (!needServer) {
      // Solo necesitamos el HTML: carga rápida
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      return { html: await page.content(), iframe: null };
    }

    // Necesitamos el servidor: carga COMPLETA y esperar al reproductor
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('iframe, [class*="player"], [class*="video"]', { timeout: 10000 });

    // Activar "DM Player" / "Dark Server" para que cargue el iframe
    const buttons = await page.$$('button, a[class*="server"], [class*="tab"]');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && (text.includes('DM') || text.includes('Dark') || text.includes('Server'))) {
        await btn.click().catch(() => {});
        break;
      }
    }

    // Esperar a que el iframe EXTERNO aparezca (hasta 6 s)
    const iframe = await page
      .waitForFunction(() => {
        for (const f of document.querySelectorAll('iframe')) {
          const src = f.src;
          if (src && !src.includes('donghuasub.com')) return src;
        }
        return false;
      }, { timeout: 6000 })
      .then(h => h.jsonValue())
      .catch(() => null);

    const html = await page.content();
    return { html, iframe };
  } catch (e) {
    // Página inexistente (404) o error de carga: no existe
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

/* Extrae los números de episodio que aparecen listados en el HTML
   de una página de episodio (la serie enlaza a todas sus partes). */
function numsFromHtml(html, slug) {
  const out = new Set();
  const re = new RegExp(`href="/donghua/${slug}/(\\d+)"`, 'gi');
  for (const m of String(html || '').matchAll(re)) out.add(parseInt(m[1], 10));
  return out;
}

/* COLA RÁPIDA (series ya en catálogo): comprueba solo los TAIL_WINDOW
   episodios siguientes al máximo guardado. Para en cuanto una página
   no existe. Devuelve servidores capturados, números conocidos
   (vistos en las listas de las páginas) y números visitados. */
async function probeTail(slug, fromNum) {
  const serversByNum = new Map();
  const knownNums = new Set();
  const visitedNums = new Set();
  let lastExisting = fromNum - 1;
  let hitEnd = false;
  let steps = 0;

  console.log(`   🔎 Cola de ${TAIL_WINDOW}: E${fromNum} → E${fromNum + TAIL_WINDOW - 1}`);

  for (let i = 0; i < TAIL_WINDOW; i++) {
    if (timeUp()) break;
    const num = fromNum + i;
    const r = await fetchEpisodePage(`${BASE_URL}/donghua/${slug}/${num}`, true);
    steps++;

    if (r.error && !r.html) {
      console.log(`      🔚 E${num} no existe (${r.error}) — fin de la cola`);
      hitEnd = true;
      break;
    }
    visitedNums.add(num);
    lastExisting = num;

    for (const n of numsFromHtml(r.html, slug)) knownNums.add(n);

    if (r.iframe) {
      serversByNum.set(num, [{ name: 'Video', url: r.iframe, embed: true }]);
      console.log(`      ✅ E${num}: existe + servidor`);
    } else {
      console.log(`      ⚠️ E${num}: existe pero sin iframe (se reintentará otra pasada)`);
    }

    await sleep(POLITENESS_MS);
  }

  // Si la cola se agotó sin 404, no sabemos si hay más: se sigue en la próxima pasada
  return { serversByNum, knownNums, visitedNums, hitEnd, lastExisting, steps };
}

/* COLA NO LISTADA (series nuevas): explora de PROBE_STRIDE en
   PROBE_STRIDE a partir de start; al fallar un salto, ajusta el
   límite fino probando los intermedios. Cada visita extrae el
   servidor si el episodio es nuevo. */
async function probeStrideTail(slug, start) {
  const serversByNum = new Map();
  const knownNums = new Set();
  const visitedNums = new Set();
  let lastGood = start - 1;
  let steps = 0;

  let n = start;
  while (!timeUp() && steps < MAX_PROBE_STEPS) {
    const r = await fetchEpisodePage(`${BASE_URL}/donghua/${slug}/${n}`, true);
    steps++;

    if (r.error && !r.html) {
      console.log(`      🔚 E${n} no existe — fin de la exploración`);
      break;
    }
    visitedNums.add(n);
    lastGood = n;
    for (const k of numsFromHtml(r.html, slug)) knownNums.add(k);
    if (r.iframe) serversByNum.set(n, [{ name: 'Video', url: r.iframe, embed: true }]);
    console.log(`      🔗 Salto E${n}${r.iframe ? ' (+servidor)' : ''}`);

    n += PROBE_STRIDE;
    await sleep(POLITENESS_MS);
  }

  // Ajuste fino: los intermedios entre lastGood y el fallo n
  for (let k = lastGood + 1; k < n; k++) {
    if (timeUp()) break;
    const r = await fetchEpisodePage(`${BASE_URL}/donghua/${slug}/${k}`, true);
    steps++;
    if (r.error && !r.html) { console.log(`      🔚 E${k} no existe`); break; }
    visitedNums.add(k);
    lastGood = k;
    for (const c of numsFromHtml(r.html, slug)) knownNums.add(c);
    if (r.iframe) serversByNum.set(k, [{ name: 'Video', url: r.iframe, embed: true }]);
    console.log(`      🔧 Ajuste E${k}${r.iframe ? ' (+servidor)' : ''}`);
    await sleep(POLITENESS_MS);
  }

  const exhausted = !(n <= lastGood) && (n > lastGood) && steps < MAX_PROBE_STEPS && !timeUp();
  return { serversByNum, knownNums, visitedNums, lastGood, exhausted, steps };
}

/* Procesar una serie */
async function processSeries(db, seriesUrl) {
  const slug = seriesUrl.split('/').pop();

  // Obtener HTML de la serie
  const html = await fetchPage(seriesUrl);

  // Extraer título
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  // Guardar serie (preservando complete/completedAt)
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

  // Detección clásica (enlaces /donghua/slug/N en la página de la serie)
  const epRegex = new RegExp(`href="/donghua/${slug}/(\\d+)"`, 'gi');
  const epMatches = [...html.matchAll(epRegex)];
  const listed = [...new Set(epMatches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);

  // Estado actual en el catálogo
  const haveNums = new Set(db.episodes.filter(e => e.seriesId === slug).map(e => e.number));
  const haveServers = new Set(
    db.episodes.filter(e => e.seriesId === slug && e.servers && e.servers.length).map(e => e.number)
  );
  const maxHave = haveNums.size ? Math.max(...haveNums) : 0;
  const missing = listed.filter(n => !haveServers.has(n));

  console.log(`   🎬 ${listed.length} listados · ${haveNums.size} en catálogo · ${missing.length} sin servidor`);

  // ── Serie COMPLETA y al día + sin episodios nuevos → se omite ──
  const completedAt = Date.parse(seriesEntry.completedAt || 0) || 0;
  const completeFresh = seriesEntry.complete &&
    completedAt && (Date.now() - completedAt) < COMPLETE_FRESH_MS;

  if (completeFresh && missing.length === 0) {
    console.log(`   ⏭️ Serie completa y al día (hace ${((Date.now() - completedAt) / 3600000).toFixed(1)} h) — se omite`);
    return;
  }

  // ══════════ FASE 1: comprobar la COLA (solo lo nuevo) ══════════
  let queueTargets = [];   // episodios que existen y necesitan servidor
  let exhausted = false;   // ¿llegamos al final real de la serie?

  if (haveServers.size > 0) {
    // Serie YA en catálogo: solo la cola de 5 por encima del máximo
    const tail = await probeTail(slug, maxHave + 1);
    exhausted = tail.hitEnd;

    for (const [num, servers] of tail.serversByNum) {
      if (addEpisode(db, slug, num, servers)) {
        console.log(`      ✅ Episodio ${num} dado de alta (cola)`);
      }
      haveNums.add(num);
      haveServers.add(num);
    }
    // Números vistos en las listas de las páginas (existen de verdad)
    for (const n of tail.knownNums) {
      if (n > maxHave && !tail.visitedNums.has(n) && !haveServers.has(n)) queueTargets.push(n);
    }
    if (queueTargets.length) {
      console.log(`   📋 Las páginas listan ${queueTargets.length} episodios más (E${Math.min(...queueTargets)}–E${Math.max(...queueTargets)}): se procesan directo`);
    }
  } else {
    // Serie NUEVA: la cola no listada se explora de 3 en 3
    const start = listed.length ? Math.max(...listed) + 1 : 1;
    const tail = await probeStrideTail(slug, start);
    exhausted = tail.exhausted;

    for (const [num, servers] of tail.serversByNum) {
      if (addEpisode(db, slug, num, servers)) {
        console.log(`      ✅ Episodio ${num} dado de alta (exploración)`);
      }
      haveNums.add(num);
      haveServers.add(num);
    }
    // Intermedios saltados que las páginas listaron como existentes
    for (const n of tail.knownNums) {
      if (n >= start && !tail.visitedNums.has(n) && !haveServers.has(n)) queueTargets.push(n);
    }
  }

  // ══════════ FASE 2: servidores (listados + cola) EN PARALELO ══════════
  const targets = [...new Set([...missing, ...queueTargets])]
    .filter(n => !haveServers.has(n))
    .sort((a, b) => a - b);

  if (targets.length) {
    console.log(`   ⚡ Extrayendo servidores de ${targets.length} episodios (${WORKERS} en paralelo)…`);
    let okCount = 0, failCount = 0;

    await mapPool(targets, WORKERS, async (num) => {
      const r = await fetchEpisodePage(`${BASE_URL}/donghua/${slug}/${num}`, true);
      if (r.iframe) {
        const servers = [{ name: 'Video', url: r.iframe, embed: true }];
        if (addEpisode(db, slug, num, servers)) okCount++;
        haveNums.add(num);
        haveServers.add(num);
        console.log(`      ✅ Episodio ${num} (servidor)`);
      } else {
        failCount++;
        console.log(`      ⚠️ Episodio ${num}: sin iframe${r.error ? ` (${r.error})` : ''}`);
      }
    });

    console.log(`   ⚡ Servidores: ${okCount} nuevos · ${failCount} fallaron`);
  }

  // ══════════ FASE 3: marcar completada y guardar ══════════
  const knownAll = [...new Set([...listed, ...haveNums])];
  const allWithServers = knownAll.length > 0 && knownAll.every(n => haveServers.has(n));

  if (exhausted && allWithServers) {
    if (!seriesEntry.complete) console.log(`   🏁 Serie COMPLETADA: ${slug}`);
    seriesEntry.complete = true;
    seriesEntry.completedAt = new Date().toISOString();
  } else if (seriesEntry.complete && !allWithServers) {
    delete seriesEntry.complete;
    delete seriesEntry.completedAt;
  }

  // 💾 Guardado del catálogo tras CADA serie (encolado)
  await enqueueSave(db);
  console.log(`💾 Catálogo guardado tras la serie: ${slug}`);
}

/* Main */
async function main() {
  console.log('🚀 DONGHUASUB SYNC (Playwright)');
  console.log(`   tope: ${MAX_RUNTIME_MS/60000} min | fresca: ${COMPLETE_RECHECK_HOURS} h | cola: ${TAIL_WINDOW} | salto: ${PROBE_STRIDE} | paralelo: ${WORKERS}\n`);

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

  let done = 0;
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
