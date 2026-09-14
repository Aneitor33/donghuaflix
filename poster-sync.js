import fs from 'node:fs/promises';
import path from 'node:path';

const FILES = [
  path.resolve('public/data/catalog.json'),
  path.resolve('public/data/catalog-cdrama.json'),
  path.resolve('public/data/catalog-anime.json'),
  path.resolve('public/data/catalog-cine.json')
];
const POSTER_DIR = path.resolve('public/img/posters');
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const FORCE = process.env.FORCE_POSTERS === '1';

const sleep = ms => new Promise(r => setTimeout(r, ms));

const normalize = s => String(s || '').toLowerCase().replace(/[^a-z0-9áéíóúñü ]/g, '').replace(/\s+/g, ' ').trim();

async function fetchJson(url, options = {}, attempt = 1) {
  try {
    const res = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (attempt < 3) { await sleep(800 * attempt); return fetchJson(url, options, attempt + 1); }
    return null;
  }
}

/* ---------- TMDB (requiere API key gratuita) ---------- */
async function searchTmdb(title) {
  if (!TMDB_KEY) return null;
  const url = `https://api.themoviedb.org/3/search/tv?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=es-ES`;
  const data = await fetchJson(url);
  const norm = normalize(title);
  const results = data?.results || [];
  // Preferir coincidencia más exacta del título
  const best = results.find(r => normalize(r.name) === norm) || results[0];
  if (!best?.poster_path) return null;
  return {
    poster: `https://image.tmdb.org/t/p/w500${best.poster_path}`,
    match: best.name
  };
}

/* ---------- AniList (gratis, sin key) ---------- */
async function searchAnilist(title) {
  const query = `query ($q: String) {
    Page(perPage: 5) {
      media(search: $q, type: ANIME) {
        title { romaji english }
        coverImage { large }
        popularity
      }
    }
  }`;
  const data = await fetchJson('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ query, variables: { q: title } })
  });
  const media = data?.data?.Page?.media || [];
  if (!media.length) return null;
  const norm = normalize(title);
  const best = media.find(m => {
    const t = normalize(m.title?.english || m.title?.romaji);
    return t === norm;
  }) || media[0];
  if (!best?.coverImage?.large) return null;
  return {
    poster: best.coverImage.large,
    match: best.title?.english || best.title?.romaji
  };
}

async function downloadPoster(url, slug) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return null; // imagen rota/placeholder
    const type = res.headers.get('content-type') || 'image/jpeg';
    const ext = type.includes('png') ? '.png' : type.includes('webp') ? '.webp' : '.jpg';
    const file = `${slug}${ext}`;
    await fs.mkdir(POSTER_DIR, { recursive: true });
    await fs.writeFile(path.join(POSTER_DIR, file), buf);
    return `./public/img/posters/${file}`;
  } catch { return null; }
}

async function processFile(OUT_FILE) {
  let db;
  try {
    db = JSON.parse(await fs.readFile(OUT_FILE, 'utf8'));
  } catch {
    console.log(`⏭️  No existe ${OUT_FILE}, se omite`);
    return;
  }
  let ok = 0, skip = 0, fail = 0;

  for (const s of db.series) {
    const slug = s.slug || s.id;
    // Si ya tiene portada local y no forzamos, saltar
    if (!FORCE && s.posterLocal) { skip++; continue; }

    const title = (s.title && s.title !== 'Temporadas') ? s.title : slug.split('-').join(' ');
    console.log(`\n🖼️  ${slug} ← buscando "${title}"`);

    const hit = (await searchTmdb(title)) || (await searchAnilist(title));
    if (!hit) { console.log('   ❌ Sin resultados'); fail++; await sleep(400); continue; }

    const local = await downloadPoster(hit.poster, slug);
    if (!local) { console.log('   ❌ No se pudo descargar'); fail++; await sleep(400); continue; }

    s.posterLocal = local;
    console.log(`   ✅ ${hit.match} → ${local}`);
    ok++;
    await sleep(400); // respetar rate limits
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(db, null, 2), 'utf8');
  console.log(`\n========== PORTADAS (${path.basename(OUT_FILE)}) ==========`);
  console.log(`✅ Nuevas: ${ok} | ⏭️ Ya tenían: ${skip} | ❌ Fallaron: ${fail}`);
}

async function main() {
  for (const file of FILES) await processFile(file);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
