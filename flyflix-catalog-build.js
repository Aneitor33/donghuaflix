// ══════════════════════════════════════════════════════════
//  flyflix-catalog-build.js — DonghuaFlix
//  Convierte los resultados del scraper de flyflix (resultados/*.json)
//  en public/data/catalog-flyflix.json con el formato canónico de la app:
//    { meta, series[], seasons[], episodes[], genres[] }
//
//  - Enriquece cada título con metadatos de TMDB (título, póster, año,
//    géneros, sinopsis, temporadas/episodios).
//  - Películas: 1 episodio ("Película") con todos los servidores verificados.
//  - Series top TV_DETAIL_LIMIT: estructura completa de temporadas/episodios.
//  - Series restantes: S1E1 como entrada mínima.
//
//  Requiere: Node 18+ (fetch nativo). Sin dependencias npm.
//  Uso:
//    TMDB_API_KEY=xxx node flyflix-catalog-build.js resultados/2026-10-12-tmdb.json
//    TMDB_API_KEY=xxx node flyflix-catalog-build.js --latest
// ══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const API_KEY = process.env.TMDB_API_KEY || '';
if (!API_KEY) { console.error('Falta TMDB_API_KEY'); process.exit(1); }

let INPUT = args.find(a => !a.startsWith('--'));
if (args.includes('--latest')) {
  const dir = 'resultados';
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith('.json'))
    : [];
  if (!files.length) { console.error('No hay resultados/*.json'); process.exit(1); }
  // elegir por fecha de modificación real, no por nombre
  INPUT = path.join(dir, files.reduce((a, b) =>
    fs.statSync(path.join(dir, a)).mtimeMs > fs.statSync(path.join(dir, b)).mtimeMs ? a : b));
  console.log(`📄 Último resultado por mtime: ${INPUT}`);
}
if (!INPUT || !fs.existsSync(INPUT)) {
  console.error(`No encuentro el archivo de resultados: ${INPUT}`);
  process.exit(1);
}

const OUT = process.env.OUT || 'public/data/catalog-flyflix.json';
const TV_DETAIL_LIMIT = Number(process.env.TV_DETAIL_LIMIT || 150);
const SLEEP_MS = Number(process.env.SLEEP_MS || 260);   // ~4 req/s (rate limit TMDB)
const IMG = p => (p ? `https://image.tmdb.org/t/p/w300${p}` : null);

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function tmdb(url, params = {}) {
  const qs = new URLSearchParams({ api_key: API_KEY, language: 'es-ES', ...params });
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`${url}?${qs}`);
    if (res.status === 429) { await sleep(2000 * attempt); continue; }
    if (!res.ok) throw new Error(`TMDB ${res.status} ${url}`);
    return res.json();
  }
  throw new Error(`TMDB rate-limit persistente en ${url}`);
}

// ── Leer resultados del scraper ──
const data = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const items = Array.isArray(data) ? data : (data.items || []);
console.log(`📥 ${INPUT}: ${items.length} títulos`);

// ── Catálogo de salida ──
const db = { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
const allGenres = new Set();
const upsert = (arr, item) => {
  const i = arr.findIndex(e => e.id === item.id);
  if (i === -1) arr.push(item); else arr[i] = { ...arr[i], ...item };
};

let done = 0, failed = 0;
const movieItems = items.filter(i => i.tipo === 'movie');
const tvItems = items.filter(i => i.tipo === 'tv');

function okServers(item) {
  const ok = (item.servers || []).filter(s => !s.http_status || s.http_status < 400);
  const list = ok.length ? ok : (item.servers || []);
  return list.map(s => ({ name: s.servidor, url: s.url, embed: true }));
}

// ══ PELÍCULAS ══
for (const item of movieItems) {
  const slug = `movie-${item.id}`;
  try {
    const m = await tmdb(`https://api.themoviedb.org/3/movie/${item.id}`);
    const year = m.release_date ? Number(m.release_date.slice(0, 4)) : null;
    const genres = (m.genres || []).map(g => g.name);
    genres.forEach(g => allGenres.add(g));
    upsert(db.series, {
      id: slug, slug, title: m.title || `Película ${item.id}`,
      image: IMG(m.poster_path), synopsis: m.overview || null,
      status: m.status || null, country: null, genres,
      totalEpisodes: null, sourceUrl: `https://flyflix.net/watch/${item.id}`,
      type: 'flyflix', contentType: 'movie', year,
      updatedAt: new Date().toISOString()
    });
    upsert(db.seasons, {
      id: `${slug}-1`, slug: `${slug}-1`, seriesId: slug,
      sourceUrl: `https://flyflix.net/watch/${item.id}`, number: 1,
      image: IMG(m.poster_path), episodeCount: 1,
      initialSyncComplete: true, updatedAt: new Date().toISOString()
    });
    upsert(db.episodes, {
      id: `${slug}-pelicula`, slug: `${slug}-pelicula`, title: m.title || 'Película',
      sourceUrl: `https://flyflix.net/watch/${item.id}`,
      servers: okServers(item),
      seriesId: slug, seasonId: `${slug}-1`, number: 1,
      updatedAt: new Date().toISOString()
    });
  } catch (e) {
    failed++;
    console.log(`  ⚠️ peli ${item.id}: ${e.message}`);
  }
  if (++done % 50 === 0) console.log(`  ⏳ ${done}/${items.length}`);
  await sleep(SLEEP_MS);
}

// ══ SERIES ══
let tvRank = 0;
for (const item of tvItems) {
  const slug = `tv-${item.id}`;
  try {
    const t = await tmdb(`https://api.themoviedb.org/3/tv/${item.id}`);
    const year = t.first_air_date ? Number(t.first_air_date.slice(0, 4)) : null;
    const genres = (t.genres || []).map(g => g.name);
    genres.forEach(g => allGenres.add(g));
    const servers = okServers(item);
    upsert(db.series, {
      id: slug, slug, title: t.name || `Serie ${item.id}`,
      image: IMG(t.poster_path), synopsis: t.overview || null,
      status: t.in_production ? 'En emisión' : 'Finalizado',
      country: null, genres,
      totalEpisodes: t.number_of_episodes || null,
      sourceUrl: `https://flyflix.net/watch/${item.id}-tv`,
      type: 'flyflix', contentType: 'series', year,
      updatedAt: new Date().toISOString()
    });

    const detailed = tvRank < TV_DETAIL_LIMIT;
    const nSeasons = detailed
      ? Math.min(t.number_of_seasons || 1, 40)
      : 1;

    for (let sn = 1; sn <= nSeasons; sn++) {
      let epCount = 1;
      let epTitles = null;
      if (detailed) {
        try {
          const season = await tmdb(`https://api.themoviedb.org/3/tv/${item.id}/season/${sn}`);
          epCount = Math.min(season.episodes?.length || 1, 200);
          epTitles = season.episodes || null;
        } catch { /* temporada sin datos → E1 */ }
        await sleep(SLEEP_MS);
      }
      const seasonId = `${slug}-${sn}`;
      upsert(db.seasons, {
        id: seasonId, slug: seasonId, seriesId: slug,
        sourceUrl: `https://flyflix.net/watch/${item.id}-tv`,
        number: sn, image: IMG(t.poster_path), episodeCount: epCount,
        initialSyncComplete: true, updatedAt: new Date().toISOString()
      });
      for (let en = 1; en <= epCount; en++) {
        const epId = `${slug}-${sn}x${en}`;
        const serversEp = servers.map(s => ({
          name: s.name,
          url: s.url.replace(/([?&])s=1(&e=1)?/, `$1s=${sn}&e=${en}`),
          embed: true
        }));
        upsert(db.episodes, {
          id: epId, slug: epId,
          title: epTitles?.[en - 1]?.name || `Episodio ${en}`,
          sourceUrl: `https://flyflix.net/watch/${item.id}-tv`,
          servers: serversEp,
          seriesId: slug, seasonId, number: en,
          updatedAt: new Date().toISOString()
        });
      }
    }
    tvRank++;
  } catch (e) {
    failed++;
    console.log(`  ⚠️ serie ${item.id}: ${e.message}`);
  }
  if (++done % 50 === 0) console.log(`  ⏳ ${done}/${items.length} (${tvRank} series detalladas)`);
  await sleep(SLEEP_MS);
}

db.genres = [...allGenres].sort((a, b) => a.localeCompare(b, 'es'));
db.meta = {
  version: 1,
  source: 'https://flyflix.net/',
  catalogTag: 'flyflix',
  syncedAt: new Date().toISOString(),
  lastSync: { status: 'success', type: 'flyflix-embed', startedAt: db.meta?.syncedAt || null,
              finishedAt: new Date().toISOString(), error: null },
  items: items.length, enriched: done - failed, failed
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(db));
const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
console.log(`\n✅ ${OUT} (${mb} MB)`);
console.log(`   series: ${db.series.length} | seasons: ${db.seasons.length} | episodes: ${db.episodes.length}`);
console.log(`   géneros: ${db.genres.length} | fallidos: ${failed}`);
