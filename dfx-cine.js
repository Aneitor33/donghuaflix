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
#app .cx5-nav{position:sticky;top:0;z-index:50;background:rgba(8,8,10,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.1);padding:0 16px;height:56px;display:flex;align-items:center;justify-content:space-between}
#app .cx5-mark{width:28px;height:28px;border-radius:8px;background:#ff2e2e;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:11px;box-shadow:0 4px 14px rgba(255,46,46,.4)}
#app .cx5-hero{position:relative;border-radius:16px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0f0f14;box-shadow:0 20px 44px rgba(0,0,0,.45);min-height:380px;display:flex;align-items:flex-end;padding:22px}
#app .cx5-hero-bg{position:absolute;inset:0;background-size:cover;background-position:center 20%}
#app .cx5-hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,8,10,.05) 30%,rgba(8,8,10,.75) 78%,#08080a 100%)}
#app .cx5-chip-ex{position:relative;z-index:1;display:inline-block;background:#ff2e2e;color:#fff;font-size:9px;font-weight:700;letter-spacing:.08em;padding:3px 8px;border-radius:6px}
#app .cx5-chip-live{position:relative;z-index:1;display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);border:1px solid rgba(52,211,153,.35);color:#34d399;font-size:9px;font-weight:600;padding:3px 8px;border-radius:6px}
#app .cx5-chip-live .dot{width:6px;height:6px;border-radius:50%;background:#34d399;box-shadow:0 0 6px rgba(52,211,153,.9);animation:cx5p 1.6s infinite}
#app .cx5-chip-off{position:relative;z-index:1;display:inline-flex;align-items:center;gap:5px;background:rgba(0,0,0,.6);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);color:#d4d4d8;font-size:9px;font-weight:600;padding:3px 8px;border-radius:6px}
@keyframes cx5p{0%,100%{opacity:1}50%{opacity:.35}}
#app .cx5-title{position:relative;z-index:1;font-size:26px;font-weight:900;color:#fff;line-height:1.12;margin:10px 0 6px;letter-spacing:-.01em;text-shadow:0 2px 18px rgba(0,0,0,.5)}
#app .cx5-meta{position:relative;z-index:1;font-size:11px;color:#d4d4d8;margin-bottom:6px}
#app .cx5-syn{position:relative;z-index:1;font-size:11px;color:#d4d4d8;line-height:1.5;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:14px}
#app .cx5-play{position:relative;z-index:1;flex:1;background:#ff2e2e;color:#fff;font-weight:700;font-size:12px;padding:11px 0;border-radius:12px;border:none;box-shadow:0 10px 24px rgba(255,46,46,.35);text-decoration:none;display:flex;align-items:center;justify-content:center;gap:8px}
#app .cx5-add{position:relative;z-index:1;width:40px;height:40px;border-radius:12px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.16);color:#fff;display:flex;align-items:center;justify-content:center;text-decoration:none;backdrop-filter:blur(8px)}
#app .cx5-sech{display:flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:#fff;margin:0 0 10px}
#app .cx5-sech::before{content:'';width:4px;height:14px;background:#ff2e2e;border-radius:99px}
#app .cx5-sech .n{margin-left:auto;font-size:10px;color:#a1a1aa;border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:2px 9px;font-weight:500}
#app .cx5-row{display:flex;gap:10px;overflow-x:auto;padding:2px 2px 8px;scrollbar-width:none}
#app .cx5-row::-webkit-scrollbar{display:none}
#app .cx5-bdg{position:absolute;top:6px;left:6px;z-index:2;background:rgba(0,0,0,.62);backdrop-filter:blur(6px);font-size:8px;font-weight:700;letter-spacing:.04em;padding:2px 6px;border-radius:5px}
#app .cx5-bdg.live{color:#34d399;border:1px solid rgba(52,211,153,.35)}
#app .cx5-bdg.off{color:#d4d4d8;border:1px solid rgba(255,255,255,.14)}
#app .cx5-card{position:relative;text-decoration:none}
#app .cx5-po{position:relative;aspect-ratio:3/4;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0f0f14}
#app .cx5-po img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
#app .cx5-po2{position:relative;aspect-ratio:2/3;border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,.1);background:#0f0f14}
#app .cx5-po2 img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
#app .cx5-ct{font-size:10.5px;font-weight:600;color:#fff;margin-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app .cx5-pr{position:absolute;left:6px;right:6px;bottom:6px;height:3px;border-radius:2px;background:rgba(255,255,255,.25);overflow:hidden;z-index:2}
#app .cx5-pr i{display:block;height:100%;background:#ff2e2e;box-shadow:0 0 8px rgba(255,46,46,.8)}
/* top 10 */
#app .cx5-top{flex:none;display:flex;align-items:flex-end;position:relative;width:118px}
#app .cx5-tn{font-size:64px;font-weight:900;line-height:.78;color:transparent;-webkit-text-stroke:1.5px rgba(255,255,255,.75);text-shadow:0 4px 12px rgba(0,0,0,.9);position:absolute;left:-4px;bottom:-2px;z-index:3;pointer-events:none}
#app .cx5-tc{width:86px;height:128px;margin-left:auto;border-radius:12px;overflow:hidden;position:relative;border:1px solid rgba(255,255,255,.1);background:#0f0f14}
#app .cx5-tc img{width:100%;height:100%;object-fit:cover;object-position:top center;display:block}
/* pills */
#app .cx5-pill{font-size:11px;font-weight:600;color:#d4d4d8;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.04);border-radius:99px;padding:7px 14px;cursor:pointer;font-family:inherit;white-space:nowrap}
#app .cx5-pill.on{background:#ff2e2e;border-color:#ff2e2e;color:#fff;box-shadow:0 6px 16px rgba(255,46,46,.4)}
#app .cx5-pills{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 8px;scrollbar-width:none}
#app .cx5-pills::-webkit-scrollbar{display:none}
#app .cx5-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
#app .cx5-more{display:block;margin:16px auto 6px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);color:#fff;border-radius:99px;padding:10px 22px;font-size:12px;font-weight:600;cursor:pointer;font-family:inherit}
#app .cx5-bnav{position:fixed;bottom:0;left:0;right:0;z-index:60;background:rgba(8,8,10,.88);backdrop-filter:blur(16px);border-top:1px solid rgba(255,255,255,.1);display:flex;justify-content:space-around;padding:8px 12px calc(8px + env(safe-area-inset-bottom))}
#app .cx5-bnav a{display:flex;flex-direction:column;align-items:center;gap:3px;color:#a1a1aa;font-size:10px;font-weight:600;text-decoration:none;padding:2px 8px}
#app .cx5-bnav a.on{color:#ff2e2e}
#app .cx5-bnav a i{font-size:16px}
#app .cx5-wrap{max-width:520px;margin:0 auto;padding:12px 14px 110px}
#app .cx5-hero-btns{display:flex;gap:8px;align-items:center;position:relative;z-index:1}
/* ocultar interfaz clásica dentro del modo cine */
body.dfx-cine-skin .nav,body.dfx-cine-skin .bottom-nav,body.dfx-cine-skin footer,
body.dfx-cine-skin #dfxThemeToggle,body.dfx-cine-skin .catalog-wrap{display:none!important}
body.dfx-cine-skin #app{padding:0!important;max-width:none!important;width:100%!important}
/* cabecera slim estilo mockup */
#app .cx5-topbar{position:sticky;top:0;z-index:55;display:flex;align-items:center;gap:10px;padding:10px 14px;
  background:rgba(8,8,10,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.08)}
#app .cx5-mark2{width:28px;height:28px;border-radius:8px;background:#ff2e2e;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900;font-size:11px;box-shadow:0 4px 14px rgba(255,46,46,.4);text-decoration:none;flex:none}
#app .cx5-brand{font-size:16px;font-weight:800;color:#fff;letter-spacing:-.01em}
#app .cx5-brand b{color:#ff2e2e}
#app .cx5-tbtn{margin-left:auto;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);color:#d4d4d8;display:flex;align-items:center;justify-content:center;text-decoration:none;font-size:13px}
#app .cx5-wrap{width:100%;max-width:560px;padding:12px 12px 120px}
#app .cx5-grid{grid-template-columns:repeat(3,minmax(0,1fr))!important}
@media (prefers-reduced-motion:reduce){#app .cx5-chip-live .dot{animation:none}}
`;
  if (!document.getElementById('dfxCineStyle')) {
    var style = document.createElement('style');
    style.id = 'dfxCineStyle'; style.textContent = CSS;
    document.head.appendChild(style);
  }

  var GENRE = null, SHOW = 18;
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
  function po(s, cls) {
    var im = imgOf(s);
    return '<div class="' + cls + '">' + (im ? '<img loading="lazy" src="' + esc(im) + '" alt="" onerror="this.remove()">' : '') + '</div>';
  }
  function link(s) { return '#/series/' + encodeURIComponent(slugOf(s)); }

  function renderCine() {
    var app = document.getElementById('app');
    if (!app) return;
    loadLibs();
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
      '<a class="cx5-mark2" href="#/cine">DF</a>' +
      '<span class="cx5-brand">Donghua<b>Flix</b></span>' +
      '<a class="cx5-tbtn" href="#/search" aria-label="Buscar"><i class="fa-solid fa-magnifying-glass" style="font-size:12px"></i></a>' +
      '<a class="cx5-tbtn" href="#/" aria-label="Salir"><i class="fa-solid fa-xmark" style="font-size:14px"></i></a>' +
      '</div><div class="cx5-wrap">';

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
            (imgOf(s) ? '<img loading="lazy" src="' + esc(imgOf(s)) + '" alt="" onerror="this.remove()">' : '') +
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
          '<span class="cx5-tc">' + (imgOf(s) ? '<img loading="lazy" src="' + esc(imgOf(s)) + '" alt="" onerror="this.remove()">' : '') +
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
        return '<a class="cx5-card" href="' + link(s) + '"><div class="cx5-po">' +
          (imgOf(s) ? '<img loading="lazy" src="' + esc(imgOf(s)) + '" alt="" onerror="this.remove()">' : '') + bdg(s) +
          '</div><div class="cx5-ct">' + esc(titleOf(s)) + '</div></a>';
      }).join('') + '</div>';
    if (grid.length > SHOW) html += '<button class="cx5-more" id="cx5More">Cargar más (' + (grid.length - SHOW) + ')</button>';
    html += '</section>';

    html += '</div>';

    /* bottom nav */
    html += '<nav class="cx5-bnav">' +
      '<a href="#/cine" class="on"><i class="fa-solid fa-house"></i><span>Inicio</span></a>' +
      '<a href="#/series"><i class="fa-solid fa-tv"></i><span>Series</span></a>' +
      '<a href="#/descubrir"><i class="fa-solid fa-compass"></i><span>Explorar</span></a>' +
      '<a href="#/mylist"><i class="fa-solid fa-heart"></i><span>Mi Lista</span></a>' +
      '</nav>';

    app.innerHTML = html;

    app.querySelectorAll('.cx5-pill').forEach(function (c) {
      c.addEventListener('click', function () { GENRE = c.getAttribute('data-g') || null; SHOW = 18; renderCine(); });
    });
    var more = document.getElementById('cx5More');
    if (more) more.addEventListener('click', function () {
      SHOW += 18;
      document.getElementById('cx5Grid').innerHTML = grid.slice(0, SHOW).map(function (s) {
        return '<a class="cx5-card" href="' + link(s) + '"><div class="cx5-po">' +
          (imgOf(s) ? '<img loading="lazy" src="' + esc(imgOf(s)) + '" alt="" onerror="this.remove()">' : '') + bdg(s) +
          '</div><div class="cx5-ct">' + esc(titleOf(s)) + '</div></a>';
      }).join('');
      if (SHOW >= grid.length) more.remove(); else more.textContent = 'Cargar más (' + (grid.length - SHOW) + ')';
    });
    window.scrollTo(0, 0);
  }

  function patch() {
    var r = glb('route');
    if (typeof r !== 'function' || r.__cine5) return;
    var w = function () {
      if (location.hash.indexOf('#/cine') === 0) {
        document.body.classList.add('dfx-cine-skin');
        renderCine(); return;
      }
      document.body.classList.remove('dfx-cine-skin');
      return r.apply(this, arguments);
    };
    w.__cine5 = true; window.route = w;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(patch, 300); });
  else setTimeout(patch, 300);
  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf('#/cine') === 0) { document.body.classList.add('dfx-cine-skin'); renderCine(); }
    else document.body.classList.remove('dfx-cine-skin');
  });
})();
