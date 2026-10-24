// ══════════════════════════════════════════════════════════
//  dfx-cine.js — DonghuaFlix "Modo Cine" v5
//  Diseño "Pro Mobile" (Tailwind): hero glass, Top 10 contorno,
//  badges miniatura, servidores pills, grid 3col, bottom nav.
//  Datos reales de app.js. Solo en #/cine; la web original intacta.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  function glb(n) { try { return Function('return typeof ' + n + '!=="undefined"?' + n + ':undefined')(); } catch (e) { return undefined; } }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  var LIBS_DONE = false;
  function loadLibs() {
    if (LIBS_DONE) return;
    LIBS_DONE = true;
    if (!document.getElementById('dfxTw')) {
      var tw = document.createElement('script');
      tw.id = 'dfxTw'; tw.src = 'https://cdn.tailwindcss.com';
      tw.onload = function () {
        if (window.tailwind) tailwind.config = { darkMode: 'class', theme: { extend: { colors: { brand: { DEFAULT: '#ff2e2e', hover: '#e02424' }, dark: { bg: '#08080a', card: '#0f0f14' } } } } };
      };
      document.head.appendChild(tw);
    }
    if (!document.getElementById('dfxFa')) {
      var fa = document.createElement('link');
      fa.id = 'dfxFa'; fa.rel = 'stylesheet';
      fa.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
      document.head.appendChild(fa);
    }
  }

  var CSS = `
.cx5-nav{position:sticky;top:0;z-index:50;background:rgba(8,8,10,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.1);padding:0 16px;height:56px;display:flex;align-items:center;justify-content:space-between}
.cx5-mark{width:28px;height:28px;border-radius:8px;background:#ff2e2e;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:11px;box-shadow:0 4px 14px rgba(255,46,46,.4)}
.cx5-hero{position:relative;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0f0f14;box-shadow:0 20px 44px rgba(0,0,0,.45);min-height:380px;display:flex;align-items:flex-end;padding:22px}
.cx5-hero-bg{position:absolute;inset:0;background-size:cover;background-position:center 20%}
.cx5-hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,8,10,.05) 30%,rgba(8,8,10,.75) 78%,#08080a 100%)}
.cx5-chip-ex{position:relative;z-index:1;display:inline-block;background:#ff2e2e;color:#fff;font-size:9px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:6px}
.cx5-chip-live{position:relative;z-index:1;display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);border:1px solid rgba(52,211,153,.35);color:#34d399;font-size:9px;font-weight:600;padding:3px 8px;border-radius:6px}
.cx5-chip-live .dot{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px rgba(52,211,153,.9);animation:cx5p 1.6s infinite}
.cx5-chip-off{position:relative;z-index:1;display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);color:#d4d4d8;font-size:9px;font-weight:600;padding:3px 8px;border-radius:6px}
@keyframes cx5p{0%,100%{opacity:1}50%{opacity:.35}}
.cx5-title{position:relative;z-index:1;font-size:26px;font-weight:900;color:#fff;line-height:1.12;margin:10px 0 6px;letter-spacing:-.01em;text-shadow:0 2px 18px rgba(0,0,0,.5)}
.cx5-meta{position:relative;z-index:1;font-size:11px;color:#d4d4d8;margin-bottom:6px}
.cx5-syn{position:relative;z-index:1;font-size:11px;color:#d4d4d8;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:14px}
.cx5-play{position:relative;z-index:1;flex:1;background:#ff2e2e;color:#fff;font-weight:700;font-size:12px;padding:11px 0;border-radius:12px;border:none;box-shadow:0 10px 24px rgba(255,46,46,.35);text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px}
.cx5-add{position:relative;z-index:1;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:#fff;display:flex;align-items:center;justify-content:center;text-decoration:none;backdrop-filter:blur(8px)}
.cx5-sech{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#fff;margin:0 0 10px}
.cx5-sech::before{content:'';width:4px;height:14px;background:#ff2e2e;border-radius:99px}
.cx5-sech .n{margin-left:auto;font-size:10px;color:#a1a1aa;border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:2px 9px;font-weight:500}
.cx5-row{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;scrollbar-width:none}
.cx5-row::-webkit-scrollbar{display:none}
.cx5-bdg{position:absolute;top:6px;left:6px;z-index:2;background:rgba(0,0,0,.62);backdrop-filter:blur(6px);font-size:8px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:5px}
.cx5-bdg.live{color:#34d399;border:1px solid rgba(52,211,153,.35)}
.cx5-bdg.off{color:#d4d4d8;border:1px solid rgba(255,255,255,.14)}
.cx5-card{position:relative;text-decoration:none}
.cx5-po{position:relative;aspect-ratio:3/4;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0f0f14}
.cx5-po img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
.cx5-po2{position:relative;aspect-ratio:2/3;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0f0f14}
.cx5-po2 img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
.cx5-ph{width:100%;height:100%;display:grid;place-items:center;font-size:30px;font-weight:800;color:#3c3f47;background:linear-gradient(160deg,#191920,#0d0d12);position:absolute;inset:0}
.cx5-tc .cx5-ph,.cx5-po2 .cx5-ph{position:absolute}
.cx5-ct{font-size:10.5px;font-weight:600;color:#fff;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cx5-pr{position:absolute;left:6px;right:6px;bottom:6px;height:3px;border-radius:2px;background:rgba(255,255,255,.25);overflow:hidden;z-index:2}
.cx5-pr i{display:block;height:100%;background:#ff2e2e;box-shadow:0 0 8px rgba(255,46,46,.8)}
/* top 10 */
.cx5-top{flex:none;display:flex;align-items:flex-end;position:relative;width:118px}
.cx5-tn{font-size:64px;font-weight:900;line-height:.78;color:transparent;-webkit-text-stroke:1.5px rgba(255,255,255,.75);text-shadow:0 4px 12px rgba(0,0,0,.9);position:absolute;left:-4px;bottom:-2px;z-index:3;pointer-events:none}
.cx5-tc{width:86px;height:128px;margin-left:auto;border-radius:12px;overflow:hidden;position:relative;border:1px solid rgba(255,255,255,.1);background:#0f0f14}
.cx5-tc img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
/* pills */
.cx5-pill{font-size:11px;font-weight:600;color:#d4d4d8;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);border-radius:99px;padding:7px 14px;cursor:pointer;font-family:inherit;white-space:nowrap}
.cx5-pill.on{background:#ff2e2e;border-color:#ff2e2e;color:#fff;box-shadow:0 6px 16px rgba(255,46,46,.4)}
.cx5-pills{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px;scrollbar-width:none}
.cx5-pills::-webkit-scrollbar{display:none}
.cx5-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.cx5-more{display:block;margin:16px auto 6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:99px;padding:10px 22px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
.cx5-bnav{position:fixed;bottom:0;left:0;right:0;z-index:60;background:rgba(8,8,10,.88);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-around;padding:8px 12px calc(8px + env(safe-area-inset-bottom))}
.cx5-bnav a{display:flex;flex-direction:column;align-items:center;gap:3px;color:#a1a1aa;font-size:10px;font-weight:600;text-decoration:none;padding:2px 8px}
.cx5-bnav a.on{color:#ff2e2e}
.cx5-bnav a i{font-size:16px}
.cx5-wrap{max-width:520px;margin:0 auto;padding:12px 14px 110px}
.cx5-hero-btns{display:flex;gap:8px;align-items:center;position:relative;z-index:1}
/* ocultar interfaz clásica dentro del modo cine */
body.dfx-cine-skin header.nav,body.dfx-cine-skin .nav{display:none!important}
body.dfx-cine-skin{padding-top:57px!important}
body.dfx-cine-home .bottom-nav,body.dfx-cine-home footer,body.dfx-cine-home .catalog-wrap{display:none!important}
body.dfx-cine-home #app{padding:0!important;max-width:none!important;width:100%!important}
#dfxThemeToggle{display:none!important}
/* ══ SKIN GLOBAL (todas las páginas clásicas con lenguaje nuevo) ══ */
body.dfx-cine-skin{--red:#ff2e2e;--red2:#ff6b6b;background:#08080a}
body.dfx-cine-skin .nav.scrolled,body.dfx-cine-skin .nav{background:rgba(8,8,10,.88);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.07)}
body.dfx-cine-skin .nav nav a{border-radius:999px}
body.dfx-cine-skin .nav nav a.active{background:#ff2e2e!important;color:#fff!important;border-color:#ff2e2e!important;box-shadow:0 4px 14px rgba(255,46,46,.35)}
body.dfx-cine-skin .btn-x.play{background:#ff2e2e!important;color:#fff!important;border-radius:12px;box-shadow:0 10px 30px rgba(255,46,46,.45),0 0 18px rgba(255,46,46,.25)}
body.dfx-cine-skin .btn-x.play:hover{background:#ff4a4a!important}
body.dfx-cine-skin .btn-x.glass{background:rgba(255,255,255,.1)!important;border:1px solid rgba(255,255,255,.22)!important;border-radius:12px}
body.dfx-cine-skin .btn-x{border-radius:12px}
body.dfx-cine-skin .badge{background:rgba(0,0,0,.62)!important;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.16)!important;color:#e4e4e7!important;border-radius:5px!important;font-size:8px!important;font-weight:700!important;letter-spacing:.03em!important;padding:2px 6px!important;white-space:nowrap!important;max-width:72%!important;overflow:hidden!important;text-overflow:ellipsis!important;text-transform:uppercase!important}
body.dfx-cine-skin .card .poster{border-radius:12px;border:1px solid rgba(255,255,255,.1);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
@media(hover:hover){
  body.dfx-cine-skin .card:hover .poster{transform:translateY(-3px) scale(1.02);border-color:rgba(255,255,255,.22);box-shadow:0 18px 40px rgba(0,0,0,.6)}
}
body.dfx-cine-skin .top10-num{color:transparent;-webkit-text-stroke:2px rgba(255,255,255,.75)!important;text-shadow:0 0 24px rgba(0,0,0,.7)}
body.dfx-cine-skin .chip{border-radius:999px}
body.dfx-cine-skin .chip.on,body.dfx-cine-skin .chip.active{background:#ff2e2e!important;border-color:#ff2e2e!important;color:#fff!important}
body.dfx-cine-skin .ep-side,body.dfx-cine-skin .ep-main{background:rgba(12,12,16,.75)!important;border:1px solid rgba(255,255,255,.1)!important;border-radius:16px!important;backdrop-filter:blur(10px)}
body.dfx-cine-skin .ep{border-radius:10px}
body.dfx-cine-skin .ep:hover{background:rgba(255,255,255,.05)}
body.dfx-cine-skin .ep-num{color:#ff2e2e!important;font-weight:700!important}
body.dfx-cine-skin .progress span,body.dfx-cine-skin [class*="prog"] i{background:#ff2e2e!important}
body.dfx-cine-skin .catalog-menu,body.dfx-cine-skin .more-menu{background:rgba(10,10,14,.96);border:1px solid rgba(255,255,255,.12);border-radius:14px}
body.dfx-cine-skin #toast{background:rgba(12,12,16,.95);border:1px solid rgba(255,255,255,.12);border-radius:12px;backdrop-filter:blur(14px)}
body.dfx-cine-skin input,body.dfx-cine-skin select{border-radius:11px}
body.dfx-cine-skin input:focus{border-color:#ff2e2e}
body.dfx-cine-skin ::selection{background:rgba(255,46,46,.35)}
body.dfx-cine-skin ::-webkit-scrollbar{width:9px;height:9px}
body.dfx-cine-skin ::-webkit-scrollbar-thumb{background:#1e1e24;border-radius:99px;border:2px solid #08080a}
/* ══ DESIGN SYSTEM PRO ══ */
body.dfx-cine-skin::after{content:'';position:fixed;inset:0;z-index:2147483000;pointer-events:none;opacity:.02;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='140' height='140' filter='url(%23n)' opacity='1'/%3E%3C/svg%3E")}
body.dfx-cine-skin .ep-side,body.dfx-cine-skin .ep-main,body.dfx-cine-skin .catalog-menu,body.dfx-cine-skin .more-menu,body.dfx-cine-skin #toast{
  background:rgba(18,18,24,.7)!important;backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,.12)!important}
/* servidores: segmented control flotante */
body.dfx-cine-skin .cx5-seg{display:inline-flex;align-items:center;gap:2px;background:rgba(18,18,24,.7);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.1);border-top:1px solid rgba(255,255,255,.14);border-radius:999px;padding:4px;position:relative;max-width:100%;overflow-x:auto;scrollbar-width:none}
body.dfx-cine-skin .cx5-seg::-webkit-scrollbar{display:none}
body.dfx-cine-skin .cx5-seg button{position:relative;z-index:1;border:none!important;background:transparent!important;box-shadow:none!important;border-radius:999px!important;padding:6px 14px!important;font-size:11px!important;font-weight:600!important;color:#d4d4d8!important;white-space:nowrap;cursor:pointer;font-family:inherit}
body.dfx-cine-skin .cx5-seg button[class*="active"],body.dfx-cine-skin .cx5-seg button.on{color:#fff!important}
body.dfx-cine-skin .cx5-seg-ind{position:absolute;top:4px;bottom:4px;border-radius:999px;background:#ff2e2e;box-shadow:0 0 20px rgba(255,46,46,.35);transition:left .25s ease,width .25s ease;z-index:0}
/* ambilight (portada de la serie, no sampling de video) */
body.dfx-cine-skin .cx5-amb{position:relative}
body.dfx-cine-skin .cx5-amb-bg{position:absolute;inset:-30px -20px;z-index:-1;border-radius:30px;background-size:cover;background-position:center;filter:blur(60px) saturate(1.4) brightness(.55);opacity:.55;pointer-events:none}
/* grid de episodios */
.cx5-epmodes{display:flex;gap:6px;margin:0 0 10px}
.cx5-epmodes button{font-size:11px;font-weight:600;color:#d4d4d8;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);border-radius:999px;padding:6px 14px;cursor:pointer;font-family:inherit}
.cx5-epmodes button.on{background:#ff2e2e;border-color:#ff2e2e;color:#fff}
.cx5-epgrid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;padding:4px 2px 10px}
.cx5-epgrid button{position:relative;aspect-ratio:1;border-radius:11px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);color:#d4d4d8;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;transition:border-color .15s,background .15s}
.cx5-epgrid button:hover{border-color:rgba(255,46,46,.6);color:#fff}
.cx5-epgrid button.seen::after{content:'✓';position:absolute;top:3px;right:5px;font-size:8px;color:#34d399}
.cx5-epgrid button.cur{background:rgba(255,46,46,.14);border-color:#ff2e2e;color:#fff;box-shadow:0 0 14px rgba(255,46,46,.3)}
.cx5-epgrid button.cur::after{content:'';position:absolute;bottom:5px;left:50%;transform:translateX(-50%);width:5px;height:5px;border-radius:50%;background:#ff2e2e;box-shadow:0 0 8px rgba(255,46,46,.9);animation:cx5ping 1.4s infinite}
@keyframes cx5ping{0%,100%{opacity:1}50%{opacity:.3}}
.cx5-eplist-hidden .ep,.cx5-eplist-hidden a.ep,.cx5-eplist-hidden .episode-item{display:none!important}
/* búsqueda limpia */
body.dfx-cine-skin.cx5-clean .card .badge{display:none!important}
body.dfx-cine-skin .filters input,body.dfx-cine-skin input[type="search"]{display:block;max-width:560px;margin:8px auto!important;padding:12px 18px!important;font-size:14px!important;border-radius:14px!important;background:rgba(18,18,24,.7)!important;border:1px solid rgba(255,255,255,.14)!important}
/* ajustes tarjetas */
body.dfx-cine-skin .dfxSetRow,body.dfx-cine-skin .dfxProfileCard{background:rgba(18,18,24,.7);backdrop-filter:blur(20px);border:1px solid rgba(255,255,255,.09);border-top:1px solid rgba(255,255,255,.12);border-radius:14px;margin:8px 0;padding:13px 15px}
body.dfx-cine-skin .dfxSwitch.on{background:#ff2e2e!important;box-shadow:0 0 14px rgba(255,46,46,.4)}
/* ══ REPRODUCTOR Y EPISODIOS (PRO STREAMING) ══ */
body.dfx-cine-skin button[class*="servidor"],body.dfx-cine-skin .server-btn,body.dfx-cine-skin div[class*="servidores"] a{
  background:rgba(255,255,255,.05)!important;border:1px solid rgba(255,255,255,.12)!important;border-radius:20px!important;
  color:#e4e4e7!important;font-size:11px!important;font-weight:600!important;padding:6px 14px!important;text-transform:capitalize!important}
body.dfx-cine-skin button[class*="servidor"][class*="active"],body.dfx-cine-skin .server-btn.active{
  background:#ff2e2e!important;border-color:#ff2e2e!important;color:#fff!important;box-shadow:0 4px 15px rgba(255,46,46,.4)!important}
body.dfx-cine-skin .ep-side .ep,body.dfx-cine-skin div[class*="episodio"],body.dfx-cine-skin .episode-item{
  background:rgba(255,255,255,.03)!important;border:1px solid rgba(255,255,255,.08)!important;border-radius:12px!important;padding:10px 14px!important;margin-bottom:6px!important}
body.dfx-cine-skin .ep-side .ep [class*="sub"],body.dfx-cine-skin .ep-side .ep small{
  display:none!important}
body.dfx-cine-skin .ep-side .ep[class*="active"],body.dfx-cine-skin div[class*="episodio"][class*="active"],body.dfx-cine-skin .episode-item.active{
  background:rgba(255,46,46,.13)!important;border-color:#ff2e2e!important;box-shadow:0 0 12px rgba(255,46,46,.28)!important}
body.dfx-cine-skin .ep-side .ep[class*="active"] [class*="n"],body.dfx-cine-skin .ep-side .ep[class*="active"] .ep-num{color:#ff2e2e!important}
body.dfx-cine-skin .player,body.dfx-cine-skin .ep-player,body.dfx-cine-skin [class*="player"]{border-radius:16px!important;overflow:hidden!important;border:1px solid rgba(255,255,255,.1)!important;box-shadow:0 20px 44px rgba(0,0,0,.5)!important}
/* hamburguesa + drawer (solo escritorio) */
.cx5-drawer{position:fixed;top:0;right:-300px;height:100vh;width:280px;z-index:95;background:rgba(10,10,14,.98);border-left:1px solid rgba(255,255,255,.1);transition:right .25s ease;padding:64px 14px 20px;display:flex;flex-direction:column;gap:2px;backdrop-filter:blur(20px)}
.cx5-drawer.open{right:0}
.cx5-drawer a{display:flex;align-items:center;gap:12px;padding:13px 14px;font-size:14px;font-weight:600;color:#e4e4e7;text-decoration:none;border-radius:11px}
.cx5-drawer a:hover{background:rgba(255,255,255,.07)}
.cx5-drawer a i{width:20px;text-align:center;color:#9a9ea7}
.cx5-drawer .sep{height:1px;background:rgba(255,255,255,.09);margin:8px 6px}
.cx5-doverlay{position:fixed;inset:0;z-index:92;background:rgba(0,0,0,.42);opacity:0;visibility:hidden;pointer-events:none;transition:opacity .2s ease,visibility .2s}
.cx5-doverlay.open{opacity:1;visibility:visible;pointer-events:auto}
@media(min-width:768px){
  #dfxAiFab{display:none!important}
  .cx5-bnav{display:none!important}
}
/* cabecera slim estilo mockup */
.cx5-topbar{position:fixed;top:0;left:0;right:0;z-index:55;display:flex;align-items:center;gap:10px;padding:10px 14px;
  background:rgba(8,8,10,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.08)}
.cx5-mark2{width:28px;height:28px;border-radius:8px;background:#ff2e2e;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:11px;box-shadow:0 4px 14px rgba(255,46,46,.4);text-decoration:none;flex:none}
.cx5-brand{font-size:16px;font-weight:800;color:#fff;letter-spacing:-.01em}
.cx5-brand b{color:#ff2e2e}
.cx5-tbtn{margin-left:auto;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#d4d4d8;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:13px}
.cx5-wrap{width:100%;max-width:560px;padding:12px 12px 120px}
.cx5-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
.cx5-sheet{position:fixed;top:56px;right:10px;z-index:70;background:rgba(14,14,18,.97);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:6px;display:none;flex-direction:column;min-width:190px;box-shadow:0 16px 40px rgba(0,0,0,.6)}
.cx5-sheet.open{display:flex}
.cx5-sheet a{display:block;padding:11px 14px;font-size:13px;color:#e4e4e7;text-decoration:none;border-radius:9px}
.cx5-sheet a:hover{background:rgba(255,255,255,.07)}
.cx5-catpill{display:inline-flex;align-items:center;gap:6px;font-size:11px;font-weight:600;color:#d4d4d8;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);border-radius:999px;padding:7px 12px;cursor:pointer;font-family:inherit;white-space:nowrap;max-width:132px;overflow:hidden;text-overflow:ellipsis}
body.dfx-cine-skin .cx5-catmenu{display:none;position:fixed;top:56px;left:10px;z-index:85;background:rgba(14,14,18,.97);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:6px;min-width:220px;box-shadow:0 16px 40px rgba(0,0,0,.65);max-height:70vh;overflow:auto}
body.dfx-cine-skin .cx5-catmenu.cx5-open{display:block}
body.dfx-cine-skin .cx5-catmenu button,body.dfx-cine-skin .cx5-catmenu a{display:flex;width:100%;text-align:left;align-items:center;gap:9px;padding:11px 12px;border:0;background:none;color:#e4e4e7;border-radius:9px;font-size:13px;font-family:inherit;cursor:pointer;text-decoration:none}
body.dfx-cine-skin .cx5-catmenu button:hover,body.dfx-cine-skin .cx5-catmenu a:hover{background:rgba(255,255,255,.08)}
body.dfx-cine-skin .cx5-catmenu .on{color:#ff2e2e;font-weight:700}
/* ── ESCRITORIO ── */
@media(min-width:768px){
  .cx5-wrap{max-width:1120px;padding:20px 28px 130px}
  .cx5-hero{min-height:460px;padding:30px}
  .cx5-title{font-size:42px}
  .cx5-grid{grid-template-columns:repeat(auto-fill,minmax(158px,1fr))!important;gap:16px}
  .cx5-top{width:172px}
  .cx5-tc{width:124px;height:186px}
  .cx5-tn{font-size:84px}
  .cx5-row a.cx5-card,.cx5-row .cx5-card{width:158px!important}
  .cx5-sheet{top:64px}
}
@media (prefers-reduced-motion:reduce){.cx5-chip-live .dot{animation:none}}
`;
  if (!document.getElementById('dfxCineStyle')) {
    var style = document.createElement('style');
    style.id = 'dfxCineStyle'; style.textContent = CSS;
    document.head.appendChild(style);
  }

  var GENRE = null, SHOW = 18, CAT_MOVED = false, HOME_TIMER = null, LAST_COUNT = -1;
  function posterSig() {
    var series = getDB().series || [];
    var n = series.length, loc = 0;
    for (var i = 0; i < Math.min(n, 500); i++) {
      var im = imgOf(series[i]);
      if (im && (im.indexOf('/img/') !== -1 || im.indexOf('public/img') !== -1)) loc++;
    }
    return n + ':' + loc;
  }
  function startHomeWatch() {
    stopHomeWatch();
    LAST_COUNT = posterSig();
    HOME_TIMER = setInterval(function () {
      if (!document.body.classList.contains('dfx-cine-home')) { stopHomeWatch(); return; }
      var sig = posterSig();
      if (sig !== LAST_COUNT) { LAST_COUNT = sig; renderCine(); }
    }, 1100);
  }
  function stopHomeWatch() { if (HOME_TIMER) { clearInterval(HOME_TIMER); HOME_TIMER = null; } }
  function pageEnhance() {
    try {
      var cb = document.getElementById('cx5Cat');
      if (cb) cb.innerHTML = '<i class="fa-solid fa-table-cells" style="font-size:10px"></i>' + esc(catLabel()) + ' ▾';
      var h = location.hash || '#/';
      document.body.classList.toggle('cx5-clean', h.indexOf('#/search') === 0 || h.indexOf('#/series') === 0 || h.indexOf('#/movies') === 0);
      /* ocultar rótulo 'Servidores' */
      document.querySelectorAll('button, .abtn, .tbtn').forEach(function (b) {
        var t = (b.textContent || '').trim();
        if (t === 'Servidores' || t === 'SERVIDORES') b.style.display = 'none';
      });
      /* servidores: segmented control con indicador deslizante + etiquetas limpias */
      var srv = Array.prototype.slice.call(document.querySelectorAll('button[class*="servidor"], .server-btn, div[class*="servidores"] button, div[class*="servidores"] a'));
      srv = srv.filter(function (b) { var t = (b.textContent || '').trim(); return t && t !== 'Servidores' && b.offsetParent !== null; });
      if (srv.length >= 2 && !srv[0].parentNode.classList.contains('cx5-seg')) {
        srv.forEach(function (b) {
          var t = (b.textContent || '').trim();
          var m = t.match(/([a-z0-9-]+)\.(com|ru|net|org|tv|io)/i);
          if (m) {
            var host = m[1].charAt(0).toUpperCase() + m[1].slice(1);
            var q = (t.match(/FHD|4K|HD/i) || ['HD'])[0].toUpperCase();
            b.textContent = '[' + q + '] ' + host;
          }
        });
        var seg = document.createElement('div'); seg.className = 'cx5-seg';
        srv[0].parentNode.insertBefore(seg, srv[0]);
        srv.forEach(function (b) { seg.appendChild(b); });
        var ind = document.createElement('span'); ind.className = 'cx5-seg-ind'; seg.appendChild(ind);
        var move = function () {
          var act = seg.querySelector('.active') || seg.querySelector('[class*="active"]') || srv[0];
          ind.style.width = act.offsetWidth + 'px';
          ind.style.left = act.offsetLeft + 'px';
        };
        srv.forEach(function (b) { b.addEventListener('click', function () { setTimeout(move, 80); }); });
        setTimeout(move, 120);
      }
      /* grid numérico de episodios + toggle grilla/lista */
      var side = document.querySelector('.ep-side');
      if (side && !side.querySelector('.cx5-epmodes')) {
        var rows = Array.prototype.slice.call(side.querySelectorAll('.ep, a.ep, .episode-item, div[class*="episodio"]'));
        rows = rows.filter(function (r) { return /\b\d{1,4}\b/.test(r.textContent || ''); });
        if (rows.length >= 4) {
          var bar = document.createElement('div'); bar.className = 'cx5-epmodes';
          var bGrid = document.createElement('button'); bGrid.textContent = '▦ Grilla'; bGrid.className = 'on';
          var bList = document.createElement('button'); bList.textContent = '☰ Lista';
          bar.appendChild(bGrid); bar.appendChild(bList);
          var grid = document.createElement('div'); grid.className = 'cx5-epgrid';
          rows.forEach(function (r) {
            var n = ((r.textContent || '').match(/\b\d{1,4}\b/) || ['?'])[0];
            var g = document.createElement('button');
            g.textContent = n;
            if (r.querySelector('.fa-check, [class*="check"], .fa-circle-check') || /visto/i.test(r.textContent || '')) g.classList.add('seen');
            if (r.classList.contains('active') || r.className.indexOf('active') !== -1 || (r.querySelector('[class*="active"], .fa-volume-high, .fa-play'))) g.classList.add('cur');
            g.addEventListener('click', function () { r.click(); });
            grid.appendChild(g);
          });
          side.insertBefore(bar, side.firstChild);
          side.insertBefore(grid, bar.nextSibling);
          bGrid.addEventListener('click', function () { grid.style.display = 'grid'; side.classList.add('cx5-eplist-hidden'); bGrid.classList.add('on'); bList.classList.remove('on'); });
          bList.addEventListener('click', function () { grid.style.display = 'none'; side.classList.remove('cx5-eplist-hidden'); bList.classList.add('on'); bGrid.classList.remove('on'); });
        }
      }
      /* ambilight con la portada de la serie */
      var player = document.querySelector('.ep-main, .player, [class*="player"]');
      if (player && !player.parentNode.classList.contains('cx5-amb')) {
        var amb = document.createElement('div'); amb.className = 'cx5-amb';
        player.parentNode.insertBefore(amb, player);
        amb.appendChild(player);
        var bg = document.createElement('div'); bg.className = 'cx5-amb-bg';
        var poster = document.querySelector('.detail-hero img, .ep-main img, .hero img, .card .poster img');
        if (poster && poster.src) bg.style.backgroundImage = 'url(' + poster.src + ')';
        else bg.style.background = 'radial-gradient(60% 60% at 50% 40%, rgba(255,46,46,.35), transparent 70%)';
        amb.insertBefore(bg, player);
      }
    } catch (e) {}
  }
  function catLabel() {
    var cur = glb('currentCatalog') || '';
    var cats = glb('CATALOGS') || [];
    for (var i = 0; i < cats.length; i++) if (cats[i].key === cur) return cats[i].name || cats[i].label || cur;
    return cur || 'Catálogo';
  }
  function moveCatMenu() {
    if (CAT_MOVED) return; CAT_MOVED = true;
    var m = document.querySelector('.catalog-wrap .catalog-menu') || document.querySelector('.catalog-menu');
    if (m) { document.body.appendChild(m); m.classList.add('cx5-catmenu'); }
  }
  function getDB() { return glb('DB') || { series: [], genres: [] }; }
  function findS(ref) { var f = glb('findSeries'); return f ? f(ref) : null; }
  function imgOf(x) { var f = glb('getSeriesImage'); return f ? f(x) : (x && x.image) || ''; }
  function titleOf(x) { var f = glb('cleanTitle'); return f ? f(x) : (x && x.title) || ''; }
  function genresOf(x) { var f = glb('seriesGenres'); return f ? f(x) : (x && x.genres) || []; }
  function slugOf(x) { return (x && (x.slug || x.id)) || ''; }
  function isAiring(x) { return /emisi/i.test(x.status || ''); }
  function isDone(x) { return /finaliz/i.test(x.status || ''); }
  function bdg(s) {
    if (isAiring(s)) return '<span class="cx5-bdg live">EN EMISIÓN</span>';
    if (isDone(s)) return '<span class="cx5-bdg off">FINALIZADO</span>';
    return '';
  }
  function imgFallbacks(s) {
    var list = [];
    var im = imgOf(s); if (im) list.push(im);
    if (s && s.image && s.image !== im && !/IcoPrueba/.test(s.image)) list.push(s.image);
    try {
      var so = glb('seasonsOf') ? seasonsOf(s.id) : [];
      for (var i = 0; i < so.length && i < 3; i++) if (so[i].image && !/IcoPrueba/.test(so[i].image)) list.push(so[i].image);
    } catch (e) {}
    return list.slice(0, 4);
  }
  window.dfxImgFb = function (imgEl) {
    var fb = (imgEl.getAttribute('data-fb') || '').split('|').filter(Boolean);
    var cur = imgEl.getAttribute('src') || '';
    var idx = fb.indexOf(cur);
    if (idx !== -1 && idx + 1 < fb.length) { imgEl.src = fb[idx + 1]; return; }
    var t = imgEl.getAttribute('data-t') || '?';
    var d = document.createElement('div');
    d.className = 'cx5-ph';
    d.textContent = t.charAt(0).toUpperCase();
    imgEl.parentNode.insertBefore(d, imgEl);
    imgEl.remove();
  };
  function po(s, cls) {
    var fb = imgFallbacks(s);
    if (!fb.length) {
      var t0 = titleOf(s) || '?';
      return '<div class="' + cls + '"><div class="cx5-ph">' + esc(t0.charAt(0).toUpperCase()) + '</div></div>';
    }
    return '<div class="' + cls + '"><img loading="lazy" src="' + esc(fb[0]) + '" data-fb="' + esc(fb.join('|')) + '" data-t="' + esc(titleOf(s)) + '" alt="" onerror="dfxImgFb(this)"></div>';
  }
  function link(s) { return '#/series/' + encodeURIComponent(slugOf(s)); }

  function renderCine() {
    var app = document.getElementById('app');
    if (!app) return;
    loadLibs();
    moveCatMenu();
    document.body.classList.add('dfx-cine-skin');
    var DB = getDB();
    var series = DB.series || [];
    if (!series.length) { app.innerHTML = '<div style="padding:90px 20px;text-align:center;color:#a1a1aa">Cargando catálogo…</div>'; setTimeout(renderCine, 900); return; }

    var favIds = {};
    try { (glb('getFavs') ? getFavs() : []).forEach(function (id) { favIds[id] = 1; }); } catch (e) {}
    var seen = {};
    var pool = series.filter(function (s) { return imgOf(s); });
    var feat = pool.filter(function (s) { return favIds[s.id]; }).concat(pool.filter(isAiring), pool)
      .filter(function (s) { return seen[s.id] ? false : (seen[s.id] = 1); });
    var top10 = pool.filter(isAiring).concat(pool).filter(function (s, i, a) { return a.indexOf(s) === i; }).slice(0, 10);

    var html = '<div class="cx5-topbar">' +
      '<button class="cx5-tbtn cx5-ham" id="cx5Ham" aria-label="Menú" style="flex:none"><i class="fa-solid fa-bars" style="font-size:14px"></i></button>' +
      '<button class="cx5-catpill" id="cx5Cat" aria-label="Cambiar catálogo"><i class="fa-solid fa-table-cells" style="font-size:10px"></i>' + esc(catLabel()) + ' ▾</button>' +
      '<span class="cx5-brand">Donghua<b>Flix</b></span>' +
      '<a class="cx5-tbtn" href="#/mi-donghua" aria-label="Cuenta" style="position:relative"><i class="fa-solid fa-user" style="font-size:12px"></i><span style="position:absolute;bottom:1px;right:1px;width:9px;height:9px;border-radius:50%;background:#ff2e2e;border:2px solid #08080a"></span></a>' +
      '<a class="cx5-tbtn" href="#/search" aria-label="Buscar"><i class="fa-solid fa-magnifying-glass" style="font-size:12px"></i></a>' +
      '<button class="cx5-tbtn" id="cx5Sync" aria-label="Sincronizar" style="cursor:pointer"><i class="fa-solid fa-rotate" style="font-size:12px"></i></button>' +
      '<a class="cx5-tbtn" href="#/classic" aria-label="Versión clásica"><i class="fa-solid fa-xmark" style="font-size:14px"></i></a>' +
      '</div>' +
      '<div class="cx5-sheet" id="cx5Sheet">' +
      '<a href="#/descubrir">Descubrir</a>' +
      '<a href="#/genres">Géneros</a>' +
      '<a href="#/airing">En emisión</a>' +
      '<a href="#/movies">Películas</a>' +
      '<a href="#/mi-donghua">Mi Donghua</a>' +
      '<a href="#/classic" style="color:#ff5c5c">Versión clásica</a>' +
      '</div>' +
      '<div class="cx5-doverlay" id="cx5DOverlay"></div>' +
      '<nav class="cx5-drawer" id="cx5Drawer">' +
      '<a href="#/cine"><i class="fa-solid fa-house"></i>Inicio</a>' +
      '<a href="#/series"><i class="fa-solid fa-tv"></i>Series</a>' +
      '<a href="#/movies"><i class="fa-solid fa-film"></i>Películas</a>' +
      '<a href="#/search"><i class="fa-solid fa-magnifying-glass"></i>Buscar</a>' +
      '<a href="#/mylist"><i class="fa-solid fa-heart"></i>Mi lista</a>' +
      '<div class="sep"></div>' +
      '<a href="#/descubrir"><i class="fa-solid fa-compass"></i>Descubrir</a>' +
      '<a href="#/genres"><i class="fa-solid fa-layer-group"></i>Géneros</a>' +
      '<a href="#/airing"><i class="fa-solid fa-satellite-dish"></i>En emisión</a>' +
      '<a href="#/mi-donghua"><i class="fa-solid fa-user"></i>Mi Donghua</a>' +
      '<div class="sep"></div>' +
      '<a href="#/classic"><i class="fa-solid fa-arrow-rotate-left"></i>Versión clásica</a>' +
      '</nav><div class="cx5-wrap">';

    /* HERO */
    var h = feat[0];
    if (h) {
      var im = imgOf(h);
      html += '<section class="cx5-hero">' +
        (im ? '<div class="cx5-hero-bg" style="background-image:url(' + esc(im) + ')"></div>' : '') +
        '<div style="position:relative;z-index:1;width:100%">' +
        '<div style="display:flex;gap:6px;align-items:center">' +
        '<span class="cx5-chip-ex">EXCLUSIVO</span>' +
        (isAiring(h) ? '<span class="cx5-chip-live"><span class="dot"></span>EN EMISIÓN</span>' : (isDone(h) ? '<span class="cx5-chip-off">FINALIZADO</span>' : '')) +
        '</div>' +
        '<h1 class="cx5-title">' + esc(titleOf(h)) + '</h1>' +
        '<div class="cx5-meta">' + esc(genresOf(h).slice(0, 3).join(' · ')) + (h.totalEpisodes ? ' · ' + h.totalEpisodes + ' episodios' : '') + '</div>' +
        '<div class="cx5-hero-btns">' +
        '<a class="cx5-play" href="' + link(h) + '"><i class="fa-solid fa-play" style="font-size:10px"></i>Ver serie</a>' +
        '<a class="cx5-add" href="' + link(h) + '"><i class="fa-solid fa-plus" style="font-size:12px"></i></a>' +
        '</div></div></section>';
    }

    /* SIGUE VIENDO */
    try {
      var hist = glb('getHistory') ? getHistory() : {};
      var prog = glb('seriesProgress');
      var cont = Object.keys(hist).map(function (id) { return findS(id); })
        .filter(function (s) { return s && imgOf(s); })
        .filter(function (s) { var p = prog ? prog(s) : 0; return p > 0 && p < 100; }).slice(0, 12);
      if (cont.length) {
        html += '<section style="margin-top:22px"><h2 class="cx5-sech">Sigue viendo</h2><div class="cx5-row">';
        cont.forEach(function (s) {
          var p = prog ? prog(s) : 0;
          html += '<a class="cx5-card" style="flex:none;width:118px" href="' + link(s) + '"><div class="cx5-po2">' +
            po(s, '') +
            '<div class="cx5-pr"><i style="width:' + Math.round(p) + '%"></i></div></div>' +
            '<div class="cx5-ct">' + esc(titleOf(s)) + '</div></a>';
        });
        html += '</div></section>';
      }
    } catch (e) {}

    /* TOP 10 */
    if (top10.length) {
      html += '<section style="margin-top:22px"><h2 class="cx5-sech">Top 10 hoy<span class="n">' + esc(glb('currentCatalog') || 'DonghuaFlix') + '</span></h2><div class="cx5-row">';
      top10.forEach(function (s, i) {
        html += '<a class="cx5-top" href="' + link(s) + '"><span class="cx5-tn">' + (i + 1) + '</span>' +
          '<span class="cx5-tc" style="display:block">' + po(s, '') +
          (isAiring(s) ? '<span class="cx5-bdg live" style="top:5px;left:5px">EN EMISIÓN</span>' : '') +
          '</span></a>';
      });
      html += '</div></section>';
    }

    /* GÉNEROS pills */
    var genres = [];
    try { (DB.genres || []).forEach(function (g) { genres.push(g.name || g); }); } catch (e) {}
    if (!genres.length) series.forEach(function (s) { genresOf(s).forEach(function (g) { if (genres.indexOf(g) === -1) genres.push(g); }); });
    if (genres.length) {
      html += '<section style="margin-top:22px"><div class="cx5-pills">' +
        '<button class="cx5-pill' + (!GENRE ? ' on' : '') + '" data-g="">Todo</button>' +
        genres.slice(0, 12).map(function (g) { return '<button class="cx5-pill' + (GENRE === g ? ' on' : '') + '" data-g="' + esc(g) + '">' + esc(g) + '</button>'; }).join('') +
        '</div></section>';
    }

    /* CATÁLOGO grid 3col */
    var grid = GENRE ? series.filter(function (s) { return genresOf(s).some(function (g) { return fold(g) === fold(GENRE); }); }) : series;
    html += '<section style="margin-top:18px"><h2 class="cx5-sech">' + esc(GENRE || 'Recomendados') + '<span class="n">' + grid.length + '</span></h2>' +
      '<div class="cx5-grid" id="cx5Grid">' +
      grid.slice(0, SHOW).map(function (s) {
        return '<a class="cx5-card" href="' + link(s) + '">' + po(s, 'cx5-po') + bdg(s) +
          '<div class="cx5-ct">' + esc(titleOf(s)) + '</div></a>';
      }).join('') + '</div>';
    if (grid.length > SHOW) html += '<button class="cx5-more" id="cx5More">Cargar más (' + (grid.length - SHOW) + ')</button>';
    html += '</section>';

    html += '</div>';

    /* bottom nav */
    html += '<nav class="cx5-bnav">' +
      '<a href="#/cine" class="on"><i class="fa-solid fa-house"></i><span>Inicio</span></a>' +
      '<a href="#/series"><i class="fa-solid fa-tv"></i><span>Series</span></a>' +
      '<a href="#/movies"><i class="fa-solid fa-film"></i><span>Películas</span></a>' +
      '<a href="#/search"><i class="fa-solid fa-magnifying-glass"></i><span>Buscar</span></a>' +
      '<a href="#/mylist"><i class="fa-solid fa-heart"></i><span>Mi lista</span></a>' +
      '<a href="#" id="cx5More2"><i class="fa-solid fa-ellipsis"></i><span>Más</span></a>' +
      '</nav>';

    app.innerHTML = html;

    var sheet = document.getElementById('cx5Sheet');
    function toggleSheet(force){ if(!sheet) return; var show = force!==undefined?force:!sheet.classList.contains('open'); sheet.classList.toggle('open',show); }
    var m2 = document.getElementById('cx5More2');
    if (m2) m2.addEventListener('click', function(e){ e.preventDefault(); toggleSheet(); });
    if (sheet) sheet.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', function(){ toggleSheet(false); }); });
    app.querySelectorAll('.cx5-pill').forEach(function (c) {
      c.addEventListener('click', function () { GENRE = c.getAttribute('data-g') || null; SHOW = 18; renderCine(); });
    });
    var more = document.getElementById('cx5More');
    if (more) more.addEventListener('click', function () {
      SHOW += 18;
      document.getElementById('cx5Grid').innerHTML = grid.slice(0, SHOW).map(function (s) {
        return '<a class="cx5-card" href="' + link(s) + '">' + po(s, 'cx5-po') + bdg(s) +
          '<div class="cx5-ct">' + esc(titleOf(s)) + '</div></a>';
      }).join('');
      if (SHOW >= grid.length) more.remove(); else more.textContent = 'Cargar más (' + (grid.length - SHOW) + ')';
    });
    window.scrollTo(0, 0);
    startHomeWatch();
  }

  function ensureGlobalChrome() {
    if (document.getElementById('cx5GlobalBar')) return;
    loadLibs();
    moveCatMenu();
    var bar = document.createElement('div');
    bar.id = 'cx5GlobalBar';
    bar.innerHTML =
      '<div class="cx5-topbar">' +
      '<button class="cx5-tbtn cx5-ham" id="cx5Ham" aria-label="Menú" style="flex:none"><i class="fa-solid fa-bars" style="font-size:14px"></i></button>' +
      '<button class="cx5-catpill" id="cx5Cat" aria-label="Cambiar catálogo"><i class="fa-solid fa-table-cells" style="font-size:10px"></i>' + esc(catLabel()) + ' ▾</button>' +
      '<a class="cx5-brand" href="#/" style="text-decoration:none">Donghua<b>Flix</b></a>' +
      '<a class="cx5-tbtn" href="#/mi-donghua" aria-label="Cuenta" style="position:relative"><i class="fa-solid fa-user" style="font-size:12px"></i><span style="position:absolute;bottom:1px;right:1px;width:9px;height:9px;border-radius:50%;background:#ff2e2e;border:2px solid #08080a"></span></a>' +
      '<a class="cx5-tbtn" href="#/search" aria-label="Buscar"><i class="fa-solid fa-magnifying-glass" style="font-size:12px"></i></a>' +
      '<button class="cx5-tbtn" id="cx5Sync" aria-label="Sincronizar" style="cursor:pointer"><i class="fa-solid fa-rotate" style="font-size:12px"></i></button>' +
      '<a class="cx5-tbtn" href="#/" aria-label="Inicio"><i class="fa-solid fa-house" style="font-size:13px"></i></a>' +
      '</div>' +
      '<div class="cx5-sheet" id="cx5Sheet">' +
      '<a href="#/descubrir">Descubrir</a><a href="#/genres">Géneros</a><a href="#/airing">En emisión</a>' +
      '<a href="#/movies">Películas</a><a href="#/mi-donghua">Mi Donghua</a>' +
      '<a href="#/classic" style="color:#ff5c5c">Versión clásica</a></div>' +
      '<div class="cx5-doverlay" id="cx5DOverlay"></div>' +
      '<nav class="cx5-drawer" id="cx5Drawer">' +
      '<a href="#/"><i class="fa-solid fa-house"></i>Inicio</a>' +
      '<a href="#/series"><i class="fa-solid fa-tv"></i>Series</a>' +
      '<a href="#/movies"><i class="fa-solid fa-film"></i>Películas</a>' +
      '<a href="#/search"><i class="fa-solid fa-magnifying-glass"></i>Buscar</a>' +
      '<a href="#/mylist"><i class="fa-solid fa-heart"></i>Mi lista</a>' +
      '<div class="sep"></div>' +
      '<a href="#/descubrir"><i class="fa-solid fa-compass"></i>Descubrir</a>' +
      '<a href="#/genres"><i class="fa-solid fa-layer-group"></i>Géneros</a>' +
      '<a href="#/airing"><i class="fa-solid fa-satellite-dish"></i>En emisión</a>' +
      '<a href="#/mi-donghua"><i class="fa-solid fa-user"></i>Mi Donghua</a>' +
      '<div class="sep"></div>' +
      '<a href="#/classic"><i class="fa-solid fa-arrow-rotate-left"></i>Versión clásica</a>' +
      '</nav>';
    document.body.appendChild(bar);
    var sheet = document.getElementById('cx5Sheet');
    var drawer = document.getElementById('cx5Drawer');
    var doverlay = document.getElementById('cx5DOverlay');
    var ham = document.getElementById('cx5Ham');
    function toggleSheet(force){ if(!sheet) return; var show = force!==undefined?force:!sheet.classList.contains('open'); sheet.classList.toggle('open',show); }
    function toggleDrawer(force){
      if(!drawer) return;
      var show = force!==undefined?force:!drawer.classList.contains('open');
      drawer.classList.toggle('open',show);
      if(doverlay) doverlay.classList.toggle('open',show);
    }
    if (ham) ham.addEventListener('click', function(e){ e.stopPropagation(); toggleDrawer(); });
    if (doverlay) doverlay.addEventListener('click', function(){ toggleDrawer(false); });
    if (drawer) drawer.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', function(){ toggleDrawer(false); }); });
    if (sheet) sheet.querySelectorAll('a').forEach(function(a){ a.addEventListener('click', function(){ toggleSheet(false); }); });
    var catBtn = document.getElementById('cx5Cat');
    var catMenu = document.querySelector('.cx5-catmenu');
    if (catBtn && catMenu) {
      catBtn.addEventListener('click', function(e){ e.stopPropagation(); catMenu.classList.toggle('cx5-open'); });
      catMenu.addEventListener('click', function(e){
        if (!e.target.closest('button,a')) return;
        catMenu.classList.remove('cx5-open');
      });
      document.addEventListener('click', function(e){
        if (catMenu.classList.contains('cx5-open') && !e.target.closest('.cx5-catmenu') && !e.target.closest('#cx5Cat')) catMenu.classList.remove('cx5-open');
      });
    }
    var sy = document.getElementById('cx5Sync');
    if (sy) sy.addEventListener('click', function () {
      var f = glb('syncAll') || glb('forceSync') || glb('refreshCatalog') || glb('syncCatalog') || glb('reloadCatalog');
      try { if (typeof f === 'function') { f(); return; } } catch (e) {}
      location.reload();
    });
  }
  function patch() {
    ensureGlobalChrome();
    var r = glb('route');
    if (typeof r !== 'function' || r.__cine5) return;
    function isCineHash(h) { h = h || location.hash || '#/'; return h === '#/' || h === '' || h.indexOf('#/cine') === 0 || h === '#/home'; }
    function applyMode() {
      if (isCineHash()) {
        document.body.classList.add('dfx-cine-skin', 'dfx-cine-home');
        renderCine();
      } else {
        document.body.classList.remove('dfx-cine-home');
        document.body.classList.add('dfx-cine-skin');
      }
    }
    var w = function () {
      if (isCineHash()) {
        document.body.classList.add('dfx-cine-skin', 'dfx-cine-home');
        renderCine(); return;
      }
      document.body.classList.remove('dfx-cine-home');
      document.body.classList.add('dfx-cine-skin');
      var ret = r.apply(this, arguments);
      setTimeout(pageEnhance, 250);
      return ret;
    };
    w.__cine5 = true; window.route = w;
    setTimeout(function () {
      try { document.body.classList.remove('dfx-amoled'); localStorage.setItem('dfx-theme-v2', 'classic'); } catch (e) {}
      applyMode();
    }, 500);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(patch, 300); });
  else setTimeout(patch, 300);
  window.addEventListener('hashchange', function () {
    var h = location.hash || '#/';
    if (h === '#/' || h === '' || h.indexOf('#/cine') === 0 || h === '#/home') {
      document.body.classList.add('dfx-cine-skin', 'dfx-cine-home');
      renderCine();
    } else {
      document.body.classList.remove('dfx-cine-home');
      document.body.classList.add('dfx-cine-skin');
    }
    var d5 = document.getElementById('cx5Drawer');
    var o5 = document.getElementById('cx5DOverlay');
    if (d5) d5.classList.remove('open');
    if (o5) o5.classList.remove('open');
    setTimeout(pageEnhance, 300);
  });
})();
