// pages-build.js — Prepara el directorio de despliegue para Cloudflare Pages.
// Cloudflare rechaza archivos >25 MiB; el frontend solo necesita los
// índices LITE (*-index.json) y las fichas (*-details/), así que los
// monolitos catalog-*.json y los ficheros de trabajo del scraper se
// quedan fuera del despliegue (siguen en el repo, que es la base de datos).
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DIST = path.join(ROOT, 'dist');

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

// Nombres que NUNCA se copian (a cualquier nivel): el propio directorio de
// salida, dependencias, control de versiones, workflows y este script.
const SKIP_NAMES = new Set(['dist', 'node_modules', '.git', '.github', 'pages-build.js']);

const isMonolith = rel =>
  /public[/\\]data[/\\]catalog-[^/\\]+\.json$/.test(rel) &&
  !rel.endsWith('-index.json');

function copyRecursive(src, dst, rel = '') {
  const base = path.basename(src);
  if (SKIP_NAMES.has(base)) return;

  const st = fs.statSync(src);
  const relPath = rel ? `${rel}/${base}` : base;

  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dst, item), relPath);
    }
    return;
  }

  // Monolitos y ficheros internos del scraper: nunca se despliegan
  if (isMonolith(relPath) || /catalog-dramasflix(-raws|-pattern|-failures)/.test(relPath)) {
    console.log('[pages-build] omitido:', relPath);
    return;
  }
  // Cualquier otro JSON de datos que supere 24 MiB tampoco se despliega
  if (relPath.startsWith('public/data/') && relPath.endsWith('.json') && st.size > 24 * 1024 * 1024) {
    console.log('[pages-build] omitido (>24MiB):', relPath);
    return;
  }

  fs.copyFileSync(src, dst);
}

copyRecursive(ROOT, DIST);
console.log('[pages-build] dist/ listo');
