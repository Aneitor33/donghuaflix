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
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'es-ES,es;q=0.9'
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

function formatTitle(slug) {
  if (!slug) return 'Donghua';
  return slug
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

async function scrapeDonghuaFlix() {
  console.log('🚀 Iniciando sincronización forzada y limpia...');

  const seriesMap = new Map();
  const seasonsMap = new Map();
  const episodesMap = new Map();
  const genresSet = new Set();

  const mainHtml = await fetchHTML(`${BASE_URL}/series`);
  if (!mainHtml) {
    console.error('❌ No se pudo conectar a la web principal.');
    return;
  }

  const $main = cheerio.load(mainHtml);
  const seriesSlugs = new Set();

  $main('a[href*="/series/"]').each((_, el) => {
    const href = $main(el).attr('href');
    if (href) {
      const parts = href.split('/').filter(Boolean);
      const idx = parts.indexOf('series');
      if (idx !== -1 && parts[idx + 1]) {
        seriesSlugs.add(parts[idx + 1]);
      }
    }
  });

  console.log(`Encontradas ${seriesSlugs.size} series únicas.`);

  for (const seriesSlug of seriesSlugs) {
    const sUrl = `${BASE_URL}/series/${seriesSlug}`;
    const sHtml = await fetchHTML(sUrl);
    if (!sHtml) continue;

    const $s = cheerio.load(sHtml);

    // SOLUCIÓN DEFINITIVA TÍTULO: Ignoramos cualquier título basura de la web y usamos el Slug formateado
    const title = formatTitle(seriesSlug);

    // SOLUCIÓN DEFINITIVA IMAGEN: Buscar og:image pero descartando "IcoPrueba.png" y logos genéricos
    let poster = '';
    const ogImage = $s('meta[property="og:image"]').attr('content');
    if (ogImage && !ogImage.includes('IcoPrueba.png') && !ogImage.includes('logo')) {
      poster = ogImage;
    }

    if (!poster) {
      // Buscar otra imagen válida en la página que no sea la basura genérica
      $s('img').each((_, img) => {
        const src = $s(img).attr('src') || '';
        if (src && !src.includes('IcoPrueba.png') && !src.includes('logo') && !src.includes('default') && !poster) {
          poster = src;
        }
      });
    }
    poster = poster ? absoluteUrl(poster).split('?')[0] : '';

    const synopsis = $s('.field--name-field-synopsis, .synopsis, article p').first().text().trim();
    const status = sHtml.includes('EN EMISIÓN') ? 'En emisión' : 'Finalizado';

    seriesMap.set(seriesSlug, {
      id: seriesSlug,
      slug: seriesSlug,
      title: title, // Título limpio garantizado (Ej: "Spirit Realm Walker")
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

      // Procesar Episodios limpios sin duplicados
      const seasonEpisodesMap = new Map();

      $se('a[href*="/episode/"]').each((_, epEl) => {
        const epHref = $s(epEl).attr('href') || $se(epEl).attr('href');
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

  const catalog = {
    series: Array.from(seriesMap.values()),
    seasons: Array.from(seasonsMap.values()),
    episodes: Array.from(episodesMap.values()),
    genres: Array.from(genresSet),
    meta: { syncedAt: new Date().toISOString() }
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(catalog, null, 2), 'utf-8');
  console.log('✅ Catálogo sincronizado: Títulos limpios e imágenes de IcoPrueba bloqueadas.');
}

scrapeDonghuaFlix();
