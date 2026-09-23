// ══════════════════════════════════════════════════════════
//  syncdonghuasub.js — DonghuaFlix (VERSIÓN PLAYWRIGHT)
//  Scraper para DONGHUASUB.COM con navegador (JavaScript)
//
//  ESTRATEGIA:
//   1) LEE LOS RANGOS DE LA PÁGINA: donghuasub agrupa episodios
//      ("Episodio 1-15", "Episodio 34-35"…). El script detecta esos
//      enlaces, extrae los números de cada rango y visita CADA
//      PÁGINA DE PAQUETE UNA SOLA VEZ: el iframe que obtiene vale
//      para todos los episodios del rango. Nada de probar URL a URL.
//   2) COLA DE 5: por encima del máximo conocido solo se comprueban
//      los TAIL_WINDOW episodios siguientes; una página solo cuenta
//      como existente si trae reproductor (los "falsos 404" que
//      responden 200 sin vídeo quedan descartados).
//   3) Reanudación: cada serie completada queda marcada (complete +
//      completedAt); si el tiempo se acaba, la siguiente ejecución
//      continúa por la primera serie incompleta.
//   4) Extracción de servidores EN PARALELO (WORKERS páginas a la vez).
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_FILE = path.resolve('public/data/catalog-donghuasub.json');
const BASE_URL = 'https://donghuasub.com';

// Configuración
const WORKERS = Math.max(1, Math.min(5, Number(process.env.WORKERS || 3)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 500);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;

/* Horas durante las que una serie completa se considera al día. */
const COMPLETE_RECHECK_HOURS = Math.max(1, Number(process.env.COMPLETE_RECHECK_HOURS || 4));
const COMPLETE_FRESH_MS = COMPLETE_RECHECK_HOURS * 3600 * 1000;

/* Episodios a comprobar por encima del máximo conocido. */
const TAIL_WINDOW = Math.max(1, Number(process.env.TAIL_WINDOW || 5));

/* Rango máximo aceptado en un paquete ("Episodio 1-15" = 15). Por
   seguridad ante textos raros; un paquete real no pasa de ~50. */
const MAX_GROUP_SPAN = Math.max(5, Number(process.env.MAX_GROUP_SPAN || 60));

const CHAIN_SAVE_PATH = path.resolve(process.env.OUT_FILE || OUT_FILE);

const sleep = ms => new Promise(r => setTimeout(r, ms));

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* Cola de guardado por serie */
let saveQueue = Promise.resolve();
function enqueueSave(db) {
  saveQueue = saveQueue
    .then(() => fs.writeFile(CHAIN_SAVE_PATH, JSON.stringify(db)))
    .catch(e => console.log(`⚠️ Error guardando catálogo: ${e.message}`));
  return saveQueue;
}

/* Pool de concurrencia */
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

/* Página genérica */
async function fetchPage(url, waitSelector = null) {
  const { context } = await getBrowser();
  const page = await context.newPage();
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 10000 });
    return await page.content();
  } finally {
    await page.close();
  }
}

/* ¿El HTML parece una página de episodio real? Los falsos 404 de
   donghuasub responden 200 pero SIN reproductor. */
function looksLikeEpisode(html) {
  return /<iframe|class=["'][^"']*(player|video)/i.test(String(html || ''));
}

/* Página de episodio/paquete en UNA visita: HTML + iframe del servidor. */
async function fetchEpisodePage(url) {
  const { context } = await getBrowser();
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('iframe, [class*="player"], [class*="video"]', { timeout: 10000 });

    const buttons = await page.$$('button, a[class*="server"], [class*="tab"]');
    for (const btn of buttons) {
      const text = await btn.textContent();
      if (text && (text.includes('DM') || text.includes('Dark') || text.includes('Server'))) {
        await btn.click().catch(() => {});
        break;
      }
    }

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

    return { html: await page.content(), iframe };
  } catch (e) {
    try {
      return { html: await page.content(), iframe: null, error: e.message };
    } catch {
      return { html: '', iframe: null, error: e.message };
    }
  } finally {
    await page.close();
  }
}

/* Descubrir series desde /directorio */
async function discoverSeries() {
  const found = new Set();
  console.log('🔍 Descubriendo series (esperando JavaScript)...');

  for (let page = 1; page <= 10; page++) {
    if (timeUp()) break;
    const url = page === 1 ? `${BASE_URL}/directorio` : `${BASE_URL}/directorio?page=${page}`;

    try {
      const html = await fetchPage(url, 'a[href*="/donghua/"]');
      const regex = /href="\/donghua\/([a-z0-9-]+)"/gi;
      let match, count = 0;
      while ((match = regex.exec(html)) !== null) {
        const full = `${BASE_URL}/donghua/${match[1]}`;
        if (!found.has(full)) { found.add(full); count++; }
      }
      console.log(`📄 Página ${page}: ${count} series (total: ${found.size})`);
      if (page > 1 && count === 0) { console.log(`🛑 Fin del directorio`); break; }
    } catch (e) {
      console.log(`⚠️ Error página ${page}: ${e.message}`);
    }
    await sleep(POLITENESS_MS);
  }
  return [...found];
}

/* Insertar un episodio en el catálogo */
function addEpisode(db, slug, epNum, servers, sourceUrl = null) {
  const epId = `${slug}-e${epNum}`;
  if (db.episodes.some(e => e.id === epId)) return false;

  const seasonId = `${slug}-t1`;
  if (!db.seasons.some(s => s.id === seasonId)) {
    db.seasons.push({ id: seasonId, slug: seasonId, seriesId: slug, number: 1, updatedAt: new Date().toISOString() });
  }

  db.episodes.push({
    id: epId,
    slug: epId,
    title: `Episodio ${epNum}`,
    sourceUrl: sourceUrl || `${BASE_URL}/donghua/${slug}/${epNum}`,
    servers,
    seriesId: slug,
    seasonId,
    number: epNum,
    updatedAt: new Date().toISOString()
  });
  return true;
}

/* LEE LOS PAQUETES DE LA PÁGINA: detecta anchors tipo
   "Episodio 1-15", "Ep. 34-35" o "1-15" apuntando a /donghua/slug/…
   y devuelve [{href, from, to}] más el conjunto plano de números. */
function parseEpisodeGroups(html, slug) {
  const groups = new Map(); // key `${from}-${to}`
  const re = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = re.exec(html)) !== null) {
    const href = m[1];
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    if (!new RegExp(`/donghua/${slug}/`).test(href)) continue;

    let mm = text.match(/(\d{1,4})\s*[-–—]\s*(\d{1,4})/);
    if (mm) {
      const a = parseInt(mm[1], 10), b = parseInt(mm[2], 10);
      if (b >= a && (b - a) <= MAX_GROUP_SPAN) {
        groups.set(`${a}-${b}`, { href, from: a, to: b });
      }
      continue;
    }
    // Número simple: en la URL (/slug/12) o en el texto ("Episodio 12")
    mm = href.match(/\/donghua\/[^/]+\/(\d{1,4})(?:[/?#]|$)/) ||
         text.match(/(?:episodio|ep\.?|cap(?:ítulo)?\.?)\s*(\d{1,4})/i);
    if (mm) {
      const n = parseInt(mm[1], 10);
      groups.set(`${n}-${n}`, { href, from: n, to: n });
    }
  }

  const list = [...groups.values()].sort((a, b) => a.from - b.from);
  const nums = new Set();
  for (const g of list) for (let n = g.from; n <= g.to; n++) nums.add(n);
  return { groups: list, nums };
}

/* Procesar una serie */
async function processSeries(db, seriesUrl) {
  const slug = seriesUrl.split('/').pop();
  const html = await fetchPage(seriesUrl);

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug;

  const seriesData = {
    id: slug, slug, title, type: 'donghua', src: 'donghuasub',
    sourceUrls: [seriesUrl], updatedAt: new Date().toISOString()
  };

  let seriesEntry;
  const existing = db.series.findIndex(s => s.id === slug);
  if (existing >= 0) { db.series[existing] = { ...db.series[existing], ...seriesData }; seriesEntry = db.series[existing]; }
  else { db.series.push(seriesData); seriesEntry = db.series[db.series.length - 1]; }

  console.log(`   📝 ${title}`);

  // ══ 1) LEER la página: paquetes "1-15", "34-35"… + números sueltos ══
  const parsed = parseEpisodeGroups(html, slug);
  const listed = [...parsed.nums].sort((a, b) => a - b);

  const haveNums = new Set(db.episodes.filter(e => e.seriesId === slug).map(e => e.number));
  const haveServers = new Set(
    db.episodes.filter(e => e.seriesId === slug && e.servers && e.servers.length).map(e => e.number)
  );
  const maxHave = haveNums.size ? Math.max(...haveNums) : 0;
  const missing = listed.filter(n => !haveServers.has(n));

  console.log(`   🎬 ${parsed.groups.length} enlaces (${listed.length} episodios en rangos) · ${haveNums.size} en catálogo · ${missing.length} sin servidor`);

  // ── Serie COMPLETA y al día + sin novedades → se omite ──
  const completedAt = Date.parse(seriesEntry.completedAt || 0) || 0;
  const completeFresh = seriesEntry.complete && completedAt &&
    (Date.now() - completedAt) < COMPLETE_FRESH_MS;

  if (completeFresh && missing.length === 0) {
    console.log(`   ⏭️ Serie completa y al día (hace ${((Date.now() - completedAt) / 3600000).toFixed(1)} h) — se omite`);
    return;
  }

  // ══ 2) Visitar CADA PÁGINA DE PAQUETE una vez (en paralelo) ══
  const visited = new Set();  // episodios cubiertos por paquete
  if (parsed.groups.length) {
    console.log(`   📦 Procesando ${parsed.groups.length} paquetes (${WORKERS} en paralelo)…`);

    await mapPool(parsed.groups, WORKERS, async (g) => {
      const url = new URL(g.href, BASE_URL).href;
      const r = await fetchEpisodePage(url);
      const label = g.from === g.to ? `Episodio ${g.from}` : `Episodio ${g.from}-${g.to}`;

      if (r.iframe) {
        const servers = [{ name: label, url: r.iframe, embed: true }];
        let added = 0;
        for (let n = g.from; n <= g.to; n++) {
          if (addEpisode(db, slug, n, servers, url)) added++;
          visited.add(n);
          haveNums.add(n);
          haveServers.add(n);
        }
        console.log(`      ✅ ${label} → servidor (${g.to - g.from + 1} episodios${added ? `, ${added} nuevos` : ''})`);
      } else {
        console.log(`      ⚠️ ${label}: sin iframe (se reintentará otra pasada)`);
      }
    });
  }

  // ══ 3) COLA DE 5: solo TAIL_WINDOW episodios por encima del máximo ══
  const knownMax = Math.max(maxHave, listed.length ? Math.max(...listed) : 0);
  const queueTargets = [];   // existen (según páginas reales) y necesitan servidor
  let exhausted = false;

  console.log(`   🔎 Cola de ${TAIL_WINDOW}: E${knownMax + 1} → E${knownMax + TAIL_WINDOW}`);
  for (let i = 1; i <= TAIL_WINDOW; i++) {
    if (timeUp()) break;
    const num = knownMax + i;
    const r = await fetchEpisodePage(`${BASE_URL}/donghua/${slug}/${num}`);

    if (r.error || !looksLikeEpisode(r.html)) {
      console.log(`      🔚 E${num} no existe (sin reproductor) — fin de la serie`);
      exhausted = true;
      break;
    }

    // La página es real: lo que liste es existente
    const p = parseEpisodeGroups(r.html, slug);
    for (const n of p.nums) {
      if (n > knownMax && !visited.has(n) && !haveServers.has(n)) queueTargets.push(n);
    }

    if (r.iframe) {
      const servers = [{ name: `Episodio ${num}`, url: r.iframe, embed: true }];
      if (addEpisode(db, slug, num, servers)) console.log(`      ✅ E${num}: existe + servidor`);
      visited.add(num);
      haveNums.add(num);
      haveServers.add(num);
    } else {
      console.log(`      ⚠️ E${num}: existe pero sin iframe (se reintentará otra pasada)`);
    }
    await sleep(POLITENESS_MS);
  }
  if (!exhausted && !timeUp()) {
    console.log(`      …cola agotada sin 404: puede haber más, se reanuda en la próxima pasada`);
  }

  // ══ 4) Servidores pendientes (listados sin paquete + vistos en cola) EN PARALELO ══
  const targets = [...new Set([...missing, ...queueTargets])]
    .filter(n => !haveServers.has(n) && !visited.has(n))
    .sort((a, b) => a - b);

  if (targets.length) {
    console.log(`   ⚡ Extrayendo servidores de ${targets.length} episodios (${WORKERS} en paralelo)…`);
    let okCount = 0, failCount = 0;

    await mapPool(targets, WORKERS, async (num) => {
      const r = await fetchEpisodePage(`${BASE_URL}/donghua/${slug}/${num}`);
      if (r.iframe) {
        const servers = [{ name: `Episodio ${num}`, url: r.iframe, embed: true }];
        if (addEpisode(db, slug, num, servers)) okCount++;
        haveNums.add(num);
        haveServers.add(num);
        console.log(`      ✅ Episodio ${num} (servidor)`);
      } else {
        failCount++;
        console.log(`      ⚠️ Episodio ${num}: sin iframe${r.error ? ` (${r.error})` : ''}`);
      }
    });
    console.log(`   ⚡ Servidores: ${okCount} nuevos · ${failCount} fallaron (se reintentarán)`);
  }

  // ══ 5) Marcar completada y guardar ══
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

  await enqueueSave(db);
  console.log(`💾 Catálogo guardado tras la serie: ${slug}`);
}

/* Main */
async function main() {
  console.log('🚀 DONGHUASUB SYNC (Playwright)');
  console.log(`   tope: ${MAX_RUNTIME_MS/60000} min | fresca: ${COMPLETE_RECHECK_HOURS} h | cola: ${TAIL_WINDOW} | paralelo: ${WORKERS}\n`);

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
    console.log(`\n[${++done}/${seriesUrls.length}] ${url.split('/').pop()}`);

    try {
      await processSeries(db, url);
      if (done % 5 === 0) {
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
