// ══════════════════════════════════════════════════════════
//  dfx-polish.js — DonghuaFlix Pro (capa visual e interacción)
//  Modo cine, glow ambiental, zoom de tarjetas, edge-fade,
//  atajos de teclado, gestos en el reproductor, pantalla de
//  carga, hero mejorado, skeletons de brillo, toasts.
//  Se carga tras app.js y dfx-core.js.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- CSS de la capa visual ---------- */
  const css = `
:root{--dfx-red:#e50914;--dfx-glow:rgba(229,9,20,.35)}
html{scroll-behavior:smooth}
body{font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
/* zoom de tarjetas */
.card{transition:transform .28s cubic-bezier(.2,.8,.2,1),box-shadow .28s ease;will-change:transform}
.card:hover{transform:translateY(-6px) scale(1.035);box-shadow:0 18px 44px rgba(0,0,0,.65),0 0 0 1px var(--dfx-red);z-index:5;position:relative}
.card .poster{overflow:hidden;border-radius:10px}
.card .poster img{transition:transform .4s ease}
.card:hover .poster img{transform:scale(1.08)}
/* badge brillante */
.card .badge{box-shadow:0 2px 8px rgba(0,0,0,.5);letter-spacing:.4px}
/* raíles con fade en los bordes */
.rail{position:relative;mask-image:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 4%,#000 96%,transparent);padding:4px 2px}
.cw-rail{mask-image:linear-gradient(90deg,transparent,#000 3%,#000 97%,transparent);-webkit-mask-image:linear-gradient(90deg,transparent,#000 3%,#000 97%,transparent)}
/* hero con parallax sutil */
.hero{position:relative;overflow:hidden}
.hero::before{content:'';position:absolute;inset:-12%;background:var(--hero) center/cover no-repeat;filter:blur(28px) brightness(.5) saturate(1.3);transform:scale(1.15);z-index:0;will-change:transform}
.hero > *{position:relative;z-index:1}
body.dfx-no-motion .card:hover{transform:none}
body.dfx-no-motion .hero::before{transform:none}
body.dfx-no-motion *{animation-duration:.01ms!important;transition-duration:.01ms!important}
/* sombras en capas */
.detail-v2 .detail-hero,.player,.episode-list,#dfsSheet,.dfxCalDay{box-shadow:0 20px 60px rgba(0,0,0,.5)}
/* modo cine */
#dfxCineBtn{position:fixed;bottom:88px;right:16px;z-index:9997;width:46px;height:46px;border-radius:50%;background:rgba(20,20,25,.92);border:1px solid #333;color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(8px);transition:transform .2s ease,border-color .2s ease;box-shadow:0 8px 24px rgba(0,0,0,.5)}
#dfxCineBtn:hover{transform:scale(1.08);border-color:var(--dfx-red)}
#dfxCineBtn svg{width:22px;height:22px}
body.dfx-cine .nav,body.dfx-cine .bottom-nav,body.dfx-cine footer,body.dfx-cine #dfxGlobalStats,body.dfx-cine #dfxBNWrap{display:none!important}
body.dfx-cine .bg-ambience{opacity:.9}
body.dfx-cine #app{padding-bottom:0}
body.dfx-cine::after{content:'';position:fixed;inset:0;pointer-events:none;z-index:9990;background:radial-gradient(ellipse at 50% 0%,var(--dfx-glow),transparent 60%);mix-blend-mode:screen;opacity:.5}
/* skeleton de brillo */
.skeleton{position:relative;overflow:hidden;background:#16161c;border-radius:10px}
.skeleton::after{content:'';position:absolute;inset:0;background:linear-gradient(100deg,transparent 20%,rgba(255,255,255,.07) 50%,transparent 80%);animation:dfxShimmer 1.4s infinite;transform:translateX(-100%)}
@keyframes dfxShimmer{to{transform:translateX(100%)}}
/* tipografía con degradado */
.section-head h2{background:linear-gradient(120deg,#fff 55%,#ffb3b8);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;font-weight:800;letter-spacing:-.2px}
/* títulos de tarjetas */
.card h3{font-weight:600;font-size:12.5px;line-height:1.3}
/* botones hero */
.btn-x{transition:transform .18s ease,box-shadow .18s ease,background .18s ease}
.btn-x:hover{transform:translateY(-2px)}
.btn-x.play{box-shadow:0 8px 26px rgba(229,9,20,.35)}
.btn-x.play:hover{box-shadow:0 12px 34px rgba(229,9,20,.5)}
/* toast heredado */
#toast{border-radius:12px!important;box-shadow:0 10px 30px rgba(0,0,0,.5)}
/* scrollbars */
::-webkit-scrollbar{width:9px;height:9px}
::-webkit-scrollbar-track{background:#0a0a0c}
::-webkit-scrollbar-thumb{background:#2a2a33;border-radius:99px;border:2px solid #0a0a0c}
::-webkit-scrollbar-thumb:hover{background:var(--dfx-red)}
/* página de episodio: glow en el reproductor */
.player{position:relative;border-radius:12px;overflow:hidden}
.player::before{content:'';position:absolute;inset:-40%;background:var(--dfx-glow,transparent);filter:blur(60px);opacity:.25;z-index:0;pointer-events:none}
.player iframe{position:relative;z-index:1}
/* glow ambiental del poster en episodio */
#dfxGlow{position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.16;filter:blur(90px) saturate(1.4);transition:background 1s ease;background:transparent}
body.dfx-cine #dfxGlow{opacity:.3}
/* kbd overlay ya en core */
  `;
  const st = document.createElement('style');
  st.id = 'dfxPolish';
  st.textContent = css;
  document.head.appendChild(st);

  /* ---------- glow ambiental (color dominante del poster) ---------- */
  function hexToRgba(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return `rgba(229,9,20,${a})`;
    return `rgba(${parseInt(m[1],16)},${parseInt(m[2],16)},${parseInt(m[3],16)},${a})`;
  }
  function pickDominantColor(img) {
    try {
      const c = document.createElement('canvas');
      const s = 24;
      c.width = s; c.height = s;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, s, s);
      const d = x.getImageData(0, 0, s, s).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) {
        const rr = d[i], gg = d[i + 1], bb = d[i + 2];
        const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
        if (lum > 24 && lum < 216) { r += rr; g += gg; b += bb; n++; }
      }
      if (!n) return '#e50914';
      const h = (v) => Math.round(v / n).toString(16).padStart(2, '0');
      return `#${h(r)}${h(g)}${h(b)}`;
    } catch { return '#e50914'; }
  }
  function applyGlowFromImage(img) {
    const col = pickDominantColor(img);
    const glow = $('#dfxGlow');
    const player = $('.player');
    if (glow) glow.style.background = `radial-gradient(circle at 50% 20%, ${hexToRgba(col, .5)}, transparent 70%)`;
    if (player) player.style.setProperty('--dfx-glow', hexToRgba(col, .5));
    document.documentElement.style.setProperty('--dfx-glow', hexToRgba(col, .35));
  }
  function watchGlow() {
    const playerImg = $('.detail-v2 .detail-hero, .episode .player');
    const src = (window.currentEpisode && window.findSeries) ? window.getSeriesImage(window.findSeries(window.currentEpisode.seriesId) || {}) : null;
    if (!src) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => applyGlowFromImage(img);
    img.src = src;
  }

  /* ---------- modo cine ---------- */
  function toggleCine() {
    document.body.classList.toggle('dfx-cine');
    const on = document.body.classList.contains('dfx-cine');
    try { localStorage.setItem('dfx_cine', on ? '1' : '0'); } catch {}
    toast(on ? '🎬 Modo cine ON — pulsa C para salir' : '🎬 Modo cine OFF');
    if (on) window.scrollTo({ top: 0 });
  }
  function injectCineBtn() {
    if ($('#dfxCineBtn')) return;
    const b = document.createElement('button');
    b.id = 'dfxCineBtn';
    b.title = 'Modo cine (C)';
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="2" y="4" width="20" height="16" rx="2.5"/><path d="M2 9h20M7 4v5M17 4v5"/></svg>';
    b.onclick = toggleCine;
    document.body.appendChild(b);
  }
  if (localStorage.getItem('dfx_cine') === '1') document.body.classList.add('dfx-cine');

  /* ---------- atajos de teclado ---------- */
  function kbdOverlay() {
    let o = $('#dfxKbd');
    if (!o) {
      o = document.createElement('div');
      o.id = 'dfxKbd';
      o.className = 'dfxKbdOverlay';
      o.innerHTML = `<div class="dfxKbdCard">
        <h3>⌨️ Atajos de teclado</h3>
        <div class="dfxKbdRow"><span>Buscar</span><kbd>/</kbd></div>
        <div class="dfxKbdRow"><span>Modo cine</span><kbd>C</kbd></div>
        <div class="dfxKbdRow"><span>Radar de episodios</span><kbd>R</kbd></div>
        <div class="dfxKbdRow"><span>Episodio aleatorio</span><kbd>X</kbd></div>
        <div class="dfxKbdRow"><span>Pantalla completa del reproductor</span><kbd>F</kbd></div>
        <div class="dfxKbdRow"><span>Ver/ocultar este panel</span><kbd>?</kbd></div>
        <div class="dfxKbdRow"><span>Cerrar diálogos</span><kbd>Esc</kbd></div>
      </div>`;
      document.body.appendChild(o);
      o.onclick = e => { if (e.target === o) o.classList.remove('open'); };
    }
    o.classList.toggle('open');
  }

  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case '/': e.preventDefault(); location.hash = '#/search'; break;
      case 'c': case 'C': toggleCine(); break;
      case 'r': case 'R': location.hash = '#/radar'; break;
      case 'x': case 'X': window.DFX && DFX.randomEp && DFX.randomEp(); break;
      case 'f': case 'F': window.togglePlayerFS && togglePlayerFS(); break;
      case '?': kbdOverlay(); break;
      case 'Escape':
        $('#dfxKbd')?.classList.remove('open');
        if (document.body.classList.contains('dfx-cine')) toggleCine();
        break;
    }
  });

  /* ---------- gestos en el reproductor (móvil) ---------- */
  function bindPlayerGestures() {
    const player = $('.player');
    if (!player || player.dataset.dfxGest) return;
    player.dataset.dfxGest = '1';
    let startX = 0, startY = 0, seeking = false, seekTO = null;
    player.addEventListener('touchstart', e => {
      const t = e.touches[0];
      startX = t.clientX; startY = t.clientY; seeking = false;
    }, { passive: true });
    player.addEventListener('touchmove', e => {
      if (seeking) return;
      const t = e.touches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        seeking = true;
        const dir = dx > 0 ? 10 : -10;
        showSeek(dir);
        if (window.DFX && DFX.roomSend) DFX.roomSend('seek', (window.dfxResumeEp && window.dfxResumeEp(window.currentEpisode?.id)) + dir);
        const ifr = player.querySelector('iframe');
        if (ifr) {
          try {
            const cur = window.dfxResumeEp ? window.dfxResumeEp(window.currentEpisode?.id) : 0;
            const to = Math.max(0, cur + dir);
            ifr.src = ifr.src.split('?')[0] + '?autoplay=1&start=' + Math.floor(to);
          } catch {}
        }
      }
    }, { passive: true });
    player.addEventListener('touchend', () => { seeking = false; }, { passive: true });
  }
  function showSeek(sec) {
    let t = $('#dfxSeekToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dfxSeekToast';
      t.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.85);color:#fff;padding:12px 26px;border-radius:12px;font-size:20px;font-weight:800;z-index:99999;pointer-events:none;border:1px solid #333';
      document.body.appendChild(t);
    }
    t.textContent = (sec > 0 ? '» +' : '« -') + Math.abs(sec) + 's';
    clearTimeout(showSeek._t);
    showSeek._t = setTimeout(() => t.remove(), 900);
  }

  /* ---------- hero: parallax sutil al scroll ---------- */
  let ticking = false;
  window.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const hero = $('.hero');
      if (hero && !document.body.classList.contains('dfx-no-motion')) {
        const y = window.scrollY;
        if (y < 600) hero.style.transform = `translateY(${y * 0.18}px)`;
        else hero.style.transform = '';
      }
      ticking = false;
    });
  }, { passive: true });

  /* ---------- envoltorios ---------- */
  function wrap(name, fn) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__dfxP) return;
    const w = function (...a) { const r = orig.apply(this, a); try { fn && fn(); } catch {} return r; };
    w.__dfxP = true; window[name] = w;
  }

  function init() {
    /* glow base */
    const g = document.createElement('div');
    g.id = 'dfxGlow';
    document.body.prepend(g);

    injectCineBtn();
    wrap('episode', () => setTimeout(() => { watchGlow(); bindPlayerGestures(); }, 300));
    wrap('home', () => setTimeout(watchGlow, 400));
    wrap('route', () => setTimeout(() => { injectCineBtn(); }, 50));

    /* Sin MutationObserver: el botón de cine se inyecta una vez.
       Los wraps de episode()/route() se encargan de re-inyectarlo si hace falta. */
    setTimeout(() => { injectCineBtn(); }, 300);

    toast('🚀 DonghuaFlix Pro cargado — pulsa ? para ver los atajos');
  }

  function toast(msg, ms = 2400) {
    let t = $('#dfxPToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dfxPToast';
      t.style.cssText = 'position:fixed;bottom:140px;left:50%;transform:translateX(-50%);background:#141419;color:#fff;padding:10px 20px;border-radius:99px;font-size:13px;border:1px solid #333;z-index:99999;opacity:0;transition:opacity .3s ease,transform .3s ease;pointer-events:none;box-shadow:0 10px 30px rgba(0,0,0,.6)';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(-8px)'; });
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%)'; }, ms);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
