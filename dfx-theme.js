// ══════════════════════════════════════════════════════════
//  dfx-theme.js — DonghuaFlix: Diseño AMOLED (v2) — CAPA OPCIONAL
//  No modifica ningún archivo existente. Inyecta un tema completo
//  (colores + componentes) solo cuando body tiene .dfx-amoled.
//  Conmutador persistente: el usuario elige Diseño clásico / AMOLED.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof document === 'undefined' || document.getElementById('dfxThemeStyle')) return;
  var KEY = 'dfx-theme-v2';

  var CSS = [
    /* ── tokens AMOLED ── */
    'body.dfx-amoled{',
    '  --red:#ff2e2e;--red2:#ff5c5c;',
    '  --surface:#000000;--surface2:#0b0b0e;',
    '  --glass:rgba(14,14,18,.82);--glass-brd:rgba(255,255,255,.12);',
    '  --line:rgba(255,255,255,.09);--muted:#8b8f98;--shadow:0 12px 32px rgba(0,0,0,.7);',
    '  background:#000;',
    '  background-image:radial-gradient(120% 55% at 50% -8%,rgba(255,46,46,.10),transparent 55%);',
    '  background-attachment:fixed;',
    '}',
    'body.dfx-amoled .bg-ambience{opacity:.35}',
    /* ── cabecera y navegación (glass) ── */
    'body.dfx-amoled header.nav{',
    '  background:rgba(10,10,14,.8);backdrop-filter:blur(18px) saturate(1.3);',
    '  border-bottom:1px solid var(--line);',
    '}',
    'body.dfx-amoled .nav-actions button,body.dfx-amoled .nav a{transition:color .15s,background .15s}',
    'body.dfx-amoled .bottom-nav{',
    '  background:rgba(8,8,11,.88);backdrop-filter:blur(20px) saturate(1.3);',
    '  border-top:1px solid var(--line);',
    '}',
    'body.dfx-amoled .bottom-nav button.active,body.dfx-amoled .bottom-nav button[aria-current]{color:var(--red)}',
    'body.dfx-amoled .catalog-wrap>button,body.dfx-amoled .nav-actions .btn-x{',
    '  border-radius:10px;border:1px solid var(--line);background:rgba(255,255,255,.04)',
    '}',
    'body.dfx-amoled .catalog-menu,body.dfx-amoled .more-menu{',
    '  background:rgba(14,14,18,.96);backdrop-filter:blur(20px);',
    '  border:1px solid var(--glass-brd);border-radius:14px;box-shadow:var(--shadow)',
    '}',
    /* ── secciones y raíles ── */
    'body.dfx-amoled .section{padding-top:6px}',
    'body.dfx-amoled .section-head h2{font-size:17px;font-weight:600;letter-spacing:.01em}',
    'body.dfx-amoled .section-head .muted{font-size:12px}',
    'body.dfx-amoled .eyebrow{letter-spacing:.14em;font-size:10.5px;color:var(--muted)}',
    /* ── tarjetas y pósteres ── */
    'body.dfx-amoled .card{border-radius:12px;transition:transform .2s ease}',
    'body.dfx-amoled .card .poster{',
    '  border-radius:12px;border:1px solid var(--line);overflow:hidden;',
    '  background:#0e0e12;aspect-ratio:2/3;',
    '  box-shadow:0 6px 18px rgba(0,0,0,.45);',
    '  transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease;',
    '}',
    'body.dfx-amoled .card .poster img{object-fit:cover;object-position:top center}',
    '@media(hover:hover){',
    '  body.dfx-amoled .card:hover .poster{transform:translateY(-4px) scale(1.03);border-color:rgba(255,46,46,.5);box-shadow:0 14px 30px rgba(0,0,0,.6)}',
    '}',
    'body.dfx-amoled .card .t{font-weight:500}',
    /* ── rejillas ── */
    'body.dfx-amoled .grid{gap:12px}',
    /* ── hero ── */
    'body.dfx-amoled .hero{',
    '  background:radial-gradient(120% 100% at 70% 0%,rgba(255,46,46,.22),transparent 60%);',
    '  border-radius:0 0 22px 22px;',
    '}',
    'body.dfx-amoled .hero-content{',
    '  background:linear-gradient(180deg,transparent,color-mix(in srgb,#000 82%,transparent));',
    '  border-radius:0 0 22px 22px;padding:18px;',
    '}',
    'body.dfx-amoled .hero-meta{color:#c9ccd2}',
    'body.dfx-amoled .hero-btns .btn-x.play.big{',
    '  background:var(--red);border-radius:11px;font-weight:600;',
    '  box-shadow:0 8px 22px rgba(255,46,46,.35);border:none;color:#fff',
    '}',
    'body.dfx-amoled .hero-btns .btn-x.glass,body.dfx-amoled .hero-btns .glass{',
    '  background:rgba(20,20,26,.55);backdrop-filter:blur(10px);border:1px solid var(--glass-brd);border-radius:11px;color:#fff',
    '}',
    'body.dfx-amoled .hero-dots button.on{background:var(--red)}',
    /* ── ficha de título ── */
    'body.dfx-amoled .detail-hero{border-radius:0 0 22px 22px}',
    'body.dfx-amoled .detail-hero-shade{',
    '  background:linear-gradient(180deg,rgba(0,0,0,.05),#000 92%);',
    '}',
    'body.dfx-amoled .chip,body.dfx-amoled .dfxChip{',
    '  border-radius:999px;border:1px solid var(--line);background:rgba(255,255,255,.03);',
    '  padding:6px 13px;font-size:12px;transition:all .15s',
    '}',
    'body.dfx-amoled .chip.on,body.dfx-amoled .dfxChip.on{',
    '  background:var(--red);border-color:var(--red);color:#fff',
    '}',
    'body.dfx-amoled .chips .chip:hover{border-color:rgba(255,46,46,.6);color:#fff}',
    /* ── botones y acciones ── */
    'body.dfx-amoled .abtn,body.dfx-amoled .tbtn,body.dfx-amoled .pg-btn,body.dfx-amoled .zbtn{',
    '  border-radius:10px;border:1px solid var(--line);transition:all .15s',
    '}',
    'body.dfx-amoled .abtn:hover,body.dfx-amoled .tbtn:hover{border-color:rgba(255,46,46,.6)}',
    'body.dfx-amoled .btn-x{border-radius:10px}',
    'body.dfx-amoled .pl-btn{border-radius:50%}',
    /* ── progreso, top10, badges ── */
    'body.dfx-amoled [class*="prog"] i,body.dfx-amoled [class*="progress"] i,body.dfx-amoled [class*="bar"] i{background:var(--red)}',
    'body.dfx-amoled .top10-num{color:var(--red);font-weight:700}',
    /* ── ajustes (dfx-core) ── */
    'body.dfx-amoled .dfxSetRow{border-bottom:1px solid var(--line);padding:13px 0}',
    'body.dfx-amoled .dfxSwitch{border-radius:999px;background:#1c1c22;transition:background .15s}',
    'body.dfx-amoled .dfxSwitch.on{background:var(--red)}',
    'body.dfx-amoled .dfxSeg{border-radius:10px;border:1px solid var(--line)}',
    'body.dfx-amoled .dfxSeg button.on{background:var(--red);color:#fff}',
    'body.dfx-amoled .dfxAv{border-radius:50%;box-shadow:0 0 0 2px rgba(255,46,46,.6)}',
    'body.dfx-amoled .dfxProfileCard,body.dfx-amoled .dfx7-section{',
    '  border:1px solid var(--line);border-radius:16px;background:rgba(255,255,255,.02)',
    '}',
    'body.dfx-amoled .dfxLbl{color:var(--muted)}',
    'body.dfx-amoled .dfxBig{font-weight:600}',
    /* ── estados: vacío, skeleton, toast ── */
    'body.dfx-amoled .empty{border:1px dashed var(--line);border-radius:18px}',
    'body.dfx-amoled .skeleton{',
    '  background:linear-gradient(100deg,#0e0e12 40%,#18181f 50%,#0e0e12 60%);',
    '  background-size:200% 100%;animation:dfxSh 1.3s infinite',
    '}',
    '@keyframes dfxSh{to{background-position:-200% 0}}',
    'body.dfx-amoled #toast{',
    '  background:rgba(16,16,20,.95);backdrop-filter:blur(14px);',
    '  border:1px solid var(--glass-brd);border-radius:12px;box-shadow:var(--shadow)',
    '}',
    /* ── buscador y filtros ── */
    'body.dfx-amoled .filters input,body.dfx-amoled input[type="search"]{',
    '  background:rgba(255,255,255,.04);border:1px solid var(--line);border-radius:12px;color:#fff',
    '}',
    'body.dfx-amoled .filters input:focus{border-color:var(--red)}',
    /* ── scrollbars y foco ── */
    'body.dfx-amoled ::-webkit-scrollbar{width:9px;height:9px}',
    'body.dfx-amoled ::-webkit-scrollbar-thumb{background:#222228;border-radius:99px;border:2px solid #000}',
    'body.dfx-amoled ::-webkit-scrollbar-track{background:transparent}',
    'body.dfx-amoled *:focus-visible{outline:2px solid var(--red);outline-offset:2px;border-radius:6px}',
    'body.dfx-amoled ::selection{background:rgba(255,46,46,.35)}',
    /* ── reproductor ── */
    'body.dfx-amoled .pl-overlay{background:linear-gradient(180deg,rgba(0,0,0,.35),transparent 30%,transparent 65%,rgba(0,0,0,.75))}',
    'body.dfx-amoled [class*="seek"] i,body.dfx-amoled [class*="seekbar"] i{background:var(--red)}',
    /* ── conmutador de tema ── */
    '#dfxThemeToggle{',
    '  position:fixed;left:14px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:94;',
    '  display:flex;align-items:center;gap:8px;',
    '  font-size:12px;color:var(--kimi,#fff);',
    '  background:rgba(16,16,20,.85);backdrop-filter:blur(14px);',
    '  border:1px solid rgba(255,255,255,.14);border-radius:999px;',
    '  padding:9px 14px;cursor:pointer;color:#fff;font-family:inherit;',
    '  box-shadow:0 8px 22px rgba(0,0,0,.5);transition:transform .15s,border-color .15s;',
    '}',
    '#dfxThemeToggle:hover{transform:scale(1.04);border-color:rgba(255,46,46,.7)}',
    '#dfxThemeToggle .dot{width:9px;height:9px;border-radius:50%;background:#ff2e2e;box-shadow:0 0 8px rgba(255,46,46,.9)}',
    'body.dfx-amoled #dfxThemeToggle .dot{background:#8b8f98;box-shadow:none}',
    '@media(min-width:901px){#dfxThemeToggle{bottom:18px}}',
    '@media (prefers-reduced-motion:reduce){body.dfx-amoled .card .poster,body.dfx-amoled .card{transition:none}}'
  ].join('\n');

  /* inyectar estilos */
  var style = document.createElement('style');
  style.id = 'dfxThemeStyle';
  style.textContent = CSS;
  document.head.appendChild(style);

  /* estado */
  function current() { try { return localStorage.getItem(KEY) || 'classic'; } catch (e) { return 'classic'; } }
  function apply(mode) {
    document.body.classList.toggle('dfx-amoled', mode === 'amoled');
    try { localStorage.setItem(KEY, mode); } catch (e) {}
    updateBtn();
  }
  function updateBtn() {
    var on = document.body.classList.contains('dfx-amoled');
    btn.innerHTML = '<span class="dot"></span>' + (on ? 'Diseño AMOLED' : 'Diseño clásico');
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function toast(msg) {
    var f = null;
    try { f = Function('return typeof showToast!=="undefined"?showToast:undefined')(); } catch (e) {}
    if (f) { f(msg); return; }
    var t = document.createElement('div');
    t.textContent = msg;
    t.style.cssText = 'position:fixed;left:50%;bottom:110px;transform:translateX(-50%);background:rgba(16,16,20,.95);border:1px solid rgba(255,255,255,.14);color:#fff;padding:10px 16px;border-radius:12px;font-size:12.5px;z-index:9999;font-family:inherit';
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 1800);
  }

  /* botón conmutador */
  var btn = document.createElement('button');
  btn.id = 'dfxThemeToggle';
  btn.setAttribute('aria-label', 'Cambiar diseño clásico / AMOLED');
  btn.addEventListener('click', function () {
    var on = document.body.classList.contains('dfx-amoled');
    apply(on ? 'classic' : 'amoled');
    toast(on ? 'Diseño clásico activado' : 'Diseño AMOLED activado');
  });

  function boot() {
    document.body.appendChild(btn);
    apply(current());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
