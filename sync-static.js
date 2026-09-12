import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.join(process.cwd(), 'public', 'data', 'catalog.json');

async function fetchHTML(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

function absoluteUrl(relative, base = BASE_URL) {
  if (!relative) return '';
  if (relative.startsWith('http')) return relative;
  return new URL(relative, base).href;
}

// Convierte "perfect-world" -> "Perfect World"
function cleanTitleFromSlug(slug) {
  if (!slug) return 'Donghua';
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

async function scrapeDonghuaFlix() {
  console.log('🚀 Iniciando extracción blindada...');

  const seriesMap = new Map();
  const seasonsMap = new Map();
  const episodesMap = new Map();

  const mainHtml = await fetchHTML(`${BASE_URL}/series`);
  if (!mainHtml) {
    console.error('❌ No se pudo conectar a la web fuente.');
    return;
  }

  const $main = cheerio.load(mainHtml);
  const seriesLinks = new Set();

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

    // 1. TÍTULO: Forzar limpieza desde el slug o desde og:title si existe
    const ogTitle = $s('meta[property="og:title"]').attr('content') || '';
    let title = cleanTitleFromSlug(seriesSlug);
    
    if (ogTitle && !ogTitle.toLowerCase().includes('temporada') && !ogTitle.toLowerCase().includes('donghualife')) {
      title = ogTitle.split('|')[0].trim();
    }

    // 2. IMAGEN: Buscar la imagen dentro del contenedor principal
    let poster = $s('meta[property="og:image"]').attr('content') || '';
    if (!poster || poster.includes('logo') || poster.includes('default')) {
      $s('img').each((_, img) => {
        const src = $s(img).attr('src') || '';
        if (src.includes('/files/') || src.includes('/styles/') || src.includes('/poster/')) {
          if (!poster) poster = src;
        }
      });
    }

    poster = poster ? absoluteUrl(poster).split('?')[0] : '';

    const synopsis = $s('.field--name-field-synopsis, .synopsis, article p').first().text().trim();

    seriesMap.set(seriesSlug, {
      id: seriesSlug,
      slug: seriesSlug,
      title: title,
      image: poster,
      synopsis: synopsis,
      status: sHtml.includes('EN EMISIÓN') ? 'En emisión' : 'Finalizado',
      updatedAt: new Date().toISOString()
    });

    // 3. TEMPORADAS Y EPISODIOS
    const seasonLinks = new Set();
    $s('a[href*="/season/"]').each((_, el) => {
      const href = $s(el).attr('href');
      if (href) seasonLinks.add(href);
    });

    if (seasonLinks.size === 0) seasonLinks.add(`/season/${seriesSlug}-1`);

    for (const seasonLink of seasonLinks) {
      const seasonSlug = seasonLink.split('/').filter(Boolean).pop();
      const seasonUrl = absoluteUrl(seasonLink);
      const seasonHtml = await fetchHTML(seasonUrl);
      if (!seasonHtml) continue;

      const $se = cheerio.load(seasonHtml);
      const seasonNum = (seasonSlug.match(/\d+$/) || ['1'])[0];

      seasonsMap.set(seasonSlug, {
        id: seasonSlug,
        seriesId: seriesSlug,
        title: `Temporada ${seasonNum}`,
        image: poster
      });

      // Extraer episodios sin duplicados
      $se('a[href*="/episode/"]').each((_, epEl) => {
        const epHref = $se(epEl).attr('href');
        if (!epHref) return;

        const epSlug = epHref.split('/').filter(Boolean).pop();
        
        // Extraer número estricto
        const numMatch = epSlug.match(/-(\d+)$/) || epSlug.match(/\d+/);
        const epNumber = numMatch ? parseInt(numMatch[1] || numMatch[0], 10) : 1;

        if (!episodesMap.has(epSlug)) {
          episodesMap.set(epSlug, {
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
    }
  }

  const catalog = {
    series: Array.from(seriesMap.values()),
    seasons: Array.from(seasonsMap.values()),
    episodes: Array.from(episodesMap.values()),
    meta: { syncedAt: new Date().toISOString() }
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log('✅ Catálogo generado correctamente.');
}

scrapeDonghuaFlix();
