import fs from 'node:fs/promises';
import path from 'node:path';

/* Por defecto SOLO DonghuaFlix necesita portadas externas: los demás
   catálogos ya traen buena portada de su propia web. Si algún día se
   necesita otro, se pasa CATALOG (p. ej. CATALOG=doramas). */
const ALL_FILES = ['catalog-donghualife.json'];
const CATALOG = (process.env.CATALOG || '').trim();
const FILES = CATALOG
  ? [path.resolve(`public/data/catalog-${CATALOG}.json`)]
  : ALL_FILES.map(f => path.resolve('public/data', f));

const POSTER_DIR = path.resolve('public/img/posters');
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const FORCE = process.env.FORCE_POSTERS === '1';

/* Presupuesto de tiempo por ejecución: cuando se agota, el script
   guarda TODO lo hecho y sale con código 0 (queda trabajo pendiente).
   Si terminó TODO el catálogo, sale con código 3. */
const BUDGET_MS = Math.max(5, Number(process.env.MAX_MINUTES || 50)) * 60000;
const T0 = Date.now();
const timeUp = () => Date.now() - T0 > BUDGET_MS;

/* Fallo con reintento tras 30 días (TMDB/AniList mejoran con el tiempo). */
const RETRY_MS = 30 * 24 * 3600 * 1000;

/* Portadas que YA son buenas (no se reemplazan) */
const GOOD_POSTER = /image\.tmdb\.org|anilist\.co/i;

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

/* ---------- TMDB (requiere API key gratuita: secrets.TMDB_API_KEY) ---------- */
async function tmdbSearch(endpoint, title, lang) {
  if (!TMDB_KEY) return null;
  const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=${lang}`;
  const data = await fetchJson(url);
  const norm = normalize(title);
  const results = data?.results || [];
  const best = results.find(r => normalize(r.name || r.title) === norm) || results[0];
  if (!best?.poster_path) return null;
  return { poster: `https://image.tmdb.org/t/p/w500${best.poster_path}`, match: best.name || best.title };
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
  const best = media.find(m => normalize(m.title?.english || m.title?.romaji) === norm) || media[0];
  if (!best?.coverImage?.large) return null;
  return { poster: best.coverImage.large, match: best.title?.english || best.title?.romaji };
}

async function downloadPoster(url, slug) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return null;
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
    console.log(`⏭️  No existe ${path.basename(OUT_FILE)}, se omite`);
    return { done: true };
  }
  let ok = 0, skip = 0, fail = 0, sinceSave = 0, checked = 0;

  for (const s of db.series) {
    if (timeUp()) {
      console.log(`\n⏰ Presupuesto de tiempo agotado tras ${checked} series — se guarda y se sale (reanudable)`);
      await fs.writeFile(OUT_FILE, JSON.stringify(db), 'utf8');
      return { done: false };
    }
    checked++;

    const slug = s.slug || s.id;
    const isGood = s.image && GOOD_POSTER.test(s.image);
    if (!FORCE && (s.posterLocal || isGood)) { skip++; continue; }

    if (!FORCE && s.posterFailed) {
      const failedAt = Date.parse(s.posterFailedAt || 0) || 0;
      if ((Date.now() - failedAt) < RETRY_MS) { skip++; continue; }
    }

    const title = (s.title && s.title !== 'Temporadas') ? s.title : slug.split('-').join(' ');
    console.log(`\n🖼️  ${slug} ← buscando "${title}"`);

    /* Candidatos: español + original + traducción es→en (clave para
       AniList/TMDB, que indexan en inglés). */
    const candidates = [...new Set([title, s.originalTitle].filter(Boolean))];
    const translated = await translateTitle(title);
    if (translated && !candidates.some(c => c.toLowerCase() === translated.toLowerCase())) {
      candidates.push(translated);
    }
    let hit = null;

    for (const c of candidates) {
      hit = await searchTmdb(c, 'es-ES') || await searchTmdbMovie(c, 'en-US');
      if (hit) { console.log(`   · TMDB "${c}" → ✅ ${hit.match}`); break; }
      await sleep(150);
    }
    if (!hit) {
      for (const c of candidates) {
        hit = await searchAnilist(c);
        if (hit) { console.log(`   · AniList "${c}" → ✅ ${hit.match}`); break; }
        await sleep(650); // AniList: ~90 peticiones/minuto
      }
    }
    if (!hit) {
      console.log('   ❌ Sin resultados (se reintentará en 30 días)');
      s.posterFailed = true;
      s.posterFailedAt = new Date().toISOString();
      fail++; sinceSave++;
      if (sinceSave >= 10) { await fs.writeFile(OUT_FILE, JSON.stringify(db), 'utf8'); sinceSave = 0; }
      await sleep(400);
      continue;
    }

    const local = await downloadPoster(hit.poster, slug);
    if (!local) {
      console.log('   ❌ Descarga fallida (se reintentará en 30 días)');
      s.posterFailed = true;
      s.posterFailedAt = new Date().toISOString();
      fail++; sinceSave++;
      if (sinceSave >= 10) { await fs.writeFile(OUT_FILE, JSON.stringify(db), 'utf8'); sinceSave = 0; }
      await sleep(400);
      continue;
    }
    delete s.posterFailed;
    delete s.posterFailedAt;
    s.posterLocal = local;
    console.log(`   ✅ ${hit.match} → ${local}`);
    ok++;
    sinceSave++;
    if (sinceSave >= 10) {
      await fs.writeFile(OUT_FILE, JSON.stringify(db), 'utf8');
      sinceSave = 0;
      console.log('   💾 Checkpoint de portadas guardado');
    }
    await sleep(400);
  }

  await fs.writeFile(OUT_FILE, JSON.stringify(db), 'utf8');
  console.log(`\n========== PORTADAS (${path.basename(OUT_FILE)}) ==========`);
  console.log(`✅ Nuevas: ${ok} | ⏭️ Ya tenían: ${skip} | ❌ Fallaron: ${fail}`);
  return { done: true };
}

async function main() {
  if (!TMDB_KEY) {
    console.log('⚠️  TMDB_API_KEY no configurada: solo se buscará en AniList (menos aciertos).');
    console.log('    Crea la secret en Settings → Secrets → Actions (gratis en themoviedb.org).');
  }
  let allDone = true;
  for (const file of FILES) {
    const r = await processFile(file);
    if (!r.done) { allDone = false; break; }
  }
  // Código 3 = todo terminado · 0 = se agotó el tiempo (reanudable)
  process.exit(allDone ? 3 : 0);
}

main().catch(e => { console.error('💥', e); process.exit(1); });
