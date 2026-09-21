// ══════════════════════════════════════════════════════════
//  syncdonghuasub.js — DonghuaFlix (VERSIÓN FETCH RÁPIDA)
//  Scraper para DONGHUASUB.COM con HTTP puro (sin Playwright)
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';

const OUT_FILE = path.resolve('public/data/catalog-donghuasub.json');
const BASE_URL = 'https://donghuasub.com';

// Configuración (Con fetch podemos subir workers a 8-10 sin despeinar la CPU)
const WORKERS = Math.max(1, Math.min(10, Number(process.env.WORKERS || 6))); 
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 50);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 5000));

const MAX_CHAIN_STEPS = Math.max(100, Number(process.env.MAX_CHAIN_STEPS || 2000));
const MAX_PATTERN_RECOVERIES = 200;

/* Ruta de guardado */
const CHAIN_SAVE_PATH = path.resolve(process.env.OUT_FILE || OUT_FILE);

const sleep = ms => new Promise(r => setTimeout(r, ms));

/* Headers para simular un navegador real */
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8'
};

/* Petición HTTP ultrarrápida */
async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP status ${res.status}`);
  return await res.text();
}

/* Número de episodio al final del path: /donghua/slug/12 -> 12 */
const epNumOf = u => {
  const m = String(u || '').match(/\/(\d+)(?:[/?#]|$)/);
  return m ? parseInt(m[1], 10) : null;
};

/* Cola de guardado */
let saveQueue = Promise.resolve();
function enqueueSave(db) {
  saveQueue = saveQueue
    .then(() => fs.writeFile(CHAIN_SAVE_PATH, JSON.stringify(db)))
    .catch(e => console.log(`⚠️ Error guardando catálogo: ${e.message}`));
  return saveQueue;
}

/* Localiza el enlace "Siguiente" */
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

/* Cadena "Siguiente episodio" */
async function discoverEpisodesByChain(seriesUrl, slug, knownEpisodes) {
  const found = new Set(knownEpisodes);
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
    try {
      const html = await fetchPage(candidate);
      if (!html.includes(slug)) return null;
      patternRecoveries++;
      console.log(`      🔄 Alternando a patrón: episodio ${target} existe — se reanuda la cadena`);
      return candidate;
    } catch { return null; }
  };

  while (queue.length && steps < MAX_CHAIN_STEPS) {
    if (timeUp()) { exhausted = false; break; }

    const currentUrl = abs(queue.shift());
    if (!currentUrl || visited.has(currentUrl)) continue;
    visited.add(currentUrl);
    steps++;
    const currentNum = epNumOf(currentUrl);
    console.log(`      🔗 Cadena paso ${steps}: E${currentNum}`);

    let resumed = false;

    try {
      const html = await fetchPage(currentUrl);
      if (currentNum != null) lastGood = currentNum;

      for (const mm of html.matchAll(epRe)) found.add(parseInt(mm[1], 10));

      const nextHref = findNextEpisodeUrl(html, slug);
      const nextUrl = nextHref ? abs(nextHref) : null;
      const nextNum = nextUrl ? epNumOf(nextUrl) : null;
      if (nextUrl && nextNum != null && !visited.has(nextUrl) && nextNum !== currentNum) {
        queue.push(nextUrl);
        resumed = true;
      }

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
    chainSteps: steps,
    recoveries: patternRecoveries,
    exhausted
  };
}

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* Descubrir series desde /directorio */
async function discoverSeries() {
  const found = new Set();
  console.log('🔍 Descubriendo series (vía HTTP Directo)...');

  for (let page = 1; page <= 10; page++) {
    if (timeUp()) break;

    const url = page === 1 ? `${BASE_URL}/directorio` : `${BASE_URL}/directorio?page=${page}`;

    try {
      const html = await fetchPage(url);
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

/* Extraer video de un episodio analizando el HTML crudo */
async function extractVideo(episodeUrl) {
  try {
    const html = await fetchPage(episodeUrl);
    const servers = [];

    // Extraer todos los iframes embed
    const iframeRegex = /<iframe[^>]+src=["']([^"']+)["']/gi;
    let match;

    while ((match = iframeRegex.exec(html)) !== null) {
      const src = match[1];
      if (src && !src.includes('donghuasub.com')) {
        servers.push({ name: 'Video', url: src, embed: true });
      }
    }

    // Extraer URLs en atributos data-video / data-player
    const dataPlayerRegex = /data-(?:video|player|src)=["']([^"']+)["']/gi;
    while ((match = dataPlayerRegex.exec(html)) !== null) {
      const src = match[1];
      if (src && !src.includes('donghuasub.com') && !servers.some(s => s.url === src)) {
        servers.push({ name: 'Server', url: src, embed: true });
      }
    }

    return servers;
  } catch (e) {
    return [];
  }
}

/* Procesar una serie */
async function processSeries(db, seriesUrl) {
  const slug = seriesUrl.split('/').pop();
  const html = await fetchPage(seriesUrl);

  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  const title = titleMatch ? titleMatch[1].trim() : slug;

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

  const epRegex = new RegExp(`href="/donghua/${slug}/(\\d+)"`, 'gi');
  const epMatches = [...html.matchAll(epRegex)];
  const episodes = [...new Set(epMatches.map(m => parseInt(m[1], 10)))].sort((a, b) => a - b);

  console.log(`   🎬 ${episodes.length} episodios detectados`);

  try {
    const chain = await discoverEpisodesByChain(seriesUrl, slug, episodes);

    console.log(
      `   🔗 Cadena "Siguiente": ${chain.chainSteps} pasos · ${chain.episodeNumbers.length} episodios vistos` +
      ` · ${chain.recoveries} recuperación(es) por patrón` +
      (chain.exhausted ? ' · fin de cadena alcanzado ✅' : ' · cadena truncada ⚠️')
    );

    const already = new Set([
      ...episodes,
      ...db.episodes.filter(e => e.seriesId === slug).map(e => e.number)
    ]);
    const fromChain = chain.episodeNumbers.filter(n => !already.has(n));

    for (const epNum of fromChain) {
      if (timeUp()) break;

      const epId = `${slug}-e${epNum}`;
      if (db.episodes.some(e => e.id === epId)) continue;

      const epUrl = `${seriesUrl}/${epNum}`;

      try {
        const servers = await extractVideo(epUrl);

        if (servers.length === 0) {
          console.log(`      ⚠️ Episodio ${epNum} (cadena): sin servidores`);
          continue;
        }

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

        console.log(`      ✅ Episodio ${epNum} (cadena) (${servers.length} servidor)`);
      } catch (e) {
        console.log(`      ❌ Episodio ${epNum} (cadena): ${e.message}`);
      }

      await sleep(POLITENESS_MS);
    }

    await enqueueSave(db);
    console.log(`💾 Catálogo guardado tras completar la serie: ${slug}`);
  } catch (e) {
    console.log(`   ⚠️ Cadena no disponible, se conserva la detección clásica: ${e.message}`);
  }

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

    await sleep(POLITENESS_MS);
  }
}

/* Main */
async function main() {
  console.log('🚀 DONGHUASUB SYNC (HTTP Directo - Ultra Rápido)');
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

    console.log(`\n[${++done}/${seriesUrls.length}] ${url.split('/').pop()}`);

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
  console.log('🎉 DONGHUASUB TERMINADO');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`🎬 Episodios: ${db.episodes.length}`);
  console.log(`⏱️ Duración: ${elapsedMin()} min`);
}

main().catch(async e => {
  console.error('💥 FATAL:', e);
  process.exit(1);
});
