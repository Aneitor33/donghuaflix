// ══════════════════════════════════════════════════════════
//  dfx-ai.js — DonghuaFlix: Asistente IA + Recomendaciones
//  · Motor de recomendaciones LOCAL y determinista (funciona sin IA).
//  · Intérprete de intenciones en lenguaje natural (local).
//  · Chat que intenta /api/ai (Pages Function) y, si falla,
//    responde con el motor local. Nunca inventa títulos.
//  Se carga tras dfx-core.js. No modifica app.js.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';
(function(){if(typeof document==='undefined')return;if(!document.getElementById('dfxThemeJs')){var s=document.createElement('script');s.id='dfxThemeJs';s.src='dfx-theme.js?v=2';document.head.appendChild(s);}var c=document.createElement('script');c.src='dfx-cine.js?v=15';document.head.appendChild(c);})();

  /* ---------- acceso a los globales de app.js ---------- */
  function glb(name) {
    try { return Function('return typeof ' + name + '!=="undefined"?' + name + ':undefined')(); }
    catch (e) { return (typeof window !== 'undefined') ? window[name] : undefined; }
  }
  var esc2 = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  };
  var fold2 = function (s) {
    return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  };

  var getDB = function () { return glb('DB') || { series: [], seasons: [], episodes: [], genres: [] }; };
  var curCat = function () { return glb('currentCatalog') || 'donghualife'; };
  var getFavs = function () { var f = glb('getFavs'); return f ? f() : []; };
  var getHistory = function () { var h = glb('getHistory'); return h ? h() : {}; };
  var getWatched = function () { var w = glb('getWatched'); return w ? w() : {}; };
  var findSeries = function (ref) { var f = glb('findSeries'); return f ? f(ref) : null; };
  var seriesGenres = function (s) { var f = glb('seriesGenres'); return f ? f(s) : (s && s.genres) || []; };
  var cleanTitle = function (s) { var f = glb('cleanTitle'); return f ? f(s) : (s && s.title) || ''; };
  var getSeriesImage = function (s) { var f = glb('getSeriesImage'); return f ? f(s) : (s && s.image) || ''; };
  var showToast = function (m) { var f = glb('showToast'); if (f) f(m); };
  var callCard = function (s) { var f = glb('card'); return f ? f(s) : ''; };
  var callRail = function (items) { var f = glb('rail'); return f ? f(items) : ''; };

  /* ══════════════ MOTOR LOCAL DE RECOMENDACIONES ══════════════ */

  function isCompleted(s) { return /finaliz/i.test(s.status || ''); }
  function isAiring(s) { return /emisi/i.test(s.status || ''); }
  function epsOf(s) { return Number(s.totalEpisodes) || 0; }
  function recencyBoost(s) {
    var t = Date.parse(s.updatedAt || '') || 0;
    if (!t) return 0;
    var age = (Date.now() - t) / 86400000;
    return age <= 30 ? 2 : age <= 90 ? 1 : 0;
  }

  /* géneros con peso: favoritos ×3 + historial reciente ×2 */
  function genreWeights() {
    var w = {};
    var add = function (s, wgt) { genresWithExtra(s).forEach(function (g) { var k = fold2(g); w[k] = (w[k] || 0) + wgt; }); };
    getFavs().forEach(function (id) { var s = findSeries(id); if (s) add(s, 3); });
    var hist = Object.entries(getHistory())
      .sort(function (a, b) { return (b[1].timestamp || 0) - (a[1].timestamp || 0); })
      .slice(0, 10);
    hist.forEach(function (e) { var s = findSeries(e[0]); if (s) add(s, 2); });
    return w;
  }

  function mostRecentHistorySeries() {
    var best = null, bestTs = 0;
    Object.entries(getHistory()).forEach(function (e) {
      if ((e[1].timestamp || 0) > bestTs) { bestTs = e[1].timestamp || 0; best = findSeries(e[0]); }
    });
    return best;
  }

  /* Progreso aproximado: % de series del historial ya completadas (excluir). */
  function isFinishedByUser(s) {
    var h = getHistory()[s.id];
    if (!h || !isCompleted(s)) return false;
    var prog = glb('seriesProgress');
    if (prog) { try { return prog(s) >= 100; } catch (e) { return false; } }
    return false;
  }

  /* Sinónimos temáticos: cuando un género no existe en el catálogo activo
     (p. ej. "Cultivo" en doramas), se busca por palabras clave en los títulos reales. */
  var THEME_KEYWORDS = {
    'cultivo': ['xianxia', 'wuxia', 'inmortal', 'immortal', 'celestial', 'espada', 'sword', 'fox spirit', 'jade', 'tao', 'espíritu', 'spirit', 'fairy', 'demonio', 'demon', 'deidad', 'divino', 'cielo', 'montaña', 'montana', 'reino', 'pacto'],
    'artes marciales': ['martial', 'wuxia', 'kung fu', 'espada', 'sword', 'guerrero', 'warrior', 'dominator', 'lucha', 'pelea', 'fist', 'puño', 'kunlun', 'secta'],
    'cultivación': ['xianxia', 'wuxia', 'inmortal', 'immortal', 'celestial']
  };

  /* Géneros enriquecidos desde public/data/dfx-genres.json (generado por tools/enrich-genres.mjs) */
  var GENRES_EXTRA = {};
  if (typeof fetch === 'function' && typeof document !== 'undefined') {
    fetch('public/data/dfx-genres.json', { cache: 'no-cache' }).then(function (r) {
      return r.ok ? r.json() : null;
    }).then(function (j) {
      if (j && typeof j === 'object' && !Array.isArray(j)) GENRES_EXTRA = j;
    }).catch(function () {});
  }
  function genresWithExtra(x) {
    var base = seriesGenres(x) || [];
    var key = x && (x.slug || x.id);
    var ex = key ? GENRES_EXTRA[key] : null;
    if (!ex || !ex.length) return base;
    var out2 = base.slice();
    ex.forEach(function (g) { if (out2.indexOf(g) === -1) out2.push(g); });
    return out2;
  }

  var DFXAI;
  if (typeof window !== 'undefined') { window.DFXAI = window.DFXAI || {}; DFXAI = window.DFXAI; }
  else { globalThis.DFXAI = globalThis.DFXAI || {}; DFXAI = globalThis.DFXAI; }

  function recommend(intent, limit) {
    intent = intent || { kind: 'foryou' };
    limit = limit || 12;
    var series = (getDB().series || []).slice();
    if (!series.length) return [];
    var histIds = Object.keys(getHistory());
    var favIds = getFavs();
    var W = genreWeights();
    var topGenreKeys = Object.keys(W).sort(function (a, b) { return W[b] - W[a]; });

    var score = function (s) {
      var sc = 0;
      genresWithExtra(s).forEach(function (g) { sc += W[fold2(g)] || 0; });
      return sc + recencyBoost(s) + (isAiring(s) ? 0.5 : 0);
    };
    var excludeSeen = function (s) { return histIds.indexOf(s.id) === -1; };
    var excludeFinished = function (s) { return !isFinishedByUser(s); };
    var sortScore = function (a, b) { return score(b) - score(a) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')); };

    var pool = series.filter(excludeFinished);
    var out = [];
    switch (intent.kind) {
      case 'surprise': {
        var p = pool.filter(excludeSeen);
        if (!p.length) p = pool;
        out = [p[Math.floor(Math.random() * p.length)]].filter(Boolean);
        break;
      }
      case 'short':
        out = pool.filter(function (s) { return epsOf(s) > 0 && epsOf(s) <= 13; }).sort(sortScore);
        break;
      case 'long':
        out = pool.filter(function (s) { return epsOf(s) >= 50; }).sort(sortScore);
        break;
      case 'completed':
        out = pool.filter(isCompleted).sort(sortScore);
        break;
      case 'airing':
        out = pool.filter(isAiring).sort(sortScore);
        break;
      case 'movie':
        out = pool.filter(function (s) { return (s.type || '').toLowerCase() === 'movie'; }).sort(sortScore);
        break;
      case 'genre': {
        var byGenre = pool.filter(function (s) {
          return genresWithExtra(s).some(function (g) { return fold2(g) === fold2(intent.genre); });
        }).sort(sortScore);
        if (!byGenre.length) {
          var kws = THEME_KEYWORDS[fold2(intent.genre)];
          if (kws) {
            byGenre = pool.filter(function (s) {
              var t = fold2(cleanTitle(s));
              return kws.some(function (k) { return t.indexOf(fold2(k)) !== -1; });
            }).sort(sortScore);
          }
        }
        out = byGenre;
        break;
      }
      case 'favs': {
        var favGenres = {};
        favIds.forEach(function (id) { var s = findSeries(id); if (s) genresWithExtra(s).forEach(function (g) { favGenres[fold2(g)] = 1; }); });
        out = pool.filter(function (s) {
          if (favIds.indexOf(s.id) !== -1) return false;
          return genresWithExtra(s).some(function (g) { return favGenres[fold2(g)]; });
        }).sort(sortScore);
        break;
      }
      case 'seed': {
        var seed = intent.seed ? findSeries(intent.seed) : mostRecentHistorySeries();
        if (!seed) { out = pool.filter(excludeSeen).sort(sortScore); break; }
        var sg = seriesGenres(seed).map(fold2);
        out = pool.filter(function (s) {
          if (s.id === seed.id) return false;
          return genresWithExtra(s).some(function (g) { return sg.indexOf(fold2(g)) !== -1; });
        }).sort(sortScore);
        break;
      }
      case 'different': {
        var top = topGenreKeys.slice(0, 4);
        out = pool.filter(function (s) {
          return genresWithExtra(s).every(function (g) { return top.indexOf(fold2(g)) === -1; });
        }).sort(sortScore);
        if (!out.length) out = pool.filter(excludeSeen).sort(function (a, b) { return recencyBoost(b) - recencyBoost(a); });
        break;
      }
      case 'foryou':
      default:
        out = pool.filter(excludeSeen).sort(sortScore);
        if (!out.length) out = pool.slice().sort(sortScore);
    }
    return out.slice(0, limit);
  }

  function candidatesForAI(intent, limit) {
    return recommend(intent, limit || 20).map(function (s) {
      return {
        id: String(s.id), title: cleanTitle(s),
        genres: genresWithExtra(s).slice(0, 4), status: s.status || '',
        eps: epsOf(s) || null, year: s.year || null
      };
    });
  }

  /* ---------- intérprete de intenciones (local) ---------- */
  function catalogGenres() {
    var g = (getDB().genres || []).map(function (x) { return x.name || x; });
    var set = {};
    (getDB().series || []).forEach(function (s) { genresWithExtra(s).forEach(function (x) { set[x] = 1; }); });
    var all = g.concat(Object.keys(set));
    return all.filter(function (v, i, a) { return a.indexOf(v) === i; });
  }

  function parseIntent(text) {
    var t = fold2(text);
    if (/sorprend|aleatori|al azar|cualquier cosa|casual/.test(t)) return { kind: 'surprise' };
    if (/cort[oa]|una noche|maraton de una|pocas capitulos|pocos episodios/.test(t)) return { kind: 'short' };
    if (/larg[oa]|extens[oa]|muchas temporadas/.test(t)) return { kind: 'long' };
    if (/finalizad|terminad|complet[oa]|cerrad[oa]/.test(t)) return { kind: 'completed' };
    if (/emision|estren|capitulo nuevo|cada semana/.test(t)) return { kind: 'airing' };
    if (/favorit|mi lista|me gusta|gustado/.test(t)) return { kind: 'favs' };
    if (/historial|lo que vi|visto (ayer|antes|reciente)|ultim|continuar/.test(t)) return { kind: 'seed' };
    if (/diferente|otra cosa|nuevo genero|cambi(a|e) de/.test(t)) return { kind: 'different' };
    if (/pelicula|film/.test(t)) return { kind: 'movie' };
    var m = t.match(/parecid[oa] a |similar a |como (?:la serie |el donghua |la pelicula )?/);
    if (m) {
      var rest = t.slice(m.index + m[0].length).trim();
      if (rest.length >= 3) {
        var found = (getDB().series || []).find(function (s) { return fold2(cleanTitle(s)).indexOf(rest) !== -1; });
        if (found) return { kind: 'seed', seed: found.id };
      }
    }
    var genres = catalogGenres();
    for (var i = 0; i < genres.length; i++) {
      var g = genres[i], fg = fold2(g);
      if (fg.length >= 3 && t.indexOf(fg) !== -1) return { kind: 'genre', genre: g };
    }
    return { kind: 'foryou' };
  }

  function prefsSummary() {
    var W = genreWeights();
    var hist = Object.entries(getHistory()).sort(function (a, b) { return (b[1].timestamp || 0) - (a[1].timestamp || 0); });
    return {
      topGenres: Object.keys(W).sort(function (a, b) { return W[b] - W[a]; }).slice(0, 5).map(function (k) {
        var orig = k;
        (getDB().series || []).some(function (s) { return genresWithExtra(s).some(function (g) { if (fold2(g) === k) orig = g; return fold2(g) === k; }); });
        return orig;
      }),
      favCount: getFavs().length,
      watchedCount: hist.length,
      recentTitles: hist.slice(0, 3).map(function (e) { var s = findSeries(e[0]); return s ? cleanTitle(s) : ''; }).filter(Boolean),
      catalog: curCat()
    };
  }

  /* respuesta local cuando la IA no está disponible */
  var LOCAL_TPL = {
    foryou: 'La IA no responde ahora mismo, pero aquí tienes recomendaciones calculadas con tus datos locales:',
    surprise: 'Sorpresa fuera de la IA: he elegido esto al azar de lo que no has visto:',
    short: 'Series cortas (≤13 episodios) según tus gustos:',
    long: 'Series largas para largas temporadas de maratón:',
    completed: 'Series finalizadas con final cerrado:',
    airing: 'Series en emisión ahora mismo:',
    movie: 'Películas disponibles en este catálogo:',
    genre: 'Opciones de género «{g}»:',
    favs: 'Similares a tus favoritos:',
    seed: 'Si te gustó eso, esto encaja con tus gustos:',
    different: 'Algo fuera de tu zona habitual:'
  };
  function localRespond(intent) {
    var items = recommend(intent, 3);
    var tpl = LOCAL_TPL[intent.kind] || LOCAL_TPL.foryou;
    if (intent.kind === 'genre') tpl = tpl.replace('{g}', intent.genre);
    return { reply: items.length ? tpl : 'No encontré nada que encaje en este catálogo. Prueba con otro género o catálogo.', items: items };
  }

  DFXAI.engine = { recommend: recommend, parseIntent: parseIntent, candidatesForAI: candidatesForAI, prefsSummary: prefsSummary, localRespond: localRespond };

  /* ══════════════ INYECCIÓN DE RAÍLES EN HOME ══════════════ */
  function injectHomeRails() {
    if (typeof document === 'undefined') return;
    var app = document.getElementById('app');
    if (!app || document.getElementById('dfxAiFavRail')) return;
    if (location.hash && location.hash !== '#/' && location.hash !== '#') return;
    var favs = getFavs(), hist = Object.keys(getHistory());
    if (!favs.length && !hist.length) return;
    var html = '';
    var favRail = recommend({ kind: 'favs' }, 12);
    if (favRail.length) {
      html += '<section class="section" id="dfxAiFavRail"><div class="section-head"><h2>❤️ Similar a tus favoritos</h2><span class="muted">' + favRail.length + '</span></div>' + callRail(favRail) + '</section>';
    }
    var diffRail = recommend({ kind: 'different' }, 12);
    if (diffRail.length) {
      html += '<section class="section" id="dfxAiDiffRail"><div class="section-head"><h2>✦ Descubre algo diferente</h2><span class="muted">' + diffRail.length + '</span></div>' + callRail(diffRail) + '</section>';
    }
    if (html) app.insertAdjacentHTML('beforeend', html);
  }
  function wrapHome() {
    var h = glb('home');
    if (typeof h !== 'function' || h.__dfxAi) return;
    var w = function () { var r = h.apply(this, arguments); setTimeout(injectHomeRails, 380); return r; };
    w.__dfxAi = true;
    if (typeof window !== 'undefined') window.home = w;
  }

  /* ══════════════ INTERFAZ DEL ASISTENTE ══════════════ */
  var chatHistory = [];   // [{role, content}] — solo en memoria, nunca en logs
  var lastPayload = null;
  var fabEl = null, panelEl = null, msgsEl = null, inputEl = null;

  var SPARK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3.5l1.9 5.3 5.3 1.9-5.3 1.9L12 17.9l-1.9-5.3-5.3-1.9 5.3-1.9z"/><path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/></svg>';
  var SEND = '<svg viewBox="0 0 24 24" fill="none"><path d="M16.5364 10.1636C16.8879 10.5151 16.8879 11.0849 16.5364 11.4364C16.1849 11.7879 15.6151 11.7879 15.2636 11.4364L12.9 9.07281V17.1C12.9 17.597 12.4971 18 12 18C11.503 18 11.1 17.597 11.1 17.1V9.07281L8.73641 11.4364C8.38494 11.7879 7.81509 11.7879 7.46362 11.4364C7.11214 11.0849 7.11214 10.5151 7.46362 10.1636L11.3636 6.2636C11.7151 5.91211 12.2849 5.91211 12.6364 6.2636L16.5364 10.1636Z" fill="currentColor"/></svg>';
  var CLOSE = '<svg viewBox="0 0 24 24" fill="none"><path d="M17.9542 4.77253C18.3056 4.42106 18.8761 4.42106 19.2276 4.77253C19.579 5.12401 19.579 5.69452 19.2276 6.04597L13.2735 12.0001L19.2276 17.9542C19.5791 18.3056 19.5791 18.8761 19.2276 19.2276C18.8761 19.5791 18.3056 19.5791 17.9542 19.2276L12.0001 13.2735L6.04595 19.2276C5.69451 19.5791 5.12399 19.579 4.77252 19.2276C4.42104 18.8761 4.42104 18.3056 4.77252 17.9542L10.7266 12.0001L4.77252 6.04597C4.42104 5.6945 4.42104 5.124 4.77252 4.77253C5.12399 4.42107 5.69448 4.42106 6.04595 4.77253L12.0001 10.7267L17.9542 4.77253Z" fill="currentColor"/></svg>';
  var STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 4l2.1 4.6 5 .5-3.8 3.3 1.1 4.9L12 14.4 7.6 17.3l1.1-4.9L4.9 9.1l5-.5z"/></svg>';

  function buildUI() {
    if (document.getElementById('dfxAiFab')) return;
    fabEl = document.createElement('button');
    fabEl.id = 'dfxAiFab';
    fabEl.setAttribute('aria-label', 'Abrir asistente de IA');
    fabEl.innerHTML = SPARK + '<span class="dfxai-dot"></span>';
    fabEl.onclick = openPanel;
    document.body.appendChild(fabEl);

    panelEl = document.createElement('div');
    panelEl.id = 'dfxAiPanel';
    panelEl.setAttribute('role', 'dialog');
    panelEl.setAttribute('aria-label', 'Asistente DonghuaFlix');
    panelEl.innerHTML =
      '<div class="dfxai-head">' +
        '<div class="dfxai-avatar">' + SPARK + '</div>' +
        '<div><div class="dfxai-title">Asistente DonghuaFlix</div>' +
        '<div class="dfxai-sub">Recomienda con tu catálogo real · tus datos no salen de tu dispositivo salvo un resumen</div></div>' +
        '<span style="flex:1"></span>' +
        '<button class="dfxai-iconbtn" id="dfxAiClose" aria-label="Cerrar asistente">' + CLOSE + '</button>' +
      '</div>' +
      '<div class="dfxai-msgs" id="dfxAiMsgs">' +
        '<div class="dfxai-msg ai">Hola 👋 Puedo recomendarte contenido del catálogo según tus favoritos e historial. ¿Qué te apetece ver?</div>' +
        '<div class="dfxai-chips">' +
          '<button class="dfxai-chip" data-q="Recomiéndame un donghua de acción">De acción</button>' +
          '<button class="dfxai-chip" data-q="Quiero algo corto para esta noche">Corto para hoy</button>' +
          '<button class="dfxai-chip" data-q="Algo parecido a mis favoritos">Como mis favoritos</button>' +
          '<button class="dfxai-chip" data-q="Encuentra series terminadas">Finalizadas</button>' +
          '<button class="dfxai-chip" data-q="Sorpréndeme">Sorpréndeme</button>' +
        '</div>' +
      '</div>' +
      '<div class="dfxai-inputbar">' +
        '<input id="dfxAiInput" type="text" maxlength="500" placeholder="Pide una recomendación…" aria-label="Escribe tu mensaje">' +
        '<button class="dfxai-send" id="dfxAiSend" aria-label="Enviar">' + SEND + '</button>' +
      '</div>';
    document.body.appendChild(panelEl);

    document.getElementById('dfxAiClose').onclick = closePanel;
    document.getElementById('dfxAiSend').onclick = function () { submit(inputEl ? inputEl.value : ''); };
    inputEl = document.getElementById('dfxAiInput');
    inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { submit(inputEl.value); } });
    msgsEl = document.getElementById('dfxAiMsgs');
    msgsEl.addEventListener('click', function (e) {
      var chip = e.target.closest('.dfxai-chip');
      if (chip) { submit(chip.getAttribute('data-q')); return; }
      var link = e.target.closest('[data-dfxai-open]');
      if (link) {
        var slug = link.getAttribute('data-dfxai-open');
        closePanel();
        location.hash = '#/series/' + encodeURIComponent(slug);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && panelEl && panelEl.classList.contains('open')) closePanel();
    });
    updateFabVisibility();
    window.addEventListener('hashchange', updateFabVisibility);
  }

  function updateFabVisibility() {
    if (!fabEl) return;
    var h = location.hash || '#/';
    var hide = h.indexOf('#/episode') === 0 || h.indexOf('#/diag') === 0 || (document.body && document.body.classList.contains('dfx-cine'));
    fabEl.style.display = hide ? 'none' : '';
    if (hide && panelEl && panelEl.classList.contains('open')) closePanel();
  }
  if (typeof document !== 'undefined') document.addEventListener('keydown', function (e) { if (e.key === 'c' || e.key === 'C') setTimeout(updateFabVisibility, 50); });

  function openPanel() {
    updateFabVisibility();
    panelEl.classList.add('open');
    fabEl.style.display = 'none';
    setTimeout(function () { inputEl && inputEl.focus(); }, 250);
  }
  function closePanel() {
    panelEl.classList.remove('open');
    updateFabVisibility();
  }

  function scrollMsgs() { if (msgsEl) msgsEl.scrollTop = msgsEl.scrollHeight; }
  function addMsg(cls, html) {
    var d = document.createElement('div');
    d.className = 'dfxai-msg ' + cls;
    d.innerHTML = html;
    msgsEl.appendChild(d);
    scrollMsgs();
    return d;
  }
  function cardHTML(s, reason) {
    var img = getSeriesImage(s);
    var meta = [];
    var g = genresWithExtra(s); if (g.length) meta.push(esc2(g.slice(0, 2).join(' · ')));
    if (epsOf(s)) meta.push(epsOf(s) + ' eps');
    if (s.status) meta.push(esc2(s.status));
    var thumb = img
      ? '<img loading="lazy" src="' + esc2(img) + '" alt="" onerror="this.remove()">'
      : '<span class="dfxai-nothumb">▶</span>';
    return '<div class="dfxai-card">' +
      '<div class="dfxai-thumb">' + thumb + '</div>' +
      '<div class="dfxai-cbody">' +
        '<div class="dfxai-ctitle">' + esc2(cleanTitle(s)) + '</div>' +
        '<div class="dfxai-cmeta">' + meta.join(' · ') + '</div>' +
        (reason ? '<div class="dfxai-creason">' + STAR + '<span>' + esc2(reason) + '</span></div>' : '') +
        '<a class="dfxai-clink" data-dfxai-open="' + esc2(s.slug || s.id) + '">Ver ficha →</a>' +
      '</div></div>';
  }
  function renderRecommendationCards(items, reasons) {
    var html = '';
    items.forEach(function (s, i) {
      if (s) html += cardHTML(s, reasons ? reasons[i] : '');
    });
    return html;
  }

  var typingEl = null;
  function showTyping() {
    typingEl = document.createElement('div');
    typingEl.className = 'dfxai-msg ai dfxai-typing';
    typingEl.innerHTML = '<i></i><i></i><i></i>';
    msgsEl.appendChild(typingEl);
    scrollMsgs();
  }
  function hideTyping() { if (typingEl) { typingEl.remove(); typingEl = null; } }

  function submit(text) {
    text = String(text || '').trim();
    if (!text || !msgsEl) return;
    if (inputEl) inputEl.value = '';
    var chipsBox = msgsEl.querySelector('.dfxai-chips');
    if (chipsBox) chipsBox.remove();
    addMsg('me', esc2(text));
    chatHistory.push({ role: 'user', content: text.slice(0, 500) });
    if (chatHistory.length > 8) chatHistory = chatHistory.slice(-8);

    var intent = parseIntent(text);
    var candidates = candidatesForAI(intent, 20);
    lastPayload = {
      message: text.slice(0, 500),
      history: chatHistory.slice(-8),
      prefs: prefsSummary(),
      candidates: candidates
    };
    showTyping();

    var ctrl = ('AbortController' in window) ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 50000) : null;

    fetch('/api/ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl ? ctrl.signal : undefined,
      body: JSON.stringify(lastPayload)
    }).then(function (r) {
      if (timer) clearTimeout(timer);
      return r.json().then(function (j) { return { ok: r.ok, j: j }; });
    }).then(function (res) {
      hideTyping();
      if (!res.ok || !res.j || !res.j.reply) throw new Error((res.j && res.j.error) || 'http ' + (res.ok ? 200 : 500));
      chatHistory.push({ role: 'assistant', content: res.j.reply.slice(0, 500) });
      var picks = (res.j.picks || []).map(function (p) { return { s: findSeries(p.id), reason: p.reason }; });
      var cardsHtml = '';
      picks.forEach(function (p) { if (p.s) cardsHtml += cardHTML(p.s, p.reason); });
      addMsg('ai', esc2(res.j.reply) + cardsHtml);
    }).catch(function () {
      hideTyping();
      fallbackLocal(intent, candidates);
    });
  }

  function fallbackLocal(intent, candidates) {
    var r = localRespond(intent);
    var items = (r.items && r.items.length) ? r.items : (candidates || []).slice(0, 3).map(function (c) { return findSeries(c.id); }).filter(Boolean);
    var html = esc2(r.reply) + renderRecommendationCards(items, null);
    var err = document.createElement('div');
    err.className = 'dfxai-retry';
    err.innerHTML = 'La IA no está disponible ahora mismo. <button id="dfxAiRetry">Reintentar</button>';
    var msg = addMsg('ai', html);
    msg.appendChild(err);
    document.getElementById('dfxAiRetry').onclick = function () {
      err.remove();
      if (lastPayload) {
        addMsg('me', esc2(lastPayload.message));
        showTyping();
        fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(lastPayload)
        }).then(function (r2) { return r2.json().then(function (j) { return { ok: r2.ok, j: j }; }); })
          .then(function (res) {
            hideTyping();
            if (!res.ok || !res.j || !res.j.reply) throw new Error('fail');
            chatHistory.push({ role: 'assistant', content: res.j.reply.slice(0, 500) });
            var cardsHtml = '';
            (res.j.picks || []).forEach(function (p) { var s = findSeries(p.id); if (s) cardsHtml += cardHTML(s, p.reason); });
            addMsg('ai', esc2(res.j.reply) + cardsHtml);
          })
          .catch(function () { hideTyping(); fallbackLocal(intent, candidates); });
      }
    };
  }

  /* ---------- arranque ---------- */
  function boot() {
    wrapHome();
    buildUI();
    setTimeout(injectHomeRails, 1200);
    var _route = glb('route');
    if (typeof _route === 'function' && !_route.__dfxAiRoute) {
      var r2 = function () { var r = _route.apply(this, arguments); setTimeout(function () { injectHomeRails(); updateFabVisibility(); }, 300); return r; };
      r2.__dfxAiRoute = true;
      window.route = r2;
    }
    document.addEventListener('dfx:logout', function () { chatHistory = []; });
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
})();
