import fs from 'node:fs/promises';
import path from 'node:path';
import * as cheerio from 'cheerio';

const BASE_URL = 'https://donghualife.com';
const OUT_FILE = path.resolve('public/data/catalog.json');

const SEEDS = [
  '/series',
  '/donghuas',
  '/en-emision',
  '/finalizado',
  '/en-pausa',
  '/'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const clean = value =>
  String(value || '').replace(/\s+/g, ' ').trim();

function absolute(href, base = BASE_URL) {
  try {
    if (!href) return null;
    if (/^(javascript:|mailto:|tel:|#)/i.test(href)) return null;

    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function canonical(url) {
  try {
    const u = new URL(url);
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return url;
  }
}

function slugFromUrl(url) {
  try {
    return new URL(url)
      .pathname
      .split('/')
      .filter(Boolean)
      .pop() || '';
  } catch {
    return '';
  }
}

/*
 * Detecta el número REAL del episodio desde su URL.
 *
 * Ejemplos:
 * big-brother-1-x1             -> 1
 * big-brother-1-x10            -> 10
 * big-brother-1-episodio-x10   -> 10
 */
function episodeNumber(url) {
  const value = decodeURIComponent(url || '');

  let match = value.match(/[-_]x(\d+)\/?$/i);

  if (match) {
    return Number(match[1]);
  }

  match = value.match(/episodio[-_ ]*x?(\d+)\/?$/i);

  if (match) {
    return Number(match[1]);
  }

  return null;
}

/*
 * Detecta la temporada desde:
 *
 * /season/big-brother-2
 * /episode/big-brother-2-x1
 * /episode/big-brother-2-episodio-x1
 */
function seasonNumber(url) {
  const value = decodeURIComponent(url || '');

  let match = value.match(
    /\/season\/[^/]*?[-_](\d+)\/?$/i
  );

  if (match) return Number(match[1]);

  match = value.match(
    /[-_](\d+)[-_](?:episodio[-_ ]*)?x\d+\/?$/i
  );

  if (match) return Number(match[1]);

  return null;
}

async function fetchHtml(url, attempts = 3) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language':
            'es-ES,es;q=0.9,en;q=0.8'
        },
        redirect: 'follow'
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return await response.text();

    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        const wait =
          1000 * attempt +
          Math.floor(Math.random() * 1000);

        console.log(
          `   ↻ Reintento ${attempt + 1}/${attempts} en ${wait} ms`
        );

        await sleep(wait);
      }
    }
  }

  throw lastError;
}

function uniqueUrls(values) {
  return [
    ...new Set(
      values
        .filter(Boolean)
        .map(canonical)
    )
  ];
}

/* =========================================================
   SERIES
   ========================================================= */

function parseSeriesLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const result = [];

  $('a[href*="/series/"]').each((_, element) => {
    const href = absolute(
      $(element).attr('href'),
      pageUrl
    );

    if (!href) return;

    const url = canonical(href);

    if (!new URL(url).pathname.startsWith('/series/')) {
      return;
    }

    const slug = slugFromUrl(url);

    if (!slug) return;

    const title =
      clean($(element).attr('title')) ||
      clean($(element).find('img').attr('alt')) ||
      clean($(element).text()) ||
      slug.replace(/-/g, ' ');

    const image =
      absolute(
        $(element).find('img').attr('src'),
        pageUrl
      ) ||
      absolute(
        $(element).find('img').attr('data-src'),
        pageUrl
      ) ||
      '';

    result.push({
      url,
      slug,
      title,
      image
    });
  });

  return result;
}

function textFrom($, selectors) {
  for (const selector of selectors) {
    const element = $(selector).first();

    if (!element.length) continue;

    const text = clean(
      element.attr('content') ||
      element.text()
    );

    if (text) return text;
  }

  return '';
}

function parseSeries(html, seriesUrl, fallback = {}) {
  const $ = cheerio.load(html);

  const title =
    textFrom($, [
      'h1',
      '.page-title',
      '.field--name-title',
      'meta[property="og:title"]'
    ]) ||
    fallback.title ||
    slugFromUrl(seriesUrl).replace(/-/g, ' ');

  const image =
    absolute(
      $('meta[property="og:image"]').attr('content'),
      seriesUrl
    ) ||
    absolute(
      $('img').first().attr('src'),
      seriesUrl
    ) ||
    fallback.image ||
    '';

  const synopsis = textFrom($, [
    '.field--name-body',
    '.field--name-field-sinopsis',
    '.synopsis',
    '.description',
    '.resumen'
  ]);

  const originalTitle = textFrom($, [
    '.field--name-field-titulo-original',
    '.original-title',
    '.titulo-original'
  ]);

  const duration = textFrom($, [
    '.field--name-field-duracion',
    '.duration',
    '.duracion'
  ]);

  const releaseDate = textFrom($, [
    '.field--name-field-fecha',
    '.release-date',
    '.fecha'
  ]);

  const status = textFrom($, [
    '.field--name-field-estado',
    '.status',
    '.estado'
  ]) || fallback.status || '';

  const seasonUrls = uniqueUrls(
    $('a[href*="/season/"]')
      .map((_, element) =>
        absolute(
          $(element).attr('href'),
          seriesUrl
        )
      )
      .get()
  );

  return {
    title: clean(
      title.replace(
        /\s*\|\s*Donghualife.*$/i,
        ''
      )
    ),
    originalTitle,
    duration,
    status,
    releaseDate,
    synopsis,
    image,
    seasonUrls
  };
}

/* =========================================================
   TEMPORADAS
   ========================================================= */

function parseSeason(html, seasonUrl) {
  const $ = cheerio.load(html);

  const episodes = [];

  /*
   * IMPORTANTE:
   * Estos enlaces SOLO sirven para localizar el primer episodio.
   *
   * NO usamos la tabla para descubrir toda la temporada.
   */
  $('a[href*="/episode/"]').each((_, element) => {
    const href = absolute(
      $(element).attr('href'),
      seasonUrl
    );

    if (!href) return;

    const number = episodeNumber(href);

    if (number == null) return;

    episodes.push({
      url: canonical(href),
      number
    });
  });

  episodes.sort(
    (a, b) => a.number - b.number
  );

  const seasonTitle =
    textFrom($, [
      'h1',
      '.page-title',
      '.field--name-title'
    ]) ||
    `Temporada ${seasonNumber(seasonUrl) || 1}`;

  return {
    title: seasonTitle,
    firstEpisode: episodes[0] || null
  };
}

/* =========================================================
   EPISODIOS
   ========================================================= */

function addServer(list, name, url, embed = true) {
  if (!url) return;

  const cleanUrl = canonical(url);

  if (!/^https?:\/\//i.test(cleanUrl)) {
    return;
  }

  if (
    list.some(
      server => server.url === cleanUrl
    )
  ) {
    return;
  }

  list.push({
    name: clean(name || 'Servidor'),
    url: cleanUrl,
    embed
  });
}

function serverName(host) {
  const h = host.toLowerCase();

  if (h.includes('dailymotion')) {
    return 'Dailymotion';
  }

  if (h.includes('ok.ru')) {
    return 'OK.ru';
  }

  if (
    h.includes('streamwish') ||
    h.includes('swdyu')
  ) {
    return 'StreamWish';
  }

  if (h.includes('filemoon')) {
    return 'FileMoon';
  }

  if (h.includes('voe')) {
    return 'VOE';
  }

  if (h.includes('mega')) {
    return 'Mega';
  }

  if (h.includes('mp4upload')) {
    return 'MP4Upload';
  }

  return host;
}

function parseEpisode(html, episodeUrl) {
  const $ = cheerio.load(html);

  const title =
    textFrom($, [
      'h1',
      '.page-title',
      '.field--name-title',
      'meta[property="og:title"]'
    ]) ||
    slugFromUrl(episodeUrl).replace(
      /-/g,
      ' '
    );

  const servers = [];

  /*
   * Buscamos enlaces e iframes reales.
   */
  $('a[href], iframe[src], video source[src], [data-src], [data-video], [data-embed]')
    .each((_, element) => {

      const href =
        $(element).attr('href') ||
        $(element).attr('src') ||
        $(element).attr('data-src') ||
        $(element).attr('data-video') ||
        $(element).attr('data-embed');

      const url = absolute(
        href,
        episodeUrl
      );

      if (!url) return;

      let hostname = '';

      try {
        hostname = new URL(url).hostname;
      } catch {
        return;
      }

      /*
       * Ignoramos enlaces internos de DonghuaLife
       * que no sean servidores de vídeo.
       */
      if (
        hostname.includes('donghualife.com') &&
        !/embed|player/i.test(url)
      ) {
        return;
      }

      const isEmbed =
        element.tagName?.toLowerCase() === 'iframe' ||
        /embed|player|video/i.test(url);

      addServer(
        servers,
        serverName(hostname),
        url,
        isEmbed
      );
    });

  let previousUrl = null;
  let nextUrl = null;
  let seriesUrl = null;

  /*
   * ESTA ES LA PARTE CLAVE.
   *
   * No calculamos x+1 nosotros.
   * Seguimos exactamente el botón "Siguiente"
   * que pone DonghuaLife.
   */
  $('a[href]').each((_, element) => {
    const text = clean(
      $(element).text()
    ).toLowerCase();

    const href = absolute(
      $(element).attr('href'),
      episodeUrl
    );

    if (!href) return;

    if (
      !previousUrl &&
      /^(anterior|previous|prev)\b/i.test(text)
    ) {
      previousUrl = canonical(href);
    }

    if (
      !nextUrl &&
      /^(siguiente|next)\b/i.test(text)
    ) {
      nextUrl = canonical(href);
    }

    if (
      !seriesUrl &&
      /^(serie|series)\b/i.test(text)
    ) {
      seriesUrl = canonical(href);
    }
  });

  /*
   * Fallback por rel=prev / rel=next.
   */
  if (!previousUrl) {
    previousUrl = absolute(
      $('a[rel="prev"]').first().attr('href'),
      episodeUrl
    );
  }

  if (!nextUrl) {
    nextUrl = absolute(
      $('a[rel="next"]').first().attr('href'),
      episodeUrl
    );
  }

  return {
    title: clean(
      title.replace(
        /\s*\|\s*Donghualife.*$/i,
        ''
      )
    ),
    servers,
    previousUrl: previousUrl
      ? canonical(previousUrl)
      : null,
    nextUrl: nextUrl
      ? canonical(nextUrl)
      : null,
    seriesUrl: seriesUrl
      ? canonical(seriesUrl)
      : null
  };
}

/* =========================================================
   CATÁLOGO
   ========================================================= */

function upsert(array, item, key = 'id') {
  const index = array.findIndex(
    x => x[key] === item[key]
  );

  if (index === -1) {
    array.push(item);
  } else {
    array[index] = {
      ...array[index],
      ...item
    };
  }
}

async function loadCatalog() {
  try {
    const raw = await fs.readFile(
      OUT_FILE,
      'utf8'
    );

    const db = JSON.parse(raw);

    return {
      meta: db.meta || {},
      series: Array.isArray(db.series)
        ? db.series
        : [],
      seasons: Array.isArray(db.seasons)
        ? db.seasons
        : [],
      episodes: Array.isArray(db.episodes)
        ? db.episodes
        : [],
      movies: Array.isArray(db.movies)
        ? db.movies
        : [],
      genres: Array.isArray(db.genres)
        ? db.genres
        : []
    };

  } catch {
    return {
      meta: {},
      series: [],
      seasons: [],
      episodes: [],
      movies: [],
      genres: []
    };
  }
}

/* =========================================================
   DESCUBRIR SERIES
   ========================================================= */

async function discoverSeries() {
  const map = new Map();

  for (const seed of SEEDS) {
    const url = canonical(
      absolute(seed)
    );

    try {
      console.log(
        `🔎 Buscando series: ${url}`
      );

      const html =
        await fetchHtml(url);

      const found =
        parseSeriesLinks(
          html,
          url
        );

      for (const item of found) {
        if (!map.has(item.slug)) {
          map.set(
            item.slug,
            item
          );
        }
      }

      console.log(
        `   + ${found.length} enlaces`
      );

      await sleep(
        500 +
        Math.floor(Math.random() * 700)
      );

    } catch (error) {
      console.log(
        `   ⚠️ ${error.message}`
      );
    }
  }

  return [...map.values()];
}

/* =========================================================
   RECORRER EPISODIOS CON "SIGUIENTE"
   ========================================================= */

async function crawlEpisodes(
  firstEpisodeUrl,
  seasonUrl,
  seriesId,
  seasonId,
  episodes
) {
  const visited = new Set();

  let current =
    canonical(firstEpisodeUrl);

  let lastNumber = 0;
  let count = 0;

  while (
    current &&
    !visited.has(current)
  ) {

    visited.add(current);

    /*
     * Esto NO es un límite de episodios.
     * Es solamente protección contra un bucle infinito
     * accidental del sitio.
     */
    if (count >= 100000) {
      console.log(
        '      ⚠️ Posible bucle. Se detiene.'
      );
      break;
    }

    /*
     * Evitar que una temporada entre en la siguiente.
     */
    const seasonOfCurrent =
      seasonNumber(current);

    const currentSeason =
      seasonNumber(seasonUrl);

    if (
      seasonOfCurrent !== null &&
      currentSeason !== null &&
      seasonOfCurrent !== currentSeason
    ) {
      console.log(
        '      ✓ Fin de temporada.'
      );
      break;
    }

    const number =
      episodeNumber(current);

    if (number === null) {
      console.log(
        `      ⚠️ No se pudo obtener número: ${current}`
      );
      break;
    }

    /*
     * Si la navegación vuelve atrás o entra
     * en un episodio menor, paramos.
     */
    if (
      lastNumber > 0 &&
      number <= lastNumber
    ) {
      console.log(
        `      ⚠️ Navegación incorrecta: ${lastNumber} → ${number}`
      );
      break;
    }

    try {
      console.log(
        `      📄 Analizando Ep. ${number}`
      );

      const html =
        await fetchHtml(current);

      const data =
        parseEpisode(
          html,
          current
        );

      const id =
        `${seriesId}-${seasonId}-x${number}`;

      const oldEpisode =
        episodes.find(
          e => e.id === id
        );

      const episode = {
        id,
        slug: id,
        title:
          data.title ||
          `Episodio ${number}`,
        sourceUrl: current,
        servers: data.servers,
        previousUrl:
          data.previousUrl,
        nextUrl:
          data.nextUrl,
        updatedAt:
          new Date().toISOString(),
        seriesId,
        seasonId,
        number
      };

      /*
       * Conservamos datos antiguos útiles.
       */
      if (
        oldEpisode?.releaseDate
      ) {
        episode.releaseDate =
          oldEpisode.releaseDate;
      }

      upsert(
        episodes,
        episode
      );

      console.log(
        `         ✓ Ep. ${number}` +
        (
          data.servers.length
            ? ` — ${data.servers.length} servidor(es)`
            : ' — ⚠️ SIN SERVIDOR'
        )
      );

      count++;
      lastNumber = number;

      const next =
        data.nextUrl
          ? canonical(data.nextUrl)
          : null;

      if (!next) {
        console.log(
          `      🏁 Último episodio: ${number}`
        );
        break;
      }

      if (visited.has(next)) {
        console.log(
          '      ⚠️ El siguiente ya fue visitado.'
        );
        break;
      }

      /*
       * Comprobamos que "Siguiente" no
       * nos haya mandado a otra temporada.
       */
      const nextSeason =
        seasonNumber(next);

      if (
        currentSeason !== null &&
        nextSeason !== null &&
        nextSeason !== currentSeason
      ) {
        console.log(
          `      🏁 Temporada ${currentSeason} termina en Ep. ${number}`
        );
        break;
      }

      current = next;

      await sleep(
        500 +
        Math.floor(Math.random() * 700)
      );

    } catch (error) {
      console.log(
        `      ❌ Error Ep. ${number}: ${error.message}`
      );
      break;
    }
  }

  return count;
}

/* =========================================================
   MAIN
   ========================================================= */

async function main() {

  console.log(
    '🚀 Iniciando sincronización del catálogo...'
  );

  console.log(
    '🧭 Modo: navegación por "Siguiente".'
  );

  console.log(
    '🚫 No se usa límite de 50 episodios.'
  );

  console.log(
    '🚫 No se usa la paginación de la tabla como fuente de episodios.'
  );

  const old =
    await loadCatalog();

  console.log(
    `📦 Catálogo anterior: ` +
    `${old.series.length} series, ` +
    `${old.episodes.length} episodios`
  );

  const db = {
    meta: old.meta,
    series: [],
    seasons: [],
    episodes: [...old.episodes],
    movies: old.movies,
    genres: old.genres
  };

  const discovered =
    await discoverSeries();

  if (!discovered.length) {
    throw new Error(
      'No se encontraron series.'
    );
  }

  console.log(
    `\n📚 Series descubiertas: ${discovered.length}\n`
  );

  for (
    let i = 0;
    i < discovered.length;
    i++
  ) {

    const item =
      discovered[i];

    console.log(
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'
    );

    console.log(
      `📺 ${i + 1}/${discovered.length} — ${item.title}`
    );

    try {

      const html =
        await fetchHtml(item.url);

      const detail =
        parseSeries(
          html,
          item.url,
          item
        );

      const seriesId =
        item.slug;

      const previous =
        old.series.find(
          s => s.id === seriesId
        );

      const series = {
        id: seriesId,
        slug: seriesId,
        title:
          detail.title ||
          previous?.title ||
          item.title,
        originalTitle:
          detail.originalTitle ||
          previous?.originalTitle ||
          '',
        duration:
          detail.duration ||
          previous?.duration ||
          '',
        status:
          detail.status ||
          previous?.status ||
          '',
        releaseDate:
          detail.releaseDate ||
          previous?.releaseDate ||
          '',
        synopsis:
          detail.synopsis ||
          previous?.synopsis ||
          '',
        image:
          detail.image ||
          previous?.image ||
          item.image ||
          '',
        sourceUrl:
          canonical(item.url),
        genres:
          detail.genres.length
            ? detail.genres
            : (previous?.genres || []),
        seasonUrls:
          detail.seasonUrls,
        updatedAt:
          new Date().toISOString()
      };

      upsert(
        db.series,
        series
      );

      console.log(
        `   Temporadas encontradas: ${detail.seasonUrls.length}`
      );

      for (
        let s = 0;
        s < detail.seasonUrls.length;
        s++
      ) {

        const seasonUrl =
          canonical(
            detail.seasonUrls[s]
          );

        const number =
          seasonNumber(seasonUrl) ||
          (s + 1);

        const seasonId =
          `${seriesId}-${number}`;

        console.log(
          `   📂 Temporada ${number}/${detail.seasonUrls.length}`
        );

        try {

          const seasonHtml =
            await fetchHtml(
              seasonUrl
            );

          const seasonData =
            parseSeason(
              seasonHtml,
              seasonUrl
            );

          const season = {
            id: seasonId,
            seriesId,
            number,
            title:
              seasonData.title ||
              `Temporada ${number}`,
            sourceUrl:
              seasonUrl,
            updatedAt:
              new Date().toISOString()
          };

          upsert(
            db.seasons,
            season
          );

          if (
            !seasonData.firstEpisode
          ) {
            console.log(
              '      ⚠️ No se encontró el primer episodio.'
            );
            continue;
          }

          console.log(
            `      🎬 Primer episodio: Ep. ${seasonData.firstEpisode.number}`
          );

          /*
           * AQUÍ ESTÁ EL CAMBIO PRINCIPAL.
           *
           * Desde el primer episodio:
           *
           * x1 → Siguiente → x2
           * x2 → Siguiente → x3
           * x3 → Siguiente → x4
           * ...
           */
          await crawlEpisodes(
            seasonData.firstEpisode.url,
            seasonUrl,
            seriesId,
            seasonId,
            db.episodes
          );

          await sleep(
            700 +
            Math.floor(Math.random() * 800)
          );

        } catch (error) {

          console.log(
            `      ❌ Error temporada: ${error.message}`
          );
        }
      }

    } catch (error) {

      console.log(
        `   ❌ Error serie: ${error.message}`
      );
    }

    await sleep(
      800 +
      Math.floor(Math.random() * 1000)
    );
  }

  /* =======================================================
     ORDENAR
     ======================================================= */

  db.series.sort(
    (a, b) =>
      clean(a.title).localeCompare(
        clean(b.title),
        'es'
      )
  );

  db.seasons.sort(
    (a, b) =>
      String(a.seriesId).localeCompare(
        String(b.seriesId)
      ) ||
      Number(a.number || 0) -
      Number(b.number || 0)
  );

  db.episodes.sort(
    (a, b) =>
      String(a.seriesId).localeCompare(
        String(b.seriesId)
      ) ||
      String(a.seasonId).localeCompare(
        String(b.seasonId)
      ) ||
      Number(a.number || 0) -
      Number(b.number || 0)
  );

  /* =======================================================
     GÉNEROS
     ======================================================= */

  const genres =
    new Set(db.genres || []);

  for (const series of db.series) {
    for (const genre of series.genres || []) {

      const value =
        clean(genre);

      if (value) {
        genres.add(value);
      }
    }
  }

  db.genres =
    [...genres].sort(
      (a, b) =>
        a.localeCompare(b, 'es')
    );

  /* =======================================================
     META
     ======================================================= */

  const finishedAt =
    new Date().toISOString();

  db.meta = {
    ...(old.meta || {}),
    version: 2,
    source: `${BASE_URL}/`,
    syncedAt: finishedAt,
    lastSync: {
      status: 'success',
      startedAt:
        old.meta?.lastSync?.startedAt ||
        null,
      finishedAt,
      error: null
    }
  };

  /* =======================================================
     GUARDAR
     ======================================================= */

  await fs.mkdir(
    path.dirname(OUT_FILE),
    { recursive: true }
  );

  const tempFile =
    `${OUT_FILE}.tmp`;

  await fs.writeFile(
    tempFile,
    JSON.stringify(
      db,
      null,
      2
    ),
    'utf8'
  );

  await fs.rename(
    tempFile,
    OUT_FILE
  );

  console.log(
    '\n════════════════════════════════════════'
  );

  console.log(
    '✅ SINCRONIZACIÓN TERMINADA'
  );

  console.log(
    `📺 Series:     ${db.series.length}`
  );

  console.log(
    `📂 Temporadas: ${db.seasons.length}`
  );

  console.log(
    `🎬 Episodios:  ${db.episodes.length}`
  );

  console.log(
    `🎞️ Películas:  ${db.movies.length}`
  );

  console.log(
    `🏷️ Géneros:    ${db.genres.length}`
  );

  console.log(
    `💾 Archivo:    ${OUT_FILE}`
  );

  console.log(
    '════════════════════════════════════════'
  );
}

main().catch(error => {

  console.error(
    '\n❌ ERROR FATAL:',
    error
  );

  process.exit(1);
});
