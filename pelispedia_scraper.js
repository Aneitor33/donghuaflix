// ══════════════════════════════════════════════════════════
//  pelispedia_scraper.js — Scraper completo de pelispedia.mov
//  Reemplaza al scraper de flyflix. Sin API key (metadatos del
//  propio sitio). Fases:
//    --discover      Playwright: detecta PLANTILLAS de servidor
//    --fase=datos    sitemaps → detalles + temporadas/episodios
//    --fase=servers  URLs de servidor por episodio (patrón o PW)
//  Reanudación, checkpoints, --max, workers.
//  Salida: public/data/catalog-pelispedia.json (formato DonghuaFlix)
// ══════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';

const ROOT = process.cwd();
const SITE = 'https://pelispedia.mov';
const DATA = path.join(ROOT, 'public', 'data');
const OUT = path.join(DATA, 'catalog-pelispedia.json');
const PARTIAL = OUT + '.partial';
const DISCOVERY_FILE = 'pelispedia_discovery.json';

const args = process.argv.slice(2);
const FASE = (args.find(a => a.startsWith('--fase=')) || '').split('=')[1]
          || (args.includes('--discover') ? 'discover' : null);
const MAX = Number((args.find(a => a.startsWith('--max=')) || '').split('=')[1] || 0);
const WORKERS = Number((args.find(a => a.startsWith('--workers=')) || '').split('=')[1] || 12);
const PW_WORKERS = Number((args.find(a => a.startsWith('--pw-workers=')) || '').split('=')[1] || 4);
const DESDE_CERO = args.includes('--desde-cero');
const MUESTRA = Number((args.find(a => a.startsWith('--muestra=')) || '').split('=')[1] || 3);

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const clean = s => (s || '').replace(/\s+/g, ' ').trim();
const slugOf = url => { try { return new URL(url).pathname.split('/').filter(Boolean).pop() || url; } catch { return url; } };
const now = () => new Date().toISOString();

// ───────────── HTTP con reintentos ─────────────
async function fetchHtml(url, intentos = 4) {
  for (let i = 1; i <= intentos; i++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es-ES,es;q=0.9' }, redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) { await sleep(1500 * i); continue; }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.text();
    } catch (e) {
      if (i === intentos) throw e;
      await sleep(1000 * i);
    }
  }
  throw new Error(`fetch falló: ${url}`);
}

// pool de concurrencia simple
async function pool(items, n, fn) {
  const cola = [...items];
  const errs = [];
  await Promise.all(Array.from({ length: Math.min(n, cola.length) }, async () => {
    while (cola.length) {
      const it = cola.shift();
      try { await fn(it); } catch (e) { errs.push(`${it}: ${e.message}`); }
    }
  }));
  return errs;
}

// ───────────── utilidades cheerio ─────────────
function abs(href, base = SITE) {
  try { if (!href || /^(javascript|mailto|tel):/i.test(href)) return null; return new URL(href, base).href; }
  catch { return null; }
}
function meta($, sel) { return clean($(sel).attr('content') || ''); }
function posterOf($, url) {
  const og = abs(meta($, 'meta[property="og:image"]') || meta($, 'meta[name="twitter:image"]'), url);
  if (og) return og;
  for (const el of $('img').toArray()) {
    const s = abs($(el).attr('data-src') || $(el).attr('src'), url);
    if (s && /tmdb|image\.tmdb|poster|cover/i.test(s)) return s;
  }
  return null;
}
// JSON embebido de frameworks (Next/Nuxt) si existe
function embeddedJson($) {
  for (const id of ['__NEXT_DATA__', '__NUXT_DATA__', '__NUXT__']) {
    const el = $(`#${id}`).first();
    if (el.length) { try { return JSON.parse(el.html()); } catch { /* continue */ } }
  }
  let found = null;
  $('script[type="application/ld+json"]').each((_, e) => {
    if (found) return;
    try { const j = JSON.parse($(e).html()); const o = Array.isArray(j) ? j[0] : j; if (o && (o['@type'] === 'Movie' || o['@type'] === 'TVSeries' || o.name)) found = o; } catch { }
  });
  return found;
}
function walkStrings(node, out = []) {
  if (node == null) return out;
  if (typeof node === 'string') { if (/^https?:\/\//.test(node) || /\.(m3u8|mp4)(\?|$)/.test(node)) out.push(node); return out; }
  if (Array.isArray(node)) { node.forEach(x => walkStrings(x, out)); return out; }
  if (typeof node === 'object') { for (const k of Object.keys(node)) walkStrings(node[k], out); }
  return out;
}

// ───────────── parseo: página de detalle (película o serie) ─────────────
function parseDetalle(html, url, tipo) {
  const $ = cheerio.load(html);
  const json = embeddedJson($) || {};
  const title = clean($('h1').first().text()) || meta($, 'meta[property="og:title"]')
             || clean(json.name) || clean($('title').text()).replace(/\s*[-|].*$/, '');
  let synopsis = meta($, 'meta[property="og:description"]') || meta($, 'meta[name="description"]')
              || clean(json.description) || '';
  synopsis = synopsis.replace(/^Disfruta de (esta|la) (serie|película)[^.\n]*\.\s*/i, '').trim();
  const text = clean($('body').text());
  const year = (text.match(/\b(19|20)\d{2}(?:-\d{2}-\d{2})?\b/) || [])[0]?.slice(0, 4) || null;
  const rating = (text.match(/(\d{1,2}(?:[.,]\d+)?)\s*\/\s*10/) || [])[1]?.replace(',', '.') || null;
  const genres = [];
  $('a[href*="/genero"], a[href*="/genre"], [class*="genre"] a').each((_, e) => {
    const g = clean($(e).text()); if (g && g.length < 30 && !genres.includes(g)) genres.push(g);
  });
  if (!genres.length && json.genre) {
    const gs = Array.isArray(json.genre) ? json.genre : [json.genre];
    gs.forEach(g => { const t = typeof g === 'string' ? g : g.name; if (t) genres.push(t); });
  }
  const poster = posterOf($, url) || clean(json.image) || null;
  const slug = slugOf(url);
  const base = { id: slug, slug, title, image: poster, synopsis: synopsis || null,
                 status: null, country: null, genres,
                 totalEpisodes: null, sourceUrl: url, type: 'pelispedia',
                 contentType: tipo === 'movie' ? 'movie' : 'series',
                 year: year ? Number(year) : null, rating: rating ? Number(rating) : null,
                 updatedAt: now() };
  // series: enlaces de temporadas y capítulos
  const seasons = new Map();   // numero -> {url, capitulos: Map}
  $('a[href*="/temporada/"]').each((_, e) => {
    const h = abs($(e).attr('href'), url); if (!h) return;
    const m = h.match(/\/temporada\/(\d+)/); if (!m) return;
    const n = Number(m[1]);
    if (!seasons.has(n)) seasons.set(n, { url: h, capitulos: new Map() });
  });
  $('a[href*="/capitulo/"]').each((_, e) => {
    const h = abs($(e).attr('href'), url); if (!h) return;
    const m = h.match(/\/temporada\/(\d+)\/capitulo\/(\d+)/); if (!m) return;
    const sn = Number(m[1]), en = Number(m[2]);
    if (!seasons.has(sn)) seasons.set(sn, { url: h.replace(/\/capitulo\/\d+.*$/, ''), capitulos: new Map() });
    seasons.get(sn).capitulos.set(en, { url: h, number: en, title: `Capítulo ${en}` });
  });
  return { base, seasons };
}

// ───────────── catálogo (db) con reanudación ─────────────
function nuevoDb() {
  return { meta: {}, series: [], seasons: [], episodes: [], genres: [] };
}
function cargarDb() {
  if (DESDE_CERO && fs.existsSync(PARTIAL)) fs.rmSync(PARTIAL);
  if (fs.existsSync(PARTIAL)) {
    try { return JSON.parse(fs.readFileSync(PARTIAL, 'utf8')); } catch { }
  }
  return nuevoDb();
}
function guardar(db) {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(PARTIAL, JSON.stringify(db));
}
const porId = (arr) => new Map(arr.map(x => [x.id, x]));

// ───────────── JS PASS: enlaces de temporada/capitulo renderizados ─────────────
async function jsPassSeries(db, workers) {
  const pend = db.series.filter(s => s.contentType === 'series'
    && !db.seasons.some(x => x.seriesId === s.id));
  if (!pend.length) return 0;
  console.log(`▶ JS PASS: ${pend.length} series sin temporadas (Playwright, ${workers} workers)`);
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] });
  const cola = [...pend];
  let hechos = 0;
  await Promise.all(Array.from({ length: Math.min(workers, cola.length) }, async () => {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'es-ES' });
    const page = await ctx.newPage();
    while (cola.length) {
      const s = cola.shift();
      try {
        await page.goto(s.sourceUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(2500);
        const enlaces = await page.evaluate(() =>
          [...document.querySelectorAll('a[href]')]
            .map(a => a.getAttribute('href'))
            .filter(h => /\/temporada\/\d+/.test(h)));
        const seasons = new Map();
        for (const h of enlaces) {
          const m = h.match(/\/temporada\/(\d+)(?:\/capitulo\/(\d+))?/);
          if (!m) continue;
          const sn = Number(m[1]);
          if (!seasons.has(sn)) seasons.set(sn, new Map());
          if (m[2]) {
            const en = Number(m[2]);
            seasons.get(sn).set(en, { url: new URL(h, location.href).href, number: en, title: `Capítulo ${en}` });
          }
        }
        // si hay temporadas sin capítulos visibles, registrar la temporada con su URL base
        for (const [sn] of seasons) {
          const sid = `${s.id}-${sn}`;
          if (!db.seasons.some(x => x.id === sid)) {
            const baseUrl = enlaces.find(h => new RegExp(`\\/temporada\\/${sn}($|[^0-9])`).test(h));
            db.seasons.push({ id: sid, slug: sid, seriesId: s.id,
              sourceUrl: baseUrl ? new URL(baseUrl, s.sourceUrl).href : s.sourceUrl,
              number: sn, image: s.image, episodeCount: seasons.get(sn).size,
              initialSyncComplete: true, updatedAt: now() });
          }
          for (const [en, cap] of seasons.get(sn)) {
            const eid = `${s.id}-${sn}x${en}`;
            if (!db.episodes.some(e => e.id === eid))
              db.episodes.push({ id: eid, slug: eid, title: cap.title, sourceUrl: cap.url,
                                 servers: [], seriesId: s.id, seasonId: sid, number: en, updatedAt: now() });
          }
        }
        if (seasons.size) hechos++;
      } catch (e) { console.log(`  ⚠️ jsPass ${s.slug}: ${e.message}`); }
    }
    await ctx.close();
  }));
  await browser.close();
  console.log(`✔ jsPass: ${hechos} series con temporadas detectadas`);
  return hechos;
}

// ───────────── FASE: DISCOVER ─────────────
const SERVER_HINT = /embed|stream|play|player|m3u8|\.mp4|video|server|servidor|ok\.ru|dood|mixdrop|filemoon|vidmoly|streamtape|voe|mp4upload|uqload/i;

async function extraerServidoresPlaywright(urls, workers) {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'],
  });
  const resultados = [];
  const cola = [...urls];
  await Promise.all(Array.from({ length: Math.min(workers, cola.length) }, async () => {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'es-ES' });
    const page = await ctx.newPage();
    while (cola.length) {
      const url = cola.shift();
      const hits = new Set();
      try {
        page.on('response', r => { const u = r.url(); if (SERVER_HINT.test(u) && !u.includes('pelispedia.mov')) hits.add(u); });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForTimeout(4000);
        // iframes
        for (const fr of page.frames()) {
          const u = fr.url();
          if (u.startsWith('http') && !u.includes('pelispedia.mov')) hits.add(u);
        }
        // DOM: enlaces/botones con nombre o URL de servidor
        const domHits = await page.evaluate(() => {
          const out = [];
          document.querySelectorAll('a[href],button,[data-url],[data-src],[data-server]').forEach(el => {
            const u = el.getAttribute('href') || el.getAttribute('data-url') || el.getAttribute('data-src') || el.getAttribute('data-server') || '';
            const t = (el.textContent || '').trim();
            if (/embed|stream|play|ok\.ru|dood|mixdrop|filemoon|vidmoly|voe|mp4upload|uqload|server|servidor/i.test(u + ' ' + t)) {
              if (u && u.startsWith('http')) out.push(u);
              else if (el.tagName === 'IFRAME') out.push(u);
            }
          });
          document.querySelectorAll('iframe[src]').forEach(el => out.push(el.getAttribute('src')));
          return out.filter(Boolean);
        });
        domHits.forEach(u => { if (/^https?:/.test(u)) hits.add(u); });
      } catch (e) {
        console.log(`  ⚠️ muestra ${url}: ${e.message}`);
      }
      resultados.push({ url, hits: [...hits] });
      console.log(`  🔍 ${slugOf(url)}: ${hits.size} candidatos`);
    }
    await ctx.close();
  }));
  await browser.close();
  return resultados;
}

// convierte URLs concretas en plantillas {slug}/{temp}/{ep}
function aPlantilla(u, ctx) {
  let t = u;
  if (ctx.slug) t = t.split(ctx.slug).join('{slug}');
  if (ctx.temporada) t = t.split(`/${ctx.temporada}/`).join('/{t}/');
  if (ctx.capitulo) t = t.split(`/${ctx.capitulo}`).join('/{e}').split(`/${ctx.capitulo}/`).join('/{e}/');
  t = t.replace(/([?&](?:ep|episode|cap|e)=\d+)/gi, m => m.replace(/\d+/, '{e}'))
       .replace(/([?&](?:season|temporada|s)=\d+)/gi, m => m.replace(/\d+/, '{t}'));
  return t;
}

async function faseDiscover(db) {
  console.log('▶ DISCOVER: analizando páginas muestra con Playwright...');
  const movies = db.series.filter(s => s.contentType === 'movie').slice(0, MUESTRA);
  const series = db.series.filter(s => s.contentType === 'series').slice(0, MUESTRA);
  const eps = db.episodes.filter(e => series.some(s => s.id === e.seriesId)).slice(0, MUESTRA);
  const muestras = [
    ...movies.map(m => ({ url: m.sourceUrl, tipo: 'movie', slug: m.slug })),
    ...eps.map(e => {
      const s = db.series.find(x => x.id === e.seriesId);
      const m = e.sourceUrl.match(/\/temporada\/(\d+)\/capitulo\/(\d+)/);
      return { url: e.sourceUrl, tipo: 'episode', slug: s ? s.slug : null,
               temporada: m ? m[1] : null, capitulo: m ? m[2] : null };
    }),
  ];
  if (!muestras.length) {
    console.log('⚠️ catálogo vacío: usando URLs de muestra conocidas');
    muestras.push(
      { url: `${SITE}/pelicula/clayface-tZ92Wp`, tipo: 'movie', slug: 'clayface-tZ92Wp' },
      { url: `${SITE}/serie/the-new-stanford-prison-experi-nzmr6U/temporada/1/capitulo/1`,
        tipo: 'episode', slug: 'the-new-stanford-prison-experi-nzmr6U', temporada: '1', capitulo: '1' });
  }
  const res = await extraerServidoresPlaywright(muestras.map(m => m.url), PW_WORKERS);
  // adjuntar ctx a cada resultado
  const conCtx = res.map((r, i) => ({ ...r, ...muestras[i] }));
  // candidatos externos (fuera de pelispedia.mov)
  const externos = conCtx.flatMap(r => r.hits.filter(u => !u.includes('pelispedia.mov')));
  const plantillas = {};
  for (const r of conCtx) {
    for (const u of r.hits) {
      if (u.includes('pelispedia.mov')) continue;
      const t = aPlantilla(u, r);
      const clave = `${r.tipo}`;
      plantillas[clave] = plantillas[clave] || {};
      plantillas[clave][t] = (plantillas[clave][t] || 0) + 1;
    }
  }
  const discovery = {
    fecha: now(),
    muestras: conCtx.map(r => ({ url: r.url, tipo: r.tipo, hits: r.hits.slice(0, 20) })),
    plantillas: Object.fromEntries(Object.entries(plantillas).map(([k, v]) => [k,
      Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([t, n]) => ({ plantilla: t, veces: n }))])),
  };
  fs.writeFileSync(DISCOVERY_FILE, JSON.stringify(discovery, null, 2));
  console.log(`✅ Descubrimiento guardado en ${DISCOVERY_FILE}`);
  console.log(JSON.stringify(discovery.plantillas, null, 2).slice(0, 2000));
}

// ───────────── LISTADOS: páginas de catálogo (el sitemap está capado a 1000) ─────────────
async function urlsDeListados() {
  const out = { movie: new Set(), series: new Set() };
  const secciones = [
    { path: '/peliculas', tipo: 'movie' },
    { path: '/series', tipo: 'series' },
    { path: '/animes', tipo: 'series', alt: '/anime' },
  ];
  for (const sec of secciones) {
    let base = sec.path, html;
    try {
      html = await fetchHtml(`${SITE}${base}?page=1`);
    } catch (e) {
      if (!sec.alt) { console.log(`  ⚠️ listado ${base}: ${e.message}`); continue; }
      base = sec.alt;
      try { html = await fetchHtml(`${SITE}${base}?page=1`); }
      catch (e2) { console.log(`  ⚠️ listado ${base}: ${e2.message}`); continue; }
    }
    const total = Number((html.match(/P[aá]gina\s*1\s*(?:de|of)\s*(\d+)/i) || [])[1] || 1);
    console.log(`  📑 ${base}: ${total} páginas de listado`);
    const paginas = Array.from({ length: Math.min(total, 600) }, (_, i) => i + 1);
    await pool(paginas, 8, async p => {
      const h = p === 1 ? html : await fetchHtml(`${SITE}${base}?page=${p}`);
      const $ = cheerio.load(h);
      $('a[href*="/pelicula/"], a[href*="/serie/"]').each((_, e) => {
        const u = abs($(e).attr('href'), SITE);
        if (!u) return;
        const limpio = u.split('?')[0].split('#')[0];
        if (limpio.includes('/pelicula/')) out.movie.add(limpio);
        else if (limpio.includes('/serie/')) out.series.add(limpio);
      });
    });
  }
  return { movie: [...out.movie], series: [...out.series] };
}

// ───────────── FASE: DATOS (sitemap + detalles) ─────────────
async function urlsDeSitemap(tipo) {
  const xml = await fetchHtml(`${SITE}/sitemap/${tipo}`);
  const $ = cheerio.load(xml, { xmlMode: true });
  return $('loc').map((_, e) => clean($(e).text())).get()
    .filter(u => u.startsWith(SITE));
}

async function faseDatos(db) {
  const seriesHechas = porId(db.series);
  console.log('▶ Descargando sitemaps...');
  const urls = { movie: [], series: [], anime: [] };
  for (const t of ['movies', 'series', 'animes']) {
    try {
      const us = await urlsDeSitemap(t);
      const clave = t === 'movies' ? 'movie' : 'series';
      urls[clave].push(...us);
      console.log(`  ✔ sitemap/${t}: ${us.length} URLs`);
    } catch (e) { console.log(`  ⚠️ sitemap/${t}: ${e.message}`); }
  }
  urls.series = [...new Set(urls.series)]; urls.movie = [...new Set(urls.movie)];
  console.log('▶ Rastreando páginas de listado (sitemaps capados a 1000)...');
  const listados = await urlsDeListados();
  const antes = { movie: urls.movie.length, series: urls.series.length };
  urls.movie = [...new Set([...urls.movie, ...listados.movie])];
  urls.series = [...new Set([...urls.series, ...listados.series])];
  console.log(`  ✔ listados: +${urls.movie.length - antes.movie} películas, +${urls.series.length - antes.series} series`);
  const pendientes = [
    ...urls.movie.map(u => ({ url: u, tipo: 'movie' })),
    ...urls.series.map(u => ({ url: u, tipo: 'series' })),
  ].filter(it => !seriesHechas.has(slugOf(it.url)));
  console.log(`▶ ${pendientes.length} títulos pendientes (${WORKERS} workers HTTP)`);
  let hechos = 0, fallos = 0;
  const lista = MAX ? pendientes.slice(0, MAX) : pendientes;
  await pool(lista, WORKERS, async ({ url, tipo }) => {
    const html = await fetchHtml(url);
    const { base, seasons } = parseDetalle(html, url, tipo);
    seriesHechas.set(base.id, base);
    const idx = db.series.findIndex(s => s.id === base.id);
    if (idx === -1) db.series.push(base); else db.series[idx] = base;
    if (tipo === 'movie') {
      const sid = `${base.id}-1`, eid = `${base.id}-pelicula`;
      if (!db.seasons.some(s => s.id === sid))
        db.seasons.push({ id: sid, slug: sid, seriesId: base.id, sourceUrl: url, number: 1,
                          image: base.image, episodeCount: 1, initialSyncComplete: true, updatedAt: now() });
      if (!db.episodes.some(e => e.id === eid))
        db.episodes.push({ id: eid, slug: eid, title: base.title, sourceUrl: url,
                           servers: [], seriesId: base.id, seasonId: sid, number: 1, updatedAt: now() });
    }
    if (tipo === 'series') {
      for (const g of base.genres) if (!db.genres.includes(g)) db.genres.push(g);
      // temporada principal: recoge capítulos de su propia página si no salieron
      for (const [n, st] of seasons) {
        const sid = `${base.id}-${n}`;
        const season = { id: sid, slug: sid, seriesId: base.id, sourceUrl: st.url,
                         number: n, image: base.image, episodeCount: st.capitulos.size,
                         initialSyncComplete: true, updatedAt: now() };
        const sidx = db.seasons.findIndex(s => s.id === sid);
        if (sidx === -1) db.seasons.push(season); else db.seasons[sidx] = season;
        for (const [en, cap] of st.capitulos) {
          const eid = `${base.id}-${n}x${en}`;
          const ep = { id: eid, slug: eid, title: cap.title, sourceUrl: cap.url,
                         servers: [], seriesId: base.id, seasonId: sid, number: en, updatedAt: now() };
          const eidx = db.episodes.findIndex(x => x.id === eid);
          if (eidx === -1) db.episodes.push(ep); else if (!db.episodes[eidx].servers.length) db.episodes[eidx] = ep;
        }
      }
    }
    if (++hechos % 25 === 0) { guardar(db); console.log(`  💾 ${hechos}/${lista.length} (parcial)`); }
  });
  fallos = lista.length - hechos;
  console.log(`✔ datos: ${hechos} procesados, ${fallos} fallos`);
  await jsPassSeries(db, PW_WORKERS);
  const restantes = pendientes.length - lista.length;
  db.meta._restantesDatos = restantes;
  console.log(`PENDIENTES_DATOS:${restantes}`);
}

// ───────────── FASE: SERVERS ─────────────
function plantillasDe(tipo, discovery) {
  return (discovery.plantillas?.[tipo] || []).filter(p => p.veces >= 1).map(p => p.plantilla);
}
function aplicarPlantilla(t, { slug, temporada, capitulo }) {
  return t.replaceAll('{slug}', slug).replaceAll('{t}', String(temporada || 1)).replaceAll('{e}', String(capitulo || 1));
}

async function faseServers(db, discovery) {
  const eps = db.episodes.filter(e => !e.servers.length);
  const movies = db.series.filter(s => s.contentType === 'movie');
  console.log(`▶ servers: ${eps.length} episodios sin servidores, ${movies.length} películas`);
  const pMovie = plantillasDe('movie', discovery);
  const pEp = plantillasDe('episode', discovery);
  let hechos = 0;

  if (pMovie.length) {
    console.log('  ⚡ modo plantilla (películas): ' + pMovie[0]);
    for (const m of movies) {
      const sid = `${m.id}-pelicula`;
      const ep = { id: sid, slug: sid, title: m.title, sourceUrl: m.sourceUrl,
                   servers: pMovie.map((t, i) => ({ name: `Servidor ${i + 1}`, url: aplicarPlantilla(t, { slug: m.slug }), embed: true })),
                   seriesId: m.id, seasonId: `${m.id}-1`, number: 1, updatedAt: now() };
      const idx = db.episodes.findIndex(x => x.id === sid);
      if (idx === -1) db.episodes.push(ep); else db.episodes[idx] = ep;
      if (++hechos % 50 === 0) guardar(db);
    }
    // seasons ficticia para películas
    for (const m of movies) {
      const sid = `${m.id}-1`;
      if (!db.seasons.some(s => s.id === sid)) {
        db.seasons.push({ id: sid, slug: sid, seriesId: m.id, sourceUrl: m.sourceUrl, number: 1,
                          image: m.image, episodeCount: 1, initialSyncComplete: true, updatedAt: now() });
      }
    }
  }
  if (pEp.length) {
    console.log('  ⚡ modo plantilla (episodios): ' + pEp[0]);
    for (const e of eps) {
      const m = e.sourceUrl.match(/\/temporada\/(\d+)\/capitulo\/(\d+)/);
      const s = db.series.find(x => x.id === e.seriesId);
      e.servers = pEp.map((t, i) => ({ name: `Servidor ${i + 1}`,
        url: aplicarPlantilla(t, { slug: s ? s.slug : '', temporada: m ? m[1] : 1, capitulo: m ? m[2] : 1 }), embed: true }));
      e.updatedAt = now();
      if (++hechos % 200 === 0) { guardar(db); console.log(`  💾 ${hechos} episodios servidores`); }
    }
  } else {
    // modo Playwright página a página
    console.log('  🐢 sin plantilla: Playwright página a página...');
    const pend = db.episodes.filter(e => !e.servers.length);
    const lista = MAX ? pend.slice(0, MAX) : pend;
    const res = await extraerServidoresPlaywright(lista.map(e => e.sourceUrl), PW_WORKERS);
    for (let i = 0; i < lista.length; i++) {
      const hits = res[i].hits.filter(u => !u.includes('pelispedia.mov'));
      lista[i].servers = hits.map((u, k) => ({ name: `Servidor ${k + 1}`, url: u, embed: true }));
      lista[i].updatedAt = now();
      if (++hechos % 50 === 0) guardar(db);
    }
  }
  guardar(db);
  console.log(`✔ servers aplicados a ${hechos} entradas`);
}

// ───────────── main ─────────────
async function main() {
  if (!FASE) {
    console.log('Uso: node pelispedia_scraper.js --fase=datos|--fase=servers|--discover [--max=N] [--workers=N]');
    process.exit(1);
  }
  const db = cargarDb();
  console.log(`♻️  catálogo parcial: ${db.series.length} series | ${db.seasons.length} seasons | ${db.episodes.length} episodes`);

  if (FASE === 'discover') { await faseDiscover(db); }
  else if (FASE === 'datos') { await faseDatos(db); }
  else if (FASE === 'servers') {
    const discovery = fs.existsSync(DISCOVERY_FILE) ? JSON.parse(fs.readFileSync(DISCOVERY_FILE, 'utf8')) : null;
    if (!discovery) { console.log('⚠️ Ejecuta --discover primero'); process.exit(1); }
    await faseServers(db, discovery);
  } else { console.log('Fase desconocida: ' + FASE); process.exit(1); }

  const restantesDatos = db.meta._restantesDatos ?? null;
  const epsSinServers = db.episodes.filter(e => !e.servers.length).length;
  guardar(db);
  const datosListos = restantesDatos === null ? db.series.length > 0 : restantesDatos === 0;
  if (datosListos && epsSinServers === 0 && db.series.length > 0) {
    db.meta = { version: 1, source: SITE, catalogTag: 'pelispedia',
                syncedAt: now(), lastSync: { status: 'success', startedAt: now(), finishedAt: now(), error: null },
                items: db.series.length };
    fs.mkdirSync(DATA, { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(db));
    fs.rmSync(PARTIAL);
    console.log(`✅ CATÁLOGO COMPLETO: ${OUT}`);
    console.log(`   series: ${db.series.length} | seasons: ${db.seasons.length} | episodes: ${db.episodes.length}`);
    console.log('PENDIENTES:0');
  } else {
    const falta = !datosListos ? `faltan ${restantesDatos} títulos del sitemap`
                               : `${epsSinServers} episodios sin servidores`;
    console.log(`⏸️  CHUNK PAUSADO: ${falta} (reanudable)`);
    console.log(`PENDIENTES:${!datosListos ? restantesDatos : epsSinServers}`);
  }
}

main().catch(e => { console.error('💥', e.message); process.exit(1); });
