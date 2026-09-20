// ══════════════════════════════════════════════════════════
//  syncdonghua.js — DonghuaFlix
//  Scraper UNIFICADO para:
//    · donghualife.com (español, episodios numerados)
//    · donghuaworld.com (inglés, episodios en rangos 1-10, etc.)
//  Genera dos catálogos separados.
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const POLITENESS_MS = Number(process.env.POLITENESS_MS || 500);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const MAX_EPISODE_CRAWLS = Math.max(100, Number(process.env.MAX_EPISODE_CRAWLS || 15000));

const T0 = Date.now();
const timeUp = () => Date.now() - T0 > MAX_RUNTIME_MS;
const elapsedMin = () => ((Date.now() - T0) / 60000).toFixed(1);

/* ══════════════════════════════════════════════════════════
   FUENTE 1: DONGHUALIFE.COM (español, numerado 1,2,3...)
══════════════════════════════════════════════════════════ */
const DONGHUALIFE = {
  id: 'donghualife',
  base: 'https://donghualife.com',
  seeds: ['/series/', '/series', '/donghuas', '/en-emision', '/finalizado', '/en-pausa'],
  seriesTest: p => /^\/series\/[a-z0-9-]+\/?$/i.test(p),
  seasonTest: p => /^\/season\/[a-z0-9-]+/i.test(p),
  episodeTest: p => /^\/episode\/[a-z0-9-]+/i.test(p),
  epBelongs: (slug, p, ss) => slug.toLowerCase().startsWith(ss.toLowerCase()),
  pageProbe: (seed, n) => `${seed}?page=${n}`,
  isPageLink: (curPath, url) => {
    try {
      const u = new URL(url);
      return u.pathname === curPath && (u.searchParams.has('page') || u.searchParams.has('pag'));
    } catch { return false; }
  }
};

/* ══════════════════════════════════════════════════════════
   FUENTE 2: DONGHUAWORLD.COM (inglés, rangos 1-10, 15-18...)
══════════════════════════════════════════════════════════ */
const DONGHUAWORLD = {
  id: 'donghuaworld',
  base: 'https://donghuaworld.com',
  seeds: ['/'],
  seriesTest: p => /^\/anime\/[a-z0-9-]+\/?$/i.test(p),
  episodeTest: p => /^\/[a-z0-9-]+-episode-\d+(-\d+)?-multi-subtitles\/?$/i.test(p),
  pageProbe: (seed, n) => `/page/${n}/`,
  isPageLink: p => /^\/?page\/\d+\/?$/i.test(p),
  isRange: true // Episodios en rangos, no numerados
};

/* ══════════════════════════════════════════════════════════
   UTILIDADES
══════════════════════════════════════════════════════════ */
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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
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

/* ══════════════════════════════════════════════════════════
   SCRAPER GENÉRICO (sirve para ambas webs)
══════════════════════════════════════════════════════════ */

// Detectar si un enlace es episodio y extraer su número/rango
function parseEpisodeUrl(url, source) {
  const slug = slugFromUrl(url);
  const pathname = new URL(url).pathname;

  if (source.id === 'donghualife') {
    // Formato: /episode/slug-1-x18 o /episode/slug-episodio-680
    let m = slug.match(/(\d{1,3})x(\d{1,4})(?:-|$)/i);
    if (m) return { season: Number(m[1]), number: Number(m[2]), from: Number(m[2]), to: Number(m[2]) };
    m = slug.match(/-(\d{1,3})-episodio-x?(\d{1,4})/i);
    if (m) return { season: Number(m[1]), number: Number(m[2]), from: Number(m[2]), to: Number(m[2]) };
    m = slug.match(/-episodio-x?(\d{1,4})(?:-|$)/i);
    if (m) return { season: 1, number: Number(m[1]), from: Number(m[1]), to: Number(m[1]) };
    m = slug.match(/-(\d{1,4})$/);
    if (m) return { season: 1, number: Number(m[1]), from: Number(m[1]), to: Number(m[1]) };
    return null;
  } else {
    // donghuaworld: /slug-episode-1-10-multi-subtitles
    const m = slug.match(/episode-(\d+)(?:-(\d+))?-multi-subtitles/i);
    if (!m) return null;
    const from = parseInt(m[1], 10);
    const to = m[2] ? parseInt(m[2], 10) : from;
    return { season: 1, number: from, from, to };
  }
}

// Extraer video de una página de episodio
function parseEpisode(html, url, source) {
  const $ = cheerio.load(html);
  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(url)
  ).replace(/\s*[-|]\s*(DonghuaLife|DonghuaWorld).*$/i, '').trim();

  const servers = [];

  // iframes (DailyMotion, etc.)
  $('iframe[src]').each((_, el) => {
    const src = absolute($(el).attr('src'), url);
    if (src && /dailymotion|youtube|vimeo|ok\.ru|streamtape|fembed|voe/i.test(src)) {
      servers.push({ name: 'Servidor', url: src, embed: true });
    }
  });

  // Scripts con URLs de video
  $('script').each((_, el) => {
    const txt = $(el).html() || '';
    const m = txt.match(/dailymotion\.com\/embed\/video\/([a-zA-Z0-9_-]+)/i);
    if (m) {
      const u = `https://www.dailymotion.com/embed/video/${m[1]}`;
      if (!servers.some(s => s.url === u)) servers.push({ name: 'DailyMotion', url: u, embed: true });
    }
  });

  return { title, servers };
}

// Extraer info de serie + episodios
function parseSeries(html, url, source) {
  const $ = cheerio.load(html);
  const slug = slugFromUrl(url);

  let title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
  );

  // Limpiar sufijos comunes
  title = title.replace(/\s*[-|]\s*(DonghuaLife|DonghuaWorld|Temporadas?).*$/i, '').trim();
  if (/^(temporadas?|episodios?|series?)$/i.test(title)) {
    title = slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  }

  const synopsis = clean(
    $('meta[name="description"]').attr('content') ||
    $('.description, .synopsis, [class*="desc"]').first().text()
  );

  // Detectar episodios
  const episodes = [];
  const baseSlug = source.id === 'donghuaworld' ? slug.replace(/^anime-/, '') : slug;

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = absolute(href, url);
    if (!full || !sameOrigin(full, url)) return;

    try {
      const path = new URL(full).pathname;
      if (!source.episodeTest(path)) return;

      const epSlug = slugFromUrl(full);
      // Filtrar: debe pertenecer a esta serie
      if (source.id === 'donghuaworld') {
        // donghuaworld: el episodio debe contener el slug base
        if (!epSlug.includes(baseSlug)) return;
      } else {
        // donghualife: debe empezar por el slug
        if (!epSlug.toLowerCase().startsWith(baseSlug.toLowerCase())) return;
      }

      const epInfo = parseEpisodeUrl(full, source);
      if (epInfo) {
        episodes.push({
          url: full,
          slug: epSlug,
          ...epInfo,
          title: source.id === 'donghuaworld' 
            ? `Episode ${epInfo.from}${epInfo.to !== epInfo.from ? '-' + epInfo.to : ''}`
            : `Episodio ${epInfo.number}`
        });
      }
    } catch {}
  });

  // Ordenar y deduplicar
  episodes.sort((a, b) => a.from - b.from);
  const seen = new Set();
  const unique = episodes.filter(ep => {
    if (seen.has(ep.slug)) return false;
    seen.add(ep.slug);
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

/* ══════════════════════════════════════════════════════════
   DESCUBRIMIENTO
══════════════════════════════════════════════════════════ */
async function discoverSource(source) {
  const found = new Set();

  for (const seed of source.seeds) {
    if (timeUp()) break;
    const first = absolute(seed, source.base);
    if (!first) continue;

    console.log(`\n🔎 [${source.id}] Descubriendo desde ${seed}...`);

    // BFS con paginación
    const queue = [first];
    const visited = new Set();

    while (queue.length && visited.size < 100 && !timeUp()) {
      const pageUrl = queue.shift();
      if (!pageUrl || visited.has(pageUrl)) continue;
      visited.add(pageUrl);

      try {
        const html = await fetchHtml(pageUrl);
        const $ = cheerio.load(html);
        let count = 0;

        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          const full = absolute(href, pageUrl);
          if (!full || !sameOrigin(full, source.base)) return;
          try {
            const p = new URL(full).pathname;
            if (source.seriesTest(p)) {
              if (!found.has(full)) {
                found.add(full);
                count++;
              }
            }
          } catch {}
        });

        // Detectar paginación
        $('a[href]').each((_, el) => {
          const href = $(el).attr('href');
          const full = absolute(href, pageUrl);
          if (!full || !sameOrigin(full, source.base)) return;
          try {
            const p = new URL(full).pathname;
            if (source.isPageLink(p, full)) {
              if (!visited.has(full) && !queue.includes(full)) queue.push(full);
            }
          } catch {}
        });

        if (count > 0) console.log(`   → ${count} series (total: ${found.size})`);
      } catch (e) {
        console.log(`   ⚠️ Error: ${e.message}`);
      }

      await sleep(POLITENESS_MS);
    }
  }

  console.log(`\n🎯 [${source.id}] Total series: ${found.size}`);
  return [...found];
}

/* ══════════════════════════════════════════════════════════
   PROCESAMIENTO
══════════════════════════════════════════════════════════ */
async function processSource(source, outFile) {
  console.log(`\n═══════════════════════════════════════`);
  console.log(`🚀 PROCESANDO ${source.id.toUpperCase()}`);
  console.log(`═══════════════════════════════════════`);

  // Cargar catálogo
  let db;
  try {
    db = JSON.parse(await fs.readFile(outFile, 'utf8'));
  } catch {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }

  // Descubrir
  const seriesUrls = await discoverSource(source);
  console.log(`\n📚 Series a procesar: ${seriesUrls.length}`);

  let done = 0;
  let newEps = 0;
  let failed = 0;

  for (const seriesUrl of seriesUrls) {
    if (timeUp()) break;
    if (newEps >= MAX_EPISODE_CRAWLS) break;

    const seriesSlug = slugFromUrl(seriesUrl);
    console.log(`\n[${++done}/${seriesUrls.length}] ${seriesSlug}`);

    try {
      const html = await fetchHtml(seriesUrl);
      const series = parseSeries(html, seriesUrl, source);

      // Guardar serie
      const seriesData = {
        id: seriesSlug,
        slug: seriesSlug,
        title: series.title,
        synopsis: series.synopsis,
        image: series.image,
        type: 'donghua',
        src: source.id,
        sourceUrls: [seriesUrl],
        updatedAt: new Date().toISOString()
      };

      const existingIdx = db.series.findIndex(s => s.id === seriesSlug);
      if (existingIdx >= 0) db.series[existingIdx] = { ...db.series[existingIdx], ...seriesData };
      else db.series.push(seriesData);

      console.log(`   📝 ${series.title}`);
      console.log(`   🎬 ${series.episodes.length} episodios detectados`);

      // Procesar episodios
      for (const ep of series.episodes) {
        if (timeUp() || newEps >= MAX_EPISODE_CRAWLS) break;

        const epId = `${seriesSlug}-e${ep.from}${ep.to !== ep.from ? '-' + ep.to : ''}`;
        if (db.episodes.some(e => e.id === epId)) continue;

        try {
          const epHtml = await fetchHtml(ep.url);
          const parsed = parseEpisode(epHtml, ep.url, source);

          if (parsed.servers.length === 0) throw new Error('Sin servidores');

          // Crear temporada si no existe
          const seasonId = `${seriesSlug}-t${ep.season}`;
          if (!db.seasons.some(s => s.id === seasonId)) {
            db.seasons.push({
              id: seasonId,
              slug: seasonId,
              seriesId: seriesSlug,
              number: ep.season,
              updatedAt: new Date().toISOString()
            });
          }

          db.episodes.push({
            id: epId,
            slug: ep.slug,
            title: parsed.title || ep.title,
            sourceUrl: ep.url,
            servers: parsed.servers,
            seriesId: seriesSlug,
            seasonId,
            number: ep.from,
            rangeFrom: ep.from,
            rangeTo: ep.to,
            updatedAt: new Date().toISOString()
          });

          newEps++;
          console.log(`      ✅ ${ep.title} (${parsed.servers.length} servidor)`);
        } catch (e) {
          failed++;
          console.log(`      ❌ ${ep.title}: ${e.message}`);
        }

        await sleep(POLITENESS_MS);
      }

      // Checkpoint cada 5 series
      if (done % 5 === 0) {
        await fs.writeFile(outFile, JSON.stringify(db));
        console.log(`💾 Checkpoint (${done}/${seriesUrls.length})`);
      }

    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
    }

    await sleep(POLITENESS_MS);
  }

  // Finalizar
  for (const season of db.seasons) {
    season.episodeCount = db.episodes.filter(e => e.seasonId === season.id).length;
  }

  db.meta = {
    source: source.base,
    syncedAt: new Date().toISOString(),
    series: db.series.length,
    episodes: db.episodes.length
  };

  await fs.writeFile(outFile, JSON.stringify(db));

  console.log(`\n🎉 ${source.id.toUpperCase()} TERMINADO`);
  console.log(`   Series: ${db.series.length} | Episodios nuevos: ${newEps} | Fallidos: ${failed}`);
}

/* ══════════════════════════════════════════════════════════
   MAIN
══════════════════════════════════════════════════════════ */
async function main() {
  const only = process.env.ONLY_SOURCE || '';

  if (only === 'donghualife') {
    console.log('🚀 DONGHUALIFE SYNC (solo donghualife.com)');
    await processSource(DONGHUALIFE, 'public/data/catalog-donghualife.json');
  } else if (only === 'donghuaworld') {
    console.log('🚀 DONGHUAWORLD SYNC (solo donghuaworld.com)');
    await processSource(DONGHUAWORLD, 'public/data/catalog-donghuaworld.json');
  } else {
    // Ambas (comportamiento por defecto)
    console.log('═══════════════════════════════════════');
    console.log('🚀 DONGHUA SYNC (DonghuaLife + DonghuaWorld)');
    console.log(`   tope episodios: ${MAX_EPISODE_CRAWLS} | tope tiempo: ${MAX_RUNTIME_MS/60000} min`);
    console.log('═══════════════════════════════════════');
    await processSource(DONGHUALIFE, 'public/data/catalog-donghualife.json');
    await processSource(DONGHUAWORLD, 'public/data/catalog-donghuaworld.json');
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`⏱️  Duración total: ${elapsedMin()} min`);
}

main().catch(e => {
  console.error('💥 FATAL:', e);
  process.exit(1);
});
