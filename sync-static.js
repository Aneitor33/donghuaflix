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
  console.log('🚀 Iniciando diagnóstico desde GitHub Actions...');

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

  console.log(`🔍 Total de series encontradas en la lista: ${seriesSlugs.size}`);

  let count = 0;
  for (const seriesSlug of seriesSlugs) {
    const sUrl = `${BASE_URL}/series/${seriesSlug}`;
    const sHtml = await fetchHTML(sUrl);
    if (!sHtml) continue;

    const $s = cheerio.load(sHtml);

    // DIAGNÓSTICO: Vamos a ver qué títulos detecta la web antes de forzarlos
    const webTitle = $s('h1, .page-title, title').first().text().trim();
    const ogImage = $s('meta[property="og:image"]').attr('content') || 'No tiene og:image';

    if (count < 3) {
      console.log(`--- SERIE DE PRUEBA [${seriesSlug}] ---`);
      console.log(`> Título detectado en HTML: "${webTitle}"`);
      console.log(`> Imagen og:image detectada: "${ogImage}"`);
      count++;
    }

    const title = formatTitle(seriesSlug);
    let poster = '';
    if (ogImage && !ogImage.includes('IcoPrueba.png') && !ogImage.includes('No tiene')) {
      poster = ogImage;
    }
    poster = poster ? absoluteUrl(poster).split('?')[0] : 'https://donghualife.com/sites/default/files/styles/medium/public/default_images/default.jpg';

    const synopsis = $s('.field--name-field-synopsis, .synopsis, article p').first().text().trim() || 'Sin sinopsis.';
    const status = sHtml.includes('EN EMISIÓN') ? 'En emisión' : 'Finalizado';

    seriesMap.set(seriesSlug, {
      id: seriesSlug,
      slug: seriesSlug,
      title: title,
      image: poster,
      synopsis: synopsis,
      status: status,
      updatedAt: new Date().toISOString()
    });

    // Guardamos solo un par de temporadas/episodios para que el log no sature
    const seasonLink = `/season/${seriesSlug}-1`;
    seasonsMap.set(`${seriesSlug}-1`, {
      id: `${seriesSlug}-1`,
      seriesId: seriesSlug,
      title: 'Temporada 1',
      image: poster
    });

    episodesMap.set(`${seriesSlug}-1-1`, {
      id: `${seriesSlug}-1-1`,
      slug: `${seriesSlug}-1-1`,
      seasonId: `${seriesSlug}-1`,
      seriesId: seriesSlug,
      title: 'Episodio 1',
      number: 1,
      servers: [{ name: 'Rumble', url: `${BASE_URL}/embed/${seriesSlug}-1-1` }]
    });
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
  console.log('✅ Archivo de diagnóstico generado correctamente.');
}

scrapeDonghuaFlix();
