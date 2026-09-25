/* ============================================================
   DONGHUAFLIX RENACER — FASE 7: Descubrir + personalización
   ------------------------------------------------------------
   - Página Descubrir (#/descubrir)
   - "Porque viste…", "Podría gustarte", "Nuevos para ti",
     "En emisión que sigues" (cruzando catálogos)
   - Filtros: género / estado / tipo / catálogo / año
   - Sorpréndeme (aleatorio que no has visto)
   - Respeta historial + favoritos; no recomienda lo ya visto
   Requiere: fases 1-6 ya cargadas (usa su caché fetch).
   ============================================================ */
(function () {
  "use strict";

  /* ---------- CONFIG ---------- */
  var CFG = {
    route: "#/descubrir",
    home: "public/data/catalog-index.json",
    indexes: {
      donghualife:  "public/data/catalog-donghualife-index.json",
      donghuasub:   "public/data/catalog-donghuasub-index.json",
      donghuaworld: "public/data/catalog-donghuaworld-index.json",
      donghuacli:   "public/data/catalog-donghuacli-index.json",
      peliculas:    "public/data/catalog-peliculas-index.json",
      doramas:      "public/data/catalog-doramas-index.json"
    },
    labels: {
      donghualife: "DonghuaLife", donghuasub: "DonghuaSub",
      donghuaworld: "DonghuaWorld", donghuacli: "DonghuaCLI",
      peliculas: "Películas", doramas: "Doramas"
    },
    maxPerSection: 12,
    maxGrid: 60
  };

  /* ---------- ESTADO ---------- */
  var rows = [];          // todos los títulos con _cat
  var imageBase = "";
  var loaded = false, loading = null;
  var filters = { genre: "", status: "", type: "", cat: "", year: "" };

  /* ---------- HELPERS ---------- */
  function read(k, d) {
    try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; }
    catch (e) { return d; }
  }
  function asRows(list) {
    if (!list) return [];
    if (Array.isArray(list)) return list;
    return Object.values(list);
  }
  function historyRows() { return asRows(read("donghuaflix_history", {})); }
  function favIds() {
    var f = read("donghuaflix_favs", []);
    if (Array.isArray(f)) return f.map(String);
    return Object.keys(f || {});
  }
  function histIdSet() {
    var s = {};
    historyRows().forEach(function (x) { s[String(x.id || x.i)] = 1; });
    return s;
  }
  function genresOf(x) { return (x.g || x.genres || []); }
  function normType(x) {
    var t = String(x.ty || x.type || "serie").toLowerCase();
    if (t.indexOf("pel") === 0) return "pelicula";
    if (t.indexOf("dorama") === 0) return "dorama";
    return "serie";
  }
  function typeLabel(t) { return t === "pelicula" ? "Película" : (t === "dorama" ? "Dorama" : "Serie"); }
  function statusNorm(x) {
    var s = String(x.st || x.status || "").toLowerCase();
    if (s.indexOf("emisi") >= 0 || s === "airing") return "emision";
    if (s.indexOf("final") >= 0 || s === "completed") return "finalizado";
    return "otro";
  }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]; }); }

  /* ---------- DATOS ---------- */
  function fetchJSON(url) {
    return fetch(url, { credentials: "same-origin" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function ensureData() {
    if (loaded) return Promise.resolve(rows);
    if (loading) return loading;
    loading = fetchJSON(CFG.home).then(function (idx) {
      imageBase = idx.imageBase || imageBase;
      var jobs = Object.keys(CFG.indexes).map(function (cat) {
        return fetchJSON(CFG.indexes[cat]).then(function (ci) {
          var base = ci.imageBase || imageBase || "";
          (ci.series || []).forEach(function (x) { x._cat = cat; x._base = base; rows.push(x); });
        }).catch(function () { /* catálogo caído: se ignora */ });
      });
      return Promise.all(jobs).then(function () {
        loaded = true;
        return rows;
      });
    });
    return loading;
  }

  /* ---------- AFINIDAD DE GÉNEROS ---------- */
  function affinity() {
    var score = {};
    function add(x, w) { genresOf(x).forEach(function (g) { g = String(g); score[g] = (score[g] || 0) + w; }); }
    historyRows().forEach(function (x) { add(x, 2); });
    var favs = favIds();
    rows.forEach(function (x) { if (favs.indexOf(String(x.i || x.id)) >= 0) add(x, 3); });
    return score;
  }
  function scoreTitle(x, aff) {
    var s = 0;
    genresOf(x).forEach(function (g) { s += (aff[String(g)] || 0); });
    if (statusNorm(x) === "emision") s += 1; // ligero boost a novedad en emisión
    return s;
  }

  /* ---------- TARJETAS ---------- */
  function card(x, opts) {
    opts = opts || {};
    var id = x.i || x.id;
    var src = (x._base || imageBase || "") + (x.p || "");
    var cat = CFG.labels[x._cat] || x._cat;
    var badge = opts.badge || "";
    return '' +
      '<a class="dfx7-card" href="#/title/' + esc(id) + '">' +
        '<div class="dfx7-card-poster">' +
          (src ? '<img loading="lazy" src="' + esc(src) + '" alt="">' : '') +
          '<span class="dfx7-card-cat">' + esc(cat) + '</span>' +
          (badge ? '<span class="dfx7-card-badge">' + esc(badge) + '</span>' : '') +
          '<span class="dfx7-card-play">▶</span>' +
        '</div>' +
        '<div class="dfx7-card-title">' + esc(x.t || x.title || "—") + '</div>' +
        (opts.meta ? '<div class="dfx7-card-meta">' + esc(opts.meta) + '</div>' : '') +
      '</a>';
  }
  function rail(title, subtitle, items, badgeFn, metaFn) {
    if (!items.length) return "";
    var cards = items.map(function (x) { return card(x, { badge: badgeFn ? badgeFn(x) : "", meta: metaFn ? metaFn(x) : "" }); }).join("");
    return '' +
      '<section class="dfx7-section">' +
        '<div class="dfx7-sec-head"><h2>' + esc(title) + '</h2>' +
        (subtitle ? '<span class="dfx7-sec-sub">' + esc(subtitle) + '</span>' : '') + '</div>' +
        '<div class="dfx7-rail">' + cards + '</div>' +
      '</section>';
  }

  /* ---------- SECCIONES INTELIGENTES ---------- */
  function buildSections() {
    var hist = historyRows();
    var seen = histIdSet();
    var favs = favIds();
    var aff = affinity();
    var out = "";

    // 1) Porque viste… (el más reciente con géneros)
    var last = hist.slice().reverse().find(function (x) { return genresOf(x).length; });
    if (last) {
      var lg = genresOf(last).map(String);
      var sim = rows.filter(function (x) {
        if (seen[String(x.i || x.id)]) return false;
        var g = genresOf(x).map(String);
        return lg.some(function (v) { return g.indexOf(v) >= 0; });
      }).sort(function (a, b) { return scoreTitle(b, aff) - scoreTitle(a, aff); })
        .slice(0, CFG.maxPerSection);
      out += rail("Porque viste “" + (last.t || last.title || "este título") + "”", "similares por género", sim,
        function () { return "similar"; },
        function (x) { return genresOf(x).slice(0, 2).join(" · "); });
    }

    // 2) En emisión que sigues
    var following = rows.filter(function (x) {
      return seen[String(x.i || x.id)] && statusNorm(x) === "emision";
    }).slice(0, CFG.maxPerSection);
    out += rail("En emisión que sigues", "continúa donde lo dejaste", following,
      function () { return "en emisión"; },
      function (x) { return (x.y || "") + (x.st ? " · " + x.st : ""); });

    // 3) Podría gustarte (afinidad, sin vistos ni favoritos)
    var pool = rows.filter(function (x) {
      var id = String(x.i || x.id);
      return !seen[id] && favs.indexOf(id) < 0;
    });
    var liked = pool.slice().sort(function (a, b) { return scoreTitle(b, aff) - scoreTitle(a, aff); })
      .slice(0, CFG.maxPerSection);
    out += rail("Podría gustarte", "según tu historial y favoritos", liked,
      null,
      function (x) { return genresOf(x).slice(0, 2).join(" · "); });

    // 4) Nuevos para ti (recientes no vistos)
    var thisYear = new Date().getFullYear();
    var fresh = pool.filter(function (x) { return Number(x.y) >= thisYear - 1; })
      .sort(function (a, b) { return Number(b.y) - Number(a.y); })
      .slice(0, CFG.maxPerSection);
    out += rail("Nuevos para ti", "recién llegados a tus catálogos", fresh,
      function (x) { return String(x.y || ""); },
      function (x) { return typeLabel(normType(x)); });

    // 5) Favoritos (acceso rápido si hay)
    if (favs.length) {
      var favRows = rows.filter(function (x) { return favs.indexOf(String(x.i || x.id)) >= 0; })
        .slice(0, CFG.maxPerSection);
      out += rail("Tus favoritos", null, favRows, null,
        function (x) { return genresOf(x).slice(0, 2).join(" · "); });
    }

    return out || emptyState("Aún no hay datos para personalizar. Mira algún episodio y vuelve: Descubrir aprenderá de ti.");
  }

  function emptyState(msg) {
    return '<div class="dfx7-empty"><div class="dfx7-empty-icon">✦</div><p>' + esc(msg) + '</p></div>';
  }

  /* ---------- FILTROS + GRID ---------- */
  function chipRow(name, options, current) {
    var h = '<div class="dfx7-fgroup"><span class="dfx7-flabel">' + esc(name) + '</span><div class="dfx7-chips">';
    h += '<button class="dfx7-chip' + (current === "" ? " on" : "") + '" data-f="' + esc(name) + '" data-v="">Todos</button>';
    options.forEach(function (o) {
      h += '<button class="dfx7-chip' + (current === o.v ? " on" : "") + '" data-f="' + esc(name) + '" data-v="' + esc(o.v) + '">' + esc(o.l) + '</button>';
    });
    return h + '</div></div>';
  }
  function filterBar() {
    var genres = {}, types = {}, statuses = {}, years = {};
    rows.forEach(function (x) {
      genresOf(x).forEach(function (g) { genres[g] = 1; });
      types[normType(x)] = 1;
      statuses[statusNorm(x)] = 1;
      if (x.y) years[x.y] = 1;
    });
    var gOpts = Object.keys(genres).sort().slice(0, 24).map(function (g) { return { v: g, l: g }; });
    var tOpts = Object.keys(types).sort().map(function (t) { return { v: t, l: typeLabel(t) }; });
    var sOpts = Object.keys(statuses).sort().map(function (s) { return { v: s, l: s === "emision" ? "En emisión" : (s === "finalizado" ? "Finalizado" : "Otro") }; });
    var cOpts = Object.keys(CFG.labels).map(function (c) { return { v: c, l: CFG.labels[c] }; });
    var yOpts = Object.keys(years).sort().reverse().slice(0, 10).map(function (y) { return { v: y, l: y }; });

    return '' +
      '<section class="dfx7-filters">' +
        chipRow("genero", gOpts, filters.genre) +
        chipRow("tipo", tOpts, filters.type) +
        chipRow("estado", sOpts, filters.status) +
        chipRow("catalogo", cOpts, filters.cat) +
        chipRow("anio", yOpts, filters.year) +
        '<button class="dfx7-clear" id="dfx7Clear">Limpiar filtros</button>' +
      '</section>';
  }
  function applyFilters() {
    var list = rows.filter(function (x) {
      if (filters.genre && genresOf(x).map(String).indexOf(filters.genre) < 0) return false;
      if (filters.type && normType(x) !== filters.type) return false;
      if (filters.status && statusNorm(x) !== filters.status) return false;
      if (filters.cat && x._cat !== filters.cat) return false;
      if (filters.year && String(x.y) !== filters.year) return false;
      return true;
    });
    var grid = document.getElementById("dfx7Grid");
    var count = document.getElementById("dfx7Count");
    if (count) count.textContent = list.length + (list.length === 1 ? " título" : " títulos");
    if (!grid) return;
    if (!list.length) { grid.innerHTML = emptyState("Nada coincide con esos filtros."); return; }
    grid.innerHTML = list.slice(0, CFG.maxGrid).map(function (x) {
      return card(x, { meta: (x.y || "") + " · " + typeLabel(normType(x)) });
    }).join("");
    var more = list.length - CFG.maxGrid;
    if (more > 0) grid.innerHTML += '<div class="dfx7-more">+' + more + ' más… ajusta los filtros para acotar</div>';
  }

  /* ---------- SORPRÉNDEME ---------- */
  function surprise() {
    var seen = histIdSet();
    var pool = rows.filter(function (x) { return !seen[String(x.i || x.id)]; });
    if (!pool.length) pool = rows;
    if (!pool.length) return;
    var pick = pool[Math.floor(Math.random() * pool.length)];
    location.hash = "#/title/" + (pick.i || pick.id);
  }

  /* ---------- RENDER ---------- */
  function skeletons() {
    var s = "";
    for (var i = 0; i < 8; i++) s += '<div class="dfx7-sk-card"><div class="dfx7-sk"></div><div class="dfx7-sk dfx7-sk-line"></div></div>';
    return '<div class="dfx7-rail">' + s + '</div>';
  }
  function render() {
    var app = document.getElementById("app");
    if (!app) return;
    document.title = "Descubrir — DonghuaFlix";
    app.innerHTML = '' +
      '<div class="dfx7-page">' +
        '<header class="dfx7-head">' +
          '<div>' +
            '<h1>Descubrir</h1>' +
            '<p class="dfx7-tagline">Recomendaciones cruzadas entre tus catálogos, basadas en lo que ves y te gusta.</p>' +
          '</div>' +
          '<button class="dfx7-surprise" id="dfx7Surprise">✦ Sorpréndeme</button>' +
        '</header>' +
        '<div id="dfx7Sections" class="dfx7-sections">' + skeletons() + skeletons() + '</div>' +
        '<section class="dfx7-section">' +
          '<div class="dfx7-sec-head"><h2>Explorar catálogos</h2><span class="dfx7-sec-sub" id="dfx7Count"></span></div>' +
          '<div id="dfx7Filters"></div>' +
          '<div class="dfx7-grid" id="dfx7Grid"></div>' +
        '</section>' +
      '</div>';

    document.getElementById("dfx7Surprise").addEventListener("click", function () {
      ensureData().then(surprise);
    });
    document.getElementById("dfx7Filters").addEventListener("click", function (e) {
      var b = e.target.closest(".dfx7-chip");
      if (b) {
        filters[b.getAttribute("data-f")] = b.getAttribute("data-v");
        renderFilterChips();
        applyFilters();
      }
      if (e.target.id === "dfx7Clear") {
        filters = { genre: "", status: "", type: "", cat: "", year: "" };
        renderFilterChips();
        applyFilters();
      }
    });

    ensureData().then(function () {
      var sec = document.getElementById("dfx7Sections");
      if (sec) sec.innerHTML = buildSections();
      renderFilterChips();
      applyFilters();
    });
  }
  function renderFilterChips() {
    var box = document.getElementById("dfx7Filters");
    if (box) box.innerHTML = filterBar();
  }

  /* ---------- NAVEGACIÓN ---------- */
  function markNav() {
    document.querySelectorAll("a[data-nav]").forEach(function (a) {
      a.classList.toggle("on", a.getAttribute("href") === CFG.route);
    });
  }
  function patch() {
    if (location.hash.indexOf(CFG.route) === 0) { markNav(); render(); }
  }
  function addNavLinks() {
    var headerNav = document.querySelector("header.nav nav");
    if (headerNav && !headerNav.querySelector('a[href="' + CFG.route + '"]')) {
      var a = document.createElement("a");
      a.href = CFG.route; a.setAttribute("data-nav", "");
      a.textContent = "Descubrir";
      var myl = headerNav.querySelector('a[href="#/mylist"]');
      headerNav.insertBefore(a, myl || null);
    }
    var more = document.getElementById("moreMenu");
    if (more && !more.querySelector('a[href="' + CFG.route + '"]')) {
      var m = document.createElement("a");
      m.href = CFG.route; m.textContent = "Descubrir";
      more.insertBefore(m, more.firstChild);
    }
  }

  /* ---------- ARRANQUE ---------- */
  var prev = window.route;
  window.route = function () { if (prev) prev.apply(this, arguments); setTimeout(patch, 60); };
  window.addEventListener("hashchange", function () { setTimeout(patch, 60); });
  window.addEventListener("load", function () { addNavLinks(); setTimeout(patch, 120); });
  if (document.readyState === "complete") { addNavLinks(); setTimeout(patch, 60); }

  /* API pública (consola / fases siguientes) */
  window.DFX7 = {
    reload: function () { loaded = false; loading = null; rows = []; return ensureData(); },
    count: function () { return rows.length; },
    surprise: function () { return ensureData().then(surprise); }
  };
})();
