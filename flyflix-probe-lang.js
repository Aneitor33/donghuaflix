// flyflix-probe-lang.js — Detecta capacidades de idioma de cada servidor embed
// Para cada servidor activo del config, descarga el embed de una película
// conocida y busca señales de subtítulos/audio en español.
//
// Uso:  node flyflix-probe-lang.js
// Salida: informe por consola + probe-idiomas.json
import fs from 'node:fs';

const TEST_ID = 969681;   // Spider-Man: Brand New Day (del sitemap de flyflix)

// Lee servidores del config YAML (parseo simple, sin dependencias)
function leerServidores() {
  const yml = fs.readFileSync('flyflix_config.yml', 'utf8');
  const servidores = [];
  const bloques = yml.split(/^  - nombre: /m).slice(1);
  for (const b of bloques) {
    const get = (k) => {
      const m = b.match(new RegExp(`^    ${k}: "?(.*?)"?$`, 'm'));
      return m ? m[1] : null;
    };
    servidores.push({
      nombre: b.split('\n')[0].trim(),
      dominio: get('dominio'),
      movie: get('movie'),
      activo: !/activo: false/.test(b),
    });
  }
  return servidores.filter(s => s.activo && s.dominio);
}

const PATRONES = {
  'subs-es-vtt':     /\.vtt[^"']*|srclang=["']?es|label=["']?(spanish|español)/i,
  'subs-genericos':  /subtitle|captions|tracks?["':]/i,
  'audio-latino':    /latino|castellano|dub[^"']*es|audio.*es/i,
  'selector-lang':   /lang(ua)?ge?["' ]*selector|set.*language|audio.?track/i,
};

const informe = [];
for (const srv of leerServidores()) {
  const url = srv.dominio + srv.movie.replace('{id}', TEST_ID);
  const entry = { servidor: srv.nombre, url, senales: [], html_bytes: 0, error: null };
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0' },
      signal: AbortSignal.timeout(20000),
    });
    entry.http = res.status;
    const html = await res.text();
    entry.html_bytes = html.length;
    for (const [senal, re] of Object.entries(PATRONES)) {
      if (re.test(html)) entry.senales.push(senal);
    }
    // Busca listas de subtítulos en JSON embebido (patrón típico: [{file,label}])
    const subs = html.match(/\{[^{}]*(?:file|src)[^{}]*label[^{}]*\}/gi) || [];
    entry.pistas_subs = subs.slice(0, 10);
    entry.spanish_subs = (html.match(/spanish|español|spa["' ,}\]]/gi) || []).length;
  } catch (e) {
    entry.error = e.message;
  }
  informe.push(entry);
  console.log(`${entry.error ? '❌' : '✅'} ${srv.nombre.padEnd(16)} HTTP ${entry.http ?? '--'} ` +
    `(${entry.html_bytes} B) señales: ${entry.senales.join(', ') || 'ninguna'}` +
    (entry.spanish_subs ? ` · ${entry.spanish_subs} menciones "spanish"` : ''));
  await new Promise(r => setTimeout(r, 1500));
}

fs.writeFileSync('probe-idiomas.json', JSON.stringify(informe, null, 2));
console.log('\n📄 Detalle en probe-idiomas.json');
console.log('⚠️  Nota: este análisis es estático (HTML del embed). Muchos players');
console.log('   cargan los subtítulos por API al reproducir — la señal real se');
console.log('   confirma abriendo el video y revisando el menú de CC/audio.');
