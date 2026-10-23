// ══════════════════════════════════════════════════════════
//  dfx-cine.js — DonghuaFlix: "Modo Cine" v2 (experimental, #/cine)
//  v2: cabecera propia, destacados con póster (nunca cortados),
//  bloques redondeados, lista En emisión pulida, "cargar más".
//  NO modifica la web original.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  function glb(n) { try { return Function('return typeof ' + n + '!=="undefined"?' + n + ':undefined')(); } catch (e) { return undefined; } }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  var CSS = `
#app .cine-nav{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:12px;padding:13px 18px;
  background:rgba(8,8,10,.94);border-bottom:1px solid rgba(255,255,255,.09);backdrop-filter:blur(18px);margin-bottom:4px}
#app .cine-logo{font-size:18px;font-weight:600;letter-spacing:.09em;color:#fff}
#app .cine-logo b{color:#ff2e2e}
#app .cine-logo em{font-style:normal;font-size:11px;color:#8b8f98;letter-spacing:.14em;margin-left:6px}
#app .cine-nav nav{display:flex;gap:4px;margin-left:8px}
#app .cine-nav nav a{font-size:12.5px;color:#b9bdc6;text-decoration:none;border-bottom:2px solid transparent;padding:6px 10px}
#app .cine-nav nav a.on{color:#fff;border-color:#ff2e2e}
#app .cine-nav .exit{margin-left:auto;font-size:11.5px;color:#fff;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);
  border-radius:999px;padding:7px 13px;text-decoration:none}
#app .cine-wrap{max-width:1080px;margin:0 auto;padding:0 16px}
/* destacado: póster a la izquierda + glow, jamás cortado */
#app .cine-hero{position:relative;display:flex;gap:18px;align-items:flex-end;margin:16px 0;padding:22px;border-radius:20px;
  overflow:hidden;background:#0a0a0d;border:1px solid rgba(255,255,255,.09)}
#app .cine-hero::before{content:'';position:absolute;inset:0;background:radial-gradient(125% 130% at 82% 0%,rgba(255,46,46,.24),transparent 55%)}
#app .cine-hero.alt::before{background:radial-gradient(125% 130% at 82% 0%,rgba(140,95,255,.22),transparent 55%)}
#app .cine-hero-p{position:relative;z-index:1;flex:none;width:118px;aspect-ratio:2/3;object-fit:cover;border-radius:12px;
  border:1px solid rgba(255,255,255,.14);box-shadow:0 14px 34px rgba(0,0,0,.65)}
#app .cine-hero-i{position:relative;z-index:1;min-width:0;padding-bottom:2px}
#app .cine-kick{font-size:10px;letter-spacing:.16em;color:#c9ccd2}
#app .cine-title{font-size:clamp(21px,4.6vw,33px);font-weight:600;color:#fff;line-height:1.1;margin:5px 0 7px}
#app .cine-meta{font-size:12.5px;color:#e3e5e9;margin-bottom:14px}
#app .cine-cta a{display:inline-block;text-decoration:none}
#app .cine-play{background:#ff2e2e;color:#fff;border-radius:11px;padding:10px 20px;font-size:13.5px;font-weight:600;box-shadow:0 8px 22px rgba(255,46,46,.4)}
#app .cine-ghost{background:rgba(22,22,28,.65);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:11px;padding:10px 15px;font-size:13.5px;margin-left:7px}
/* secciones */
#app .cine-sec{display:flex;align-items:baseline;gap:10px;font-size:10.5px;letter-spacing:.14em;color:#8b8f98;margin:24px 2px 10px}
#app .cine-sec .n{margin-left:auto;font-size:11px;letter-spacing:0;border:1px solid rgba(255,255,255,.14);border-radius:999px;padding:2px 9px}
/* sigue viendo */
#app .cine-row{display:flex;gap:10px;overflow-x:auto;padding:2px 0 6px;scrollbar-width:none}
#app .cine-row::-webkit-scrollbar{display:none}
#app .cine-cont{flex:none;width:118px;text-decoration:none}
#app .cine-cont .poster{border:1px solid rgba(255,255,255,.1);border-radius:12px}
#app .cine-cont h3{font-size:12px;margin-top:6px}
#app .cine-prog{height:3px;border-radius:2px;background:rgba(255,255,255,.14);margin-top:5px;overflow:hidden}
#app .cine-prog i{display:block;height:100%;background:#ff2e2e}
/* en emisión */
#app .cine-eps{border:1px solid rgba(255,255,255,.09);border-radius:16px;overflow:hidden}
#app .cine-ep{display:flex;align-items:center;gap:12px;padding:10px 14px;border-bottom:1px solid rgba(255,255,255,.06);text-decoration:none}
#app .cine-ep:last-child{border-bottom:none}
#app .cine-ep:hover{background:rgba(255,255,255,.03)}
#app .cine-ep .num{width:26px;height:26px;border-radius:8px;background:#141419;display:grid;place-items:center;color:#8b8f98;font-size:11px;flex:none}
#app .cine-ep .th{flex:none;width:36px;height:50px;border-radius:7px;object-fit:cover;border:1px solid rgba(255,255,255,.1)}
#app .cine-ep .t{font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app .cine-ep .m{font-size:10.5px;color:#8b8f98;margin-top:2px}
#app .cine-ep .go{margin-left:auto;flex:none;width:32px;height:32px;border-radius:50%;border:1px solid rgba(255,255,255,.2);color:#fff;display:grid;place-items:center;font-size:11px}
/* géneros */
#app .cine-chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:4px}
#app .cine-chip{font-size:12px;color:#c9ccd2;border:1px solid rgba(255,255,255,.16);background:transparent;border-radius:999px;padding:7px 14px;cursor:pointer;font-family:inherit}
#app .cine-chip.on{background:#ff2e2e;border-color:#ff2e2e;color:#fff}
/* catálogo */
#app .cine-gridhead{display:flex;align-items:baseline;gap:10px;margin:6px 2px 12px}
#app .cine-gridhead h2{font-size:17px;font-weight:600;color:#fff;margin:0}
#app .cine-gridhead .cnt{font-size:11px;color:#8b8f98}
#app .cine-more{display:block;margin:14px auto 8px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);color:#fff;
  border-radius:999px;padding:10px 22px;font-size:12.5px;cursor:pointer;font-family:inherit}
#app .cine-more:hover{border-color:rgba(255,46,46,.7)}
@media (prefers-reduced-motion:reduce){#app .cine-hero,#app .cine-cont .poster{transition:none}}
`;
  if (!document.getElementById('dfxCineStyle')) {
    var style = document.createElement('style');
    style.id = 'dfxCineStyle'; style.textContent = CSS;
    document.head.appendChild(style);
  }

  var GENRE = null, SHOW = 24;

  function getDB() { return glb('DB') || { series: [], genres: [] }; }
  function findS(ref) { var f = glb('findSeries'); return f ? f(ref) : null; }
  function imgOf(x) { var f = glb('getSeriesImage'); return f ? f(x) : (x && x.image) || ''; }
  function titleOf(x) { var f = glb('cleanTitle'); return f ? f(x) : (x && x.title) || ''; }
  function genresOf(x) { var f = glb('seriesGenres'); return f ? f(x) : (x && x.genres) || []; }
  function slugOf(x) { return (x && (x.slug || x.id)) || ''; }
  function cardFn(x) { var f = glb('card'); return f ? f(x) : ''; }
  function isAiring(x) { return /emisi/i.test(x.status || ''); }

  function hero(s, alt, kick) {
    var im = imgOf(s);
    var p = im ? '<img class="cine-hero-p" src="' + esc(im) + '" alt="" loading="lazy" onerror="this.style.display=\'none\'">' : '';
    var g = genresOf(s).slice(0, 3).join(' · ');
    return '<div class="cine-hero' + (alt ? ' alt' : '') + '">' + p +
      '<div class="cine-hero-i">' +
      '<span class="cine-kick">' + kick + '</span>' +
      '<h2 class="cine-title">' + esc(titleOf(s)) + '</h2>' +
      '<div class="cine-meta">' + esc(g) + (s.totalEpisodes ? ' · ' + s.totalEpisodes + ' eps' : '') + (s.status ? ' · ' + esc(s.status) : '') + '</div>' +
      '<div class="cine-cta"><a class="cine-play" href="#/series/' + encodeURIComponent(slugOf(s)) + '">▶ Ver serie</a><a class="cine-ghost" href="#/series/' + encodeURIComponent(slugOf(s)) + '">+ Mi lista</a></div>' +
      '</div></div>';
  }

  function epRow(s, i) {
    var im = imgOf(s);
    return '<a class="cine-ep" href="#/series/' + encodeURIComponent(slugOf(s)) + '">' +
      '<span class="num">' + (i + 1) + '</span>' +
      (im ? '<img class="th" src="' + esc(im) + '" alt="" loading="lazy" onerror="this.remove()">' : '') +
      '<span style="min-width:0"><span class="t">' + esc(titleOf(s)) + '</span><br><span class="m">' + esc(genresOf(s).slice(0, 2).join(' · ')) + (s.totalEpisodes ? ' · ' + s.totalEpisodes + ' eps' : '') + '</span></span>' +
      '<span class="go">▶</span></a>';
  }

  function renderCine() {
    var app = document.getElementById('app');
    if (!app) return;
    var DB = getDB();
    var series = DB.series || [];
    if (!series.length) {
      app.innerHTML = '<div class="empty" style="padding:80px 20px;text-align:center">Cargando catálogo…</div>';
      setTimeout(renderCine, 900); return;
    }
    var favIds = {};
    try { (glb('getFavs') ? getFavs() : []).forEach(function (id) { favIds[id] = 1; }); } catch (e) {}
    var pool = series.filter(function (s) { return imgOf(s); });
    var seen = {};
    var feat = pool.filter(function (s) { return favIds[s.id]; })
      .concat(pool.filter(isAiring), pool)
      .filter(function (s) { return seen[s.id] ? false : (seen[s.id] = 1); });

    var html = '<div class="cine-nav"><span class="cine-logo">DONGHUA<b>FLIX</b><em>MODO CINE</em></span>' +
      '<nav><a href="#/cine" class="on">Inicio</a><a href="#/">Versión clásica</a></nav>' +
      '<a class="exit" href="#/">✕ Salir</a></div><div class="cine-wrap">';

    if (feat[0]) html += hero(feat[0], false, 'DESTACADO · DONGHUAFLIX');

    try {
      var hist = glb('getHistory') ? getHistory() : {};
      var prog = glb('seriesProgress');
      var cont = Object.keys(hist).map(function (id) { return findS(id); })
        .filter(function (s) { return s && imgOf(s); })
        .filter(function (s) { var p = prog ? prog(s) : 0; return p > 0 && p < 100; }).slice(0, 12);
      if (cont.length) {
        html += '<div class="cine-sec">SIGUE VIENDO</div><div class="cine-row">';
        cont.forEach(function (s) {
          var p = prog ? prog(s) : 0;
          var im = imgOf(s);
          html += '<a class="cine-cont" href="#/series/' + encodeURIComponent(slugOf(s)) + '">' +
            (im ? '<div class="poster"><img loading="lazy" src="' + esc(im) + '" alt="" onerror="this.remove()"></div>' : '<div class="poster no-img"><span>▶</span></div>') +
            '<h3>' + esc(titleOf(s)) + '</h3><div class="cine-prog"><i style="width:' + Math.round(p) + '%"></i></div></a>';
        });
        html += '</div>';
      }
    } catch (e) {}

    if (feat[1]) html += hero(feat[1], true, 'TAMBIÉN DESTACADO');

    var airing = series.filter(isAiring).slice(0, 12);
    if (airing.length) {
      html += '<div class="cine-sec">EN EMISIÓN <span class="n">' + airing.length + ' series</span></div><div class="cine-eps">' +
        airing.map(epRow).join('') + '</div>';
    }

    var genres = [];
    try { (DB.genres || []).forEach(function (g) { genres.push(g.name || g); }); } catch (e) {}
    if (!genres.length) series.forEach(function (s) { genresOf(s).forEach(function (g) { if (genres.indexOf(g) === -1) genres.push(g); }); });
    if (genres.length) {
      html += '<div class="cine-sec">EXPLORAR POR GÉNERO</div><div class="cine-chips">' +
        '<button class="cine-chip' + (!GENRE ? ' on' : '') + '" data-g="">Todo</button>' +
        genres.slice(0, 16).map(function (g) { return '<button class="cine-chip' + (GENRE === g ? ' on' : '') + '" data-g="' + esc(g) + '">' + esc(g) + '</button>'; }).join('') + '</div>';
    }

    var grid = GENRE ? series.filter(function (s) { return genresOf(s).some(function (g) { return fold(g) === fold(GENRE); }); }) : series;
    html += '<div class="cine-sec">' + esc(GENRE || 'CATÁLOGO COMPLETO') + '<span class="n">' + grid.length + ' títulos</span></div>' +
      '<div class="cine-gridhead"><h2>' + esc(GENRE || 'Explorar') + '</h2><span class="cnt"></span></div>' +
      '<div class="grid cards" id="cineGrid">' + grid.slice(0, SHOW).map(cardFn).join('') + '</div>';
    if (grid.length > SHOW) html += '<button class="cine-more" id="cineMore">Cargar más (' + (grid.length - SHOW) + ' restantes)</button>';

    html += '</div>';
    app.innerHTML = html;

    app.querySelectorAll('.cine-chip').forEach(function (c) {
      c.addEventListener('click', function () { GENRE = c.getAttribute('data-g') || null; SHOW = 24; renderCine(); });
    });
    var more = document.getElementById('cineMore');
    if (more) more.addEventListener('click', function () {
      SHOW += 24;
      var g2 = document.getElementById('cineGrid');
      g2.innerHTML = grid.slice(0, SHOW).map(cardFn).join('');
      if (SHOW >= grid.length) more.remove();
      else more.textContent = 'Cargar más (' + (grid.length - SHOW) + ' restantes)';
    });
    window.scrollTo(0, 0);
  }

  function patch() {
    var r = glb('route');
    if (typeof r !== 'function' || r.__cine2) return;
    var w = function () {
      if (location.hash.indexOf('#/cine') === 0) { renderCine(); return; }
      return r.apply(this, arguments);
    };
    w.__cine2 = true; window.route = w;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(patch, 300); });
  else setTimeout(patch, 300);
  window.addEventListener('hashchange', function () { if (location.hash.indexOf('#/cine') === 0) renderCine(); });
})();
