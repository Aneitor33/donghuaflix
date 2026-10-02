#!/usr/bin/env node
/**
 * DonghuaFlix — Scraper "YOUTUBE FILMS"
 * ---------------------------------------------------------------
 * Lee la pestaña "Videos subidos" de los canales autorizados de
 * YouTube, filtra por duración (>= MIN_DURATION_SECONDS, default
 * 3600s), limpia títulos, clasifica tipo (animation/live_action),
 * asigna géneros y genera un catálogo de PELÍCULAS compatible con
 * el frontend de DonghuaFlix:
 *
 *   public/data/catalog-youtubefilms.json                -> catálogo completo (fallback)
 *   public/data/catalog-youtubefilms-index.json          -> índice ligero compacto (lo lee el frontend)
 *   public/data/catalog-youtubefilms-details/<slug>.json -> ficha por película {series, seasons, episodes}
 *
 * Cada película se modela como: series(contentType 'movie')
 * + 1 temporada 'Película' + 1 episodio 'Ver película' cuyo
 * servidor apunta al embed de YouTube. El frontend la renderiza
 * como PELÍCULA (sin lista de capítulos).
 *
 * Requiere env: YOUTUBE_API_KEY (YouTube Data API v3)
 * Uso: node tools/sync-youtubefilms.js
 */
import fs from 'node:fs';
import path from 'node:path';

/* ============================== CONFIG ============================== */

const API_KEY = process.env.YOUTUBE_API_KEY;
if (!API_KEY) {
  console.error('[yt-films] ERROR: falta la variable de entorno YOUTUBE_API_KEY');
  process.exit(1);
}

const MIN_DURATION_SECONDS = parseInt(process.env.MIN_DURATION_SECONDS || '3600', 10);
const MAX_VIDEOS_PER_CHANNEL = parseInt(process.env.MAX_VIDEOS_PER_CHANNEL || '100', 10);
const API_BASE = 'https://www.googleapis.com/youtube/v3';

// Canales autorizados y su categoría base
const CHANNELS = [
  { handle: '@animaciondesinchew', base: 'animation' },
  { handle: '@anime_multiverso',   base: 'animation' },
  { handle: '@kb025-p4s',          base: 'animation' },
  { handle: '@moxispanish',        base: 'live_action' },
  { handle: '@cine-esp',           base: 'live_action' },
  { handle: '@freshesp',           base: 'live_action' },
];

const GENRE_LIST = [
  'Fantasía/Cultivación', 'Artes Marciales', 'Acción',
  'Comedia', 'Histórico', 'Romance', 'Drama',
];

const GENRE_KEYWORDS = {
  'Fantasía/Cultivación': ['secta', 'inmortal', 'qi', 'dantian', 'cultivacion', 'cultivo', 'dios', 'magia', 'magico', 'hechicero', 'dragon', 'espiritu', 'reino celestial', 'ascension', 'inmortalidad'],
  'Artes Marciales':      ['kung fu', 'kungfu', 'espada', 'shaolin', 'maestro', 'combate', 'artes marciales', 'marcial', 'wuxia', 'samurai', 'katana'],
  'Acción':               ['accion', 'guerra', 'batalla', 'pelea', 'lucha', 'ejercito', 'asesino', 'venganza', 'mision', 'infiltrado', 'operacion'],
  'Comedia':              ['comedia', 'comico', 'humor', 'risa', 'parodia'],
  'Histórico':            ['dinastia', 'emperador', 'reino', 'palacio', 'imperio', 'general', 'antiguo', 'historia', 'medieval', 'feudal'],
  'Romance':              ['romance', 'amor', 'amores', 'matrimonio', 'esposa', 'esposo', 'corazon', 'amante'],
  'Drama':                ['drama', 'tragedia', 'sacrificio', 'destino', 'secreto', 'familia', 'honor', 'traicion'],
};

// Términos que reasignan un canal live_action -> animation
const ANIMATION_HINTS = /\b(donghua|dong hua|anime|animation|animacion|animación|3d|cgi|render)\b/i;

/* ============================ API HELPERS =========================== */

async function ytGet(endpoint, params) {
  const url = new URL(`${API_BASE}/${endpoint}`);
  url.searchParams.set('key', API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`YouTube API ${endpoint} -> ${res.status}: ${body}`);
  }
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ========================= DURATION (ISO 8601) ====================== */

function isoDurationToSeconds(iso) {
  const m = /PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/.exec(iso || '');
  if (!m) return 0;
  return (parseInt(m[1] || 0, 10) * 3600) + (parseInt(m[2] || 0, 10) * 60) + parseInt(m[3] || 0, 10);
}

/* =========================== TITLE CLEANING ========================= */

function cleanTitle(raw) {
  let t = ` ${raw} `;
  // 1) Bloques entre corchetes / paréntesis que sean etiquetas de marketing
  t = t.replace(/[\[\(][^\]\)]{0,60}[\]\)]/g, (blk) => {
    const b = blk.toLowerCase();
    const isLabel =
      /sub|esp|lat|hd|4k|8k|1080|720|pelicula|movie|completa|full|estreno|nuevo|mejor|gran|accion|acción|new|official|trailer|temporada|cap[ií]tulo|episodio|\d{4}/.test(b);
    return isLabel ? ' ' : blk;
  });
  // 2) Frases de gancho sueltas
  t = t.replace(/\b(PEL[IÍ]CULA COMPLETA|FULL MOVIE|COMPLETA EN ESPA[NÑ]OL|SUB ESPA[NÑ]OL|SUBTITULADA|DOBLADA|NUEVO ESTRENO|GRAN ESTRENO|MEJOR PEL[IÍ]CULA( DE)?|ACC[IÓO]N\s*\d{4}|ESTRENO\s*\d{4}|\b\d{4}\b)\b/gi, ' ');
  // 3) Calidad / resoluciones sueltas
  t = t.replace(/\b(4K|HD|FULL HD|1080P?|720P?|8K|UHD)\b/gi, ' ');
  // 4) Separadores tipo " | "
  t = t.replace(/\s*[|]\s*/g, ' ');
  // 5) Normalizar espacios y puntuación residual
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([:;,.!?])/g, '$1').trim();
  t = t.replace(/^[-–—:.\s]+|[-–—:.\s]+$/g, '');
  const out = t.trim();
  return out.length >= 3 ? out : raw.trim();
}

/* ========================== GENRE ASSIGNMENT ======================== */

function stripAccents(s) {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function assignGenres(text) {
  const hay = ` ${stripAccents(text.toLowerCase())} `;
  const scored = [];
  for (const [genre, kws] of Object.entries(GENRE_KEYWORDS)) {
    let score = 0;
    for (const kw of kws) {
      const needle = ` ${stripAccents(kw)} `;
      if (hay.includes(needle)) score += kw.includes(' ') ? 3 : 2;
    }
    if (score > 0) scored.push({ genre, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 3).map((s) => s.genre);
  return picked.length ? picked : ['Acción'];
}

/* ============================ SLUG / AÑO ============================ */

function slugify(str) {
  return stripAccents(String(str).toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'sin-titulo';
}

/* ==================== MODELO: PELÍCULA (no serie) =================== */

function buildMovie(video, channel) {
  const { id, snippet, contentDetails } = video;
  const originalTitle = (snippet.title || '').trim();
  const title = cleanTitle(originalTitle);
  const fullText = `${originalTitle}\n${snippet.description || ''}`;
  const publishedAt = snippet.publishedAt || new Date().toISOString();
  const year = parseInt((publishedAt || '').slice(0, 4), 10) || null;

  const type = (channel.base === 'live_action' && ANIMATION_HINTS.test(fullText))
    ? 'animation'
    : channel.base;

  const genres = assignGenres(fullText);

  let synopsis = (snippet.description || '').replace(/\s+/g, ' ').trim();
  if (synopsis.length > 197) synopsis = synopsis.slice(0, 197).trimEnd() + '...';

  const baseSlug = slugify(title);
  const durationSec = isoDurationToSeconds(contentDetails?.duration);
  const videoUrl = `https://www.youtube.com/watch?v=${id}`;
  const embedUrl = `https://www.youtube-nocookie.com/embed/${id}`;
  const thumb = `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`;

  // Ficha "series" del frontend (contentType movie => se muestra como PELÍCULA)
  const series = {
    id: baseSlug,
    slug: baseSlug,
    title,
    image: thumb,
    status: 'Finalizada',
    type: 'movie',          // <- película, no serie/episodios
    contentType: 'movie',
    synopsis,
    year,
    updatedAt: publishedAt,
    sourceUrl: videoUrl,
    channel: channel.handle,
    originalTitle,
    duration: durationSec,
    genres,
    source: 'youtube_yt',
  };

  // Una única "temporada/episodio" apuntando al embed (película completa)
  const seasons = [{
    id: `${baseSlug}-s1`,
    seriesId: baseSlug,
    number: 1,
    title: 'Película',
  }];
  const episodes = [{
    id: `${baseSlug}-ep-1`,
    slug: `${baseSlug}-ep-1`,
    seriesId: baseSlug,
    seasonId: `${baseSlug}-s1`,
    number: 1,
    title: 'Ver película',
    servers: [{ name: 'YouTube', url: embedUrl }],
    updatedAt: publishedAt,
  }];

  return { series, seasons, episodes };
}

/* ===================== VIDEOS SUBIDOS DEL CANAL ===================== */

async function resolveChannelId(handle) {
  const h = handle.replace(/^@/, '');
  // Paso 1: resolver el canal por handle
  const data = await ytGet('channels', { part: 'snippet', forHandle: h, maxResults: 1 });
  const ch = data.items && data.items[0];
  if (!ch) throw new Error(`Canal no encontrado: ${handle}`);
  // Paso 2: pedir contentDetails por ID (garantizado; forHandle a veces lo omite)
  const det = await ytGet('channels', { part: 'contentDetails', id: ch.id });
  const uploadsId = det.items && det.items[0] && det.items[0].contentDetails
    && det.items[0].contentDetails.relatedPlaylists
    && det.items[0].contentDetails.relatedPlaylists.uploads;
  if (!uploadsId) throw new Error(`Sin playlist de uploads para ${handle} (id ${ch.id})`);
  return { id: ch.id, title: ch.snippet.title, uploadsId };
}

// Pestaña "Videos" del canal: la playlist de uploads ES la pestaña Videos
// (mismo contenido y orden que search.list channelId+order=date, pero cuesta
// 1 unidad por página en vez de 100). Ver https://developers.google.com/youtube/v3/docs/channels
async function listUploadedVideoIds(uploadsId, maxItems) {
  const ids = [];
  let pageToken = '';
  do {
    const data = await ytGet('playlistItems', {
      part: 'snippet,contentDetails',  // snippet da resourceId.videoId, contentDetails da videoId
      playlistId: uploadsId,
      maxResults: 50,
      pageToken,
    });
    const items = data.items || [];
    console.log(`[yt-films]   playlist ${uploadsId}: ${items.length} items en página`);
    for (const it of items) {
      const vid = (it.contentDetails && it.contentDetails.videoId)
        || (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId);
      if (vid) ids.push(vid);
    }
    pageToken = data.nextPageToken || '';
    if (ids.length >= maxItems) break;
  } while (pageToken);
  return ids.slice(0, maxItems);
}

async function fetchVideos(videoIds) {
  const videos = [];
  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50);
    const data = await ytGet('videos', {
      part: 'snippet,contentDetails',
      id: chunk.join(','),
    });
    videos.push(...(data.items || []));
    await sleep(150);
  }
  return videos;
}

/* ============================== MAIN ================================= */

async function main() {
  const startedAt = new Date();
  const allMovies = [];   // {series, seasons, episodes}
  const seenSlugs = new Set();
  const stats = { scanned: 0, kept: 0, ignoredDuration: 0, errors: [] };

  for (const ch of CHANNELS) {
    try {
      console.log(`[yt-films] Procesando ${ch.handle} (pestaña Videos)...`);
      const { title: channelTitle, uploadsId } = await resolveChannelId(ch.handle);
      const ids = await listUploadedVideoIds(uploadsId, MAX_VIDEOS_PER_CHANNEL);
      const videos = await fetchVideos(ids);
      stats.scanned += videos.length;
      console.log(`[yt-films]   ${channelTitle}: ${videos.length} videos revisados`);

      for (const v of videos) {
        const dur = isoDurationToSeconds(v.contentDetails?.duration);
        if (dur < MIN_DURATION_SECONDS) { stats.ignoredDuration++; continue; }

        const movie = buildMovie(v, ch);

        // Slug único entre canales
        let slug = movie.series.slug;
        if (seenSlugs.has(slug)) {
          const suffix = ch.handle.replace(/^@/, '').replace(/[^a-z0-9]/gi, '');
          slug = `${slug}-${suffix}`;
          movie.series.id = movie.series.slug = slug;
          movie.seasons = movie.seasons.map((s) => ({ ...s, seriesId: slug, id: `${slug}-s1` }));
          movie.episodes = movie.episodes.map((e) => ({ ...e, seriesId: slug, seasonId: `${slug}-s1`, id: `${slug}-ep-1`, slug: `${slug}-ep-1` }));
        }
        seenSlugs.add(slug);

        allMovies.push(movie);
        stats.kept++;
      }
    } catch (err) {
      console.error(`[yt-films] ERROR en ${ch.handle}: ${err.message}`);
      stats.errors.push({ channel: ch.handle, error: err.message });
    }
  }

  // Diagnóstico: canales resueltos pero 0 videos leídos = algo va mal en la API
  if (stats.scanned === 0) {
    console.error('[yt-films] FATAL: 0 videos escaneados. Revisa los logs de páginas de playlist.');
    process.exit(1);
  }

  // Más recientes primero (por fecha de publicación)
  allMovies.sort((a, b) => String(b.series.updatedAt).localeCompare(String(a.series.updatedAt)));

  const finishedAt = new Date();

  const meta = {
    source: 'youtubefilms-youtube',
    version: 2,
    lite: false,
    syncedAt: finishedAt.toISOString(),
    minDurationSeconds: MIN_DURATION_SECONDS,
    counts: {
      movies: allMovies.length,
      scanned: stats.scanned,
      ignoredByDuration: stats.ignoredDuration,
      errors: stats.errors.length,
    },
    channels: CHANNELS.map((c) => c.handle),
  };

  /* ---------- catálogo completo (fallback si no hay índice) ---------- */
  const catalog = {
    meta,
    genres: GENRE_LIST,
    series: allMovies.map((m) => m.series),
    seasons: allMovies.flatMap((m) => m.seasons),
    episodes: allMovies.flatMap((m) => m.episodes),
  };

  /* ------- índice ligero compacto: claves i/s/t/p/g/st/ty/y/c/e/u ----- */
  const liteIndex = {
    meta: {
      source: 'youtubefilms-youtube',
      version: 2,
      lite: true,
      compact: true,
      syncedAt: finishedAt.toISOString(),
      count: allMovies.length,
      genres: GENRE_LIST,
      imageBase: 'https://i.ytimg.com/vi/',
      detailsBase: 'catalog-youtubefilms-details',
    },
    series: allMovies.map((m) => {
      const s = m.series;
      return {
        i: s.slug,                                        // id
        s: s.slug,                                        // slug (clave del detalle)
        t: s.title,                                       // título limpio
        p: s.image,                                       // thumbnail (URL http completa)
        g: s.genres.map((gn) => GENRE_LIST.indexOf(gn)).filter((n) => n >= 0),
        st: 'Finalizada',                                 // status
        ty: 'movie',                                      // type (película)
        y: s.year,                                        // año
        c: s.channel,                                     // canal de origen
        e: 1,                                             // totalEpisodes (1 = película)
        u: s.updatedAt,                                   // updatedAt
      };
    }),
  };

  /* ---------- escritura ---------- */
  const outDir = path.join(process.cwd(), 'public', 'data');
  const detailsDir = path.join(outDir, 'catalog-youtubefilms-details');
  fs.mkdirSync(detailsDir, { recursive: true });

  fs.writeFileSync(path.join(outDir, 'catalog-youtubefilms.json'), JSON.stringify(catalog, null, 2));
  fs.writeFileSync(path.join(outDir, 'catalog-youtubefilms-index.json'), JSON.stringify(liteIndex));

  let written = 0;
  for (const m of allMovies) {
    const safe = m.series.slug.replace(/[^a-zA-Z0-9._-]/g, '_');
    fs.writeFileSync(
      path.join(detailsDir, `${safe}.json`),
      JSON.stringify({
        series: m.series,
        seasons: m.seasons,
        episodes: m.episodes,
      }, null, 2)
    );
    written++;
  }

  console.log('------------------------------------------------------------');
  console.log(`[yt-films] Escaneados : ${stats.scanned} (pestaña Videos de ${CHANNELS.length} canales)`);
  console.log(`[yt-films] Ignorados  : ${stats.ignoredDuration} (duración < ${MIN_DURATION_SECONDS}s)`);
  console.log(`[yt-films] Películas  : ${stats.kept} guardadas`);
  console.log(`[yt-films] Detalles   : ${written} fichas en catalog-youtubefilms-details/`);
  if (stats.errors.length) {
    console.log('[yt-films] Errores:', JSON.stringify(stats.errors, null, 2));
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('[yt-films] FATAL:', err);
  process.exit(1);
});
