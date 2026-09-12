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
  } catch (err) {
    return null;
  }
}

function absoluteUrl(relative, base = BASE_URL) {
  if (!relative) return '';
  if (relative.startsWith('http')) return relative;
  return new URL(relative, base).href;
}

function extractCleanPoster($) {
  let posterSrc = '';
  // Buscar imágenes excluyendo portadas genéricas/default o logos
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src && !src.includes('default_images') && !src.includes('logo') && (src.includes('/poster/') || src.includes('/public/'))) {
      if (!posterSrc) posterSrc = src;
    }
  });
  
  if (!posterSrc) {
    posterSrc = $('.poster img, .field--name-field-poster img').first().attr('src') || '';
  }
  
  return posterSrc ? absoluteUrl(posterSrc).split('?')[0] : '';
}

async function scrapeDonghuaFlix() {
  console.log('🚀 Iniciando sincronización limpia...');

  const seriesMap = new Map();
  const seasonsMap = new Map();
  const episodesMap = new Map();
  const genresSet = new Set();

  const mainHtml = await fetchHTML(`${BASE_URL}/series`);
  if (!mainHtml) return;

  const $main = cheerio.load(mainHtml);
  const seriesLinks = [];

  $main('a[href*="/series/"]').each((_, el) => {
    const href = $main(el).attr('href');
    if (href && href !== '/series' && !seriesLinks.includes(href)) {
      seriesLinks.push(href);
    }
  });

  for (const sLink of seriesLinks) {
    const sUrl = absoluteUrl(sLink);
    const sHtml = await fetchHTML(sUrl);
    if (!sHtml) continue;

    const $s = cheerio.load(sHtml);
    const seriesSlug = sLink.split('/').filter(Boolean).pop();

    const rawTitle = $s('h1').first().text().trim();
    const title = (!rawTitle || rawTitle.toLowerCase() === 'temporadas') ? seriesSlug.replace(/-/g, ' ').toUpperCase() : rawTitle;
    
    const poster = extractCleanPoster($s);
    const synopsis = $s('p, div[class*="synopsis"]').text().trim();
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
    const seasonLinks = [];
    $s('a[href*="/season/"]').each((_, el) => {
      const href = $s(el).attr('href');
      if (href && !seasonLinks.includes(href)) seasonLinks.push(href);
    });

    if (seasonLinks.length === 0) seasonLinks.push(`/season/${seriesSlug}-1`);

    for (const seasonLink of seasonLinks) {
      const seasonSlug = seasonLink.split('/').filter(Boolean).pop();
      let seasonUrl = absoluteUrl(seasonLink);
      let page = 1;
      let hasMorePages = true;

      while (hasMorePages) {
        const pageUrl = page === 1 ? seasonUrl : `${seasonUrl}?page=${page}`;
        const seasonHtml = await fetchHTML(pageUrl);
        if (!seasonHtml) break;

        const $se = cheerio.load(seasonHtml);

        if (page === 1) {
          const seasonPoster = extractCleanPoster($se) || poster;
          const sTitleMatch = seasonSlug.match(/\d+$/);
          const seasonNum = sTitleMatch ? sTitleMatch[0] : '1';

          seasonsMap.set(seasonSlug, {
            id: seasonSlug,
            seriesId: seriesSlug,
            title: `Temporada ${seasonNum}`,
            image: seasonPoster
          });
        }

        const epRows = $se('a[href*="/episode/"]');
        let foundEpsInPage = 0;

        epRows.each((_, epEl) => {
          const epHref = $se(epEl).attr('href');
          if (!epHref) return;

          const epSlug = epHref.split('/').filter(Boolean).pop();
          const rawEpText = $se(epEl).text().trim();
          
          // Extraer número de episodio limpio (ej: x3 -> 3, Episodio 5 -> 5)
          const epNumMatch = rawEpText.match(/(?:x|episodio\s*|ep\s*)(\d+)/i) || epSlug.match(/\d+/);
          const epNumber = epNumMatch ? parseInt(epNumMatch[1] || epNumMatch[0], 10) : 1;

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
            foundEpsInPage++;
          }
        });

        const hasNextBtn = $se('a:contains("SIGUIENTE"), a:contains(">"), .pagination a[rel="next"]').length > 0;
        if (hasNextBtn && foundEpsInPage > 0) page++;
        else hasMorePages = false;
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
  console.log('✅ Catálogo reestructurado y limpio guardado.');
}

scrapeDonghuaFlix();
