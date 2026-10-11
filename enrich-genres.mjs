#!/usr/bin/env node
// tools/enrich-genres.mjs — Enriquece los géneros del catálogo con APIs externas gratuitas.
//   · AniList (sin clave): donghua/anime → géneros + tags (Cultivation, Xianxia, Martial Arts…)
//   · TMDB  (clave gratuita, opcional): doramas y películas → géneros en español
// Escribe public/data/dfx-genres.json: { "<slug>": ["Cultivo", "Xianxia", ...] }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA_DIR, 'dfx-genres.json');
const TMDB_KEY = process.env.TMDB_API_KEY || '';
const SLEEP = ms => new Promise(r => setTimeout(r, ms));
const norm = s => String(s || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();

const TAG_MAP = {
  'Cultivation': 'Cultivo', 'Martial Arts': 'Artes marciales', 'Xianxia': 'Xianxia',
  'Wuxia': 'Wuxia', 'Gods': 'Dioses', 'Mythology': 'Mitología', 'Historical': 'Histórico',
  'Military': 'Militar', 'Supernatural': 'Sobrenatural', 'Demons': 'Demonios'
};

function indexFiles() {
  return fs.readdirSync(DATA_DIR)
    .filter(f => /^catalog-.*-(index|shard-\d+)\.json$/.test(f))
    .map(f => path.join(DATA_DIR, f));
}

async function anilistBatch(titles) {
  const body = titles.map((t, i) =>
    `s${i}: Page(perPage:1){ media(search:${JSON.stringify(t.slice(0, 70))}, type:ANIME){ title{romaji english} genres tags{name rank} } }`).join('\n');
  for (let att = 0; att < 3; att++) {
    try {
      const r = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify({ query: `query { ${body} }` })
      });
      if (r.status === 429) { await SLEEP(2000); continue; }
      if (!r.ok) throw new Error('anilist ' + r.status);
      const j = await r.json();
      return titles.map((t, i) => j.data && j.data['s' + i] && j.data['s' + i].media && j.data['s' + i].media[0] || null);
    } catch (e) { if (att === 2) return titles.map(() => null); await SLEEP(1500); }
  }
  return titles.map(() => null);
}

function anilistGenres(m, wanted) {
  if (!m) return null;
  const mt = norm(m.title && (m.title.english || m.title.romaji));
  if (!mt || (mt !== wanted && !mt.includes(wanted) && !wanted.includes(mt))) return null; // descarta coincidencias dudosas
  const g = (m.genres || []).slice(0, 6);
  for (const t of (m.tags || [])) {
    if ((t.rank || 0) >= 70 || /cultivation|xianxia|wuxia/i.test(t.name)) {
      const x = TAG_MAP[t.name] || t.name;
      if (g.indexOf(x) === -1) g.push(x);
    }
  }
  return g.length ? g : null;
}

let tmdbGenreNames = {};
async function tmdbGenres() {
  for (const type of ['tv', 'movie']) {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/genre/${type}/list?api_key=${TMDB_KEY}&language=es-ES`);
      if (r.ok) { const j = await r.json(); for (const g of j.genres || []) tmdbGenreNames[g.id] = g.name; }
    } catch (e) { /* ignora */ }
  }
}

async function tmdbSearch(title, type) {
  for (let att = 0; att < 3; att++) {
    try {
      const r = await fetch(`https://api.themoviedb.org/3/search/${type}?api_key=${TMDB_KEY}&query=${encodeURIComponent(title)}&language=es-ES&page=1`);
      if (r.status === 429) { await SLEEP(1200); continue; }
      if (!r.ok) return null;
      const j = await r.json();
      return j.results && j.results[0] || null;
    } catch (e) { if (att === 2) return null; await SLEEP(1000); }
  }
  return null;
}

function tmdbGenresOf(item, wanted) {
  if (!item) return null;
  const it = norm(item.title || item.name);
  if (!it || (it !== wanted && !it.includes(wanted) && !wanted.includes(it))) return null;
  const g = (item.genre_ids || []).map(id => tmdbGenreNames[id]).filter(Boolean).slice(0, 6);
  return g.length ? g : null;
}

const isAnimeCat = f => /donghualife|donghua|anime/.test(f);

async function main() {
  const out = {};
  const files = indexFiles();
  console.log('Archivos de índice:', files.length);
  if (TMDB_KEY) await tmdbGenres();

  for (const f of files) {
    let idx;
    try { idx = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { console.log('saltando', f); continue; }
    const rows = idx.series || [];
    const anime = isAnimeCat(path.basename(f));
    console.log(`\n== ${path.basename(f)}: ${rows.length} títulos (${anime ? 'AniList' : 'TMDB'})`);
    let matched = 0;

    if (anime) {
      const BATCH = 8;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const results = await anilistBatch(chunk.map(r => r.t));
        chunk.forEach((r, k) => {
          const g = anilistGenres(results[k], norm(r.t));
          if (g) { out[r.s || r.i] = g; matched++; }
        });
        if (Math.floor(i / BATCH) % 10 === 0) console.log(`  ${Math.min(i + BATCH, rows.length)}/${rows.length} (${matched} con género)`);
        await SLEEP(750); // límite AniList ~90 req/min
      }
    } else if (TMDB_KEY) {
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const type = (r.ty === 'movie' || /catalog-peliculas/.test(f)) ? 'movie' : 'tv';
        const item = await tmdbSearch(r.t, type);
        const g = tmdbGenresOf(item, norm(r.t));
        if (g) { out[r.s || r.i] = g; matched++; }
        if (i % 25 === 0) console.log(`  ${i + 1}/${rows.length} (${matched} con género)`);
        await SLEEP(60); // límite TMDB
      }
    } else {
      console.log('  (sin TMDB_API_KEY: se omite este catálogo)');
    }
    console.log(`  → ${matched} títulos enriquecidos`);
  }

  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log('\nEscrito', OUT, 'con', Object.keys(out).length, 'entradas');
}

main().catch(e => { console.error('FATAL', e); process.exit(1); });
