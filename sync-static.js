import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.join(process.cwd(), 'public', 'data', 'catalog.json');

// Usamos un proxy público para evitar que Cloudflare bloquee la IP de GitHub Actions
async function fetchHTML(url) {
  try {
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    const res = await fetch(proxyUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) {
      console.log(`⚠️ Error HTTP ${res.status} en URL: ${url}`);
      return null;
    }
    return await res.text();
  } catch (err) {
    console.log(`⚠️ Error de red:`, err.message);
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
  console.log('🚀 Iniciando sincronización mediante Proxy...');

  const seriesMap = new Map();
  const seasonsMap = new Map();
  const episodesMap = new Map();
  const genresSet = new Set();

  const mainHtml = await fetchHTML(`${BASE_URL}/series`);
  if (!mainHtml) {
    console.error('❌ El proxy no pudo conectar a la web principal.');
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

  console.log(`🔍 Series encontradas: ${seriesSlugs.size}`);

  for (const seriesSlug of seriesSlugs) {
    const sUrl = `${BASE_URL}/series/${seriesSlug}`;
    const sHtml = await fetchHTML(sUrl);
    if (!sHtml) continue;

    const $s = cheerio.load(sHtml);

    // Título limpio garantizado por el slug de la URL
    const title = formatTitle(seriesSlug);

    // Imagen limpia sin la basura de IcoPrueba
    let poster = '';
    const ogImage = $s('meta[property="og:image"]').attr('content');
    if (ogImage && !ogImage.includes('IcoPrueba.png')) {
      poster = ogImage;
    }

    if (!poster) {
      $s('img').each((_, img) => {
        const src = $s(img).attr('src');
        if (src && !src.includes('IcoPrueba.png') && !src.includes('logo') && !poster) {
          poster = src;
        }
      });
    }

    poster = poster ? absoluteUrl(poster).split('?')[0] : 'https://donghualife.com/sites/default/files/styles/medium/public/default_images/default.jpg';

    const synopsis = $s('.field--name-field-synopsis, .synopsis, article p').first().text().trim() || 'Sin sinopsis disponible.';
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

    // Temporadas y Episodios
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
  console.log('✅ Catálogo sincronizado exitosamente mediante Proxy.');
}

scrapeDonghuaFlix();
