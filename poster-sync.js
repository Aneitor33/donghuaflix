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
// Reintentos: espera entre reintentos y máximo de intentos antes de abandonar
const RETRY_DAYS = Number(process.env.POSTER_RETRY_DAYS || 7);
const MAX_FAILS = Number(process.env.POSTER_MAX_FAILS || 3);

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
async function tmdbSearch(endpoint, title, lang) {
  if (!TMDB_KEY) return null;
  const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=${lang}`;
  const data = await fetchJson(url);
  const norm = normalize(title);
  const results = data?.results || [];
  const best = results.find(r => normalize(r.name || r.title) === norm) || results[0];
  if (!best?.poster_path) return null;
  return {
    poster: `https://image.tmdb.org/t/p/w500${best.poster_path}`,
    match: best.name || best.title
  };
}

const searchTmdb = (title, lang = 'es-ES') => tmdbSearch('tv', title, lang);
const searchTmdbMovie = (title, lang = 'en-US') => tmdbSearch('movie', title, lang);

/* ---------- Traducción gratuita (MyMemory, sin key) ---------- */
async function translateTitle(text) {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=es|en`;
    const data = await fetchJson(url);
    const t = data?.responseData?.translatedText;
    if (t && String(t).toLowerCase() !== String(text).toLowerCase()) return t;
  } catch {}
  return null;
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
  let ok = 0, skip = 0, fail = 0, sinceSave = 0;

  for (const s of db.series) {
    const slug = s.slug || s.id;
    // Si ya tiene portada local y no forzamos, saltar
    if (!FORCE && s.posterLocal) { skip++; continue; }

    // Abandonadas tras MAX_FAILS intentos (salvo FORCE)
    if (!FORCE && (s.posterFails || 0) >= MAX_FAILS) {
      skip++;
      console.log(`\n💀 ${slug} — abandonada tras ${s.posterFails} intentos (FORCE para reintentar)`);
      continue;
    }

    // Reintento espaciado: solo si falló hace más de RETRY_DAYS días
    if (!FORCE && s.posterLastFail) {
      const dias = (Date.now() - new Date(s.posterLastFail).getTime()) / 86400000;
      if (dias < RETRY_DAYS) {
        skip++;
        console.log(`\n⏳ ${slug} — reintento en ${Math.ceil(RETRY_DAYS - dias)} días`);
        continue;
      }
    }

    const title = (s.title && s.title !== 'Temporadas') ? s.title : slug.split('-').join(' ');
    console.log(`\n🖼️  ${slug} ← buscando "${title}"`);

    // Candidatos: título visible + título original si existe
    const candidates = [...new Set([title, s.originalTitle].filter(Boolean))];
    let hit = null;

    // 1) TMDB series: español → inglés → chino
    for (const lang of ['es-ES', 'en-US', 'zh-CN']) {
      for (const c of candidates) {
        hit = await searchTmdb(c, lang);
        if (hit) { console.log(`   · TMDB[${lang}] "${c}" → ✅ ${hit.match}`); break; }
        console.log(`   · TMDB[${lang}] "${c}" → ❌`);
        await sleep(150);
      }
      if (hit) break;
    }

    // 2) TMDB películas (algunos donghuas son pelis)
    if (!hit) {
      for (const c of candidates) {
        hit = await searchTmdbMovie(c, 'en-US');
        if (hit) { console.log(`   · TMDB-peli[en-US] "${c}" → ✅ ${hit.match}`); break; }
        console.log(`   · TMDB-peli[en-US] "${c}" → ❌`);
        await sleep(150);
      }
    }

    // 3) AniList (romaji/english nativo)
    if (!hit) {
      for (const c of candidates) {
        hit = await searchAnilist(c);
        if (hit) { console.log(`   · AniList "${c}" → ✅ ${hit.match}`); break; }
        console.log(`   · AniList "${c}" → ❌`);
      }
    }

    // 4) Último recurso: traducir el título al inglés y reintentar todo
    if (!hit) {
      const translated = await translateTitle(title);
      if (translated) {
        console.log(`   · Traducción automática: "${title}" → "${translated}"`);
        hit = await searchTmdb(translated, 'en-US');
        if (hit) console.log(`   · TMDB[en-US] "${translated}" → ✅ ${hit.match}`);
        if (!hit) { hit = await searchTmdbMovie(translated, 'en-US'); if (hit) console.log(`   · TMDB-peli "${translated}" → ✅ ${hit.match}`); }
        if (!hit) { hit = await searchAnilist(translated); if (hit) console.log(`   · AniList "${translated}" → ✅ ${hit.match}`); }
      }
    }
    if (!hit) { console.log('   ❌ Sin resultados'); fail++; await sleep(400); continue; }

    const local = await downloadPoster(hit.poster, slug);
    if (!local) {
      console.log('   ❌ No se pudo descargar');
      s.posterFails = (s.posterFails || 0) + 1;
      s.posterLastFail = new Date().toISOString();
      fail++; sinceSave++;
      console.log(`   📉 Fallo ${s.posterFails}/${MAX_FAILS}`);
      if (sinceSave >= 10) { await fs.writeFile(OUT_FILE, JSON.stringify(db, null, 2), 'utf8'); sinceSave = 0; }
      await sleep(400);
      continue;
    }
    // Éxito: limpiar historial de fallos
    delete s.posterFails;
    delete s.posterLastFail;

    s.posterLocal = local;
    console.log(`   ✅ ${hit.match} → ${local}`);
    ok++;
    sinceSave++;
    // Checkpoint: guardar cada 10 portadas para no perder progreso
    if (sinceSave >= 10) {
      await fs.writeFile(OUT_FILE, JSON.stringify(db, null, 2), 'utf8');
      sinceSave = 0;
      console.log('   💾 Checkpoint de portadas guardado');
    }
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
