// ══════════════════════════════════════════════════════════
//  dfx-cine.js — DonghuaFlix "Modo Cine" v3
//  Design system: Apple TV+ (glass/hero) · HBO Max (Top10, glow,
//  progress) · Disney+ (hover, pills) · Bilibili (badges) ·
//  Crunchyroll (servidores pills, ficha compacta).
//  Experimental en #/cine. NO modifica la web original.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (typeof document === 'undefined') return;
  function glb(n) { try { return Function('return typeof ' + n + '!=="undefined"?' + n + ':undefined')(); } catch (e) { return undefined; } }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (m) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]; }); }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  var CSS = `
#app .cx-nav{position:sticky;top:0;z-index:30;display:flex;align-items:center;gap:14px;padding:13px 22px;
  background:rgba(8,8,10,.85);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);
  border-bottom:1px solid rgba(255,255,255,.07)}
#app .cx-logo{font-size:19px;font-weight:800;letter-spacing:.06em;color:#fff}
#app .cx-logo b{color:#ff2e2e}
#app .cx-logo em{font-style:normal;font-size:10px;font-weight:600;letter-spacing:.18em;color:#9a9ea7;margin-left:8px}
#app .cx-nav nav{display:flex;gap:2px}
#app .cx-nav nav a{font-size:13px;color:#b9bdc6;text-decoration:none;padding:7px 11px;border-radius:8px}
#app .cx-nav nav a.on{color:#fff;background:rgba(255,255,255,.08)}
#app .cx-nav .x{margin-left:auto;font-size:12px;color:#fff;border:1px solid rgba(255,255,255,.18);border-radius:999px;padding:7px 14px;text-decoration:none}
/* HERO inmersivo full-bleed */
#app .cx-hero{position:relative;min-height:66vh;display:flex;flex-direction:column;justify-content:flex-end;padding:0 0 46px;overflow:hidden;background:#08080a}
#app .cx-hero-bg{position:absolute;inset:0;background-size:cover;background-position:center 18%;filter:saturate(1.05)}
#app .cx-hero::before{content:'';position:absolute;inset:0;background:radial-gradient(130% 90% at 50% 10%,transparent 30%,rgba(8,8,10,.55) 100%)}
#app .cx-hero::after{content:'';position:absolute;inset:0;background:linear-gradient(180deg,rgba(8,8,10,.2) 0%,transparent 35%,rgba(8,8,10,.92) 88%,#08080a 100%)}
#app .cx-hero-in{position:relative;z-index:1;max-width:1080px;width:100%;margin:0 auto;padding:0 24px}
#app .cx-kick{font-size:11px;font-weight:600;letter-spacing:.2em;color:#e3e5e9}
#app .cx-title{font-size:clamp(28px,5.6vw,54px);font-weight:800;line-height:1.04;color:#fff;margin:10px 0 12px;letter-spacing:-.01em;text-shadow:0 2px 24px rgba(0,0,0,.45)}
#app .cx-meta{font-size:13.5px;color:#d6d9de;margin-bottom:22px}
#app .cx-meta b{color:#3ddc84;font-weight:600}
#app .cx-btn{display:inline-flex;align-items:center;gap:8px;background:#ff2e2e;color:#fff;border:none;border-radius:12px;
  padding:13px 28px;font-size:15px;font-weight:700;text-decoration:none;box-shadow:0 10px 30px rgba(255,46,46,.45),0 0 18px rgba(255,46,46,.25);transition:transform .15s,box-shadow .15s}
#app .cx-btn:hover{transform:translateY(-1px);box-shadow:0 14px 36px rgba(255,46,46,.55),0 0 26px rgba(255,46,46,.35)}
#app .cx-btn.gh{background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.25);box-shadow:none;margin-left:10px;backdrop-filter:blur(8px)}
/* secciones */
#app .cx-sec{display:flex;align-items:baseline;gap:12px;max-width:1080px;margin:34px auto 0;padding:0 24px}
#app .cx-sec h2{font-size:19px;font-weight:800;color:#fff;margin:0;letter-spacing:-.01em}
#app .cx-sec .n{font-size:11px;color:#9a9ea7;border:1px solid rgba(255,255,255,.15);border-radius:999px;padding:3px 10px}
#app .cx-sec a{margin-left:auto;font-size:12px;color:#9a9ea7;text-decoration:none}
/* rail sigue viendo: barra 3px dentro del póster */
#app .cx-rail{display:flex;gap:12px;overflow-x:auto;max-width:1080px;margin:12px auto 0;padding:6px 24px 14px;scrollbar-width:none}
#app .cx-rail::-webkit-scrollbar{display:none}
#app .cx-cw{flex:none;width:150px;text-decoration:none;position:relative}
#app .cx-cw .poster{border-radius:12px;border:1px solid rgba(255,255,255,.1);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
@media(hover:hover){
  #app .cx-cw:hover .poster{transform:scale(1.04);border-color:rgba(255,255,255,.2);box-shadow:0 18px 40px rgba(0,0,0,.6)}
}
#app .cx-cw h3{font-size:12.5px;font-weight:600;color:#fff;margin:8px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app .cx-cw .pm{font-size:11px;color:#9a9ea7;margin-top:2px}
#app .cx-prog{position:absolute;left:8px;right:8px;bottom:34px;height:3px;border-radius:2px;background:rgba(255,255,255,.25);overflow:hidden;z-index:2}
#app .cx-prog i{display:block;height:100%;background:#ff2e2e;box-shadow:0 0 8px rgba(255,46,46,.8)}
/* TOP 10: números con contorno */
#app .cx-top{display:flex;gap:6px;overflow-x:auto;max-width:1080px;margin:12px auto 0;padding:6px 24px 18px;scrollbar-width:none}
#app .cx-top::-webkit-scrollbar{display:none}
#app .cx-tc{flex:none;position:relative;width:158px;padding-left:34px;text-decoration:none}
#app .cx-tn{position:absolute;left:0;bottom:26px;font-size:86px;font-weight:800;line-height:.8;color:transparent;
  -webkit-text-stroke:2.5px #ff2e2e;text-shadow:0 0 30px rgba(255,46,46,.35);z-index:2;font-family:inherit;pointer-events:none}
#app .cx-tc .poster{border-radius:12px;border:1px solid rgba(255,255,255,.1)}
#app .cx-tc h3{font-size:12.5px;font-weight:600;color:#fff;margin:8px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
/* pills (Disney+) */
#app .cx-pills{display:flex;gap:8px;flex-wrap:wrap;max-width:1080px;margin:14px auto 0;padding:0 24px}
#app .cx-pill{font-size:12.5px;font-weight:600;color:#c9ccd2;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.03);
  border-radius:999px;padding:8px 16px;cursor:pointer;font-family:inherit;transition:all .15s}
#app .cx-pill:hover{border-color:rgba(255,46,46,.6);color:#fff}
#app .cx-pill.on{background:#ff2e2e;border-color:#ff2e2e;color:#fff;box-shadow:0 6px 18px rgba(255,46,46,.4)}
/* grid + badges (Bilibili) */
#app .cx-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:14px;max-width:1080px;margin:14px auto 0;padding:0 24px}
#app .cx-gc{position:relative;text-decoration:none}
#app .cx-gc .poster{border-radius:12px;border:1px solid rgba(255,255,255,.1);transition:transform .18s ease,box-shadow .18s ease,border-color .18s ease}
@media(hover:hover){
  #app .cx-gc:hover .poster{transform:scale(1.04);border-color:rgba(255,255,255,.2);box-shadow:0 18px 40px rgba(0,0,0,.6)}
}
#app .cx-bdg{position:absolute;top:8px;left:8px;z-index:3;display:flex;align-items:center;gap:5px;font-size:9px;font-weight:700;letter-spacing:.08em;
  padding:4px 8px;border-radius:6px;background:rgba(8,8,10,.55);border:1px solid rgba(255,255,255,.14);color:#e3e5e9;backdrop-filter:blur(6px)}
#app .cx-bdg .dot{width:6px;height:6px;border-radius:50%;background:#3ddc84;box-shadow:0 0 6px rgba(61,220,132,.9)}
#app .cx-bdg.fin .dot{background:#9a9ea7;box-shadow:none}
#app .cx-gc h3{font-size:12.5px;font-weight:600;color:#fff;margin:8px 0 0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#app .cx-more{display:block;margin:20px auto 10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.16);color:#fff;
  border-radius:999px;padding:11px 24px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit}
#app .cx-more:hover{border-color:rgba(255,46,46,.7)}
#app .cx-foot{max-width:1080px;margin:36px auto 0;padding:22px 24px 30px;border-top:1px solid rgba(255,255,255,.07);color:#7d828c;font-size:11.5px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap}
@media (prefers-reduced-motion:reduce){#app .cx-cw .poster,#app .cx-gc .poster,#app .cx-btn{transition:none}}
`;
  var SKIN = `
/* REDISEÑO DE IMPACTO — DonghuaFlix (corregido y mapeado a clases reales) */
body.dfx-cine-skin{background-color:#08080a!important;color:#f4f4f5!important;
  font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif!important}
/* glassmorphism nav */
body.dfx-cine-skin .nav,body.dfx-cine-skin .nav.scrolled{
  background:rgba(8,8,10,.85)!important;
  backdrop-filter:blur(16px)!important;-webkit-backdrop-filter:blur(16px)!important;
  border-bottom:1px solid rgba(255,255,255,.08)!important}
/* móvil: menos botones en cabecera */
@media (max-width:640px){
  body.dfx-cine-skin .nav nav a:not(:first-child):not(:nth-child(2)){display:none!important}
}
/* píldora activa roja */
body.dfx-cine-skin .nav nav a.active{background:#ff2e2e!important;color:#fff!important;border-color:#ff2e2e!important;
  box-shadow:0 6px 20px rgba(255,46,46,.35)!important;border-radius:999px!important}
/* badges glass sutiles */
body.dfx-cine-skin .badge{
  background:rgba(0,0,0,.65)!important;backdrop-filter:blur(8px)!important;
  border:1px solid rgba(255,255,255,.15)!important;color:#e4e4e7!important;
  border-radius:6px!important;font-size:9px!important;font-weight:600!important;
  letter-spacing:.5px!important;padding:3px 7px!important;text-transform:uppercase!important}
/* tarjetas hover */
body.dfx-cine-skin .card{border-radius:14px!important;overflow:hidden!important;
  transition:transform .25s cubic-bezier(.4,0,.2,1),box-shadow .25s ease!important}
@media(hover:hover){
  body.dfx-cine-skin .card:hover{transform:translateY(-4px) scale(1.02)!important;
    box-shadow:0 12px 28px rgba(0,0,0,.75),0 0 0 1px rgba(255,255,255,.15)!important}
}
/* top 10 */
body.dfx-cine-skin .top10-num{font-size:4.5rem!important;font-weight:900!important;
  -webkit-text-stroke:1.5px rgba(255,255,255,.7)!important;color:transparent!important;
  text-shadow:0 4px 12px rgba(0,0,0,.8)!important}
/* botones acción */
body.dfx-cine-skin .btn-x.play,body.dfx-cine-skin .cine-play{
  background:#ff2e2e!important;color:#fff!important;border-radius:10px!important;font-weight:600!important;
  border:none!important;box-shadow:0 6px 20px rgba(255,46,46,.35)!important;transition:all .2s ease!important}
body.dfx-cine-skin .btn-x.play:hover,body.dfx-cine-skin .cine-play:hover{
  background:#e02424!important;box-shadow:0 8px 25px rgba(255,46,46,.5)!important;transform:scale(1.03)!important}
/* panel episodios + servidores */
body.dfx-cine-skin .ep-side,body.dfx-cine-skin .ep-main{
  background:#0f0f14!important;border:1px solid rgba(255,255,255,.08)!important;
  border-radius:16px!important;padding:12px!important}
body.dfx-cine-skin .ep{border-radius:10px!important;margin-bottom:4px!important;transition:background .15s ease!important}
body.dfx-cine-skin .ep:hover{background:rgba(255,255,255,.05)!important}
body.dfx-cine-skin .ep-num{color:#ff2e2e!important;font-weight:700!important}
/* progreso + chips */
body.dfx-cine-skin .progress span,body.dfx-cine-skin [class*="prog"] i{background:#ff2e2e!important}
body.dfx-cine-skin .chip{border-radius:999px!important}
body.dfx-cine-skin .chip.on,body.dfx-cine-skin .chip.active{background:#ff2e2e!important;border-color:#ff2e2e!important;color:#fff!important}
`;
  function applySkin() {
    var on = false;
    try { on = localStorage.getItem('dfx-cine-mode') === 'on'; } catch (e) {}
    document.body.classList.toggle('dfx-cine-skin', on);
  }
  if (!document.getElementById('dfxCineStyle')) {
    var style = document.createElement('style');
    style.id = 'dfxCineStyle'; style.textContent = CSS + SKIN;
    document.head.appendChild(style);
    applySkin();
    window.addEventListener('hashchange', applySkin);
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
  function isDone(x) { return /finaliz/i.test(x.status || ''); }
  function bdg(s) {
    if (isAiring(s)) return '<span class="cx-bdg"><span class="dot"></span>EN EMISIÓN</span>';
    if (isDone(s)) return '<span class="cx-bdg fin"><span class="dot"></span>FINALIZADO</span>';
    return '';
  }
  function posterHtml(s, cls) {
    var im = imgOf(s);
    return im
      ? '<div class="poster"><img loading="lazy" src="' + esc(im) + '" alt="" onerror="this.remove()"></div>'
      : '<div class="poster no-img"><span>▶</span></div>';
  }

  function renderCine() {
    var app = document.getElementById('app');
    if (!app) return;
    var DB = getDB();
    var series = DB.series || [];
    if (!series.length) { app.innerHTML = '<div class="empty" style="padding:90px 20px;text-align:center">Cargando catálogo…</div>'; setTimeout(renderCine, 900); return; }

    var favIds = {};
    try { (glb('getFavs') ? getFavs() : []).forEach(function (id) { favIds[id] = 1; }); } catch (e) {}
    var seen = {};
    var pool = series.filter(function (s) { return imgOf(s); });
    var feat = pool.filter(function (s) { return favIds[s.id]; }).concat(pool.filter(isAiring), pool)
      .filter(function (s) { return seen[s.id] ? false : (seen[s.id] = 1); });
    var top10 = pool.filter(isAiring).concat(pool).filter(function (s, i, a) { return a.indexOf(s) === i; }).slice(0, 10);

    var html = '<div class="cx-nav"><span class="cx-logo">DONGHUA<b>FLIX</b><em>MODO CINE</em></span>' +
      '<nav><a href="#/cine" class="on">Inicio</a><a href="#/">Versión clásica</a></nav>' +
      '<a class="x" href="#/" id="cxOff">✕ Salir</a></div>';

    /* HERO */
    var h = feat[0];
    if (h) {
      var im = imgOf(h);
      html += '<div class="cx-hero">' +
        (im ? '<div class="cx-hero-bg" style="background-image:url(' + esc(im) + ')"></div>' : '') +
        '<div class="cx-hero-in">' +
        '<span class="cx-kick">DESTACADO · DONGHUAFLIX</span>' +
        '<h1 class="cx-title">' + esc(titleOf(h)) + '</h1>' +
        '<div class="cx-meta">' + esc(genresOf(h).slice(0, 3).join(' · ')) +
        (h.totalEpisodes ? ' · ' + h.totalEpisodes + ' episodios' : '') +
        (isAiring(h) ? ' · <b>EN EMISIÓN</b>' : '') + '</div>' +
        '<a class="cx-btn" href="#/series/' + encodeURIComponent(slugOf(h)) + '">▶ Reproducir</a>' +
        '<a class="cx-btn gh" href="#/series/' + encodeURIComponent(slugOf(h)) + '">+ Mi lista</a>' +
        '</div></div>';
    }

    /* SIGUE VIENDO (barra 3px en el póster) */
    try {
      var hist = glb('getHistory') ? getHistory() : {};
      var prog = glb('seriesProgress');
      var cont = Object.keys(hist).map(function (id) { return findS(id); })
        .filter(function (s) { return s && imgOf(s); })
        .filter(function (s) { var p = prog ? prog(s) : 0; return p > 0 && p < 100; }).slice(0, 14);
      if (cont.length) {
        html += '<div class="cx-sec"><h2>Sigue viendo</h2><span class="n">' + cont.length + '</span></div><div class="cx-rail">';
        cont.forEach(function (s) {
          var p = prog ? prog(s) : 0;
          html += '<a class="cx-cw" href="#/series/' + encodeURIComponent(slugOf(s)) + '">' + bdg(s) +
            posterHtml(s) +
            '<div class="cx-prog"><i style="width:' + Math.round(p) + '%"></i></div>' +
            '<h3>' + esc(titleOf(s)) + '</h3><div class="pm">' + Math.round(p) + '% visto</div></a>';
        });
        html += '</div>';
      }
    } catch (e) {}

    /* TOP 10 (números con contorno) */
    if (top10.length) {
      html += '<div class="cx-sec"><h2>Top 10 hoy</h2><span class="n">' + esc(glb('currentCatalog') || '') + '</span></div><div class="cx-top">';
      top10.forEach(function (s, i) {
        html += '<a class="cx-tc" href="#/series/' + encodeURIComponent(slugOf(s)) + '">' +
          '<span class="cx-tn">' + (i + 1) + '</span>' + posterHtml(s) +
          '<h3>' + esc(titleOf(s)) + '</h3></a>';
      });
      html += '</div>';
    }

    /* Pills género + grid con badges */
    var genres = [];
    try { (DB.genres || []).forEach(function (g) { genres.push(g.name || g); }); } catch (e) {}
    if (!genres.length) series.forEach(function (s) { genresOf(s).forEach(function (g) { if (genres.indexOf(g) === -1) genres.push(g); }); });
    if (genres.length) {
      html += '<div class="cx-sec"><h2>Explorar</h2><a href="#/genres">Todos los géneros →</a></div><div class="cx-pills">' +
        '<button class="cx-pill' + (!GENRE ? ' on' : '') + '" data-g="">Todo</button>' +
        genres.slice(0, 14).map(function (g) { return '<button class="cx-pill' + (GENRE === g ? ' on' : '') + '" data-g="' + esc(g) + '">' + esc(g) + '</button>'; }).join('') + '</div>';
    }
    var grid = GENRE ? series.filter(function (s) { return genresOf(s).some(function (g) { return fold(g) === fold(GENRE); }); }) : series;
    html += '<div class="cx-sec"><h2>' + esc(GENRE || 'Catálogo') + '</h2><span class="n">' + grid.length + ' títulos</span></div>' +
      '<div class="cx-grid" id="cxGrid">' +
      grid.slice(0, SHOW).map(function (s) {
        return '<a class="cx-gc" href="#/series/' + encodeURIComponent(slugOf(s)) + '">' + bdg(s) + posterHtml(s) +
          '<h3>' + esc(titleOf(s)) + '</h3><div class="pm" style="font-size:11px;color:#9a9ea7;margin-top:2px">' + esc(genresOf(s).slice(0, 2).join(' · ')) + '</div></a>';
      }).join('') + '</div>';
    if (grid.length > SHOW) html += '<button class="cx-more" id="cxMore">Cargar más (' + (grid.length - SHOW) + ')</button>';

    /* PELÍCULAS */
    var movies = series.filter(function (s) { return /movie|pelicula/i.test(s.type || ''); }).slice(0, 12);
    if (movies.length) {
      html += '<div class="cx-sec"><h2>Películas</h2><a href="#/movies">Ver todas →</a></div><div class="cx-rail">' +
        movies.map(function (s) {
          return '<a class="cx-cw" href="#/series/' + encodeURIComponent(slugOf(s)) + '"><span class="cx-bdg">HD</span>' + posterHtml(s) + '<h3>' + esc(titleOf(s)) + '</h3></a>';
        }).join('') + '</div>';
    }

    html += '<div class="cx-foot"><span>© 2026 DonghuaFlix · Modo cine (experimental)</span><span>' + series.length + ' títulos en este catálogo</span></div>';
    app.innerHTML = html;

    var off = document.getElementById('cxOff');
    if (off) off.addEventListener('click', function () { try { localStorage.setItem('dfx-cine-mode', 'off'); } catch (e) {} document.body.classList.remove('dfx-cine-skin'); });
    app.querySelectorAll('.cx-pill').forEach(function (c) {
      c.addEventListener('click', function () { GENRE = c.getAttribute('data-g') || null; SHOW = 24; renderCine(); });
    });
    var more = document.getElementById('cxMore');
    if (more) more.addEventListener('click', function () {
      SHOW += 24;
      document.getElementById('cxGrid').innerHTML = grid.slice(0, SHOW).map(function (s) {
        return '<a class="cx-gc" href="#/series/' + encodeURIComponent(slugOf(s)) + '">' + bdg(s) + posterHtml(s) +
          '<h3>' + esc(titleOf(s)) + '</h3><div class="pm" style="font-size:11px;color:#9a9ea7;margin-top:2px">' + esc(genresOf(s).slice(0, 2).join(' · ')) + '</div></a>';
      }).join('');
      if (SHOW >= grid.length) more.remove(); else more.textContent = 'Cargar más (' + (grid.length - SHOW) + ')';
    });
    window.scrollTo(0, 0);
  }

  function patch() {
    var r = glb('route');
    if (typeof r !== 'function' || r.__cine3) return;
    var w = function () {
      if (location.hash.indexOf('#/cine') === 0) {
        try { localStorage.setItem('dfx-cine-mode', 'on'); } catch (e) {}
        applySkin(); renderCine(); return;
      }
      return r.apply(this, arguments);
    };
    w.__cine3 = true; window.route = w;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(patch, 300); });
  else setTimeout(patch, 300);
  window.addEventListener('hashchange', function () { if (location.hash.indexOf('#/cine') === 0) renderCine(); });
})();
