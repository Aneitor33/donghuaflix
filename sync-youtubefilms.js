#!/usr/bin/env node
/**
 * DonghuaFlix — Scraper "YOUTUBE FILMS"
 * ---------------------------------------------------------------
 * Extrae videos de los canales autorizados de YouTube, filtra por
 * duración (>= MIN_DURATION_SECONDS, default 3600s), limpia títulos,
 * clasifica tipo (animation/live_action), asigna géneros y genera:
 *
 *   public/data/catalog-youtubefilms.json        -> catálogo completo
 *   public/data/catalog-youtubefilms-index.json  -> índice ligero
 *   public/data/catalog-youtubefilms-details/<id>.json -> detalle por ítem
 *
 * Requiere env: YOUTUBE_API_KEY (YouTube Data API v3)
 * Uso: node tools/sync-youtubefilms.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

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

// Keywords de género (minúsculas, sin acentos para matching robusto)
const GENRE_KEYWORDS = {
  'Fantasía/Cultivación': ['secta', 'inmortal', 'qi', 'dantian', 'cultivacion', 'cultivo', 'dios', 'magia', 'magico', 'hechicero', 'dragon', 'espiritu', 'reino celestial', 'ascension'],
  'Artes Marciales':      ['kung fu', 'kungfu', 'espada', 'shaolin', 'maestro', 'combate', 'artes marciales', 'marcial', 'wuxia', 'guerrero'],
  'Acción':               ['accion', 'guerra', 'batalla', 'pelea', 'lucha', 'ejercito', 'asesino', 'venganza', 'mision'],
  'Comedia':              ['comedia', 'comico', 'humor', 'risa', 'parodia'],
  'Histórico':            ['dinastia', 'emperador', 'reino', 'palacio', 'imperio', 'general', 'antiguo', 'historia', 'guerrero de la dinastia'],
  'Romance':              ['romance', 'amor', 'amores', 'matrimonio', 'esposa', 'esposo', 'corazon'],
  'Drama':                ['drama', 'tragedia', 'sacrificio', 'destino', 'secreto', 'familia', 'honor'],
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
  // 1) Quitar bloques entre corchetes / paréntesis que sean etiquetas
  t = t.replace(/[\[\(][^\]\)]{0,60}[\]\)]/g, (blk) => {
    const b = blk.toLowerCase();
    const isLabel =
      /sub|esp|lat|hd|4k|1080|720|pelicula|movie|completa|full|estreno|nuevo|mejor|gran|accion|acción|new|official|trailer|temporada|cap[ií]tulo|episodio|\d{4}/.test(b);
    return isLabel ? ' ' : blk;
  });
  // 2) Frases de gancho sueltas
  t = t.replace(/\b(PEL[IÍ]CULA COMPLETA|FULL MOVIE|COMPLETA EN ESPA[NÑ]OL|SUB ESPA[NÑ]OL|SUBTITULADA|DOBLADA|NUEVO ESTRENO|GRAN ESTRENO|MEJOR PEL[IÍ]CULA( DE)?|ACC[IÓO]N\s*\d{4}|ESTRENO\s*\d{4}|\b\d{4}\b)\b/gi, ' ');
  // 3) Calidad / resoluciones sueltas
  t = t.replace(/\b(4K|HD|FULL HD|1080P?|720P?|8K|UHD)\b/gi, ' ');
  // 4) Separadores típicos: quedar con la parte principal antes de " | " o " - " si el resto es ruido
  t = t.replace(/\s*[|]\s*/g, ' ');
  // 5) Normalizar espacios y puntuación residual
  t = t.replace(/\s{2,}/g, ' ').replace(/\s+([:;,.!?])/g, '$1').trim();
  t = t.replace(/^[-–—:.\s]+|[-–—:.\s]+$/g, '');
  return t || raw.trim();
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
      if (hay.includes(needle)) score += kw.includes(' ') ? 3 : 2; // frases valen más
    }
    if (score > 0) scored.push({ genre, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = scored.slice(0, 3).map((s) => s.genre);
  return picked.length ? picked : ['Acción'];
}

/* ============================ ITEM BUILDER ========================== */

function buildItem(snippet, contentDetails, channelBase) {
  const videoId = snippet ? (typeof snippet === 'string' ? snippet : undefined) : undefined;
  return null; // placeholder (no usado)
}

function makeItem(video, channelHandle, channelBase) {
  const { id, snippet, contentDetails } = video;
  const durationSec = isoDurationToSeconds(contentDetails?.duration);
  const originalTitle = (snippet.title || '').trim();
  const fullText = `${originalTitle}\n${snippet.description || ''}`;

  const type = (channelBase === 'live_action' && ANIMATION_HINTS.test(fullText))
    ? 'animation'
    : channelBase;

  let description = (snippet.description || '').replace(/\s+/g, ' ').trim();
  if (description.length > 197) description = description.slice(0, 197).trimEnd() + '...';

  return {
    id,
    title: cleanTitle(originalTitle),
    original_title: originalTitle,
    channel: channelHandle,
    description,
    thumbnail_url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
    duration: durationSec,
    video_url: `https://www.youtube.com/watch?v=${id}`,
    embed_url: `https://www.youtube-nocookie.com/embed/${id}`,
    type,
    genres: assignGenres(fullText),
    source: 'youtube_yt',
  };
}

/* ============================ SCRAPING ============================== */

async function resolveUploadsPlaylist(handle) {
  // YouTube Data API v3 soporta búsqueda por handle
  const data = await ytGet('channels', {
    part: 'contentDetails,snippet',
    forHandle: handle.replace(/^@/, ''),
    maxResults: 1,
  });
  const ch = data.items && data.items[0];
  if (!ch) throw new Error(`Canal no encontrado: ${handle}`);
  return {
    uploadsId: ch.contentDetails.relatedPlaylists.uploads,
    title: ch.snippet.title,
  };
}

async function listUploadIds(uploadsId, maxItems) {
  const ids = [];
  let pageToken = '';
  do {
    const data = await ytGet('playlistItems', {
      part: 'contentDetails',
      playlistId: uploadsId,
      maxResults: 50,
      pageToken,
    });
    for (const it of data.items || []) {
      if (it.contentDetails?.videoId) ids.push(it.contentDetails.videoId);
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
    await sleep(120); // cortesía de cuota
  }
  return videos;
}

/* ============================== MAIN ================================= */

async function main() {
  const startedAt = new Date();
  const allItems = [];
  const stats = { scanned: 0, kept: 0, ignoredDuration: 0, errors: [] };

  for (const ch of CHANNELS) {
    try {
      console.log(`[yt-films] Procesando ${ch.handle} ...`);
      const { uploadsId, title } = await resolveUploadsPlaylist(ch.handle);
      const ids = await listUploadIds(uploadsId, MAX_VIDEOS_PER_CHANNEL);
      const videos = await fetchVideos(ids);
      stats.scanned += videos.length;
      console.log(`[yt-films]   ${title}: ${videos.length} videos revisados`);

      for (const v of videos) {
        const dur = isoDurationToSeconds(v.contentDetails?.duration);
        if (dur < MIN_DURATION_SECONDS) { stats.ignoredDuration++; continue; }
        const item = makeItem(v, ch.handle, ch.base);
        if (item.title.length < 3) item.title = item.original_title; // salvaguarda
        allItems.push(item);
        stats.kept++;
      }
    } catch (err) {
      console.error(`[yt-films] ERROR en ${ch.handle}: ${err.message}`);
      stats.errors.push({ channel: ch.handle, error: err.message });
    }
  }

  // Orden: más recientes primero (por fecha de publicación no disponible aquí; usar id estable)
  allItems.sort((a, b) => a.title.localeCompare(b.title, 'es'));

  const finishedAt = new Date();

  /* ---------- catálogo completo ---------- */
  const catalog = {
    meta: {
      source: 'youtube-films',
      version: 1,
      lite: false,
      syncedAt: finishedAt.toISOString(),
      counts: {
        movies: allItems.length,
        scanned: stats.scanned,
        ignoredByDuration: stats.ignoredDuration,
        errors: stats.errors.length,
      },
      minDurationSeconds: MIN_DURATION_SECONDS,
      channels: CHANNELS.map((c) => c.handle),
      genres: GENRE_LIST,
    },
    movies: allItems,
  };

  /* ---------- índice ligero (lo que lee el frontend en Home) ---------- */
  const liteIndex = {
    meta: {
      source: 'youtube-films',
      version: 1,
      lite: true,
      compact: true,
      syncedAt: finishedAt.toISOString(),
      count: allItems.length,
      imageBase: 'https://i.ytimg.com/vi/',
      detailsBase: 'catalog-youtubefilms-details',
      genres: GENRE_LIST,
    },
    movies: allItems.map((m) => ({
      i: m.id,                                    // id del video YouTube
      t: m.title,                                 // título limpio
      ot: m.original_title,                       // título original
      p: m.thumbnail_url,                         // póster/thumbnail
      g: m.genres.map((g) => GENRE_LIST.indexOf(g)).filter((n) => n >= 0),
      ty: m.type,                                 // animation | live_action
      d: m.duration,                              // segundos
      c: m.channel,                               // canal de origen
      u: m.video_url,
      e: m.embed_url,
      s: m.source,                                // youtube_yt
    })),
  };

  /* ---------- escritura ---------- */
  const outDir = path.join(process.cwd(), 'public', 'data');
  const detailsDir = path.join(outDir, 'catalog-youtubefilms-details');
  fs.mkdirSync(detailsDir, { recursive: true });

  fs.writeFileSync(
    path.join(outDir, 'catalog-youtubefilms.json'),
    JSON.stringify(catalog, null, 2)
  );
  fs.writeFileSync(
    path.join(outDir, 'catalog-youtubefilms-index.json'),
    JSON.stringify(liteIndex)
  );

  // detalles individuales (uno por video)
  let written = 0;
  for (const m of allItems) {
    fs.writeFileSync(
      path.join(detailsDir, `${m.id}.json`),
      JSON.stringify({ meta: catalog.meta, movie: m }, null, 2)
    );
    written++;
  }

  console.log('------------------------------------------------------------');
  console.log(`[yt-films] Escaneados : ${stats.scanned}`);
  console.log(`[yt-films] Ignorados  : ${stats.ignoredDuration} (duración < ${MIN_DURATION_SECONDS}s)`);
  console.log(`[yt-films] Guardados  : ${stats.kept} items`);
  console.log(`[yt-films] Detalles   : ${written} archivos en catalog-youtubefilms-details/`);
  console.log(`[yt-films] Inicio     : ${startedAt.toISOString()}`);
  console.log(`[yt-films] Fin        : ${finishedAt.toISOString()}`);
  if (stats.errors.length) {
    console.log('[yt-films] Errores:', JSON.stringify(stats.errors, null, 2));
    process.exitCode = 2;
  }
}

main().catch((err) => {
  console.error('[yt-films] FATAL:', err);
  process.exit(1);
});
