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
    console.error(`[ERR] Error al obtener ${url}:`, err.message);
    return null;
  }
}

function absoluteUrl(relative, base = BASE_URL) {
  if (!relative) return '';
  if (relative.startsWith('http')) return relative;
  return new URL(relative, base).href;
}

function cleanImageUrl(src) {
  if (!src) return '';
  let full = absoluteUrl(src);
  return full.split('?')[0];
}

async function scrapeDonghuaFlix() {
  console.log('🚀 Sincronizando catálogo completo de DonghuaFlix...');

  const seriesMap = new Map();
  const seasonsMap = new Map();
  const episodesMap = new Map();
  const genresSet = new Set();

  const mainHtml = await fetchHTML(`${BASE_URL}/series`);
  if (!mainHtml) {
    console.error('❌ No se pudo obtener la lista de series.');
    return;
  }

  const $main = cheerio.load(mainHtml);
  const seriesLinks = [];

  $main('a[href*="/series/"]').each((_, el) => {
    const href = $main(el).attr('href');
    if (href && href !== '/series' && !seriesLinks.includes(href)) {
      seriesLinks.push(href);
    }
  });

  console.log(`📌 Se procesarán ${seriesLinks.length} series...`);

  for (const sLink of seriesLinks) {
    const sUrl = absoluteUrl(sLink);
    const sHtml = await fetchHTML(sUrl);
    if (!sHtml) continue;

    const $s = cheerio.load(sHtml);
    const seriesSlug = sLink.split('/').filter(Boolean).pop();

    const rawTitle = $s('h1').first().text().trim();
    const title = (!rawTitle || rawTitle.toLowerCase() === 'temporadas') ? seriesSlug : rawTitle;
    
    let poster = cleanImageUrl($s('.poster img, img[src*="/sites/default/files/"]').first().attr('src'));
    const synopsis = $s('p, div[class*="synopsis"]').text().trim();
    const status = sHtml.includes('EN EMISIÓN') ? 'En emisión' : 'Finalizado';

    const genres = [];
    $s('a[href*="/genre/"]').each((_, g) => {
      const gText = $s(g).text().trim();
      if (gText) {
        genres.push(gText);
        genresSet.add(gText);
      }
    });

    seriesMap.set(seriesSlug, {
      id: seriesSlug,
      slug: seriesSlug,
      title: title,
      image: poster,
      synopsis: synopsis,
      status: status,
      genres: [...new Set(genres)],
      updatedAt: new Date().toISOString()
    });

    const seasonLinks = [];
    $s('a[href*="/season/"]').each((_, el) => {
      const href = $s(el).attr('href');
      if (href && !seasonLinks.includes(href)) seasonLinks.push(href);
    });

    if (seasonLinks.length === 0) {
      seasonLinks.push(`/season/${seriesSlug}-1`);
    }

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
          const seasonTitle = $se('h1').first().text().trim() || seasonSlug;
          const seasonPoster = cleanImageUrl($se('.poster img, img[src*="/sites/default/files/"]').first().attr('src')) || poster;

          seasonsMap.set(seasonSlug, {
            id: seasonSlug,
            seriesId: seriesSlug,
            title: seasonTitle,
            image: seasonPoster
          });
        }

        const epRows = $se('a[href*="/episode/"]');
        let foundEpsInPage = 0;

        epRows.each((_, epEl) => {
          const epHref = $se(epEl).attr('href');
          if (!epHref) return;

          const epSlug = epHref.split('/').filter(Boolean).pop();
          const epTitle = $se(epEl).text().trim() || epSlug;
          const epNumMatch = epTitle.match(/\d+/);
          const epNumber = epNumMatch ? parseInt(epNumMatch[0], 10) : 1;

          if (!episodesMap.has(epSlug)) {
            episodesMap.set(epSlug, {
              id: epSlug,
              slug: epSlug,
              seasonId: seasonSlug,
              seriesId: seriesSlug,
              title: epTitle,
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
        if (hasNextBtn && foundEpsInPage > 0) {
          page++;
        } else {
          hasMorePages = false;
        }
      }
    }
  }

  const catalog = {
    series: Array.from(seriesMap.values()),
    seasons: Array.from(seasonsMap.values()),
    episodes: Array.from(episodesMap.values()),
    movies: [],
    genres: Array.from(genresSet),
    meta: {
      syncedAt: new Date().toISOString()
    }
  };

  await fs.mkdir(path.dirname(OUT_FILE), { recursive: true });
  await fs.writeFile(OUT_FILE, JSON.stringify(catalog, null, 2), 'utf-8');

  console.log(`✅ ¡Proceso finalizado con éxito! Total de series: ${catalog.series.length} | Episodios: ${catalog.episodes.length}`);
}

scrapeDonghuaFlix();
