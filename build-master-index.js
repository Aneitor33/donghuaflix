// build-master-index.js — Regenera public/data/catalog-index.json
// (descubre automáticamente los catalog-*-index.json de public/data)
// ESM — el package.json del repo tiene "type": "module"
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DATA_DIR = path.join(ROOT, 'public', 'data');
const OUT_FILE = path.join(DATA_DIR, 'catalog-index.json');

const CATALOGS = [
  { id: 'dramasyt', label: 'Dramas & Series YouTube', index: 'catalog-dramasyt-index.json' },
  { id: 'doramas', label: 'Doramas', index: 'catalog-doramas-index.json' },
  { id: 'youtubefilms', label: 'YouTube Films', index: 'catalog-youtubefilms-index.json' },
  { id: 'donghualife', label: 'Donghua Life', index: 'catalog-donghualife-index.json' },
  { id: 'donghuasub', label: 'DonghuaSub', index: 'catalog-donghuasub-index.json' },
  { id: 'pelispedia', label: 'PelisPedia', index: 'catalog-pelispedia-index.json' },
];

const out = {
  version: 1,
  generatedAt: new Date().toISOString(),
  imageBase: 'https://image.tmdb.org/t/p/w300',
  catalogs: []
};

for (const cat of CATALOGS) {
  const p = path.join(DATA_DIR, cat.index);
  if (!fs.existsSync(p)) {
    console.warn(`⚠️  No existe ${cat.index} — se omite "${cat.label}"`);
    continue;
  }
  try {
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    out.catalogs.push({
      id: cat.id,
      label: cat.label,
      index: cat.index,
      series: Array.isArray(j.series) ? j.series.length : 0
    });
    console.log(`✅ ${cat.label}: ${j.series.length} títulos`);
  } catch (e) {
    console.warn(`⚠️  Error leyendo ${cat.index}: ${e.message}`);
  }
}

fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
console.log(`\n🎉 ${OUT_FILE} regenerado con ${out.catalogs.length} catálogos`);
