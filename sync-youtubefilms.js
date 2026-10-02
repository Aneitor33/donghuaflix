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
// SYNC INCREMENTAL: solo devuelve videos NO presentes en el catálogo.
// Las uploads están ordenadas de más reciente a más antigua, así que en
// cuanto una página entera ya es conocida, todo lo demás también lo es
// (early-exit) -> las syncs siguientes leen 1-2 páginas y terminan.
async function listNewVideoIds(uploadsId, knownIds, maxItems) {
  const newIds = [];
  let known = 0;
  let pageToken = '';
  let page = 0;
  do {
    const data = await ytGet('playlistItems', {
      part: 'snippet,contentDetails',  // snippet da resourceId.videoId, contentDetails da videoId
      playlistId: uploadsId,
      maxResults: 50,
      pageToken,
    });
    const items = data.items || [];
    page++;
    let pageNew = 0;
    for (const it of items) {
      const vid = (it.contentDetails && it.contentDetails.videoId)
        || (it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId);
      if (!vid) continue;
      if (knownIds.has(vid)) { known++; continue; }
      newIds.push(vid);
      pageNew++;
    }
    console.log(`[yt-films]   página ${page}: ${pageNew} nuevos, ${items.length - pageNew} ya conocidos`);
    pageToken = data.nextPageToken || '';
    if (pageNew === 0) {
      console.log('[yt-films]   early-exit: el resto ya está en el catálogo ✓');
      break;
    }
    if (newIds.length >= maxItems) break;
  } while (pageToken);
  return { newIds: newIds.slice(0, maxItems), known };
}

async function fetchVideos(videoIds) {
  const videos = [];
  if (!videoIds.length) return videos;
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

/* ==================== SYNC INCREMENTAL ============================== */

// Extrae el videoId de YouTube de una ficha existente
function videoIdFromSeries(s) {
  const m = /(?:v=|\/embed\/)([\w-]{11})/.exec(s.sourceUrl || '');
  return m ? m[1] : null;
}

// Lee el catálogo ya commiteado para omitir lo conocido en la próxima sync
function loadExistingCatalog() {
  const p = path.join(process.cwd(), 'public', 'data', 'catalog-youtubefilms.json');
  const map = new Map();
  if (!fs.existsSync(p)) return map;
  try {
    const cat = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const s of cat.series || []) {
      const vid = videoIdFromSeries(s);
      if (vid) map.set(vid, s);
    }
    console.log(`[yt-films] Catálogo existente: ${map.size} películas (se omitirán)`);
  } catch (e) {
    console.warn(`[yt-films] No se pudo leer el catálogo existente (${e.message}); sync completa`);
  }
  return map;
}

// Reconstruye la ficha {series, seasons, episodes} a partir de una series guardada
function rebuildMovie(s) {
  const slug = s.slug || s.id;
  const vid = videoIdFromSeries(s) || slug;
  return {
    series: s,
    seasons: [{ id: `${slug}-s1`, seriesId: slug, number: 1, title: 'Película' }],
    episodes: [{
      id: `${slug}-ep-1`, slug: `${slug}-ep-1`, seriesId: slug, seasonId: `${slug}-s1`,
      number: 1, title: 'Ver película',
      servers: [{ name: 'YouTube', url: `https://www.youtube-nocookie.com/embed/${vid}` }],
      updatedAt: s.updatedAt,
    }],
  };
}

/* ==================== SHARDS DE DETALLE ============================= */
/* Mismo algoritmo que app.js: las fichas se agrupan en SHARD_COUNT
   archivos para no agotar el límite de 20.000 archivos de Pages. */
const SHARD_COUNT = 64;
function shardIndexOf(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % SHARD_COUNT;
}

/* ============================== MAIN ================================= */

async function main() {
  const startedAt = new Date();

  // ── Sync incremental: arrancamos con lo que ya está commiteado ──
  const existingMap = loadExistingCatalog();
  const allMovies = [...existingMap.values()].map(rebuildMovie);
  const seenSlugs = new Set(allMovies.map((m) => m.series.slug));
  console.log(`[yt-films] Sync incremental sobre ${allMovies.length} películas existentes`);

  const stats = { scanned: 0, kept: 0, newItems: 0, ignoredDuration: 0, errors: [] };

  for (const ch of CHANNELS) {
    try {
      console.log(`[yt-films] Procesando ${ch.handle} (pestaña Videos)...`);
      const { title: channelTitle, uploadsId } = await resolveChannelId(ch.handle);
      const { newIds, known } = await listNewVideoIds(uploadsId, new Set(existingMap.keys()), MAX_VIDEOS_PER_CHANNEL);
      console.log(`[yt-films]   ${channelTitle}: ${newIds.length} nuevos, ${known} ya en catálogo`);
      const videos = await fetchVideos(newIds);
      stats.scanned += videos.length;

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
        existingMap.set(v.id, movie.series); // por si el slug sufrió cambio
        stats.kept++;
        stats.newItems++;
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
      newInThisSync: stats.newItems,
      scanned: stats.scanned,
      ignoredByDuration: stats.ignoredDuration,
      errors: stats.errors.length,
    },
    incremental: true,
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
    // ⚠️ OJO: app.js lee compact/genres/imageBase/detailsBase A NIVEL RAÍZ
    compact: true,
    genres: GENRE_LIST,
    imageBase: 'https://i.ytimg.com/vi/',
    detailsBase: 'catalog-youtubefilms-details',
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

  // Limpiar fichas antiguas (un archivo por película ya no se usa -> shards)
  for (const f of fs.readdirSync(detailsDir)) {
    fs.unlinkSync(path.join(detailsDir, f));
  }

  // Agrupar en shards deterministas (mismo hash que app.js)
  const shards = new Map();
  for (const m of allMovies) {
    const sh = shardIndexOf(m.series.slug);
    if (!shards.has(sh)) shards.set(sh, { series: [], seasons: [], episodes: [] });
    const b = shards.get(sh);
    b.series.push(m.series);
    for (const s of m.seasons) b.seasons.push(s);
    for (const e of m.episodes) b.episodes.push(e);
  }
  let written = 0;
  for (const [sh, b] of [...shards.entries()].sort((a, b2) => a[0] - b2[0])) {
    fs.writeFileSync(path.join(detailsDir, `shard-${sh}.json`), JSON.stringify(b));
    written++;
  }

  console.log('------------------------------------------------------------');
  console.log(`[yt-films] Nuevos procesados : ${stats.scanned}`);
  console.log(`[yt-films] Nuevas películas  : ${stats.newItems} (omitidas las ya conocidas)`);
  console.log(`[yt-films] Ignorados (cortos): ${stats.ignoredDuration} (duración < ${MIN_DURATION_SECONDS}s)`);
  console.log(`[yt-films] Total catálogo    : ${allMovies.length} películas`);
  console.log(`[yt-films] Shards     : ${written} archivos (máx. ${SHARD_COUNT}) para ${allMovies.length} películas`);
  if (stats.errors.length) {
    console.log('[yt-films] Errores:', JSON.stringify(stats.errors, null, 2));
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('[yt-films] FATAL:', err);
  process.exit(1);
});
