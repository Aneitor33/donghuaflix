// ══════════════════════════════════════════════════════════
//  dfx-cine.js — DonghuaFlix: "Modo Cine" (versión experimental C)
//  Página separada en #/cine. NO modifica la web original.
//  Usa los datos y helpers reales de app.js (DB, card, historial…).
//  Si funciona, se itera hasta convertirla en la versión definitiva.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof document === 'undefined' || document.getElementById('dfxCineJs')) return;
  var s0 = document.createElement('script'); s0.id = 'dfxCineJs'; // marcador
  function glb(n) { try { return Function('return typeof ' + n + '!=="undefined"?' + n + ':undefined')(); } catch (e) { return undefined; } }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  var CSS = [
    'body.dfx-cine{background:#000}',
    '#app .cine-big{position:relative;display:flex;flex-direction:column;justify-content:flex-end;min-height:300px;padding:26px 20px;overflow:hidden;border-bottom:1px solid rgba(255,255,255,.08);background-size:cover;background-position:center 20%}',
    '#app .cine-big::before{content:"";position:absolute;inset:0;background:radial-gradient(130% 110% at 75% 0%,rgba(255,46,46,.30),transparent 58%)}',
    '#app .cine-big::after{content:"";position:absolute;inset:0;background:linear-gradient(180deg,rgba(0,0,0,.15),rgba(0,0,0,.88))}',
    '#app .cine-big.alt::before{background:radial-gradient(130% 110% at 25% 0%,rgba(140,95,255,.28),transparent 58%)}',
    '#app .cine-kick,#app .cine-title,#app .cine-meta,#app .cine-cta{position:relative;z-index:1}',
    '#app .cine-kick{font-size:10px;letter-spacing:.16em;color:#c9ccd2}',
    '#app .cine-title{font-size:clamp(24px,6vw,38px);font-weight:600;color:#fff;line-height:1.08;margin:6px 0 8px}',
    '#app .cine-meta{font-size:12.5px;color:#e3e5e9;margin-bottom:16px}',
    '#app .cine-cta .cine-play{background:#ff2e2e;color:#fff;border:none;border-radius:11px;padding:11px 22px;font-size:13.5px;font-weight:600;box-shadow:0 8px 22px rgba(255,46,46,.4);text-decoration:none;display:inline-block}',
    '#app .cine-cta .cine-ghost{background:rgba(20,20,26,.6);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:11px;padding:11px 16px;font-size:13.5px;text-decoration:none;display:inline-block;margin-left:8px}',
    '#app .cine-sec{font-size:10.5px;letter-spacing:.14em;color:#8b8f98;margin:22px 16px 10px}',
    '#app .cine-row{display:flex;gap:10px;overflow-x:auto;padding:0 16px 12px;scrollbar-width:none}',
    '#app .cine-row::-webkit-scrollbar{display:none}',
    '#app .cine-cont{position:relative;min-width:118px;width:118px}',
    '#app .cine-cont .poster{border:1px solid rgba(255,255,255,.1);border-radius:12px}',
    '#app .cine-prog{height:3px;border-radius:2px;background:rgba(255,255,255,.14);margin-top:6px;overflow:hidden}',
    '#app .cine-prog i{display:block;height:100%;background:#ff2e2e}',
    '#app .cine-chips{display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 6px}',
    '#app .cine-chip{font-size:12px;color:#c9ccd2;border:1px solid rgba(255,255,255,.16);background:transparent;border-radius:999px;padding:7px 14px;cursor:pointer;font-family:inherit}',
    '#app .cine-chip.on{background:#ff2e2e;border-color:#ff2e2e;color:#fff}',
    '#app .cine-list .ep{display:flex;align-items:center;gap:11px;padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.06)}',
    '#app .cine-list .ep .n{width:30px;height:30px;border-radius:8px;background:#141419;display:grid;place-items:center;color:#8b8f98;font-size:11px;flex:none}',
    '#app .cine-exit{position:fixed;top:14px;right:14px;z-index:98;background:rgba(14,14,18,.9);border:1px solid rgba(255,255,255,.2);color:#fff;border-radius:999px;padding:9px 15px;font-size:12px;cursor:pointer;font-family:inherit;backdrop-filter:blur(10px)}'
  ].join('\n');
  var style = document.createElement('style');
  style.id = 'dfxCineStyle';
  style.textContent = CSS;
  document.head.appendChild(style);

  function getDB() { return glb('DB') || { series: [], genres: [] }; }
  function findS(ref) { var f = glb('findSeries'); return f ? f(ref) : null; }
  function imgOf(x) { var f = glb('getSeriesImage'); return f ? f(x) : (x && x.image) || ''; }
  function titleOf(x) { var f = glb('cleanTitle'); return f ? f(x) : (x && x.title) || ''; }
  function genresOf(x) { var f = glb('seriesGenres'); return f ? f(x) : (x && x.genres) || []; }
  function slugOf(x) { return (x && (x.slug || x.id)) || ''; }
  function cardFn(x) { var f = glb('card'); return f ? f(x) : ''; }
  function isAiring(x) { return /emisi/i.test(x.status || ''); }
  function isMovie(x) { return /movie|pelicula/i.test(x.type || ''); }

  function bigBlock(s, alt, kick) {
    var im = imgOf(s);
    var bg = im ? ' style="background-image:url(' + esc(im) + ')"' : '';
    var g = genresOf(s).slice(0, 3).join(' · ');
    return '<div class="cine-big' + (alt ? ' alt' : '') + '"' + bg + '>' +
      '<span class="cine-kick">' + kick + '</span>' +
      '<span class="cine-title">' + esc(titleOf(s)) + '</span>' +
      '<span class="cine-meta">' + esc(g) + (s.totalEpisodes ? ' · ' + s.totalEpisodes + ' eps' : '') + (s.status ? ' · ' + esc(s.status) : '') + '</span>' +
      '<span class="cine-cta"><a class="cine-play" href="#/series/' + encodeURIComponent(slugOf(s)) + '">▶ Ver serie</a><a class="cine-ghost" href="#/series/' + encodeURIComponent(slugOf(s)) + '">+ Mi lista</a></span>' +
      '</div>';
  }

  var genreFilter = null;

  function renderCine() {
    var app = document.getElementById('app');
    if (!app) return;
    document.body.classList.add('dfx-cine');
    var DB = getDB();
    var series = DB.series || [];
    if (!series.length) {
      app.innerHTML = '<div class="empty" style="padding:80px 20px;text-align:center">Cargando catálogo… vuelve en un segundo.</div>';
      setTimeout(renderCine, 900);
      return;
    }
    var html = '';

    /* 1 · DESTACADOS: favoritos del usuario primero, luego recientes */
    var favIds = {}; try { (glb('getFavs') ? getFavs() : []).forEach(function (id) { favIds[id] = 1; }); } catch (e) {}
    var pool = series.filter(function (s) { return imgOf(s); });
    var featured = pool.filter(function (s) { return favIds[s.id]; })
      .concat(pool.filter(function (s) { return isAiring(s); }))
      .concat(pool);
    var seen = {}; featured = featured.filter(function (s) { return seen[s.id] ? false : (seen[s.id] = 1); });
    if (featured[0]) html += bigBlock(featured[0], false, 'DESTACADO · DONGHUAFLIX');

    /* 2 · SIGUE VIENDO (historial real con progreso) */
    try {
      var hist = glb('getHistory') ? getHistory() : {};
      var prog = glb('seriesProgress');
      var cont = Object.keys(hist).map(function (id) { return findS(id); })
        .filter(function (s) { return s && imgOf(s); })
        .filter(function (s) { var p = prog ? prog(s) : 50; return p > 0 && p < 100; })
        .slice(0, 12);
      if (cont.length) {
        html += '<div class="cine-sec">SIGUE VIENDO</div><div class="cine-row">';
        cont.forEach(function (s) {
          var p = prog ? prog(s) : 50;
          html += '<a class="cine-cont" href="#/series/' + encodeURIComponent(slugOf(s)) + '">' + miniCard(s) +
            '<div class="cine-prog"><i style="width:' + Math.round(p) + '%"></i></div></a>';
        });
        html += '</div>';
      }
    } catch (e) {}

    /* 3 · Segundo destacado */
    if (featured[1]) html += bigBlock(featured[1], true, 'TAMBIÉN DESTACADO');

    /* 4 · EN EMISIÓN */
    var airing = series.filter(isAiring).slice(0, 12);
    if (airing.length) {
      html += '<div class="cine-sec">EN EMISIÓN · ' + airing.length + '</div><div class="cine-list">';
      airing.forEach(function (s, i) {
        html += '<a class="ep" href="#/series/' + encodeURIComponent(slugOf(s)) + '" style="text-decoration:none">' +
          '<span class="n">' + (i + 1) + '</span>' +
          '<div style="min-width:0"><div style="font-size:13px;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(titleOf(s)) + '</div>' +
          '<div style="font-size:10.5px;color:#8b8f98">' + esc(genresOf(s).slice(0, 2).join(' · ')) + (s.totalEpisodes ? ' · ' + s.totalEpisodes + ' eps' : '') + '</div></div>' +
          '<span style="margin-left:auto;color:#fff">▶</span></a>';
      });
      html += '</div>';
    }

    /* 5 · GÉNEROS + catálogo filtrable */
    var genres = [];
    try { (DB.genres || []).forEach(function (g) { genres.push(g.name || g); }); } catch (e) {}
    if (!genres.length) series.forEach(function (s) { genresOf(s).forEach(function (g) { if (genres.indexOf(g) === -1) genres.push(g); }); });
    if (genres.length) {
      html += '<div class="cine-sec">EXPLORAR POR GÉNERO</div><div class="cine-chips">' +
        '<button class="cine-chip' + (!genreFilter ? ' on' : '') + '" data-g="">Todo</button>' +
        genres.slice(0, 14).map(function (g) {
          return '<button class="cine-chip' + (genreFilter === g ? ' on' : '') + '" data-g="' + esc(g) + '">' + esc(g) + '</button>';
        }).join('') + '</div>';
    }
    var grid = genreFilter
      ? series.filter(function (s) { return genresOf(s).some(function (g) { return fold(g) === fold(genreFilter); }); })
      : series;
    html += '<div class="section"><div class="section-head"><h2>' + esc(genreFilter || 'Catálogo') + '</h2><span class="muted">' + grid.length + '</span></div>' +
      '<div class="grid cards">' + grid.slice(0, 18).map(cardFn).join('') + '</div></div>';

    /* 6 · PELÍCULAS del catálogo (si hay) */
    var movies = series.filter(isMovie);
    if (movies.length) {
      html += '<div class="cine-sec">PELÍCULAS</div><div class="section"><div class="grid cards">' +
        movies.slice(0, 6).map(cardFn).join('') + '</div></div>';
    }

    app.innerHTML = html;
    if (!document.getElementById('cineExit')) {
      var ex = document.createElement('button');
      ex.id = 'cineExit'; ex.className = 'cine-exit'; ex.textContent = '✕ Salir del modo cine';
      ex.onclick = function () { location.hash = '#/'; };
      document.body.appendChild(ex);
    }
    app.querySelectorAll('.cine-chip').forEach(function (c) {
      c.addEventListener('click', function () { genreFilter = c.getAttribute('data-g') || null; renderCine(); });
    });
    window.scrollTo(0, 0);
  }

  function exitCine() {
    document.body.classList.remove('dfx-cine');
    var ex = document.getElementById('cineExit'); if (ex) ex.remove();
  }

  function miniCard(s) {
    var im = imgOf(s);
    var th = im
      ? '<div class="poster"><img loading="lazy" src="' + esc(im) + '" alt="" onerror="this.remove()"></div>'
      : '<div class="poster no-img"><span>▶</span></div>';
    return th + '<h3>' + esc(titleOf(s)) + '</h3>';
  }

  /* router: intercepta #/cine sin tocar el original */
  function patch() {
    var r = glb('route');
    if (typeof r !== 'function' || r.__cine) return;
    var w = function () {
      if (location.hash.indexOf('#/cine') === 0) { renderCine(); return; }
      exitCine();
      return r.apply(this, arguments);
    };
    w.__cine = true;
    window.route = w;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(patch, 300); });
  else setTimeout(patch, 300);
  window.addEventListener('hashchange', function () {
    if (location.hash.indexOf('#/cine') === 0) renderCine(); else exitCine();
  });
})();
