// probe-servidores.js — Descubre cómo doramasflix.io carga los reproductores.
// Uso:
//   npm i -D playwright && npx playwright install chromium
//   node probe-servidores.js "https://doramasflix.io/capitulos/another-miss-oh-1x1"
import { chromium } from 'playwright';

const url = process.argv[2] || 'https://doramasflix.io/capitulos/another-miss-oh-1x1';

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  locale: 'es-ES'
});
const page = await ctx.newPage();

/* 1) Capturar respuestas sospechosas (APIs JSON, ajax, server, embed) */
const captured = [];
page.on('response', async res => {
  const u = res.url();
  if (!/json|ajax|api|server|player|embed|option|source/i.test(u)) return;
  try {
    const text = await res.text();
    if (/https?:\/\//.test(text) || /embed|iframe|src|url/i.test(text)) {
      captured.push({ url: u, status: res.status(), body: text.slice(0, 600) });
    }
  } catch {}
});

console.log('Cargando (renderizado JS):', url);
await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }).catch(e => console.log('goto:', e.message));
await page.waitForTimeout(4000);

/* 2) Iframes presentes tras el render */
const iframes = await page.$$eval('iframe[src]', els => els.map(e => e.src).filter(Boolean));
console.log('\n=== IFRAMES TRAS RENDER ===');
iframes.forEach(s => console.log(' ', s));
if (!iframes.length) console.log('  (ninguno)');

/* 3) Elementos de opciones/servidores y sus atributos */
console.log('\n=== ELEMENTOS DE SERVIDOR (data-*, class*opcion/server) ===');
const sel = '[data-server],[data-embed],[data-url],[data-id],[data-episode],[data-option],[data-link],[class*="opcion" i],[class*="option" i],[class*="server" i],[class*="player" i]';
const els = await page.$$eval(sel, nodes => nodes.slice(0, 25).map(e => ({
  tag: e.tagName,
  text: (e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
  html: e.outerHTML.slice(0, 350)
})));
for (const e of els) console.log(`\n  <${e.tag}> "${e.text}"\n  ${e.html}`);
if (!els.length) console.log('  (ninguno)');

/* 4) Hacer clic en cada pestaña de opción y recapturar iframes */
console.log('\n=== CLIC EN PESTAÑAS DE OPCIÓN ===');
const tabs = await page.$$(sel);
for (const t of tabs.slice(0, 6)) {
  try {
    await t.click({ timeout: 3000 });
    await page.waitForTimeout(2500);
    const now = await page.$$eval('iframe[src]', els2 => els2.map(e => e.src).filter(Boolean));
    const txt = ((await t.textContent()) || '').trim().slice(0, 40);
    console.log(`\n  [${txt}] → iframes: ${now.length ? now.join(' | ') : '(ninguno)'}`);
  } catch {}
}

/* 5) Script tags con JSON de configuración del episodio */
console.log('\n=== SCRIPTS CON JSON DEL EPISODIO/REPRODUCTOR ===');
const scripts = await page.$$eval('script', ss =>
  ss.map(s => s.textContent || '')
    .filter(t => /servidor|server|embed|player|source|https?:\\/\\//i.test(t) && t.length > 80 && t.length < 30000)
    .slice(0, 5)
    .map(t => t.slice(0, 500))
);
scripts.forEach((s, i) => console.log(`\n  --- script ${i + 1} ---\n  ${s.replace(/\s+/g, ' ')}`));
if (!scripts.length) console.log('  (ninguno)');

/* 6) Respuestas capturadas */
console.log('\n=== RESPUESTAS DE API CAPTURADAS ===');
for (const c of captured.slice(0, 12)) {
  console.log(`\n  ${c.status} ${c.url}\n  ${c.body.replace(/\s+/g, ' ').slice(0, 400)}`);
}
if (!captured.length) console.log('  (ninguna)');

await browser.close();
console.log('\n✅ Sondeo terminado. Pásame esta salida completa.');
