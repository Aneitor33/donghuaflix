// ══════════════════════════════════════════════════════════
//  split-catalog.js  —  DonghuaFlix
//  Convierte un catálogo gigante en:
//    <base>-index.json           → índice LITE (grids + búsqueda)
//    <base>-details/<slug>.json  → ficha completa (sinopsis, temporadas,
//                                   episodios y servidores) de UN título
//
//  Uso:
//    node split-catalog.js public/data/catalog-peliculas.json
//    node split-catalog.js public/data/catalog.json
//
//  No toca el JSON original (se mantiene por compatibilidad).
// ══════════════════════════════════════════════════════════

import fs from 'node:fs';
import path from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Uso: node split-catalog.js <ruta/al/catalog.json>');
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`[split] No existe ${input}`);
  process.exit(0);
}

const db = JSON.parse(fs.readFileSync(input, 'utf8'));
const series = Array.isArray(db.series) ? db.series : [];
const seasons = Array.isArray(db.seasons) ? db.seasons : [];
const episodes = Array.isArray(db.episodes) ? db.episodes : [];

if (!series.length) {
  console.error(`[split] ${input} no tiene series/películas. Nada que hacer.`);
  process.exit(0);
}

const dir = path.dirname(input);
const base = path.basename(input, '.json');              // catalog-peliculas
const indexFile = path.join(dir, `${base}-index.json`);
const detailsDir = path.join(dir, `${base}-details`);

// Agrupar temporadas y episodios por serie (una sola pasada)
const seasonsBySeries = new Map();
for (const s of seasons) {
  if (!seasonsBySeries.has(s.seriesId)) seasonsBySeries.set(s.seriesId, []);
  seasonsBySeries.get(s.seriesId).push(s);
}
const epsBySeries = new Map();
const seasonToSeries = new Map(seasons.map(s => [s.id, s.seriesId]));
for (const e of episodes) {
  const sid = e.seriesId || seasonToSeries.get(e.seasonId);
  if (!sid) continue;
  if (!epsBySeries.has(sid)) epsBySeries.set(sid, []);
  epsBySeries.get(sid).push(e);
}

// Empezar de cero para no dejar fichas huérfanas de sincronizaciones previas
fs.rmSync(detailsDir, { recursive: true, force: true });
fs.mkdirSync(detailsDir, { recursive: true });

const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
const genreList = [];
const genreIdx = new Map();
const gid = (g) => {
  if (!genreIdx.has(g)) { genreIdx.set(g, genreList.length); genreList.push(g); }
  return genreIdx.get(g);
};
const IMG_BASE = 'https://image.tmdb.org/t/p/w300';
const index = [];
let written = 0;

for (const s of series) {
  const key = safe(s.slug || s.id);
  if (!key) continue;

  // ── Índice LITE: sólo lo que pinta una tarjeta o se usa al buscar ──
  // Los géneros se guardan como números (diccionario) y el póster sin el
  // prefijo de TMDB: así el índice pesa una fracción.
  //
  // CORREGIDO: se prioriza la portada LOCAL descargada por poster-sync.js
  // (posterLocal). Si no hay, se usa la remota como antes. Las rutas
  // locales ('./public/...') viajan tal cual y la app las detecta.
  const img = s.posterLocal || s.image || '';
  const row = {
    i: s.id,
    s: s.slug || s.id,
    t: s.title,
    p: img.startsWith(IMG_BASE) ? img.slice(IMG_BASE.length) : img || null,
    g: (s.genres || []).map(gid),
  };
  if (s.posterLocal) row.pl = 1;   // marca informativa: portada local
  if (s.status) row.st = s.status;
  if (s.type) row.ty = s.type;
  if (s.year) row.y = s.year;
  if (s.country) row.c = s.country;
  if (s.totalEpisodes != null) row.e = s.totalEpisodes;
  if (s.updatedAt) row.u = s.updatedAt;
  index.push(row);

  // ── Detalle: todo lo pesado, un fichero por título ──
  fs.writeFileSync(
    path.join(detailsDir, `${key}.json`),
    JSON.stringify({
      series: s,
      seasons: seasonsBySeries.get(s.id) || [],
      episodes: epsBySeries.get(s.id) || [],
    })
  );
  written++;
}

fs.writeFileSync(
  indexFile,
  JSON.stringify({
    meta: { ...(db.meta || {}), lite: true, generatedAt: new Date().toISOString() },
    lite: true,
    compact: true,
    imageBase: IMG_BASE,
    detailsBase: `${base}-details`,
    genres: genreList,
    count: index.length,
    series: index,
  })
);

const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(2);
console.log(`[split] origen : ${input} (${mb(input)} MB, ${series.length} títulos)`);
console.log(`[split] índice : ${indexFile} (${mb(indexFile)} MB)`);
console.log(`[split] fichas : ${detailsDir}/ (${written} ficheros)`);
