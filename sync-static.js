import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.join(process.cwd(), 'public', 'data', 'catalog.json');

// Slugs que aparecen bajo /series/ pero que en realidad son enlaces de
// navegación (temporadas, géneros, paginación, buscador...) y no series reales.
// Esto evita que un enlace como /series/temporadas se trate como una "serie".
const RESERVED_SLUGS = new Set([
  'temporadas', 'temporada', 'episodios', 'episodio',
  'genero', 'generos', 'genre', 'genres',
  'page', 'pagina', 'buscar', 'search',
  'categoria', 'categorias', 'inicio'
]);

// Encabezados genéricos de la plantilla que NUNCA son el título real de una serie.
const GENERIC_HEADINGS = new Set([
  'temporadas', 'temporada', 'episodios', 'episodio', 'series', 'inicio'
]);

// Delay entre peticiones para reducir el riesgo de bloqueo (403) por parte de
// Cloudflare/WAF al ejecutar desde IPs de GitHub Actions. Ajustable por entorno.
const MIN_DELAY_MS = Number(process.env.SCRAPE_DELAY_MIN_MS) || 800;
const MAX_DELAY_MS = Number(process.env.SCRAPE_DELAY_MAX_MS) || 2000;

// Si se acumulan demasiados fallos seguidos, probablemente sea un bloqueo de IP
// (no un fallo puntual). Abortamos pronto en vez de agotar el tiempo de CI.
const MAX_CONSECUTIVE_FAILURES = 8;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function randomDelay(minMs = MIN_DELAY_MS, maxMs = MAX_DELAY_MS) {
  return sleep(minMs + Math.random() * (maxMs - minMs));
}

function isGenericHeading(text) {
  return !text || GENERIC_HEADINGS.has(text.toLowerCase().trim());
}

async function fetchHTML(url, { referer = BASE_URL, retries = 3 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'es-ES,es;q=0.9',
          'Referer': referer,
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'same-origin'
        }
      });

      if (res.ok) return await res.text();

      // 403/429/5xx pueden ser bloqueos temporales: merece la pena reintentar.
      // Un 404 no lo es (la página no existe), así que no perdemos tiempo ahí.
      const isRetryable = res.status === 403 || res.status === 429 || res.status >= 500;
      if (isRetryable && attempt < retries) {
        const wait = 2500 * attempt;
        console.warn(`⚠️  HTTP ${res.status} en ${url} — reintentando en ${wait}ms (intento ${attempt}/${retries})`);
        await sleep(wait);
        continue;
      }
      console.warn(`⚠️  HTTP ${res.status} en ${url} — se omite tras ${attempt} intento(s).`);
      return null;
    } catch (err) {
      if (attempt < retries) {
        const wait = 2000 * attempt;
        console.warn(`⚠️  Error de red en ${url}: ${err.message} — reintentando en ${wait}ms`);
        await sleep(wait);
        continue;
      }
      console.warn(`⚠️  Error de red en ${url}: ${err.message} — se omite.`);
      return null;
    }
  }
  return null;
}

function absoluteUrl(relative, base = BASE_URL) {
  if (!relative) return '';
  if (relative.startsWith('http')) return relative;
  return new URL(relative, base).href;
}

// Transforma slugs como "spirit-realm-walker" en títulos limpios "Spirit Realm Walker"
function formatTitle(slug) {
  if (!slug) return 'Donghua';
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

// Extrae una imagen válida (og:image o <img>), descartando el placeholder
// IcoPrueba.png y logos. Se reutiliza para series Y temporadas, así ninguna
// de las dos rutas puede colar el placeholder.
function extractCleanImage($ctx) {
  const ogImage = $ctx('meta[property="og:image"]').attr('content');
  if (ogImage && !ogImage.includes('IcoPrueba.png')) {
    return absoluteUrl(ogImage).split('?')[0];
  }

  let found = '';
  $ctx('img').each((_, img) => {
    const src = $ctx(img).attr('src');
    if (src && !src.includes('IcoPrueba.png') && !src.includes('logo') && !found) {
      found = src;
    }
  });
  return found ? absoluteUrl(found).split('?')[0] : '';
}

async function scrapeDonghuaFlix() {
  console.log('🚀 Iniciando sincronización del catálogo...');

  const seriesMap = new Map();
  const seasonsMap = new Map();
  const episodesMap = new Map();
  const genresSet = new Set();

  const mainHtml = await fetchHTML(`${BASE_URL}/series`);
  if (!mainHtml) {
    console.error('❌ No se pudo conectar a la web principal.');
    process.exitCode = 1;
    return;
  }

  const $main = cheerio.load(mainHtml);
  const seriesSlugs = new Set();

  $main('a[href*="/series/"]').each((_, el) => {
    const href = $main(el).attr('href');
    if (href) {
      const parts = href.split('/').filter(Boolean);
      const idx = parts.indexOf('series');
      const candidate = idx !== -1 ? parts[idx + 1] : null;
      if (candidate && !RESERVED_SLUGS.has(candidate.toLowerCase())) {
        seriesSlugs.add(candidate);
      }
    }
  });

  console.log(`Encontradas ${seriesSlugs.size} series únicas.`);

  let consecutiveFailures = 0;
  let aborted = false;

  for (const seriesSlug of seriesSlugs) {
    if (aborted) break;

    const sUrl = `${BASE_URL}/series/${seriesSlug}`;
    const sHtml = await fetchHTML(sUrl, { referer: `${BASE_URL}/series` });
    await randomDelay();

    if (!sHtml) {
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`❌ ${MAX_CONSECUTIVE_FAILURES} fallos consecutivos — probable bloqueo de IP. Abortando sin tocar el catalog.json existente.`);
        aborted = true;
      }
      continue;
    }
    consecutiveFailures = 0;

    const $s = cheerio.load(sHtml);

    // Título limpio basado en el slug: es la fuente de verdad y NUNCA depende
    // del HTML de la página, así que jamás puede terminar siendo "Temporadas".
    const title = formatTitle(seriesSlug);

    // Título original/nativo: preferimos og:title (más fiable) y usamos el h1
    // solo como respaldo, descartando encabezados genéricos de la plantilla
    // ("Temporadas", "Episodios", etc.). Si ambos fallan, caemos al título limpio.
    const ogTitleRaw = $s('meta[property="og:title"]').attr('content')?.split('|')[0]?.trim();
    const h1Title = $s('h1').first().text().trim();

    let chineseTitle = title;
    if (ogTitleRaw && !isGenericHeading(ogTitleRaw)) {
      chineseTitle = ogTitleRaw;
    } else if (h1Title && !isGenericHeading(h1Title)) {
      chineseTitle = h1Title;
    }

    const poster = extractCleanImage($s);
    const synopsis = $s('.field--name-field-synopsis, .synopsis, article p').first().text().trim();
    const status = sHtml.includes('EN EMISIÓN') ? 'En emisión' : 'Finalizado';

    seriesMap.set(seriesSlug, {
      id: seriesSlug,
      slug: seriesSlug,
      title: title,
      originalTitle: chineseTitle,
      image: poster,
      synopsis: synopsis,
      status: status,
      updatedAt: new Date().toISOString()
    });

    // Procesar Temporadas
    const seasonLinks = new Set();
    $s('a[href*="/season/"]').each((_, el) => {
      const href = $s(el).attr('href');
      if (href) seasonLinks.add(href);
    });

    if (seasonLinks.size === 0) {
      seasonLinks.add(`/season/${seriesSlug}-1`);
    }

    for (const seasonLink of seasonLinks) {
      const seasonSlug = seasonLink.split('/').filter(Boolean).pop();
      const seasonUrl = absoluteUrl(seasonLink);
      const seasonHtml = await fetchHTML(seasonUrl, { referer: sUrl });
      await randomDelay();
      if (!seasonHtml) continue;

      const $se = cheerio.load(seasonHtml);
      const seasonPoster = extractCleanImage($se) || poster;

      const sNumMatch = seasonSlug.match(/\d+$/);
      const seasonNum = sNumMatch ? sNumMatch[0] : '1';

      seasonsMap.set(seasonSlug, {
        id: seasonSlug,
        seriesId: seriesSlug,
        title: `Temporada ${seasonNum}`,
        image: seasonPoster
      });

      // Procesar Episodios
      const seasonEpisodesMap = new Map();

      $se('a[href*="/episode/"]').each((_, epEl) => {
        const epHref = $se(epEl).attr('href');
        if (!epHref) return;

        const epSlug = epHref.split('/').filter(Boolean).pop();
        const rawText = $se(epEl).text().trim();

        const match = rawText.match(/(?:x|episodio\s*|ep\s*|-|\s)(\d+)(?:\s*\||$)/i) || epSlug.match(/\d+$/) || epSlug.match(/\d+/);
        const epNumber = match ? parseInt(match[1] || match[0], 10) : 1;

        if (!seasonEpisodesMap.has(epNumber)) {
          seasonEpisodesMap.set(epNumber, {
            id: epSlug,
            slug: epSlug,
            seasonId: seasonSlug,
            seriesId: seriesSlug,
            title: `Episodio ${epNumber}`,
            number: epNumber,
            servers: [
              { name: 'Rumble', url: `${BASE_URL}/embed/${epSlug}?server=rumble` },
              { name: 'Dailymotion', url: `${BASE_URL}/embed/${epSlug}?server=dailymotion` }
            ]
          });
        }
      });

      for (const ep of seasonEpisodesMap.values()) {
        episodesMap.set(ep.id, ep);
      }
    }
  }

  if (aborted || seriesMap.size === 0) {
    console.error('❌ Sincronización incompleta o bloqueada: se conserva el catalog.json anterior para no publicar datos vacíos/parciales.');
    process.exitCode = 1;
    return;
  }

  const catalog = {
    series: Array.from(seriesMap.values()),
    seasons: Array.from(seasonsMap.values()),
    episodes: Array.from(episodesMap.values()),
    genres: Array.from(genresSet),
    meta: { syncedAt: new Date().toISOString() }
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log('✅ Catálogo sincronizado correctamente.');
}

scrapeDonghuaFlix();
