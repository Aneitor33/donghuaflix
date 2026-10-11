#!/usr/bin/env node
/**
 * debug-episode.js — v2: diagnóstico con INTERACCIÓN
 * 1) Estado del proxy (sin mostrar secretos)
 * 2) Detección de muro VIP / login en el HTML
 * 3) Playwright: lista botones candidatos, HACE CLIC en el de reproducción,
 *    espera, y vuelca iframes + TODAS las llamadas a API/interesantes.
 */
const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const PROXY_URL = (process.env.FLIX_PROXY_URL || '').replace(/\/+$/, '');
const PROXY_KEY = process.env.FLIX_PROXY_KEY || '';
const PROXY_HOSTS = (process.env.FLIX_PROXY_HOSTS || 'doramasia.com,www.doramasia.com')
  .split(',').map(s => s.trim()).filter(Boolean);
const EP_URL = process.env.DEBUG_EPISODE_URL ||
  'https://doramasia.com/capitulos/is-there-equation-in-love-1x3';

console.log(`🔍 Diagnóstico v2 de ${EP_URL}`);
console.log(`   Proxy URL: ${PROXY_URL ? 'definida' : 'NO'} | Proxy KEY: ${PROXY_KEY ? 'definida' : '⚠️ VACÍA'} | Hosts: ${PROXY_HOSTS.join(', ')}`);

/* ── 1) HTML estático: gating + proxies de contenido ── */
async function fetchHtml(url) {
  const useProxy = PROXY_URL && PROXY_KEY && PROXY_HOSTS.includes(new URL(url).hostname);
  const target = useProxy ? `${PROXY_URL}/?u=${encodeURIComponent(url)}` : url;
  const res = await fetch(target, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: useProxy ? { 'x-proxy-key': PROXY_KEY } : {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept-Language': 'es-ES,es;q=0.9'
    }
  });
  return { status: res.status, html: await res.text(), proxied: useProxy };
}

const { status, html, proxied } = await fetchHtml(EP_URL);
console.log(`\n1) HTML: HTTP ${status} | ${html.length} bytes | proxied=${proxied}`);

const gate = [];
for (const [label, re] of [
  ['VIP', /vip/i], ['registro', /registr/i], ['login/sesión', /inicia sesi|login|sign in/i],
  ['premium', /premium/i], ['suscripción', /suscrip/i], ['planes', /planes/i]
]) if (re.test(html)) gate.push(label);
console.log(`   Palabras de muro detectadas en HTML: ${gate.length ? gate.join(', ') : 'ninguna'}`);

for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) {
  console.log(`   iframe en HTML estático: ${m[1]}`);
}

/* ── 2) Playwright con interacción ── */
console.log('\n2) Playwright (con clics):');
try {
  const { chromium } = await import('playwright');
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    locale: 'es-ES'
  });
  const page = await ctx.newPage();

  const interesting = [];
  page.on('response', res => {
    const u = res.url();
    if (/_next\/static|\.(js|css|png|jpe?g|webp|svg|woff2?|ico)(\?|$)/.test(u)) return;
    res.text().then(t => {
      const hit = /embedshortener|"(?:link|url|src|embed|file)":"https?:|m3u8|\.mp4/.test(t);
      interesting.push({ u: u.slice(0, 160), len: t.length, hit });
    }).catch(() => {});
  });

  await page.goto(EP_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  /* Botones/enlaces con texto de reproducción */
  const cands = await page.$$eval('button, a, [role="button"], li', els =>
    els.map(e => (e.textContent || '').trim())
       .filter(t => t && t.length < 50 && /ver|play|reproducir|mirar|servidor|server|cap[ií]tulo|opci|hd|latino|sub/i.test(t))
  );
  console.log(`   Candidatos clicables (${cands.length}):`, JSON.stringify([...new Set(cands)].slice(0, 20)));

  const iframesBefore = await page.$$eval('iframe[src]', els => els.map(e => e.src)).catch(() => []);
  console.log(`   Iframes ANTES de clicar: ${iframesBefore.length}`);

  /* Clicar el candidato más probable */
  const locs = page.locator('button, a, [role="button"], li');
  const n = Math.min(await locs.count(), 80);
  let clicked = null;
  for (let i = 0; i < n; i++) {
    const el = locs.nth(i);
    const txt = ((await el.innerText().catch(() => '')) || '').trim();
    if (txt && txt.length < 40 && /^(ver|play|reproducir|mirar)|servidor|server|opciones|op\d/i.test(txt)) {
      await el.scrollIntoViewIfNeeded().catch(() => {});
      await el.click({ timeout: 3000 }).catch(() => null);
      clicked = txt;
      break;
    }
  }
  console.log(`   Clicado: ${clicked || 'nada (no hubo candidato)'}`);
  await page.waitForTimeout(6000);

  const iframesAfter = await page.$$eval('iframe[src]', els => els.map(e => e.src)).catch(() => []);
  console.log(`   Iframes DESPUÉS: ${iframesAfter.length}${iframesAfter.length ? ' → ' + iframesAfter.slice(0, 3).join(' | ') : ''}`);

  /* A veces el player va dentro de un div con data-* */
  const dataUrls = await page.$$eval('[data-url], [data-embed], [data-src], [data-link], [data-player], [data-server]', els =>
    els.map(e => e.getAttribute('data-url') || e.getAttribute('data-embed') || e.getAttribute('data-src') || e.getAttribute('data-link') || e.getAttribute('data-player') || e.getAttribute('data-server')).filter(Boolean)
  ).catch(() => []);
  console.log(`   Atributos data-* con URL: ${dataUrls.length}${dataUrls.length ? ' → ' + dataUrls.slice(0, 3).join(' | ') : ''}`);

  await page.waitForTimeout(2000);
  const hits = interesting.filter(r => r.hit);
  console.log(`\n   Peticiones "interesantes": ${interesting.length} | con posibles servers: ${hits.length}`);
  for (const h of hits.slice(0, 5)) console.log(`     HIT → ${h.u} (${h.len} bytes)`);
  const apis = interesting.filter(r => /api|rsc|episode|capitulo|player|server/i.test(r.u));
  console.log(`   Peticiones a posibles API (${apis.length}):`);
  for (const a of apis.slice(0, 10)) console.log(`     → ${a.u} (${a.len} bytes)`);

  await browser.close();
} catch (e) {
  console.log(`   Playwright ERROR: ${e.message}`);
}
console.log('\n✅ Diagnóstico v2 terminado. Manda esta salida completa.');
process.exit(0);
