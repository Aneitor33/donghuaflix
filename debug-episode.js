#!/usr/bin/env node
/**
 * debug-episode.js — Diagnóstico de extracción de servidores (doramasia)
 * Replica EXACTAMENTE los métodos de sync-doramasia.js y dice cuál falla.
 *
 * Uso (local, con las mismas env que el scraper):
 *   FLIX_PROXY_URL=... FLIX_PROXY_KEY=... DEBUG_EPISODE_URL="https://doramasia.com/capitulos/..." node debug-episode.js
 */
import fs from 'node:fs/promises';

const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 20000);
const PROXY_URL = (process.env.FLIX_PROXY_URL || '').replace(/\/+$/, '');
const PROXY_KEY = process.env.FLIX_PROXY_KEY || '';
const PROXY_HOSTS = (process.env.FLIX_PROXY_HOSTS || 'doramasia.com,www.doramasia.com')
  .split(',').map(s => s.trim()).filter(Boolean);
const EP_URL = process.env.DEBUG_EPISODE_URL ||
  'https://doramasia.com/capitulos/is-there-equation-in-love-1x3';

const KNOWN_VIDEO_HOST = /(?:ok\.ru|okcdn\.ru|byse|voe\.sx|voe|vidmoly|dailymotion|rumble|mixdrop|uqload|filemoon|streamwish|yourupload|mega\.nz|embedsue|dood\.|streamsb|vudeo|vidoza|fembed|netu|hqq|waaw|upstream|doodstream|embedshortener)\b/i;
const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return '?'; } };

async function fetchHtml(url) {
  let target = url, proxied = false;
  if (PROXY_URL && PROXY_KEY && PROXY_HOSTS.includes(new URL(url).hostname)) {
    target = `${PROXY_URL}/?u=${encodeURIComponent(url)}`;
    proxied = true;
  }
  const res = await fetch(target, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    redirect: 'follow',
    headers: proxied ? { 'x-proxy-key': PROXY_KEY } : {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-ES,es;q=0.9'
    }
  });
  const body = await res.text();
  return { status: res.status, body, proxied };
}

/* Mismo extractor que sync-doramasia.js (resumen): si iframes/data-url/JSON-embebidos */
function quickScan(html) {
  const found = [];
  const push = u => { try { const a = new URL(u, EP_URL).href; if (/^https?:/.test(a) && !found.includes(a)) found.push(a); } catch {} };
  for (const m of html.matchAll(/<iframe[^>]+src=["']([^"']+)["']/gi)) push(m[1]);
  for (const m of html.matchAll(/data-(?:url|embed|src|link|player|href|server)=["']([^"']+)["']/gi)) push(m[1]);
  const un = html.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/\\"/g, '"');
  for (const m of un.matchAll(/"(?:src|url|embed|file|source|link|href|iframeSrc|player)":"(https?:\/\/[^"]{10,600})"/g)) push(m[1]);
  return found.filter(u => KNOWN_VIDEO_HOST.test(u) || /\.(mp4|webm|m3u8)([?#]|$)/i.test(u));
}

/* Mismo extractRouterState que el scraper */
function extractRouterState(html) {
  const marker = 'self.__next_f.push([1,"0:{';
  const start = html.indexOf(marker);
  if (start === -1) return null;
  let i = start + marker.length, out = '0:{';
  while (i < html.length && out.length < 200000) {
    const ch = html[i];
    if (ch === '\\') {
      const n = html[i + 1];
      if (n === '"' || n === '\\' || n === '/') { out += n; i += 2; continue; }
      if (n === 'u') { out += html.slice(i, i + 6); i += 6; continue; }
    }
    if (ch === '"') break;
    out += ch; i++;
  }
  try {
    const row = JSON.parse(out.slice(2));
    if (row && Array.isArray(row.f) && Array.isArray(row.f[0])) return row.f[0];
  } catch {}
  return null;
}

async function tryRsc(url, html) {
  const tree = extractRouterState(html);
  console.log(`   Router state tree extraído del HTML: ${tree ? 'SÍ' : 'NO'}`);
  const variants = [];
  if (tree) variants.push({ 'RSC': '1', 'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(tree)), 'Next-Url': new URL(url).pathname });
  variants.push({ 'RSC': '1', 'Next-Url': new URL(url).pathname });
  variants.push({ 'RSC': '1' });
  let vi = 0;
  for (const extra of variants) {
    vi++;
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/x-component, */*', ...extra }
      });
      const text = await res.text();
      const hasLink = /\\?"link\\?":\\?"?https?/.test(text) || /embedshortener/.test(text);
      console.log(`   RSC variante ${vi}: HTTP ${res.status} | ${text.length} bytes | ¿contiene servers? ${hasLink ? 'SÍ' : 'no'}`);
      if (vi === 1 || hasLink) console.log(`     muestra: ${text.replace(/\s+/g, ' ').slice(0, 400)}`);
      if (hasLink) return text;
    } catch (e) {
      console.log(`   RSC variante ${vi}: ERROR ${e.message}`);
    }
  }
  return null;
}

async function tryPlaywright(url) {
  try {
    const { chromium } = await import('playwright');
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36', locale: 'es-ES' });
    const page = await ctx.newPage();
    const responses = [];
    page.on('response', res => {
      res.text().then(t => responses.push({ url: res.url(), len: t.length, hit: /embedshortener|"(?:link|url)":"https?:/.test(t) }))
        .catch(() => {});
    });
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(6000);
    const iframes = await page.$$eval('iframe[src]', els => els.map(e => e.src)).catch(() => []);
    console.log(`   Playwright: ${iframes.length} iframe(s) en DOM: ${iframes.slice(0, 3).join(' | ') || 'ninguno'}`);
    const hits = responses.filter(r => r.hit);
    console.log(`   Playwright: ${responses.length} respuestas sniffadas, ${hits.length} con posibles servers`);
    for (const h of hits.slice(0, 3)) console.log(`     → ${h.url.slice(0, 140)} (${h.len} bytes)`);
    await browser.close();
  } catch (e) {
    console.log(`   Playwright: ERROR ${e.message}`);
  }
}

console.log(`🔍 Diagnóstico de ${EP_URL}`);
console.log(`   Proxy: ${PROXY_URL ? 'sí (' + PROXY_URL + ')' : 'NO (directo)'}`);
const { status, body, proxied } = await fetchHtml(EP_URL);
console.log(`\n1) HTML estático: HTTP ${status} | ${body.length} bytes | proxied=${proxied}`);
const servers = quickScan(body);
console.log(`   Servers encontrados en HTML estático: ${servers.length}`);
servers.slice(0, 5).forEach(u => console.log(`     → ${u}`));

console.log(`\n2) Búsqueda de marca Next.js en HTML: __next_f=${body.includes('__next_f')} | self.__next_f.push=${body.includes('self.__next_f.push')}`);

console.log(`\n3) RSC (payload que sirve los servers):`);
await tryRsc(EP_URL, body);

console.log(`\n4) Playwright (navegador real):`);
await tryPlaywright(EP_URL);

console.log('\n✅ Diagnóstico terminado. Manda esta salida completa.');
process.exit(0);
