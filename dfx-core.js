console.log('%c DonghuaFlix Pro ', 'background:#111;color:#fff;font-size:12px;border-left:4px solid #e50914;padding:2px 6px;');

/* ============================================================
   DONGHUAFLIX PRO — Capa de valor añadido
   ============================================================
   Incluye:
   - Perfiles múltiples (hasta 4) con ajustes independientes
   - Insignias (badges) por hitos de visualización
   - Reanudar episodio desde donde lo dejaste
   - Episodio aleatorio (sorpréndeme)
   - Nube multi-perfil (Firestore opcional) con fallback local
   - Modo maratón
   - Radar de episodios nuevos
   - Calendario semanal
   - Versus (comparador de títulos)
   - Perfil público /u/:id
   - Notificaciones push
   - Sala compartida entre dispositivos
   - Exportar / Importar datos
   ============================================================ */
(function () {
  'use strict';

  window.DFX = window.DFX || {};

  const DFX = window.DFX;

  DFX.v = '1.4.1';
  DFX.appId = 'donghuaflix';

  /* ----------------------------------------------------------
     Utilidades
     ---------------------------------------------------------- */
  const $  = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const prof = () => DFX.profiles.find(p => p.id === DFX.current) || DFX.profiles[0];
  const prefix = () => 'dfx_p_' + DFX.current + '_';

  /* localStorage seguro */
  const ls = {
    get(k, fb){ try { const v = localStorage.getItem(k); return v === null ? fb : JSON.parse(v); } catch { return fb; } },
    set(k, v){ try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
  };
  const load = (k, fb) => ls.get(k, fb);
  const save = (k, v) => ls.set(k, v);

  /* ----------------------------------------------------------
     Perfiles
     ---------------------------------------------------------- */
  DFX.profiles = load('dfx_profiles', null) || [
    { id: 'p1', name: 'Perfil 1', avatar: '👤', color: '#e50914', createdAt: Date.now() },
    { id: 'p2', name: 'Perfil 2', avatar: '🎬', color: '#3b82f6', createdAt: Date.now() },
    { id: 'p3', name: 'Perfil 3', avatar: '🌙', color: '#a855f7', createdAt: Date.now() },
    { id: 'p4', name: 'Perfil 4', avatar: '⚡', color: '#22c55e', createdAt: Date.now() }
  ];
  save('dfx_profiles', DFX.profiles);

  DFX.current = load('dfx_current', 'p1');
  if (!DFX.profiles.some(p => p.id === DFX.current)) DFX.current = DFX.profiles[0].id;
  save('dfx_current', DFX.current);

  /* Ajustes por perfil */
  DFX.settings = Object.assign(
    { textSize: 'md', autoplay: true, reduceMotion: false, imgQ: 'fast' },
    load(prefix() + 'set', {})
  );

  /* Estado volátil */
  DFX.resume = load('dfx_resume', {});       // { epId: seconds }
  DFX.seen   = load('dfx_seen', {});         // { seriesId: lastSeenEpNumber|timestamp }
  DFX.best   = load('dfx_marathon_best', 0); // récord de caps en un día
  DFX.today  = 0;                            // caps vistos hoy (sesión)

  /* ----------------------------------------------------------
     Iconos (trazo fino, estilo coherente)
     ---------------------------------------------------------- */
  const I = {
    Sparkles: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.9 2.1L22 18l-2.1.9L19 21l-.9-2.1L16 18l2.1-.9z"/></svg>',
    Trophy:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a1 1 0 0 0-1 1c0 2 1.5 3.5 4 3.5M17 6h3a1 1 0 0 1 1 1c0 2-1.5 3.5-4 3.5"/></svg>',
    Calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M16 2v4M8 2v4M3 9h18"/></svg>',
    Compass:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M16 8l-2.5 5.5L8 16l2.5-5.5z"/></svg>',
    Share2:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 10.7l6.8-4.4M8.6 13.3l6.8 4.4"/></svg>',
    User:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.5-6.5 8-6.5s8 2.5 8 6.5"/></svg>',
    Download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0l-4-4m4 4l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    Upload:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15V3m0 0L8 7m4-4l4 4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    Trash2:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
    Play:     '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    Lock:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    Bell:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    Timer:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3h14M12 3v3"/><circle cx="12" cy="14" r="7"/><path d="M12 14l2.5-2.5"/></svg>',
    Gauge:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 15l3.5-5.5"/><path d="M3.5 15a8.5 8.5 0 1 1 17 0"/></svg>',
    Eye:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    Flame:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22c4 0 7-2.8 7-7 0-3-2-5.5-3.5-7C14 6.5 13 4.5 13 2c-3 2-5 5-5 8-1-1-1.5-2-1.5-4C4.8 8.5 5 11 5 15c0 4.2 3 7 7 7z"/></svg>',
    Layers:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5"/></svg>',
    Zap:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L4 14h6l-1 8 9-12h-6l1-8z"/></svg>',
    Award:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M8.5 14L7 22l5-3 5 3-1.5-8"/></svg>',
    Star:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.8-4.5 4.2 1.1 6-5.4-3-5.4 3 1.1-6L3.2 9.4l6.1-.8z"/></svg>',
    Bookmark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    Heart:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9A5.3 5.3 0 0 1 12 6.6a5.3 5.3 0 0 1 9.3 4.9c-1.8 4.4-9.3 9-9.3 9z"/></svg>'
  };

  /* ----------------------------------------------------------
     Toast propio (estilo Pro)
     ---------------------------------------------------------- */
  function toast(msg, ms = 2600) {
    let t = $('#dfxToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dfxToast';
      t.style.cssText = 'position:fixed;left:50%;bottom:92px;transform:translateX(-50%);background:rgba(12,12,16,.92);border:1px solid rgba(255,255,255,.12);color:#fff;padding:11px 18px;border-radius:12px;font-size:13px;z-index:99999;opacity:0;transition:opacity .25s;pointer-events:none;max-width:86vw;text-align:center;backdrop-filter:blur(8px);font-family:inherit;box-shadow:0 8px 30px rgba(0,0,0,.5)';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => t.style.opacity = '1');
    clearTimeout(t._h);
    t._h = setTimeout(() => t.style.opacity = '0', ms);
  }

  /* ----------------------------------------------------------
     Splash Pro
     ---------------------------------------------------------- */
  function splash() {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;background:#000;display:flex;align-items:center;justify-content:center;z-index:99998;font-family:inherit;color:#fff';
    el.innerHTML = '<div style="text-align:center;animation:dfxFadeIn .8s ease"><div style="font-size:15px;letter-spacing:4px;text-transform:uppercase;opacity:.85">Donghua<b style="color:#e50914">Flix</b> Pro</div><div style="width:160px;height:2px;background:rgba(255,255,255,.1);margin:14px auto;border-radius:2px;overflow:hidden"><div style="width:40%;height:100%;background:#e50914;animation:dfxSlide 1.2s ease-in-out infinite alternate;border-radius:2px"></div></div></div>';
    document.body.appendChild(el);
    const st = document.createElement('style');
    st.textContent = '@keyframes dfxFadeIn{from{opacity:0}to{opacity:1}}@keyframes dfxSlide{from{transform:translateX(-30%)}to{transform:translateX(260%)}}';
    document.head.appendChild(st);
    setTimeout(() => el.remove(), 900);
  }

  /* ----------------------------------------------------------
     Utilidad: envolver funciones del núcleo sin doble-wrap
     ---------------------------------------------------------- */
  function wrap(name, fn) {
    const w = window;
    if (!w[name] || w[name].__dfx) return;
    const orig = w[name];
    const wrapped = function (...a) {
      const out = orig.apply(this, a);
      try { fn.apply(this, a); } catch {}
      return out;
    };
    wrapped.__dfx = true;
    w[name] = wrapped;
  }

  /* ----------------------------------------------------------
     Estadísticas
     ---------------------------------------------------------- */
  function computeStats() {
    const watched = window.getWatched ? window.getWatched() : {};
    let total = 0, done = 0;
    const eps = (window.DB && window.DB.episodes) || [];
    const series = (window.DB && window.DB.series) || [];
    const perSeries = {};
    for (const ep of eps) { perSeries[ep.seriesId] = (perSeries[ep.seriesId] || 0) + 1; }
    const seenPerSeries = {};
    for (const sid in watched) {
      for (const n in watched[sid]) {
        total++;
        seenPerSeries[sid] = (seenPerSeries[sid] || 0) + 1;
      }
    }
    for (const sid in perSeries) {
      if (seenPerSeries[sid] >= perSeries[sid]) done++;
    }
    return { total, series: series.length, seriesDone: done };
  }

  /* ----------------------------------------------------------
     Insignias
     ---------------------------------------------------------- */
  const BADGES = [
    { id: 'first',      name: 'Primeros pasos',   desc: 'Mira tu primer episodio',                 icon: I.Sparkles, check: s => s.total >= 1 },
    { id: 'curious',    name: 'Curioso',          desc: 'Mira 10 episodios',                       icon: I.Eye,      check: s => s.total >= 10 },
    { id: 'regular',    name: 'Regular',          desc: 'Mira 50 episodios',                       icon: I.Flame,    check: s => s.total >= 50 },
    { id: 'marathon',   name: 'Maratonista',      desc: 'Mira 100 episodios',                      icon: I.Timer,    check: s => s.total >= 100 },
    { id: 'legend',     name: 'Leyenda',          desc: 'Mira 300 episodios',                      icon: I.Trophy,   check: s => s.total >= 300 },
    { id: 'collector',  name: 'Coleccionista',    desc: 'Explora 50 series distintas',             icon: I.Layers,   check: s => s.series >= 50 },
    { id: 'completist', name: 'Perfeccionista',   desc: 'Termina 3 series completas',              icon: I.Award,    check: s => s.seriesDone >= 3 },
    { id: 'week',       name: 'Constancia',       desc: 'Mira episodios 7 días seguidos',          icon: I.Calendar, check: () => (load('dfx_streak_days', 0) >= 7) },
    { id: 'speed',      name: 'Velocista',        desc: 'Mira 5 episodios en un día',              icon: I.Zap,      check: () => DFX.best >= 5 || DFX.today >= 5 },
    { id: 'critic',     name: 'Crítico',          desc: 'Añade 10 títulos a Mi lista',             icon: I.Bookmark, check: () => (window.getFavs ? window.getFavs().length : 0) >= 10 },
    { id: 'explorer',   name: 'Explorador',       desc: 'Usa el descubrimiento aleatorio',         icon: I.Compass,  check: () => load('dfx_random_used', 0) > 0 },
    { id: 'loyal',      name: 'Fiel',             desc: 'Usa DonghuaFlix 30 días',                 icon: I.Star,     check: () => (load('dfx_active_days', {}) && Object.keys(load('dfx_active_days', {})).length >= 30) }
  ];

  /* insignias: conteo de episodios vistos */
  function dateKey(d = new Date()) {
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function registerActiveDay() {
    const days = load('dfx_active_days', {});
    days[dateKey()] = true;
    save('dfx_active_days', days);
  }

  function checkStreak() {
    const today = dateKey();
    const y = new Date(); y.setDate(y.getDate() - 1);
    const yesterday = dateKey(y);
    const st = load('dfx_streak', { last: null, count: 0 });
    if (st.last === today) return st.count;
    st.count = (st.last === yesterday) ? st.count + 1 : 1;
    st.last = today;
    save('dfx_streak', st);
    save('dfx_streak_days', st.count);
    return st.count;
  }

  function loadDay() {
    const d = load('dfx_day', null);
    if (!d || d.k !== dateKey()) return { k: dateKey(), n: 0 };
    return d;
  }

  function saveDay(n) {
    save('dfx_day', { k: dateKey(), n });
    DFX.today = n;
    if (n > DFX.best) { DFX.best = n; save('dfx_marathon_best', n); }
  }

  function loadResume() {
    DFX.resume = load('dfx_resume', {});
  }

  function loadMarathon() {
    const d = loadDay();
    DFX.today = d.n;
  }

  function loadSeen() {
    DFX.seen = load('dfx_seen', {});
  }

  function loadSettings() {
    DFX.settings = Object.assign(
      { textSize: 'md', autoplay: true, reduceMotion: false, imgQ: 'fast' },
      load('dfx_settings', {}),
      load(prefix() + 'set', {})
    );
  }

  function applySettings() {
    const s = DFX.settings;
    const r = document.documentElement;
    r.style.setProperty('--dfx-text-scale', s.textSize === 'sm' ? '.92' : s.textSize === 'lg' ? '1.08' : '1');
    r.classList.toggle('dfx-no-motion', !!s.reduceMotion);
    save('dfx_settings', s);
    save(prefix() + 'set', s);
  }

  /* ----------------------------------------------------------
     Radar: episodios nuevos de series seguidas
     ---------------------------------------------------------- */
  function followSet() {
    const favs = new Set(window.getFavs ? window.getFavs() : []);
    const hist = window.getHistory ? window.getHistory() : {};
    for (const k in hist) favs.add(k);
    return favs;
  }

  function getEps(s) {
    const DB = window.DB;
    if (!DB || !DB.episodes) return [];
    return DB.episodes.filter(e => e.seriesId === s.id);
  }

  function getLatestEpisode(s) {
    const eps = getEps(s);
    if (!eps.length) return null;
    return eps.reduce((a, b) => (a.number > b.number ? a : b));
  }

  function fmtTimeAgo(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 60) return 'hace un momento';
    const m = Math.floor(s / 60);   if (m < 60) return `hace ${m} min`;
    const h = Math.floor(m / 60);   if (h < 24) return `hace ${h} h`;
    const d = Math.floor(h / 24);   if (d < 30) return `hace ${d} d`;
    const mo = Math.floor(d / 30);  if (mo < 12) return `hace ${mo} mes${mo > 1 ? 'es' : ''}`;
    return `hace ${Math.floor(mo / 12)} año${mo >= 24 ? 's' : ''}`;
  }

  function isNewEpisode(s, ep) {
    const last = DFX.seen[s.id];
    if (last == null) return false;
    const n = typeof last === 'object' && last !== null ? (last.n ?? 0) : Number(last) || 0;
    return ep.number > n;
  }

  function newEpisodesCount() {
    try {
      const eps = (window.DB && window.DB.episodes) || [];
      if (!eps.length) return 0;
      const follow = followSet();
      if (!follow.size) return 0;
      const bySeries = {};
      for (const e of eps) {
        if (!follow.has(e.seriesId)) continue;
        (bySeries[e.seriesId] = bySeries[e.seriesId] || []).push(e);
      }
      let n = 0;
      for (const sid in bySeries) {
        const s = window.findSeries ? window.findSeries(sid) : null;
        if (!s) continue;
        for (const ep of bySeries[sid]) {
          if (isNewEpisode(s, ep)) n++;
        }
      }
      return n;
    } catch { return 0; }
  }

  /* marca los episodios actuales como "vistos" para el radar */
  function markSeenCurrent() {
    try {
      const eps = (window.DB && window.DB.episodes) || [];
      const follow = followSet();
      if (!follow.size || !eps.length) return;
      const bySeries = {};
      for (const e of eps) {
        if (!follow.has(e.seriesId)) continue;
        (bySeries[e.seriesId] = bySeries[e.seriesId] || []).push(e);
      }
      let changed = false;
      for (const sid in bySeries) {
        const list = bySeries[sid];
        const max = Math.max(...list.map(e => e.number));
        const prev = DFX.seen[sid];
        const pn = prev == null ? 0 : (typeof prev === 'object' && prev !== null ? (prev.n ?? 0) : Number(prev) || 0);
        if (max > pn) { DFX.seen[sid] = max; changed = true; }
      }
      if (changed) save('dfx_seen', DFX.seen);
    } catch {}
  }

  /* ----------------------------------------------------------
     UI: barra flotante del radar
     ---------------------------------------------------------- */
  function injectRadar() {
    if ($('#dfxRadarBar')) return;
    const bar = document.createElement('div');
    bar.id = 'dfxRadarBar';
    bar.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:76px;z-index:9990;display:none;align-items:center;gap:10px;background:linear-gradient(90deg,#1a0505,#111);border:1px solid rgba(229,9,20,.55);color:#fff;padding:9px 16px;border-radius:999px;font-size:13px;box-shadow:0 10px 30px rgba(0,0,0,.55), inset 0 0 12px rgba(229,9,20,.12);backdrop-filter:blur(6px);animation:dfxRadarIn .5s ease;font-family:inherit;max-width:92vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    bar.innerHTML = `<span style="display:flex;align-items:center;gap:8px;color:#ff6b6b;font-weight:600;letter-spacing:.3px"><span style="width:8px;height:8px;border-radius:50%;background:#e50914;box-shadow:0 0 10px #e50914;animation:dfxPulse 1.4s infinite"></span> Radar</span><span id="dfxRadarTxt" style="opacity:.92"></span><a href="#/radar" style="color:#fff;text-decoration:none;border-left:1px solid rgba(255,255,255,.15);padding-left:10px;font-weight:600;white-space:nowrap">Ver</a>`;
    document.body.appendChild(bar);
    const st = document.createElement('style');
    st.textContent = '@keyframes dfxRadarIn{from{opacity:0;transform:translateX(-50%) translateY(14px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}@keyframes dfxPulse{0%,100%{opacity:1}50%{opacity:.35}}';
    document.head.appendChild(st);
  }

  function updateRadar() {
    const n = newEpisodesCount();
    const bar = $('#dfxRadarBar');
    if (!bar) return;
    if (n > 0) {
      bar.style.display = 'flex';
      $('#dfxRadarTxt').textContent = `${n} episodio${n > 1 ? 's' : ''} nuevo${n > 1 ? 's' : ''} en series seguidas`;
    } else {
      bar.style.display = 'none';
    }
  }

  /* página del radar */
  function radarPage() {
    const eps = (window.DB && window.DB.episodes) || [];
    const series = (window.DB && window.DB.series) || [];
    const follow = followSet();
    const items = [];
    for (const s of series) {
      if (!follow.has(s.id)) continue;
      const list = eps.filter(e => e.seriesId === s.id);
      if (!list.length) continue;
      const news = list.filter(e => isNewEpisode(s, e)).sort((a, b) => a.number - b.number);
      if (!news.length) continue;
      items.push({ s, news, last: news[news.length - 1] });
    }
    items.sort((a, b) => new Date(b.last.updatedAt || 0) - new Date(a.last.updatedAt || 0));

    document.getElementById('app').innerHTML = `
      <section class="section page-top" style="max-width:900px;margin:0 auto">
        <div class="section-head"><h1>📡 Radar</h1><span class="muted">${items.length} series</span></div>
        <p class="muted" style="margin:0 0 16px">Episodios nuevos de tus series seguidas y favoritas.</p>
        ${items.length ? items.map(({ s, news }) => `
          <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:14px 16px;margin-bottom:12px">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
              <img src="${esc(window.getSeriesImage ? window.getSeriesImage(s) : (s.image || ''))}" style="width:44px;height:62px;object-fit:cover;border-radius:8px;background:#000" onerror="this.style.visibility='hidden'">
              <div style="min-width:0">
                <a href="#/series/${encodeURIComponent(s.slug || s.id)}" style="color:#fff;text-decoration:none;font-weight:600;display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(window.cleanTitle ? window.cleanTitle(s) : s.title)}</a>
                <small class="muted">${news.length} nuevo${news.length > 1 ? 's' : ''} · hasta el episodio ${news[news.length - 1].number}</small>
              </div>
            </div>
            <div style="display:flex;flex-direction:column;gap:6px">
              ${news.slice(0, 6).map(ep => `
                <a href="#/episode/${encodeURIComponent(ep.slug || ep.id)}" style="display:flex;align-items:center;gap:10px;color:#ddd;text-decoration:none;font-size:13.5px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.02);border:1px solid rgba(255,255,255,.05)">
                  <span style="color:#ff6b6b;font-weight:700;min-width:26px">E${ep.number}</span>
                  <span style="flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(ep.title || ('Episodio ' + ep.number))}</span>
                  ${ep.updatedAt ? `<small class="muted">${fmtTimeAgo(ep.updatedAt)}</small>` : ''}
                </a>`).join('')}
              ${news.length > 6 ? `<small class="muted" style="padding-left:4px">… y ${news.length - 6} más</small>` : ''}
            </div>
          </div>`).join('')
        : `<div class="empty" style="padding:60px 0"><p class="muted">No hay novedades. Marca series como favoritas o míralas para seguirlas.</p></div>`}
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:8px">
          <button class="btn-x glass" onclick="DFX.markAllSeen()">✔ Marcar todo como visto</button>
          <button class="btn-x glass" onclick="DFX.markSeenCurrent()">✔ Solo el estado actual</button>
        </div>
      </section>`;
  }

  /* ----------------------------------------------------------
     Calendario semanal
     ---------------------------------------------------------- */
  function calendarPage() {
    const eps = (window.DB && window.DB.episodes) || [];
    const series = (window.DB && window.DB.series) || [];
    const follow = followSet();
    const dow = new Date().getDay(); // 0 = domingo
    const names = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    const days = Array.from({ length: 7 }, () => []);
    for (const s of series) {
      if (!follow.has(s.id)) continue;
      const list = eps.filter(e => e.seriesId === s.id && e.updatedAt);
      if (!list.length) continue;
      const latest = list.reduce((a, b) => (new Date(a.updatedAt) > new Date(b.updatedAt) ? a : b));
      const d = new Date(latest.updatedAt).getDay();
      days[d].push({ s, ep: latest });
    }
    document.getElementById('app').innerHTML = `
      <section class="section page-top" style="max-width:900px;margin:0 auto">
        <div class="section-head"><h1>📅 Calendario</h1><span class="muted">semanal</span></div>
        <p class="muted" style="margin:0 0 16px">Última actualización por día de la semana de tus series seguidas.</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px">
          ${days.map((list, i) => `
            <div style="border:1px solid ${i === dow ? 'rgba(229,9,20,.6)' : 'rgba(255,255,255,.08)'};border-radius:14px;padding:12px;background:${i === dow ? 'rgba(229,9,20,.06)' : 'rgba(255,255,255,.02)'}">
              <div style="font-weight:700;margin-bottom:8px;${i === dow ? 'color:#ff6b6b' : ''}">${names[i]}${i === dow ? ' · hoy' : ''}</div>
              ${list.length ? list.map(({ s, ep }) => `
                <a href="#/episode/${encodeURIComponent(ep.slug || ep.id)}" style="display:block;color:#ddd;text-decoration:none;font-size:13px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.02);margin-bottom:6px;border:1px solid rgba(255,255,255,.04)">
                  <div style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(window.cleanTitle ? window.cleanTitle(s) : s.title)}</div>
                  <small class="muted">E${ep.number} · ${fmtTimeAgo(ep.updatedAt)}</small>
                </a>`).join('') : '<small class="muted">Sin novedades</small>'}
            </div>`).join('')}
        </div>
      </section>`;
  }

  /* ----------------------------------------------------------
     Versus
     ---------------------------------------------------------- */
  function versusPage() {
    const series = (window.DB && window.DB.series) || [];
    const box = (n) => `
      <div id="vs${n}" style="flex:1;min-width:240px;background:rgba(255,255,255,.03);border:1px dashed rgba(255,255,255,.15);border-radius:14px;padding:16px;text-align:center">
        <div class="muted" style="margin-bottom:8px">Elige el título ${n}</div>
        <select data-vs="${n}" style="width:100%;background:#15151d;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px">
          <option value="">— seleccionar —</option>
          ${series.slice(0, 800).map(s => `<option value="${esc(s.id)}">${esc(window.cleanTitle ? window.cleanTitle(s) : s.title)}</option>`).join('')}
        </select>
        <div id="vs${n}Card" style="margin-top:12px"></div>
      </div>`;

    document.getElementById('app').innerHTML = `
      <section class="section page-top" style="max-width:980px;margin:0 auto">
        <div class="section-head"><h1>⚔️ Versus</h1><span class="muted">comparador</span></div>
        <div style="display:flex;gap:14px;flex-wrap:wrap">${box(1)}${box(2)}</div>
        <div id="vsResult" style="margin-top:16px"></div>
      </section>`;

    const picked = {};
    $$('select[data-vs]').forEach(sel => {
      sel.onchange = () => {
        const s = series.find(x => x.id === sel.value);
        picked[sel.dataset.vs] = s || null;
        const card = document.getElementById('vs' + sel.dataset.vs + 'Card');
        if (!s) { card.innerHTML = ''; renderResult(); return; }
        const img = window.getSeriesImage ? window.getSeriesImage(s) : (s.image || '');
        const eps = (window.DB && window.DB.episodes) ? window.DB.episodes.filter(e => e.seriesId === s.id).length : (s.totalEpisodes || 0);
        card.innerHTML = `
          <img src="${esc(img)}" style="width:120px;height:170px;object-fit:cover;border-radius:10px;background:#000" onerror="this.style.visibility='hidden'">
          <div style="margin-top:8px;font-weight:700">${esc(window.cleanTitle ? window.cleanTitle(s) : s.title)}</div>
          <small class="muted">${eps ? eps + ' episodios' : ''}</small>`;
        renderResult();
      };
    });

    function bar(label, a, b, max) {
      const pa = max ? Math.round((a / max) * 100) : 0;
      const pb = max ? Math.round((b / max) * 100) : 0;
      return `
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;font-size:12.5px;margin-bottom:4px"><span>${a}</span><strong>${label}</strong><span>${b}</span></div>
          <div style="height:8px;border-radius:99px;background:rgba(255,255,255,.06);overflow:hidden;display:flex">
            <div style="width:${pa}%;background:#e50914"></div>
            <div style="flex:1"></div>
            <div style="width:${pb}%;background:#3b82f6"></div>
          </div>
        </div>`;
    }

    function renderResult() {
      const r = document.getElementById('vsResult');
      const a = picked[1], b = picked[2];
      if (!a || !b) { r.innerHTML = ''; return; }
      const epsA = (window.DB && window.DB.episodes) ? window.DB.episodes.filter(e => e.seriesId === a.id).length : (a.totalEpisodes || 0);
      const epsB = (window.DB && window.DB.episodes) ? window.DB.episodes.filter(e => e.seriesId === b.id).length : (b.totalEpisodes || 0);
      const favs = new Set(window.getFavs ? window.getFavs() : []);
      const scoreA = epsA + (favs.has(a.id) ? 25 : 0) + (a.synopsis ? 10 : 0);
      const scoreB = epsB + (favs.has(b.id) ? 25 : 0) + (b.synopsis ? 10 : 0);
      const max = Math.max(epsA, epsB, 1);
      r.innerHTML = `
        <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:16px">
          <div style="text-align:center;margin-bottom:14px;font-weight:700">${scoreA === scoreB ? '⚖️ Empate' : scoreA > scoreB ? '🏆 Gana: ' + esc(window.cleanTitle ? window.cleanTitle(a) : a.title) : '🏆 Gana: ' + esc(window.cleanTitle ? window.cleanTitle(b) : b.title)}</div>
          ${bar('Episodios', epsA, epsB, max)}
          ${bar('Favorito', favs.has(a.id) ? 25 : 0, favs.has(b.id) ? 25 : 0, 25)}
          ${bar('Info', a.synopsis ? 10 : 0, b.synopsis ? 10 : 0, 10)}
        </div>`;
    }
  }

  /* ----------------------------------------------------------
     Perfil público /u/:id
     ---------------------------------------------------------- */
  function publicProfilePage(uidParam) {
    const all = load('dfx_public_profiles', {});
    const p = all[uidParam];
    if (!p) {
      document.getElementById('app').innerHTML = `<section class="section page-top"><div class="empty"><h2>Perfil no encontrado</h2></div></section>`;
      return;
    }
    const stats = p.stats || { total: 0, series: 0, seriesDone: 0 };
    const favs = p.favs || [];
    const genres = p.genres || [];
    const badges = (p.badges || []).map(id => BADGES.find(b => b.id === id)).filter(Boolean);
    document.getElementById('app').innerHTML = `
      <section class="section page-top" style="max-width:860px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:20px">
          <div style="width:72px;height:72px;border-radius:50%;background:${esc(p.color || '#e50914')};display:flex;align-items:center;justify-content:center;font-size:34px;border:2px solid rgba(255,255,255,.15)">${esc(p.avatar || '👤')}</div>
          <div>
            <h1 style="margin:0">${esc(p.name)}</h1>
            <small class="muted">Perfil público de DonghuaFlix</small>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
          ${[['Episodios vistos', stats.total], ['Series vistas', stats.series], ['Series terminadas', stats.seriesDone], ['Racha', (load('dfx_streak_days', 0)) + ' días']].map(([k, v]) => `
            <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:14px;text-align:center">
              <div style="font-size:24px;font-weight:800">${v}</div><small class="muted">${k}</small>
            </div>`).join('')}
        </div>
        ${badges.length ? `
          <div class="section-head"><h2>Insignias</h2><span class="muted">${badges.length}/${BADGES.length}</span></div>
          <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
            ${badges.map(b => `<div title="${esc(b.name)} — ${esc(b.desc)}" style="width:44px;height:44px;border-radius:12px;background:rgba(229,9,20,.12);border:1px solid rgba(229,9,20,.35);display:flex;align-items:center;justify-content:center;color:#ff6b6b">${b.icon}</div>`).join('')}
          </div>` : ''}
        ${genres.length ? `
          <div class="section-head"><h2>Géneros favoritos</h2></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">${genres.map(g => `<span class="chip">${esc(g)}</span>`).join('')}</div>` : ''}
        ${favs.length ? `
          <div class="section-head"><h2>Mi lista pública</h2><span class="muted">${favs.length}</span></div>
          <div class="grid">${favs.map(id => { const s = (window.DB && window.DB.series || []).find(x => x.id === id); return s ? window.card(s) : ''; }).join('')}</div>` : ''}
      </section>`;
  }

  /* ----------------------------------------------------------
     Nube multi-perfil (Firestore opcional, fallback local)
     ---------------------------------------------------------- */
  async function cloudSave() {
    const payload = {
      favs: window.getFavs ? window.getFavs() : [],
      watched: window.getWatched ? window.getWatched() : {},
      history: window.getHistory ? window.getHistory() : {},
      settings: DFX.settings,
      seen: DFX.seen,
      resume: DFX.resume,
      updatedAt: Date.now()
    };
    if (window.DFX_CLOUD_SAVE) {
      try { await window.DFX_CLOUD_SAVE(payload); return; } catch {}
    }
    save(prefix() + 'cloud', payload);
    save(prefix() + 'cloud_at', Date.now());
  }

  async function cloudLoad() {
    let payload = null;
    if (window.DFX_CLOUD_LOAD) {
      try { payload = await window.DFX_CLOUD_LOAD(); } catch {}
    }
    if (!payload) payload = load(prefix() + 'cloud', null);
    if (!payload) return false;
    try {
      if (payload.favs) localStorage.setItem('donghuaflix_favs', JSON.stringify(payload.favs));
      if (payload.watched) localStorage.setItem('donghuaflix_watched', JSON.stringify(payload.watched));
      if (payload.history) localStorage.setItem('donghuaflix_history', JSON.stringify(payload.history));
      if (payload.settings) { DFX.settings = Object.assign(DFX.settings, payload.settings); applySettings(); }
      if (payload.seen) { DFX.seen = payload.seen; save('dfx_seen', DFX.seen); }
      if (payload.resume) { DFX.resume = payload.resume; save('dfx_resume', DFX.resume); }
      return true;
    } catch { return false; }
  }

  /* ----------------------------------------------------------
     Sincronización: cuando el núcleo toca datos, guardamos
     ---------------------------------------------------------- */
  let __saveT = null;
  function scheduleCloudSave() {
    clearTimeout(__saveT);
    __saveT = setTimeout(cloudSave, 1200);
  }

  function afterChange(){
    save(prefix()+'favs', window.getFavs?window.getFavs():[]);
    save(prefix()+'watched', window.getWatched?window.getWatched():{});
    save(prefix()+'history', window.getHistory?window.getHistory():{});
    save(prefix()+'autonext', window.autoNextEnabled!==false);
    cloudSave();
  }

  /* Cambio de perfil real: guarda el actual en su prefijo,
     conmuta DFX.current y restaura los datos del destino.
     Antes, afterChange() guardaba los datos del perfil viejo
     con el prefijo del perfil nuevo (destruyéndolo) y las
     claves globales nunca se restauraban. */
  function switchProfile(newId) {
    if (!DFX.profiles.some(p => p.id === newId) || newId === DFX.current) return;
    const USER_KEYS = {
      favs: 'donghuaflix_favs',
      watched: 'donghuaflix_watched',
      history: 'donghuaflix_history',
      autonext: 'donghuaflix_autonext'
    };
    /* 1) persistir el perfil actual en su prefijo (y en la nube) */
    save(prefix() + 'favs', window.getFavs ? window.getFavs() : []);
    save(prefix() + 'watched', window.getWatched ? window.getWatched() : {});
    save(prefix() + 'history', window.getHistory ? window.getHistory() : {});
    save(prefix() + 'autonext', window.autoNextEnabled !== false);
    cloudSave();
    /* 2) conmutar */
    DFX.current = newId;
    save('dfx_current', DFX.current);
    /* 3) restaurar los datos del perfil destino (vacío = defaults) */
    const restore = (k, fb) => {
      const v = load(prefix() + k, null);
      localStorage.setItem(USER_KEYS[k], JSON.stringify(v == null ? fb : v));
    };
    restore('favs', []);
    restore('watched', {});
    restore('history', {});
    const an = load(prefix() + 'autonext', true);
    localStorage.setItem('donghuaflix_autonext', an === false ? 'off' : 'on');
    window.autoNextEnabled = an !== false;
    /* 4) refrescar UI, insignias, radar y nube */
    applySettings();
    checkBadges();
    injectRadar();
    cloudSave();
    try { window.route && window.route(); } catch {}
    toast('👤 Perfil: ' + prof().name);
  }

  /* insignias: desbloqueo + toast */
  function checkBadges() {
    const stats = computeStats();
    const unlocked = load('dfx_badges', []);
    let changed = false;
    for (const b of BADGES) {
      if (!unlocked.includes(b.id) && b.check(stats)) {
        unlocked.push(b.id);
        changed = true;
        toast(`🏅 Insignia desbloqueada: ${b.name}`);
      }
    }
    if (changed) save('dfx_badges', unlocked);
    return unlocked;
  }

  /* ----------------------------------------------------------
     Insignias: exportar el estado para el perfil público
     ---------------------------------------------------------- */
  function favoriteGenres(limit = 4) {
    const favs = new Set(window.getFavs ? window.getFavs() : []);
    const count = {};
    const series = (window.DB && window.DB.series) || [];
    for (const s of series) {
      if (!favs.has(s.id)) continue;
      for (const g of (window.seriesGenres ? window.seriesGenres(s) : (s.genres || []))) {
        count[g] = (count[g] || 0) + 1;
      }
    }
    return Object.entries(count).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([g]) => g);
  }

  function dfxCopyUid() {
    const uidv = load('dfx_public_uid', null) || uid();
    save('dfx_public_uid', uidv);
    const all = load('dfx_public_profiles', {});
    all[uidv] = {
      name: prof().name,
      avatar: prof().avatar,
      color: prof().color,
      stats: computeStats(),
      favs: window.getFavs ? window.getFavs() : [],
      genres: favoriteGenres(),
      badges: load('dfx_badges', []),
      updatedAt: Date.now()
    };
    save('dfx_public_profiles', all);
    const url = location.origin + location.pathname + '#/u/' + uidv;
    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
      .then(() => toast('🔗 Enlace de perfil público copiado'))
      .catch(() => toast(url, 5000));
  }

  /* ----------------------------------------------------------
     Modal de ajustes Pro
     ---------------------------------------------------------- */
  function openSettings() {
    const s = DFX.settings;
    const badges = load('dfx_badges', []);
    const stats = computeStats();
    const streak = load('dfx_streak_days', 0);
    const m = document.createElement('div');
    m.id = 'dfxSet';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(6px);z-index:99990;display:flex;align-items:center;justify-content:center;padding:16px';
    m.innerHTML = `
      <div style="width:min(560px,96vw);max-height:88vh;overflow:auto;background:#0d0d13;border:1px solid rgba(255,255,255,.1);border-radius:18px;padding:20px;color:#fff;font-size:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <strong style="font-size:16px">⚙️ Ajustes DonghuaFlix Pro</strong>
          <button id="dfxSetX" style="background:none;border:none;color:#fff;font-size:20px;cursor:pointer;line-height:1">✕</button>
        </div>

        <div style="font-weight:700;margin:6px 0 8px">Perfil</div>
        <div id="dfxProfSeg" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px">
          ${DFX.profiles.map(p => `
            <button data-p="${p.id}" style="display:flex;align-items:center;gap:6px;padding:8px 12px;border-radius:999px;border:1px solid ${p.id === DFX.current ? esc(p.color) : 'rgba(255,255,255,.14)'};background:${p.id === DFX.current ? esc(p.color) + '22' : 'rgba(255,255,255,.03)'};color:#fff;cursor:pointer;font-size:13px">
              <span>${esc(p.avatar)}</span><span>${esc(p.name)}</span>
            </button>`).join('')}
        </div>

        <div style="font-weight:700;margin:6px 0 8px">Apariencia</div>
        <div style="display:flex;gap:8px;margin-bottom:14px">
          ${[['sm','Compacto'],['md','Normal'],['lg','Grande']].map(([v, l]) => `
            <button data-tz="${v}" style="flex:1;padding:9px;border-radius:10px;border:1px solid ${s.textSize === v ? '#e50914' : 'rgba(255,255,255,.14)'};background:${s.textSize === v ? 'rgba(229,9,20,.14)' : 'rgba(255,255,255,.03)'};color:#fff;cursor:pointer;font-size:13px">${l}</button>`).join('')}
        </div>

        <div style="font-weight:700;margin:6px 0 8px">Preferencias</div>
        <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:8px;background:rgba(255,255,255,.02)">
          <span>▶️ Auto-siguiente</span>
          <input type="checkbox" id="dfxAuto" ${window.autoNextEnabled !== false ? 'checked' : ''} style="accent-color:#e50914;width:18px;height:18px">
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:8px;background:rgba(255,255,255,.02)">
          <span>🌿 Reducir animaciones</span>
          <input type="checkbox" id="dfxMotion" ${s.reduceMotion ? 'checked' : ''} style="accent-color:#e50914;width:18px;height:18px">
        </label>
        <label style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border:1px solid rgba(255,255,255,.08);border-radius:12px;margin-bottom:14px;background:rgba(255,255,255,.02)">
          <span>🖼️ Calidad de imágenes</span>
          <select id="dfxImgQ" style="background:#15151d;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:6px 8px">
            <option value="fast" ${s.imgQ === 'fast' ? 'selected' : ''}>Rápida</option>
            <option value="hd" ${s.imgQ === 'hd' ? 'selected' : ''}>Alta</option>
          </select>
        </label>

        <div style="font-weight:700;margin:6px 0 8px">Tu actividad</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px">
          ${[['Caps hoy', DFX.today], ['Récord', DFX.best], ['Racha', streak + ' días'], ['Caps totales', stats.total], ['Insignias', badges.length + '/' + BADGES.length], ['Series', stats.series]].map(([k, v]) => `
            <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:10px;text-align:center">
              <div style="font-size:18px;font-weight:800">${v}</div><small class="muted" style="color:#9aa">${k}</small>
            </div>`).join('')}
        </div>

        <div style="font-weight:700;margin:6px 0 8px">Insignias</div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          ${BADGES.map(b => {
            const on = badges.includes(b.id);
            return `<div title="${esc(b.name)} — ${esc(b.desc)}" style="width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;${on ? 'background:rgba(229,9,20,.14);border:1px solid rgba(229,9,20,.4);color:#ff6b6b' : 'background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);color:#555;filter:grayscale(1)'}">${b.icon}</div>`;
          }).join('')}
        </div>

        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button id="dfxCloudUp" style="flex:1;min-width:120px;padding:10px;border-radius:10px;border:1px solid rgba(229,9,20,.5);background:rgba(229,9,20,.12);color:#fff;cursor:pointer;font-size:13px">☁️ Guardar en nube</button>
          <button id="dfxCloudDown" style="flex:1;min-width:120px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:13px">⬇️ Cargar de nube</button>
          <button id="dfxPublic" style="flex:1;min-width:120px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:13px">🔗 Perfil público</button>
          <button id="dfxExp" style="flex:1;min-width:120px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:13px">📤 Exportar</button>
          <button id="dfxImp" style="flex:1;min-width:120px;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:13px">📥 Importar</button>
          <button id="dfxWipe" style="flex:1;min-width:120px;padding:10px;border-radius:10px;border:1px solid rgba(255,80,80,.4);background:rgba(255,60,60,.08);color:#fff;cursor:pointer;font-size:13px">🗑️ Borrar datos</button>
        </div>
        <div id="dfxSleepWrap" style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)">
          <div style="font-weight:700;margin-bottom:8px">⏲️ Temporizador de sueño</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            ${[15, 30, 45, 60].map(min => `<button data-sleep="${min}" style="padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:13px">${min} min</button>`).join('')}
            <button data-sleep="0" style="padding:8px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:13px">Cancelar</button>
          </div>
          <div id="dfxSleepInfo" class="muted" style="color:#9aa;font-size:12px;margin-top:6px"></div>
        </div>
        <div style="margin-top:14px;padding-top:12px;border-top:1px solid rgba(255,255,255,.08)">
          <div style="font-weight:700;margin-bottom:8px">🔔 Notificaciones</div>
          <button id="dfxPush" style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:#fff;cursor:pointer;font-size:13px">Activar avisos de nuevos episodios</button>
        </div>
      </div>`;
    document.body.appendChild(m);

    const close = () => m.remove();
    $('#dfxSetX').onclick = close;
    m.addEventListener('click', e => { if (e.target === m) close(); });

    /* perfiles: cambio real con guardado + restauración */
    $('#dfxProfSeg').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      switchProfile(b.dataset.p);
      m.remove(); buildModal(); openSettings();
    };

    $$('#dfxProfSeg [data-p]').forEach(b => {
      b.ondblclick = () => {
        const name = prompt('Nuevo nombre del perfil:', prof().name);
        if (name && name.trim()) {
          prof().name = name.trim().slice(0, 18);
          save('dfx_profiles', DFX.profiles);
          m.remove(); buildModal(); openSettings();
        }
      };
    });

    $$('[data-tz]').forEach(b => b.onclick = () => {
      DFX.settings.textSize = b.dataset.tz;
      applySettings(); m.remove(); buildModal(); openSettings();
    });

    $('#dfxAuto').onchange = e => { window.autoNextEnabled = e.target.checked; };
    $('#dfxMotion').onchange = e => { DFX.settings.reduceMotion = e.target.checked; applySettings(); };
    $('#dfxImgQ').onchange = e => { DFX.settings.imgQ = e.target.value; applySettings(); toast('🖼️ Calidad: ' + (e.target.value === 'hd' ? 'Alta' : 'Rápida')); };

    $('#dfxCloudUp').onclick = async () => { toast('☁️ Guardando…'); await cloudSave(); toast('☁️ Guardado'); };
    $('#dfxCloudDown').onclick = async () => { toast('⬇️ Cargando…'); const ok = await cloudLoad(); toast(ok ? '⬇️ Datos cargados' : 'No hay datos en la nube'); if (ok) setTimeout(() => location.reload(), 600); };
    $('#dfxPublic').onclick = dfxCopyUid;
    $('#dfxExp').onclick = () => {
      const data = {};
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k.startsWith('donghuaflix_') || k.startsWith('dfx_')) data[k] = localStorage.getItem(k);
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'donghuaflix-backup.json';
      a.click();
      URL.revokeObjectURL(a.href);
      toast('📤 Datos exportados');
    };
    $('#dfxImp').onclick = () => {
      const inp = document.createElement('input');
      inp.type = 'file'; inp.accept = 'application/json';
      inp.onchange = async () => {
        try {
          const data = JSON.parse(await inp.files[0].text());
          Object.entries(data).forEach(([k, v]) => localStorage.setItem(k, v));
          toast('📥 Datos importados');
          setTimeout(() => location.reload(), 700);
        } catch { toast('Archivo no válido'); }
      };
      inp.click();
    };
    $('#dfxWipe').onclick = () => {
      if (!confirm('¿Borrar TODOS los datos locales de DonghuaFlix?')) return;
      Object.keys(localStorage).filter(k => k.startsWith('donghuaflix_') || k.startsWith('dfx_')).forEach(k => localStorage.removeItem(k));
      location.reload();
    };

    /* temporizador de sueño */
    let sleepAt = load('dfx_sleep_at', 0);
    const sleepInfo = $('#dfxSleepInfo');
    const tick = () => {
      if (!sleepAt) { sleepInfo.textContent = ''; return; }
      const left = Math.max(0, sleepAt - Date.now());
      if (left <= 0) {
        sleepInfo.textContent = '⏰ Pausando reproducción…';
        try {
          const f = document.getElementById('playerFrame');
          if (f) f.src = 'about:blank';
        } catch {}
        sleepAt = 0; save('dfx_sleep_at', 0);
        toast('⏰ Temporizador: reproducción pausada');
      } else {
        const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
        sleepInfo.textContent = `Quedan ${mm}:${String(ss).padStart(2, '0')}`;
      }
    };
    tick(); const sleepIv = setInterval(tick, 1000);
    m.addEventListener('DOMNodeRemoved', () => clearInterval(sleepIv));
    $$('#dfxSleepWrap [data-sleep]').forEach(b => b.onclick = () => {
      const min = Number(b.dataset.sleep);
      if (!min) { sleepAt = 0; save('dfx_sleep_at', 0); toast('⏲️ Temporizador cancelado'); }
      else { sleepAt = Date.now() + min * 60000; save('dfx_sleep_at', sleepAt); toast(`⏲️ Pausa en ${min} minutos`); }
      tick();
    });

    $('#dfxPush').onclick = async () => {
      if (!('Notification' in window)) { toast('Notificaciones no soportadas'); return; }
      const perm = await Notification.requestPermission();
      if (perm === 'granted') {
        toast('🔔 Avisos activados');
        setTimeout(() => new Notification('DonghuaFlix', { body: 'Te avisaremos de nuevos episodios de tus series seguidas.' }), 800);
      } else toast('Permiso denegado');
    };
  }

  function buildModal() {}

  /* entrada de ajustes en el menú "Más" (móvil) */
  function injectSettingsEntry() {
    const more = document.getElementById('moreMenu');
    if (!more || document.getElementById('dfxSetEntry')) return;
    const b = document.createElement('a');
    b.id = 'dfxSetEntry';
    b.href = 'javascript:void(0)';
    b.textContent = '⚙️ Ajustes Pro';
    b.onclick = e => { e.preventDefault(); more.classList.remove('open'); openSettings(); };
    more.appendChild(b);
  }

  /* entrada en nav desktop */
  function injectNavDesktop() {
    const nav = document.querySelector('.nav nav');
    if (!nav || document.getElementById('dfxSetNav')) return;
    const a = document.createElement('a');
    a.id = 'dfxSetNav';
    a.href = 'javascript:void(0)';
    a.textContent = 'Pro';
    a.onclick = e => { e.preventDefault(); openSettings(); };
    nav.appendChild(a);
  }

  /* ----------------------------------------------------------
     Maratón
     ---------------------------------------------------------- */
  function dfxToggleMarathon() {
    const d = loadDay();
    saveDay(d.n + 1);
    checkStreak();
    registerActiveDay();
    const s = (window.DB && window.DB.series || []).find(x => x.id === (window.detailState && window.detailState.seriesId));
    toast(`🏃 Maratón: ${DFX.today} episodios hoy${DFX.today > DFX.best ? ' — ¡nuevo récord!' : ''}`);
    checkBadges();
  }

  /* ----------------------------------------------------------
     Compartir episodio
     ---------------------------------------------------------- */
  function dfxShareEpisode() {
    const ep = window.currentEpisode;
    if (!ep) { toast('No hay episodio activo'); return; }
    const s = window.findSeries ? window.findSeries(ep.seriesId) : null;
    const url = location.origin + location.pathname + '#/episode/' + encodeURIComponent(ep.slug || ep.id);
    const text = `Viendo ${s ? window.cleanTitle(s) : 'DonghuaFlix'} — Episodio ${ep.number} en DonghuaFlix`;
    if (navigator.share) {
      navigator.share({ title: 'DonghuaFlix', text, url }).catch(() => {});
    } else if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => toast('🔗 Enlace copiado')).catch(() => toast(url, 4500));
    } else toast(url, 4500);
  }

  /* ----------------------------------------------------------
     Episodio aleatorio (sorpréndeme)
     ---------------------------------------------------------- */
  function dfxRandomEpisode() {
    const eps = (window.DB && window.DB.episodes) || [];
    if (!eps.length) { toast('No hay episodios en el catálogo'); return; }
    const watched = window.getWatched ? window.getWatched() : {};
    const pool = eps.filter(e => !(watched[e.seasonId] && watched[e.seasonId][e.number]));
    const list = pool.length ? pool : eps;
    const ep = list[Math.floor(Math.random() * list.length)];
    save('dfx_random_used', 1);
    location.hash = '#/episode/' + encodeURIComponent(ep.slug || ep.id);
    toast('🎲 Episodio aleatorio: E' + ep.number);
  }

  /* ----------------------------------------------------------
     Reanudar episodio
     ---------------------------------------------------------- */
  function dfxResumeEp() {
    const ep = window.currentEpisode;
    if (!ep) { toast('Abre un episodio primero'); return; }
    const t = DFX.resume[ep.id];
    if (!t || t < 15) { toast('No hay progreso guardado en este episodio'); return; }
    try {
      const f = document.getElementById('playerFrame');
      if (f) {
        const src = f.src;
        f.src = src.replace(/([?&])start=\d+/, '$1start=' + Math.floor(t - 5)).replace(/([?&])t=\d+/, '$1t=' + Math.floor(t - 5));
      }
      toast('▶ Reanudando en ' + Math.floor(t / 60) + 'm ' + Math.floor(t % 60) + 's');
    } catch { toast('No se pudo reanudar'); }
  }

  /* ----------------------------------------------------------
     Waitlist (pendiente de estreno / espera)
     ---------------------------------------------------------- */
  function dfxToggleWaitlist() {
    const s = (window.DB && window.DB.series || []).find(x => x.id === (window.detailState && window.detailState.seriesId));
    if (!s) { toast('Abre una serie primero'); return; }
    const wl = load('dfx_waitlist', []);
    const i = wl.indexOf(s.id);
    if (i >= 0) { wl.splice(i, 1); toast('Quitado de la waitlist'); }
    else { wl.push(s.id); toast('⏳ Añadido a la waitlist'); }
    save('dfx_waitlist', wl);
    scheduleCloudSave();
  }

  /* ----------------------------------------------------------
     Barra global de actividad
     ---------------------------------------------------------- */
  function injectGlobalStats() {
    if (document.getElementById('dfxGlobalStats')) return;
    const b = document.createElement('button');
    b.id = 'dfxGlobalStats';
    b.title = 'Tu actividad';
    b.style.cssText = 'position:fixed;right:14px;bottom:88px;z-index:9990;width:46px;height:46px;border-radius:50%;background:rgba(12,12,16,.85);border:1px solid rgba(229,9,20,.5);color:#ff6b6b;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 8px 24px rgba(0,0,0,.45)';
    b.innerHTML = I.Gauge;
    b.onclick = openSettings;
    document.body.appendChild(b);
  }

  /* ----------------------------------------------------------
     Rutas Pro: radar, calendario, versus, perfil público
     ---------------------------------------------------------- */
  function proRouter() {
    const raw = location.hash.slice(2);
    const [page, ...rest] = raw.split('/');
    if (page === 'radar') { radarPage(); return true; }
    if (page === 'calendar') { calendarPage(); return true; }
    if (page === 'versus') { versusPage(); return true; }
    if (page === 'u' && rest[0]) { publicProfilePage(decodeURIComponent(rest[0])); return true; }
    return false;
  }

  /* ----------------------------------------------------------
     Init
     ---------------------------------------------------------- */
  function init() {
    splash();
    loadSettings(); applySettings();
    loadResume(); loadMarathon(); loadSeen();
    registerActiveDay();
    checkStreak();
    injectRadar();
    injectGlobalStats();
    injectSettingsEntry();
    injectNavDesktop();
    updateRadar();

    /* envolver funciones del núcleo */
    wrap('toggleFav', () => { scheduleCloudSave(); checkBadges(); });
    wrap('toggleWatched', () => { scheduleCloudSave(); checkBadges(); });
    wrap('markWatchedSingle', () => { scheduleCloudSave(); });
    wrap('markWatchedUpTo', () => { scheduleCloudSave(); });
    wrap('saveHistory', () => { scheduleCloudSave(); });

    wrap('episode', (ref) => {
      const ep = window.findEpisode ? window.findEpisode(decodeURIComponent(ref)) : null;
      if (ep) {
        const d = loadDay(); saveDay(d.n + 1);
        registerActiveDay(); checkStreak();
        checkBadges();
        /* auto-marcar visto para el radar */
        try {
          const last = DFX.seen[ep.seriesId];
          const pn = last == null ? 0 : (typeof last === 'object' && last !== null ? (last.n ?? 0) : Number(last) || 0);
          if (ep.number > pn) { DFX.seen[ep.seriesId] = ep.number; save('dfx_seen', DFX.seen); }
        } catch {}
        setTimeout(updateRadar, 1500);
      }
    });

    /* actualizar radar al entrar en home / navegar */
    wrap('home', () => setTimeout(updateRadar, 800));
    const origRoute = window.route;
    if (origRoute && !origRoute.__dfxR) {
      const r2 = function (...a) {
        const handled = proRouter();
        if (!handled) origRoute.apply(this, a);
        else window.scrollTo(0, 0);
        setTimeout(updateRadar, 600);
      };
      r2.__dfxR = true;
      window.route = r2;
    }

    /* limpiar menú "Más" duplicado (core ya inyecta sus entradas) */
    const cleanMoreMenu = () => {
      const more = document.getElementById('moreMenu');
      if (!more) return;
      more.querySelectorAll('a[href="#/airing"], a[href="#/completed"], a[href="#/genres"]').forEach(a => a.remove());
    };
    cleanMoreMenu();
    setTimeout(cleanMoreMenu, 1200);

    /* botón maratón junto al reproductor */
    wrap('episode', () => {
      setTimeout(() => {
        const bar = document.querySelector('.player-bar');
        if (bar && !document.getElementById('dfxBNWrap')) {
          const w = document.createElement('div');
          w.id = 'dfxBNWrap';
          w.style.cssText = 'display:flex;align-items:center;gap:8px;margin-left:auto';
          w.innerHTML = `<button class="btn-mini" id="dfxMarathonBtn" title="Modo maratón">🏃 ${DFX.today}</button>
                         <button class="btn-mini" id="dfxShareBtn" title="Compartir episodio">${I.Share2}</button>
                         <button class="btn-mini" id="dfxResumeBtn" title="Reanudar">▶️</button>`;
          bar.appendChild(w);
          document.getElementById('dfxMarathonBtn').onclick = dfxToggleMarathon;
          document.getElementById('dfxShareBtn').onclick = dfxShareEpisode;
          document.getElementById('dfxResumeBtn').onclick = dfxResumeEp;
        }
      }, 400);
    });

    /* tracking de tiempo del reproductor (Dailymotion postMessage) */
    window.addEventListener('message', ev => {
      let d = ev.data;
      if (typeof d === 'string') { try { d = JSON.parse(d); } catch { d = null; } }
      if (!d || !d.event) return;
      if (d.event === 'timeupdate' && window.currentEpisode) {
        try {
          DFX.resume[window.currentEpisode.id] = Math.floor(d.time || 0);
          if (Object.keys(DFX.resume).length > 400) {
            const keys = Object.keys(DFX.resume).sort((a, b) => (DFX.resume[a] || 0) - (DFX.resume[b] || 0));
            keys.slice(0, 100).forEach(k => delete DFX.resume[k]);
          }
          save('dfx_resume', DFX.resume);
        } catch {}
      }
    });

    /* sincronización cuando vuelve el foco / otra pestaña escribe */
    window.addEventListener('focus', () => { loadSeen(); updateRadar(); });
    window.addEventListener('storage', e => { if (e.key && e.key.startsWith('dfx_')) { loadSeen(); updateRadar(); } });

    /* marcar el estado actual como "visto" para el radar al arrancar */
    setTimeout(markSeenCurrent, 2500);

    /* hook de autenticación (firebase-sync.js lo llama) */
    window.dfxAuthChanged = async user => {
      if (user) {
        toast('👋 Hola, ' + (user.email || user.displayName || 'usuario'));
        const ok = await cloudLoad();
        if (ok) toast('☁️ Datos sincronizados');
        updateRadar();
      }
    };

    /* accesos rápidos globales */
    window.dfxOpenSettings = openSettings;
    window.dfxToggleMarathon = dfxToggleMarathon;
    window.dfxShareEpisode = dfxShareEpisode;
    window.dfxRandomEpisode = dfxRandomEpisode;
    window.dfxResumeEp = dfxResumeEp;
    window.dfxToggleWaitlist = dfxToggleWaitlist;
    window.dfxCopyUid = dfxCopyUid;
    DFX.randomEp = dfxRandomEpisode;
    DFX.openSettings = openSettings;
    DFX.toast = toast;
    DFX.cloudSave = cloudSave;
    DFX.cloudLoad = cloudLoad;
    DFX.computeStats = computeStats;
    DFX.checkBadges = checkBadges;
    DFX.markSeenCurrent = markSeenCurrent;
    DFX.markAllSeen = () => {
      try {
        const eps = (window.DB && window.DB.episodes) || [];
        const follow = followSet();
        const bySeries = {};
        for (const e of eps) {
          if (!follow.has(e.seriesId)) continue;
          (bySeries[e.seriesId] = bySeries[e.seriesId] || []).push(e);
        }
        for (const sid in bySeries) {
          DFX.seen[sid] = Math.max(...bySeries[sid].map(e => e.number));
        }
        save('dfx_seen', DFX.seen);
        updateRadar();
        toast('✔ Radar limpio');
      } catch {}
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
