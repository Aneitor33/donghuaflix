// shard-pack.js — Empaqueta fichas de CUALQUIER catalog-*.json en shards
// compatibles con SHARDED_CATS de app.js. Uso:
//   node shard-pack.js catalog-pelispedia            (solo el índice lite)
//   node shard-pack.js catalog-pelispedia full       (también genera el -index.json via split-catalog si existe)
import fs from 'node:fs';
import path from 'node:path';

const NAME = process.argv[2] || 'catalog-pelispedia';
const ROOT = process.cwd();
const DATA = path.join(ROOT, 'public', 'data');
const INPUT = path.join(DATA, `${NAME}.json`);
const SHARD_COUNT = 64;

function shardIndexOf(key) {
  let h = 0;
  for (const c of String(key)) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h) % SHARD_COUNT;
}

if (!fs.existsSync(INPUT)) { console.error(`No existe ${INPUT}`); process.exit(1); }
const db = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
const dir = path.join(DATA, `${NAME}-details`);
fs.mkdirSync(dir, { recursive: true });

const seasonsBy = {}, episodesBy = {};
for (const s of db.seasons || []) (seasonsBy[s.seriesId] ||= []).push(s);
for (const e of db.episodes || []) (episodesBy[e.seriesId] ||= []).push(e);

const buckets = Array.from({ length: SHARD_COUNT },
  () => ({ series: [], seasons: [], episodes: [] }));
for (const s of db.series || []) {
  const h = shardIndexOf(String(s.slug || s.id));
  buckets[h].series.push(s);
  for (const x of seasonsBy[s.id] || []) buckets[h].seasons.push(x);
  for (const x of episodesBy[s.id] || []) buckets[h].episodes.push(x);
}

let escritos = 0, eliminados = 0;
for (let i = 0; i < SHARD_COUNT; i++) {
  const f = path.join(dir, `shard-${i}.json`);
  if (buckets[i].series.length) { fs.writeFileSync(f, JSON.stringify(buckets[i])); escritos++; }
  else if (fs.existsSync(f)) fs.rmSync(f);
}
for (const f of fs.readdirSync(dir)) {
  if (!/^shard-\d+\.json$/.test(f)) { fs.rmSync(path.join(dir, f)); eliminados++; }
}
console.log(`✅ ${escritos} shards escritos | ${eliminados} fichas sueltas eliminadas`);
console.log(`   series: ${db.series?.length ?? 0} | seasons: ${db.seasons?.length ?? 0} | episodes: ${db.episodes?.length ?? 0}`);
