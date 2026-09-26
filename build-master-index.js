/* Regenera public/data/catalog-index.json como INDICE MAESTRO ligero.
   Anadir al final de cada workflow de sincronizacion:
     node build-master-index.js && git add -A public/data && git commit -m "index maestro" && git push
*/
const fs = require('fs');
const path = require('path');

const CATALOGS = [
  { id: 'donghualife', label: 'DonghuaLife', index: 'catalog-donghualife-index.json' },
  { id: 'donghuasub',  label: 'DonghuaSub',  index: 'catalog-donghuasub-index.json' },
  { id: 'donghuacli',  label: 'DonghuaCLI',  index: 'catalog-donghuacli-index.json' },
  { id: 'dramasyt',    label: 'DramasYT',    index: 'catalog-dramasyt-index.json' },
  { id: 'peliculas',   label: 'Peliculas',   index: 'catalog-peliculas-index.json' },
  { id: 'doramas',     label: 'Doramas',     index: 'catalog-doramas-index.json' }
];

const dir = path.join(__dirname, 'public', 'data');
let imageBase = '';
const catalogs = [];

for (const c of CATALOGS) {
  const p = path.join(dir, c.index);
  if (!fs.existsSync(p)) { console.log('sin indice:', c.index); continue; }
  try {
    const idx = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!imageBase && idx.imageBase) imageBase = idx.imageBase;
    catalogs.push({ id: c.id, label: c.label, index: c.index, series: Array.isArray(idx.series) ? idx.series.length : 0 });
  } catch (e) { console.log('no legible:', c.index); }
}

const out = { version: 1, generatedAt: new Date().toISOString(), imageBase, catalogs };
fs.writeFileSync(path.join(dir, 'catalog-index.json'), JSON.stringify(out));
console.log('catalog-index.json:', catalogs.length, 'catalogos');
