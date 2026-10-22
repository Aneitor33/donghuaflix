// ══════════════════════════════════════════════════════════
//  dfx-theme.js — DonghuaFlix: Diseño AMOLED (v2) — CAPA OPCIONAL
//  v2: selectores reales de styles.css / dfx.css / dfx-final.css.
//  No modifica ningún archivo. Activo solo con body.dfx-amoled.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof document === 'undefined' || document.getElementById('dfxThemeStyle')) return;
  var KEY = 'dfx-theme-v2';

  var CSS = `
/* ══ TOKENS AMOLED ══ */
body.dfx-amoled{
  --red:#ff2e2e; --red2:#ff6b6b;
  --surface:#000; --surface2:#0b0b0e;
  --glass:rgba(14,14,18,.8); --glass-brd:rgba(255,255,255,.13);
  --line:rgba(255,255,255,.09); --muted:#8b8f98;
  --radius:12px;
  background:#000 !important;
  background-image:radial-gradient(130% 55% at 50% -10%,rgba(255,46,46,.10),transparent 55%) !important;
  background-attachment:fixed;
}
body.dfx-amoled .bg-ambience{opacity:.3}

/* ══ NAVBAR ══ */
body.dfx-amoled .nav{background:linear-gradient(rgba(0,0,0,.85),rgba(0,0,0,.4) 70%,transparent)}
body.dfx-amoled .nav.scrolled{background:rgba(6,6,8,.92);backdrop-filter:blur(18px) saturate(1.3);border-bottom:1px solid var(--line)}
body.dfx-amoled .nav nav a{border-radius:999px}
body.dfx-amoled .nav nav a.active{background:var(--red) !important;color:#fff !important;border-color:var(--red) !important;box-shadow:0 4px 14px rgba(255,46,46,.35)}
body.dfx-amoled .brand b{color:var(--red)}
body.dfx-amoled .brand-mark{background:var(--red)}

/* ══ BOTONES: el cambio estrella (blanco → rojo AMOLED) ══ */
body.dfx-amoled .btn-x{border-radius:11px}
body.dfx-amoled .btn-x.play{background:var(--red) !important;color:#fff !important;box-shadow:0 8px 22px rgba(255,46,46,.35)}
body.dfx-amoled .btn-x.play:hover{background:#ff4a4a !important;color:#fff !important;box-shadow:0 10px 26px rgba(255,46,46,.45)}
body.dfx-amoled .btn-x.glass{background:rgba(18,18,24,.6);border:1px solid var(--glass-brd)}
body.dfx-amoled .btn-x.glass:hover{background:rgba(255,255,255,.14)}
body.dfx-amoled .abtn{border-radius:10px}
body.dfx-amoled .tbtn.on{background:var(--red);border-color:var(--red);color:#fff}

/* ══ TARJETAS Y PÓSTERES ══ */
body.dfx-amoled .card .poster{border:1px solid var(--line);box-shadow:0 8px 22px rgba(0,0,0,.55);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
body.dfx-amoled .card:hover .poster{transform:translateY(-4px);border-color:rgba(255,46,46,.55);box-shadow:0 16px 34px rgba(0,0,0,.65)}
body.dfx-amoled .card h3{font-size:13.5px;font-weight:600}
body.dfx-amoled .badge{background:var(--red) !important;color:#fff !important;border-radius:6px}
body.dfx-amoled .no-img{background:#0d0d11}
body.dfx-amoled .progress{height:3px}
body.dfx-amoled .progress span{background:var(--red);box-shadow:0 0 8px rgba(255,46,46,.7)}
body.dfx-amoled .fav-heart{color:#fff}
body.dfx-amoled .fav-heart.fav,body.dfx-amoled .fav-heart.on{color:var(--red)}

/* ══ HERO ══ */
body.dfx-amoled .hero::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(120% 90% at 72% 10%,rgba(255,46,46,.20),transparent 58%)}

/* ══ TOP 10 ══ */
body.dfx-amoled .top10-num{color:transparent;-webkit-text-stroke:2.5px var(--red);text-shadow:0 0 24px rgba(255,46,46,.35)}
body.dfx-amoled .top10-poster{border-radius:12px;border:1px solid var(--line)}
body.dfx-amoled .top10-item:hover .top10-poster{transform:translateY(-6px) scale(1.03)}

/* ══ CHIPS / FILTROS ══ */
body.dfx-amoled .chip{border-radius:999px}
body.dfx-amoled .chip.on,body.dfx-amoled .chip.active{background:var(--red) !important;border-color:var(--red) !important;color:#fff !important}
body.dfx-amoled .chip:hover{border-color:var(--red);color:#fff}

/* ══ PÁGINA DE EPISODIO / FICHA ══ */
body.dfx-amoled .ep-side,body.dfx-amoled .ep-main{border-radius:16px}
body.dfx-amoled .ep-num{color:var(--red);font-weight:700}
body.dfx-amoled .ep-info h4,body.dfx-amoled .ep-info .ep-title{font-weight:600}
body.dfx-amoled .season-picker select{border-radius:12px;border:1px solid var(--line)}
body.dfx-amoled .detail-hero::after{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(120% 90% at 60% 0%,rgba(255,46,46,.16),transparent 55%)}

/* ══ MENÚS / TOAST / INPUTS ══ */
body.dfx-amoled .catalog-menu,body.dfx-amoled .more-menu{background:rgba(12,12,16,.96);border:1px solid var(--glass-brd)}
body.dfx-amoled .catalog-menu button.on{color:var(--red)}
body.dfx-amoled #toast{background:rgba(14,14,18,.96);border:1px solid var(--glass-brd);border-radius:12px;backdrop-filter:blur(14px)}
body.dfx-amoled input,body.dfx-amoled select{border-radius:11px}
body.dfx-amoled input:focus{border-color:var(--red)}

/* ══ NAV INFERIOR MÓVIL ══ */
body.dfx-amoled .bottom-nav{background:rgba(7,7,9,.9);border-top:1px solid var(--line)}
body.dfx-amoled .bottom-nav .on,body.dfx-amoled .bottom-nav .active,body.dfx-amoled .bottom-nav [aria-current]{color:var(--red) !important}

/* ══ SKELETONS ══ */
body.dfx-amoled .skeleton{background:linear-gradient(100deg,#0d0d11 40%,#17171d 50%,#0d0d11 60%) !important;background-size:200% 100% !important;animation:dfxSh2 1.3s infinite !important}
@keyframes dfxSh2{to{background-position:-200% 0}}

/* ══ SCROLLBAR / FOCO / SELECCIÓN ══ */
body.dfx-amoled ::-webkit-scrollbar{width:9px;height:9px}
body.dfx-amoled ::-webkit-scrollbar-thumb{background:#1e1e24;border-radius:99px;border:2px solid #000}
body.dfx-amoled *:focus-visible{outline:2px solid var(--red);outline-offset:2px}
body.dfx-amoled ::selection{background:rgba(255,46,46,.35)}

/* ══ CONMUTADOR ══ */
#dfxThemeToggle{position:fixed;left:14px;bottom:calc(76px + env(safe-area-inset-bottom));z-index:94;
  display:flex;align-items:center;gap:8px;font-size:12px;color:#fff;font-family:inherit;
  background:rgba(14,14,18,.88);backdrop-filter:blur(14px);
  border:1px solid rgba(255,255,255,.16);border-radius:999px;padding:9px 14px;cursor:pointer;
  box-shadow:0 8px 22px rgba(0,0,0,.55);transition:transform .15s,border-color .15s}
#dfxThemeToggle:hover{transform:scale(1.04);border-color:rgba(255,46,46,.7)}
#dfxThemeToggle .dot{width:9px;height:9px;border-radius:50%;background:#8b8f98}
body.dfx-amoled #dfxThemeToggle .dot{background:#ff2e2e;box-shadow:0 0 8px rgba(255,46,46,.9)}
@media(min-width:901px){#dfxThemeToggle{bottom:18px}}
@media (prefers-reduced-motion:reduce){body.dfx-amoled .card .poster,body.dfx-amoled .card{transition:none}}
`;

  var style = document.createElement('style');
  style.id = 'dfxThemeStyle';
  style.textContent = CSS;
  document.head.appendChild(style);

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
  }

  var btn = document.createElement('button');
  btn.id = 'dfxThemeToggle';
  btn.setAttribute('aria-label', 'Cambiar diseño clásico / AMOLED');
  btn.addEventListener('click', function () {
    var on = document.body.classList.contains('dfx-amoled');
    apply(on ? 'classic' : 'amoled');
    toast(on ? 'Diseño clásico activado' : 'Diseño AMOLED activado');
  });

  function boot() {
    if (document.getElementById('dfxThemeToggle')) return;
    document.body.appendChild(btn);
    apply(current());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
