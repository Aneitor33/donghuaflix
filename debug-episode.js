#!/usr/bin/env node
/**
 * debug-episode.js — v3: ¿DÓNDE está el player ahora?
 * - Vuelca TODOS los <a> con href de la página de episodio (texto + URL)
 * - Vuelca el texto visible completo (zona del reproductor / muros)
 * - Cabeceras de la respuesta RSC de 71 bytes
 * - Prueba la ruta /browser
 */
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const PROXY_URL = (process.env.FLIX_PROXY_URL || '').replace(/\/+$/, '');
const PROXY_KEY = process.env.FLIX_PROXY_KEY || '';
const PROXY_HOSTS = (process.env.FLIX_PROXY_HOSTS || 'doramasia.com,www.doramasia.com')
  .split(',').map(s => s.trim()).filter(Boolean);
const EP_URL = process.env.DEBUG_EPISODE_URL ||
  'https://doramasia.com/capitulos/is-there-equation-in-love-1x3';

console.log(`🔍 Diagnóstico v3 de ${EP_URL}`);

const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'es-ES'
});
const page = await ctx.newPage();

/* Cabeceras de cada respuesta del documento (para el RSC de 71 bytes) */
page.on('response', res => {
  const u = res.url();
  if (u.split('?')[0] !== EP_URL.split('?')[0]) return;
  const h = {};
  ['content-type', 'location', 'x-middleware-rewrite', 'x-nextjs-prerender'].forEach(k => {
    const v = res.headers()[k]; if (v) h[k] = v;
  });
  res.text().then(t => {
    console.log(`   [doc-response] ${res.status()} | ${t.length} bytes | ${JSON.stringify(h)}`);
    if (t.length < 300) console.log(`     cuerpo: ${t}`);
  }).catch(() => {});
});

await page.goto(EP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(6000);

/* 1) Todos los enlaces: texto + href */
const links = await page.$$eval('a[href]', els =>
  els.map(e => ({ t: (e.textContent || '').trim().slice(0, 60), h: e.href }))
     .filter(x => x.h && !x.h.includes('_next') && !x.h.startsWith('javascript'))
);
console.log(`\n1) Enlaces en la página (${links.length}):`);
const seen = new Set();
for (const l of links) {
  const k = l.h;
  if (seen.has(k)) continue;
  seen.add(k);
  console.log(`   "${l.t}" → ${l.h}`);
  if (seen.size > 45) { console.log('   …(truncado)'); break; }
}

/* 2) Texto visible completo (recortado) — busca muros de login/VIP */
const bodyText = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'));
console.log(`\n2) Texto visible (${bodyText.length} chars), primeros 2000:`);
console.log(bodyText.slice(0, 2000));
const walls = [];
for (const m of bodyText.matchAll(/.{0,60}(inicia sesi|iniciar sesi|registrate|regístrate|crea tu cuenta|premium|vip|suscripci|miembro|acceso).{0,60}/gi)) {
  walls.push(m[0].replace(/\n/g, ' '));
}
console.log(`\n   Frases de muro/login encontradas: ${walls.length}`);
walls.slice(0, 8).forEach(w => console.log(`   → "${w}"`));

/* 3) Iframes y objetos embed */
const frames = await page.$$eval('iframe, embed, object, video', els =>
  els.map(e => e.src || e.data || '(sin src)'));
console.log(`\n3) iframe/embed/object/video en DOM: ${frames.length}`, frames.slice(0, 5));

/* 4) ¿Algún elemento con estilo de player (clases)? */
const playerish = await page.$$eval('[class*="player"], [class*="video"], [id*="player"], [class*="reproductor"]', els =>
  els.map(e => `${e.tagName}.${String(e.className).slice(0, 60)}#${e.id}`).slice(0, 10));
console.log(`\n4) Elementos con clase/id de player: ${playerish.length}`, playerish);

/* 5) Ruta /browser */
try {
  const r = await page.goto('https://doramasia.com/browser', { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(2500);
  const bt = await page.evaluate(() => document.body.innerText.slice(0, 400));
  console.log(`\n5) /browser → HTTP ${r.status()} | texto: ${bt.replace(/\n/g, ' | ').slice(0, 300)}`);
} catch (e) { console.log(`\n5) /browser → ERROR ${e.message}`); }

await browser.close();
console.log('\n✅ Diagnóstico v3 terminado. Manda esta salida completa.');
process.exit(0);
