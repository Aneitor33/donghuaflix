import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.join(process.cwd(), 'public', 'data', 'catalog.json');

async function fetchHTML(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    if (!res.ok) {
      console.log(`⚠️ Error HTTP ${res.status} al conectar a: ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.log(`⚠️ Error de red en ${url}:`, err.message);
    return null;
  }
}

function absoluteUrl(relative, base = BASE_URL) {
  if (!relative) return '';
  if (relative.startsWith('http')) return relative;
  return new URL(relative, base).href;
}

// Convierte un slug como "perfect-world" en un título limpio "Perfect World"
function formatTitle(slug) {
  if (!slug) return 'Donghua';
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function scrapeDonghuaFlix() {
  console.log('🚀 Iniciando sincronización limpia...');

  const seriesMap = new Map();
  const seasonsMap = new Map();
  const episodesMap = new Map();
  const genresSet = new Set();

  const mainHtml = await fetchHTML(`${BASE_URL}/series`);
  if (!mainHtml) {
    console.error('❌ No se pudo conectar a donghualife.com');
    return;
  }

  const $main = cheerio.load(mainHtml);
  const seriesLinks = new Set();

  // Buscar todos los enlaces únicos de series
  $main('a[href*="/series/"]').each((_, el) => {
    const href = $main(el).attr('href');
    if (href && href !== '/series') {
      seriesLinks.add(href);
    }
  });

  for (const sLink of seriesLinks) {
    const sUrl = absoluteUrl(sLink);
    const sHtml = await fetchHTML(sUrl);
    if (!sHtml) continue;

    const $s = cheerio.load(sHtml);
    const seriesSlug = sLink.split('/').filter(Boolean).pop();

    // SOLUCIÓN TÍTULO: Usar siempre el Slug formateado profesionalmente para evitar "Temporadas"
    const title = formatTitle(seriesSlug);

    // SOLUCIÓN IMAGEN: Usar la etiqueta og:image de la página individual (la imagen real del donghua)
    let poster = $s('meta[property="og:image"]').attr('content') || '';
    if (!poster) {
      // Búsqueda alternativa si no hay og:image
      $s('img').each((_, img) => {
        const src = $s(img).attr('src') || '';
        if (src && !src.includes('logo') && !src.includes('default') && !poster) {
          poster = src;
        }
      });
    }
    poster = poster ? absoluteUrl(poster).split('?')[0] : '';

    const synopsis = $s('.field--name-field-synopsis, .synopsis, article p').first().text().trim();
    const status = sHtml.includes('EN EMISIÓN') ? 'En emisión' : 'Finalizado';

    $s('a[href*="/genre/"]').each((_, g) => {
      const gText = $s(g).text().trim();
      if (gText) genresSet.add(gText);
    });

    seriesMap.set(seriesSlug, {
      id: seriesSlug,
      slug: seriesSlug,
      title: title,
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
      const seasonHtml = await fetchHTML(seasonUrl);
      if (!seasonHtml) continue;

      const $se = cheerio.load(seasonHtml);
      const seasonPoster = absoluteUrl($se('meta[property="og:image"]').attr('content') || '') || poster;
      
      const sNumMatch = seasonSlug.match(/\d+$/);
      const seasonNum = sNumMatch ? sNumMatch[0] : '1';

      seasonsMap.set(seasonSlug, {
        id: seasonSlug,
        seriesId: seriesSlug,
        title: `Temporada ${seasonNum}`,
        image: seasonPoster
      });

      // Procesar Episodios (Evitando duplicados por número exacto)
      const seasonEpisodesMap = new Map();

      $se('a[href*="/episode/"]').each((_, epEl) => {
        const epHref = $se(epEl).attr('href');
        if (!epHref) return;

        const epSlug = epHref.split('/').filter(Boolean).pop();
        const rawText = $se(epEl).text().trim();

        // Extraer número de episodio con expresión regular limpia
        const match = rawText.match(/(?:x|episodio\s*|ep\s*|-|\s)(\d+)(?:\s*\||$)/i) || epSlug.match(/\d+$/) || epSlug.match(/\d+/);
        const epNumber = match ? parseInt(match[1] || match[0], 10) : 1;

        // Solo guardamos un episodio por cada número exacto para evitar duplicados
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

      // Volcar episodios limpios al mapa global
      for (const ep of seasonEpisodesMap.values()) {
        episodesMap.set(ep.id, ep);
      }
    }
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
  console.log('✅ Catálogo sincronizado limpiamente sin títulos genéricos.');
}

scrapeDonghuaFlix();
