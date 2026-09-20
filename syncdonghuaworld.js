// ══════════════════════════════════════════════════════════
//  syncdonghuaworld.js — DonghuaFlix
//  Scraper para DONGHUAWORLD.COM
//  Usa la MISMA lógica de extracción que donghualife (iframes, enlaces, data-*)
// ══════════════════════════════════════════════════════════

import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const OUT_FILE = path.resolve('public/data/catalog-donghuaworld.json');
const BASE_URL = 'https://donghuaworld.com';

// 8 workers como en donghualife
const WORKERS = Math.max(1, Math.min(12, Number(process.env.WORKERS || 8)));
const POLITENESS_MS = Number(process.env.POLITENESS_MS || 300);
const MAX_RUNTIME_MS = Math.max(10, Number(process.env.MAX_RUNTIME_MINUTES || 300)) * 60000;
const FETCH_TIMEOUT_MS = 30000;

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

/* Pool de workers */
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
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml'
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

/* Descubrir series desde /page/N/ */
async function discoverSeries() {
  const found = new Set();

  // Sondeo forzado: páginas 1 a 50 (donghuaworld tiene al menos 31)
  // No para hasta encontrar 5 páginas vacías seguidas (después de la página 5)
  let emptyStreak = 0;
  const MAX_EMPTY = 5;

  for (let page = 1; page <= 50; page++) {
    if (timeUp()) break;

    // URL exacta según la estructura de donghuaworld
    const url = page === 1 ? BASE_URL : `${BASE_URL}/page/${page}/`;

    try {
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);
      let count = 0;

      // Buscar enlaces /anime/ (fichas de series)
      $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        const full = canonical(absolute(href, url));
        if (!full || !sameOrigin(full)) return;

        try {
          const p = new URL(full).pathname;
          if (/^\/anime\/[a-z0-9-]+\/?$/i.test(p)) {
            if (!found.has(full)) {
              found.add(full);
              count++;
            }
          }
        } catch {}
      });

      console.log(`📄 Página ${page}: ${count} series (total: ${found.size})`);

      // Solo contar vacías después de la página 5 (para no parar por errores temporales al inicio)
      if (page > 5 && count === 0) {
        emptyStreak++;
        console.log(`   ⚠️ Página vacía (${emptyStreak}/${MAX_EMPTY})`);
        if (emptyStreak >= MAX_EMPTY) {
          console.log(`🛑 ${MAX_EMPTY} páginas vacías seguidas, fin del sondeo`);
          break;
        }
      } else {
        emptyStreak = 0; // Reset si encontramos algo
      }

    } catch (e) {
      console.log(`⚠️ Error página ${page}: ${e.message}`);
      // No contamos errores como vacías, solo logueamos y seguimos
    }

    await sleep(POLITENESS_MS);
  }

  console.log(`\n🎯 Total series descubiertas: ${found.size}`);
  return [...found];
}

/* Parsear episodio (MISMA lógica que donghualife) */
function parseEpisode(html, episodeUrl) {
  const $ = cheerio.load(html);

  const title = clean(
    $('h1').first().text() ||
    $('meta[property="og:title"]').attr('content') ||
    slugFromUrl(episodeUrl)
  );

  const servers = [];

  const addServer = (name, raw, embed = false) => {
    const url = absolute(raw, episodeUrl);
    if (!url || sameOrigin(url)) return;

    const key = `${name}|${url}`.toLowerCase();
    if (servers.some(item => `${item.name}|${item.url}`.toLowerCase() === key)) return;

    servers.push({
      name: clean(name) || 'Servidor',
      url,
      embed: Boolean(embed)
    });
  };

  // 1. Enlaces a servidores conocidos
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const text = clean($(el).text());
    if (!href) return;

    const lower = href.toLowerCase();
    if (/dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|mega|youtube|fembed|skadi|asura/.test(lower)) {
      let hostname = 'Servidor';
      try { hostname = new URL(href, episodeUrl).hostname; } catch {}
      addServer(text || hostname, href, false);
    }
  });

  // 2. Iframes y videos embebidos
  $('iframe[src], video[src], source[src]').each((_, el) => {
    const src = $(el).attr('src');
    if (!src) return;

    const full = absolute(src, episodeUrl);
    if (!full) return;

    const lower = full.toLowerCase();
    if (/dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|youtube|fembed|skadi|asura/.test(lower)) {
      try { addServer(new URL(full).hostname, full, true); } catch {}
    }
  });

  // 3. Atributos data-*
  $('[data-src], [data-embed], [data-url], [data-video]').each((_, el) => {
    const raw = $(el).attr('data-src') || $(el).attr('data-embed') || 
                $(el).attr('data-url') || $(el).attr('data-video');
    if (!raw) return;

    const full = absolute(raw, episodeUrl);
    if (!full) return;

    if (/dailymotion|rumble|streamtape|ok\.ru|voe|vidmoly|youtube|fembed|skadi|asura/i.test(full)) {
      try { addServer(new URL(full).hostname, full, true); } catch {}
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

  // Limpiar " - DonghuaWorld" del título
  title = title.replace(/\s*[-|]\s*DonghuaWorld.*$/i, '').trim();

  const synopsis = clean(
    $('meta[name="description"]').attr('content') ||
    $('[class*="description"], [class*="synopsis"]').first().text()
  );

  // Detectar episodios: LÓGICA FLEXIBLE
  // 1. El enlace debe contener el nombre de la serie (slug)
  // 2. Debe tener "episode" o "ep" seguido de números
  // 3. Extraer el número inicial y final (si es rango)
  const episodes = [];
  const baseSlug = slug.replace(/^anime-/, '').toLowerCase();

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const full = canonical(absolute(href, url));
    if (!full || !sameOrigin(full)) return;

    try {
      const epSlug = slugFromUrl(full).toLowerCase();

      // REGLA 1: Debe empezar con el nombre de la serie (o contenerlo al inicio)
      if (!epSlug.startsWith(baseSlug)) return;

      // REGLA 2: Debe contener "episode" o "-ep-" después del nombre
      const afterSeries = epSlug.slice(baseSlug.length);
      if (!afterSeries.match(/^-(episode|ep)-/i)) return;

      // REGLA 3: Extraer números (cualquier combinación: 1, 1-10, 1-10-20, etc)
      const numMatch = afterSeries.match(/^(?:-episode|-ep)-(\d+)(?:-(\d+))?(?:-(\d+))?/i);
      if (!numMatch) return;

      const from = parseInt(numMatch[1], 10);
      // Si hay segundo número, es el final del rango (o parte de él)
      const to = numMatch[2] ? parseInt(numMatch[2], 10) : from;

      // Título legible
      let title;
      if (from === to) {
        title = `Episode ${from}`;
      } else {
        title = `Episode ${from}-${to}`;
      }

      episodes.push({
        url: full,
        slug: epSlug,
        from,
        to,
        isRange: from !== to,
        title
      });
    } catch {}
  });

  // Ordenar: primero por número inicial, luego rangos después de individuales
  episodes.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    // Si empiezan igual, individuales antes que rangos
    if (a.isRange && !b.isRange) return 1;
    if (!a.isRange && b.isRange) return -1;
    return a.to - b.to;
  });

  // Eliminar duplicados
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
    src: 'donghuaworld',
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

    const epId = `${slug}-e${ep.from}${ep.to !== ep.from ? '-' + ep.to : ''}`;

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
        slug: ep.slug,
        title: parsed.title || ep.title,
        sourceUrl: ep.url,
        servers: parsed.servers,
        seriesId: slug,
        seasonId,
        number: ep.from,
        rangeFrom: ep.from,
        rangeTo: ep.to,
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
  console.log('🚀 DONGHUAWORLD SYNC');
  console.log(`   workers: ${WORKERS} | tope tiempo: ${MAX_RUNTIME_MS/60000} min\n`);

  // Cargar catálogo
  let db;
  try {
    db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
  }

  // Descubrir series
  console.log('🔍 Descubriendo series...');
  const seriesUrls = await discoverSeries();
  console.log(`\n📚 Total series: ${seriesUrls.length}`);

  // Procesar con pool de workers
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
  console.log('🎉 DONGHUAWORLD TERMINADO');
  console.log(`📚 Series: ${db.series.length}`);
  console.log(`🎬 Episodios: ${db.episodes.length}`);
  console.log(`⏱️ Duración: ${elapsedMin()} min`);
}

main().catch(e => {
  console.error('💥 FATAL:', e);
  process.exit(1);
});
