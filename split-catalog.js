// ══════════════════════════════════════════════════════════
//  split-catalog.js  —  DonghuaFlix  (v2: detalles en BATCHES)
//  Convierte un catálogo gigante en:
//    <base>-index.json                 → índice LITE (grids + búsqueda)
//                                         CADA serie lleva "b": nº de batch
//    <base>-details-batch-000.json     → detalles de ~1,5 MB máx. cada uno
//    <base>-details-batch-001.json     → (series + temporadas + episodios
//                                         + servidores de N títulos)
//
//  Uso:
//    node split-catalog.js public/data/catalog-donghualife.json
//
//  Por qué: Cloudflare Pages limita a 20.000 archivos por deploy.
//  Con 1 archivo por título, cualquier catálogo grande lo revienta.
//  Con batches, el total son ~10-25 archivos, inmune al crecimiento.
//
//  CAMBIO EN LA WEB (3 líneas):
//    // antes
//    const r = await fetch(`${DATA}/${index.detailsBase}/${slug}.json`);
//    const detail = await r.json();
//    // después
//    const row = index.series.find(x => x.s === slug || x.i === slug);
//    const r = await fetch(`${index.detailsBase}${String(row?.b ?? 0).padStart(3,'0')}.json`);
//    const detail = (await r.json())[slug];
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
const detailsDir = path.join(dir, `${base}-details`);    // legado (se borra)

// Tamaño objetivo por batch (1,5 MB ≈ cómodo de cargar por serie)
const BATCH_TARGET_BYTES = Number(process.env.SPLIT_BATCH_BYTES || 1_500_000);

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

/*
   Limpieza de lo anterior:
   - la carpeta de fichas sueltas (legado v1)
   - los batches viejos de corridas anteriores
   Así no quedan huérfanos que inflen el deploy.
*/
fs.rmSync(detailsDir, { recursive: true, force: true });
for (const f of fs.readdirSync(dir)) {
  if (f.startsWith(`${base}-details-batch-`) && f.endsWith('.json')) {
    fs.rmSync(path.join(dir, f));
  }
}

const safe = (s) => String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 150);
const genreList = [];
const genreIdx = new Map();
const gid = (g) => {
  if (!genreIdx.has(g)) { genreIdx.set(g, genreList.length); genreList.push(g); }
  return genreIdx.get(g);
};
const IMG_BASE = 'https://image.tmdb.org/t/p/w300';
const index = [];

// ── Construcción de batches por tamaño ──
const batches = [];            // array de Map<key, payload>
let current = new Map();
let currentBytes = 2;          // "{}"

function flushBatch() {
  if (!current.size) return;
  batches.push(current);
  current = new Map();
  currentBytes = 2;
}

for (const s of series) {
  const key = safe(s.slug || s.id);
  if (!key) continue;

  const payload = {
    series: s,
    seasons: seasonsBySeries.get(s.id) || [],
    episodes: epsBySeries.get(s.id) || [],
  };
  const entry = JSON.stringify(payload);

  // si el batch actual superaría el objetivo, cerrarlo y abrir otro
  if (current.size > 0 && currentBytes + entry.length + key.length + 5 > BATCH_TARGET_BYTES) {
    flushBatch();
  }
  current.set(key, payload);
  currentBytes += entry.length + key.length + 5;

  // ── Índice LITE (igual que antes + campo b = nº de batch) ──
  const img = s.posterLocal || s.image || '';
  const row = {
    i: s.id,
    s: s.slug || s.id,
    t: s.title,
    p: img.startsWith(IMG_BASE) ? img.slice(IMG_BASE.length) : img || null,
    g: (s.genres || []).map(gid),
    b: batches.length,                      // ← batch donde vive su detalle
  };
  if (s.posterLocal) row.pl = 1;
  if (s.status) row.st = s.status;
  if (s.type) row.ty = s.type;
  if (s.year) row.y = s.year;
  if (s.country) row.c = s.country;
  if (s.totalEpisodes != null) row.e = s.totalEpisodes;
  if (s.updatedAt) row.u = s.updatedAt;
  index.push(row);
}
flushBatch();

// ── Escribir los batches ──
batches.forEach((map, n) => {
  const name = `${base}-details-batch-${String(n).padStart(3, '0')}.json`;
  fs.writeFileSync(path.join(dir, name), JSON.stringify(Object.fromEntries(map)));
});

fs.writeFileSync(
  indexFile,
  JSON.stringify({
    meta: { ...(db.meta || {}), lite: true, generatedAt: new Date().toISOString() },
    lite: true,
    compact: true,
    imageBase: IMG_BASE,
    detailsMode: 'batch',                              // ← la web lo detecta
    detailsBase: `${base}-details-batch-`,             // prefijo + 000.json
    batchCount: batches.length,
    batchBytes: BATCH_TARGET_BYTES,
    genres: genreList,
    count: index.length,
    series: index,
  })
);

const mb = (p) => (fs.statSync(p).size / 1024 / 1024).toFixed(2);
console.log(`[split] origen : ${input} (${mb(input)} MB, ${series.length} títulos)`);
console.log(`[split] índice : ${indexFile} (${mb(indexFile)} MB)`);
console.log(`[split] batches: ${batches.length} archivos (~${(BATCH_TARGET_BYTES / 1024 / 1024).toFixed(1)} MB c/u)`);
