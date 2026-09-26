// ══════════════════════════════════════════════════════════
//  dfx-core.js — DonghuaFlix Pro (núcleo integrado)
//  Perfiles, ajustes, insignias, sala, sleep timer, perfiles
//  públicos, nube, Descubrir, Mi Donghua, pulido y efectos.
//  Se carga tras app.js. No modifica app.js.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';

  /* ---------- utilidades ---------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const load = (k, fb) => { try { return JSON.parse(localStorage.getItem(k) ?? JSON.stringify(fb)); } catch { return fb; } };
  const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const dayKey = () => new Date().toISOString().slice(0, 10);
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

  /* ---------- iconos ---------- */
  const I = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c.8-3.8 3.9-5.7 7.5-5.7s6.7 1.9 7.5 5.7"/></svg>',
    sliders: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3"/><path d="M1 14h6M9 8h6M17 16h6"/></svg>',
    cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>',
    vs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M8 6l-4 6 4 6M16 6l4 6-4 6"/></svg>',
    trophy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M7 6H4a2 2 0 0 0 0 4h3M17 6h3a2 2 0 0 1 0 4h-3"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>',
    moon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
    zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20.5s-7.5-4.6-9.3-9A5.3 5.3 0 0 1 12 6.6a5.3 5.3 0 0 1 9.3 4.9c-1.8 4.4-9.3 9-9.3 9z"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/></svg>',
    dice: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="8.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="8.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/><circle cx="15.5" cy="15.5" r="1.4" fill="currentColor" stroke="none"/></svg>',
    eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    film: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 8h18M3 16h18M8 3v18M16 3v18"/></svg>'
  };

  /* ---------- estado ---------- */
  const DFX = window.DFX = window.DFX || {};
  DFX.profiles = load('dfx_profiles', null);
  DFX.current = load('dfx_current', null);
  DFX.badge = load('dfx_badge', {});
  DFX.waitlist = load('dfx_waitlist', {});
  DFX.seen = load('dfx_seen_eps', {});
  DFX.settings = Object.assign({ textSize: 'm', autoplay: true, reduceMotion: false, imgQ: 'hd', sleepTimer: 0 }, load('dfx_settings', {}));
  DFX.account = load('dfx_account', null); // { uid, email, name, public: bool, bio: '' }
  DFX.resume = load('dfx_resume', {}); // { epKey: { t: seconds, at: ts } }

  if (!DFX.profiles || !DFX.profiles.length) {
    DFX.profiles = [{ id: uid(), name: 'Yo', avatar: '🐉', created: Date.now() }];
    DFX.current = DFX.profiles[0].id;
    save('dfx_profiles', DFX.profiles); save('dfx_current', DFX.current);
  }

  const prof = () => DFX.profiles.find(p => p.id === DFX.current) || DFX.profiles[0];
  const prefix = () => 'dfx_p_' + DFX.current + '_';

  /* ajustes se guardan por perfil */
  function getSetting(k) {
    const v = load(prefix() + 'set', {});
    return (k in DFX.settings) ? DFX.settings[k] : (v[k] ?? DFX.settings[k]);
  }
  function setSetting(k, v) {
    DFX.settings[k] = v;
    const p = load(prefix() + 'set', {}); p[k] = v; save(prefix() + 'set', p);
    save('dfx_settings', DFX.settings);
    applySettings();
  }

  /* ---------- estilos del módulo ---------- */
  const css = `
#dfxSplash{position:fixed;inset:0;background:#000;z-index:100000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;transition:opacity .5s ease}
#dfxSplash img{width:84px;height:84px;border-radius:20px;animation:dfxPulse 1.2s ease infinite}
#dfxSplash .dfxBar{width:130px;height:3px;background:#222;border-radius:99px;overflow:hidden}
#dfxSplash .dfxBar i{display:block;height:100%;width:40%;background:#e50914;border-radius:99px;animation:dfxBar 1s linear infinite}
@keyframes dfxPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes dfxBar{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}
#dfxSplash.gone{opacity:0;pointer-events:none}
.dfxTop{position:fixed;top:64px;left:50%;transform:translateX(-50%);z-index:9999;background:rgba(20,20,25,.95);border:1px solid #333;border-radius:12px;padding:10px 16px;display:flex;align-items:center;gap:12px;box-shadow:0 10px 40px rgba(0,0,0,.6);animation:dfxDown .3s ease;backdrop-filter:blur(10px);max-width:92vw}
@keyframes dfxDown{from{opacity:0;transform:translate(-50%,-12px)}to{opacity:1;transform:translate(-50%,0)}}
.dfxTop b{color:#fff;font-size:13px}
.dfxTop span{color:#9a9aa5;font-size:12px}
.dfxTop .dfxGo{background:#e50914;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap}
.dfxGrid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:560px){.dfxGrid2{grid-template-columns:1fr}}
.dfxBadgeRow{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.dfxBadge{width:64px;text-align:center}
.dfxBadge .dfxBIcon{width:52px;height:52px;margin:0 auto;border-radius:50%;background:linear-gradient(145deg,#1d1d24,#111);border:2px solid #333;display:flex;align-items:center;justify-content:center;font-size:22px}
.dfxBadge.owned .dfxBIcon{border-color:#e50914;background:linear-gradient(145deg,#2a0a0c,#150607)}
.dfxBadge span{display:block;font-size:9px;color:#9a9aa5;margin-top:4px;line-height:1.2}
.dfxProfileCard{display:flex;align-items:center;gap:12px;background:#141419;border:1px solid #2a2a33;border-radius:14px;padding:14px;margin-bottom:14px}
.dfxProfileCard .dfxAv{width:52px;height:52px;border-radius:50%;background:linear-gradient(145deg,#e50914,#7a0510);display:flex;align-items:center;justify-content:center;font-size:24px;flex:none}
.dfxProfileCard b{color:#fff;font-size:16px}
.dfxProfileCard .dfxMeta{color:#9a9aa5;font-size:12px;margin-top:2px}
.dfxStatBar{height:6px;border-radius:99px;background:#1d1d24;overflow:hidden;margin-top:4px}
.dfxStatBar i{display:block;height:100%;background:#e50914;border-radius:99px}
.dfxStatRow{display:flex;justify-content:space-between;font-size:11px;color:#9a9aa5;margin-top:8px}
.dfxSwitch{position:relative;width:40px;height:22px;flex:none}
.dfxSwitch input{opacity:0;width:0;height:0}
.dfxSwitch i{position:absolute;inset:0;background:#333;border-radius:99px;transition:.2s;cursor:pointer}
.dfxSwitch i::before{content:'';position:absolute;left:3px;top:3px;width:16px;height:16px;border-radius:50%;background:#fff;transition:.2s}
.dfxSwitch input:checked + i{background:#e50914}
.dfxSwitch input:checked + i::before{transform:translateX(18px)}
.dfxChip{display:inline-flex;align-items:center;gap:5px;background:#1d1d24;border:1px solid #333;color:#fff;border-radius:99px;padding:5px 10px;font-size:11px;cursor:pointer;margin:0 4px 4px 0}
.dfxChip.on{background:#e50914;border-color:#e50914}
#dfxModal{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:99990;display:none;align-items:flex-end;justify-content:center;backdrop-filter:blur(4px)}
@media(min-width:640px){#dfxModal{align-items:center}}
#dfxModal.open{display:flex}
#dfxSheet{width:100%;max-width:520px;max-height:86vh;overflow-y:auto;background:#141419;border:1px solid #2a2a33;border-radius:18px 18px 0 0;color:#fff;padding:20px;animation:dfxUp .28s ease}
@media(min-width:640px){#dfxSheet{border-radius:18px;max-width:440px}}
@keyframes dfxUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:none}}
#dfxSheet h2{margin:0 0 14px;font-size:18px;display:flex;align-items:center;gap:8px}
.dfxSetRow{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 0;border-bottom:1px solid #222}
.dfxSetRow:last-child{border-bottom:none}
.dfxSetRow .dfxLbl{font-size:13px;color:#ddd}
.dfxSetRow .dfxLbl small{display:block;color:#9a9aa5;font-size:11px;margin-top:2px}
.dfxSetRow select{background:#1d1d24;border:1px solid #333;color:#fff;border-radius:8px;padding:6px 10px;font-size:12px}
.dfxSeg{display:flex;background:#1d1d24;border-radius:8px;overflow:hidden;border:1px solid #333}
.dfxSeg button{background:none;border:none;color:#9a9aa5;padding:6px 12px;font-size:12px;cursor:pointer}
.dfxSeg button.on{background:#e50914;color:#fff;font-weight:700}
.dfxAvPick{display:grid;grid-template-columns:repeat(8,1fr);gap:6px;margin-top:8px}
.dfxAvPick button{font-size:20px;background:#1d1d24;border:1px solid #333;border-radius:8px;padding:6px 0;cursor:pointer}
.dfxAvPick button.on{border-color:#e50914;background:#2a0a0c}
.dfxEmpty{padding:30px 10px;text-align:center;color:#9a9aa5;font-size:13px}
.dfxEmpty .dfxBig{font-size:38px;display:block;margin-bottom:8px;opacity:.6}
.dfxKbdOverlay{position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:99995;display:none;align-items:center;justify-content:center;backdrop-filter:blur(6px)}
.dfxKbdOverlay.open{display:flex}
.dfxKbdCard{width:100%;max-width:420px;background:#141419;border:1px solid #2a2a33;border-radius:16px;color:#fff;padding:22px;animation:dfxUp .25s ease}
.dfxKbdCard h3{margin:0 0 14px;font-size:16px}
.dfxKbdRow{display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #1d1d24;font-size:13px;color:#ddd}
.dfxKbdRow kbd{background:#1d1d24;border:1px solid #333;border-radius:6px;padding:2px 8px;font-size:11px;font-family:monospace}
  `;
  const st = document.createElement('style');
  st.id = 'dfxStyles';
  st.textContent = css;
  document.head.appendChild(st);

  /* ---------- toast bonito ---------- */
  let toastTimer = null;
  function toast(msg, ms = 2200) {
    let t = $('#dfxToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dfxToast';
      t.style.cssText = 'position:fixed;bottom:84px;left:50%;transform:translateX(-50%);background:#e50914;color:#fff;padding:11px 20px;border-radius:99px;font-size:13px;font-weight:700;z-index:99999;box-shadow:0 8px 30px rgba(229,9,20,.4);opacity:0;transition:opacity .25s ease,transform .25s ease;pointer-events:none;max-width:90vw;text-align:center';
      document.body.appendChild(t);
    }
    t.textContent = msg;
    requestAnimationFrame(() => { t.style.opacity = '1'; t.style.transform = 'translateX(-50%) translateY(-6px)'; });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(-50%)'; }, ms);
  }

  /* ---------- splash ---------- */
  function splash() {
    try {
      if (sessionStorage.getItem('dfx_splash')) return;
      sessionStorage.setItem('dfx_splash', '1');
    } catch {}
    const s = document.createElement('div');
    s.id = 'dfxSplash';
    s.innerHTML = `<img src="icon-192.png" alt="DonghuaFlix"><div class="dfxBar"><i></i></div>`;
    document.body.appendChild(s);
    setTimeout(() => { s.classList.add('gone'); setTimeout(() => s.remove(), 600); }, 1100);
  }

  /* ---------- notificaciones ---------- */
  function requestPush() {
    if (!('Notification' in window)) return toast('Este navegador no soporta notificaciones');
    Notification.requestPermission().then(p => {
      if (p === 'granted') toast('🔔 Notificaciones activadas');
      else toast('Notificaciones bloqueadas por el navegador');
    });
  }
  function notify(title, body) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try { new Notification(title, { body, icon: 'icon-192.png' }); } catch {}
  }

  /* ---------- ajustes aplicados ---------- */
  function applySettings() {
    const sz = { s: '14px', m: '16px', l: '18px' }[getSetting('textSize')] || '16px';
    document.documentElement.style.fontSize = sz;
    document.body.classList.toggle('dfx-no-motion', !!getSetting('reduceMotion'));
  }

  /* ---------- envoltorios sobre app.js ---------- */
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== 'function' || orig.__dfx) return;
    const w = function (...a) {
      const r = orig.apply(this, a);
      try { after && after.apply(this, a); } catch {}
      return r;
    };
    w.__dfx = true;
    window[name] = w;
  }

  /* favoritos/vistos → guardado por perfil + subida a nube */
  function afterChange() {
    const p = prof();
    if (!p) return;
    save(prefix() + 'favs', window.getFavs ? window.getFavs() : []);
    save(prefix() + 'watched', window.getWatched ? window.getWatched() : {});
    save(prefix() + 'history', window.getHistory ? window.getHistory() : {});
    save(prefix() + 'autonext', window.autoNextEnabled !== false);
    scheduleCloudSave();
  }

  /* insignias: conteo de episodios vistos */
  const BADGES = [
    { id: 'first', name: 'Primera vez', icon: '🎬', test: s => s.total >= 1 },
    { id: 'fan5', name: 'Fan · 50 caps', icon: '🍿', test: s => s.total >= 50 },
    { id: 'fan10', name: 'Fan · 100 caps', icon: '⭐', test: s => s.total >= 100 },
    { id: 'fan25', name: 'Fan · 250 caps', icon: '🔥', test: s => s.total >= 250 },
    { id: 'fan50', name: 'Fan · 500 caps', icon: '💎', test: s => s.total >= 500 },
    { id: 'fan100', name: 'Leyenda · 1000 caps', icon: '👑', test: s => s.total >= 1000 },
    { id: 'genres5', name: 'Explorador', icon: '🧭', test: s => s.genres >= 5 },
    { id: 'list20', name: 'Coleccionista', icon: '❤️', test: s => s.list >= 20 },
    { id: 'genres10', name: 'Trotamundos', icon: '🌍', test: s => s.genres >= 10 }
  ];

  function computeStats() {
    const watched = window.getWatched ? window.getWatched() : {};
    const history = window.getHistory ? window.getHistory() : {};
    let total = 0;
    for (const k of Object.keys(watched)) {
      const v = watched[k];
      if (v && typeof v === 'object') total += Object.keys(v).length;
    }
    let seriesDone = 0;
    try {
      const eps = (window.DB && window.DB.episodes) || [];
      const seasons = (window.DB && window.DB.seasons) || [];
      const bySeries = {};
      eps.forEach(e => { (bySeries[e.seriesId] = bySeries[e.seriesId] || []).push(e); });
      for (const sid of Object.keys(history)) {
        const sEps = bySeries[sid] || [];
        if (!sEps.length) continue;
        const sSeasons = seasons.filter(x => x.seriesId === sid);
        let done = true;
        for (const s of sSeasons) {
          const w = watched[s.id] || {};
          const inS = sEps.filter(e => e.seasonId === s.id);
          if (inS.some(e => !w[e.number])) { done = false; break; }
        }
        if (done) seriesDone++;
      }
    } catch {}
    const favs = window.getFavs ? window.getFavs() : [];
    const genres = new Set();
    try {
      (window.DB.series || []).forEach(s => {
        (window.seriesGenres ? window.seriesGenres(s) : (s.genres || [])).forEach(g => genres.add(fold(g)));
      });
    } catch {}
    return { total, seriesDone, list: favs.length, genres: genres.size, best: 0 };
  }

  function checkBadges() {
    const s = computeStats();
    let changed = false;
    for (const b of BADGES) {
      const key = DFX.current + ':' + b.id;
      if (!DFX.badge[key] && b.test(s)) {
        DFX.badge[key] = Date.now();
        changed = true;
        toast('🏅 ¡Insignia desbloqueada: ' + b.name + '!');
        notify('DonghuaFlix — Nueva insignia', b.name);
      }
    }
    if (changed) save('dfx_badge', DFX.badge);
    return s;
  }

  /* ---------- episodio aleatorio ---------- */
  function randomEp() {
    try {
      const eps = (window.DB && window.DB.episodes) || [];
      if (eps.length) {
        const e = eps[Math.floor(Math.random() * eps.length)];
        location.hash = '#/episode/' + encodeURIComponent(e.slug || e.id);
        return;
      }
      /* Catálogos LITE: no hay episodios hasta abrir la ficha →
         se abre una serie aleatoria en su lugar. */
      const series = (window.DB && window.DB.series) || [];
      if (!series.length) return toast('Catálogo todavía vacío');
      const s = series[Math.floor(Math.random() * series.length)];
      location.hash = '#/series/' + encodeURIComponent(s.slug || s.id);
      toast('🎲 ' + (window.cleanTitle ? window.cleanTitle(s) : s.title));
    } catch { toast('No se pudo elegir episodio'); }
  }

  wrap('episode', () => {
    afterChange();
    checkBadges();
    const ep = window.currentEpisode;
    if (ep) {
      try {
        const key = ep.id;
        const prev = DFX.resume[key];
        if (prev && prev.t > 5) {
          setTimeout(() => {
            const iframe = document.querySelector('.player iframe');
            if (iframe && /dailymotion|dmcdn/i.test(iframe.src)) {
              iframe.src = iframe.src.split('?')[0] + '?autoplay=0&start=' + Math.floor(prev.t);
            }
          }, 600);
          toast('⏯️ Reanudando en ' + Math.floor(prev.t / 60) + 'm' + Math.floor(prev.t % 60) + 's');
        }
      } catch {}
    }
  });

  /* seguimiento del tiempo en Dailymotion */
  window.addEventListener('message', e => {
    if (!/dailymotion|dmcdn/i.test(String(e.origin || ''))) return;
    let data = e.data;
    if (typeof data === 'string') { try { data = JSON.parse(data); } catch {} }
    const time = data && (data.time || data.currentTime || (data.player && data.player.currentTime));
    if (time != null && window.currentEpisode) {
      DFX.resume[window.currentEpisode.id] = { t: time, at: Date.now() };
      save('dfx_resume', DFX.resume);
    }
  });

  /* ---------- perfiles públicos ---------- */
  function publicPage(arg) {
    const app = document.getElementById('app');
    if (!app) return;
    const acc = DFX.account;
    if (!acc || !acc.public) {
      app.innerHTML = '<section class="section page-top"><div class="dfxEmpty"><span class="dfxBig">🔒</span>Este perfil es privado. Actívalo en Ajustes → Perfil público.</div></section>';
      return;
    }
    const s = checkBadges();
    const owned = BADGES.filter(b => DFX.badge[DFX.current + ':' + b.id]);
    const favs = window.getFavs ? window.getFavs() : [];
    const favSeries = (window.DB.series || []).filter(x => favs.includes(x.id)).slice(0, 12);
    const genreCount = {};
    try {
      (window.DB.series || []).forEach(sr => {
        (window.seriesGenres ? window.seriesGenres(sr) : sr.genres || []).forEach(g => {
          const k = fold(g); genreCount[k] = (genreCount[k] || 0) + 1;
        });
      });
    } catch {}
    const topGenres = Object.entries(genreCount).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxG = topGenres.length ? topGenres[0][1] : 1;
    app.innerHTML = `<section class="section page-top">
      <div class="dfxProfileCard">
        <div class="dfxAv">${esc(prof().avatar)}</div>
        <div style="flex:1;min-width:0">
          <b>${esc(acc.name || prof().name)}</b>
          <div class="dfxMeta">@${esc(acc.uid)} · ${s.total} capítulos vistos · ${s.list} en Mi lista</div>
          ${acc.bio ? `<div class="dfxMeta" style="margin-top:4px">${esc(acc.bio)}</div>` : ''}
        </div>
      </div>
      <div class="section-head"><h2>🏅 Insignias</h2><span class="muted">${owned.length}/${BADGES.length}</span></div>
      <div class="dfxBadgeRow">${BADGES.map(b => `<div class="dfxBadge ${DFX.badge[DFX.current + ':' + b.id] ? 'owned' : ''}" title="${esc(b.name)}"><div class="dfxBIcon">${b.icon}</div><span>${esc(b.name)}</span></div>`).join('')}</div>
      <div class="section-head" style="margin-top:22px"><h2>Géneros favoritos</h2></div>
      ${topGenres.map(([g, n]) => `<div class="dfxStatRow"><span>${esc(g)}</span><span>${n}</span></div><div class="dfxStatBar"><i style="width:${Math.round(n / maxG * 100)}%"></i></div>`).join('')}
      ${favSeries.length ? `<div class="section-head" style="margin-top:22px"><h2>❤️ Su lista</h2><span class="muted">${favSeries.length}</span></div><div class="grid">${favSeries.map(window.card).join('')}</div>` : ''}
    </section>`;
  }

  /* ---------- nube (Firebase multi-perfil) ---------- */
  let cloudTimer = null;
  function scheduleCloudSave() {
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(cloudSave, 1200);
  }
  async function cloudSave() {
    const fb = window.DFX_AUTH;
    if (!fb || !fb.currentUser()) return;
    try {
      await fb.saveProfile({
        profileId: DFX.current,
        data: {
          favs: window.getFavs ? window.getFavs() : [],
          watched: window.getWatched ? window.getWatched() : {},
          history: window.getHistory ? window.getHistory() : {},
          resume: DFX.resume,
          settings: load(prefix() + 'set', {}),
          seen: DFX.seen,
          badge: DFX.badge,
          account: DFX.account
        }
      });
    } catch (e) { console.warn('[dfx] cloud save', e); }
  }
  function cloudLoad() {
    const fb = window.DFX_AUTH;
    if (!fb || !fb.currentUser()) return;
    fb.loadProfile(DFX.current, (data) => {
      if (!data) { cloudSave(); return; }
      /* fusión: nube gana en timestamps por historia/vistos, unión en favoritos */
      const localF = new Set(window.getFavs ? window.getFavs() : []);
      const cloudF = new Set(data.favs || []);
      const union = [...new Set([...localF, ...cloudF])];
      localStorage.setItem('donghuaflix_favs', JSON.stringify(union));
      const merge = (ls, cl) => {
        const out = { ...ls };
        for (const [k, v] of Object.entries(cl || {})) {
          const rt = (v && (v.timestamp || v.ts)) || 0;
          const lt = (out[k] && (out[k].timestamp || out[k].ts)) || 0;
          if (!out[k] || rt > lt) out[k] = v;
        }
        return out;
      };
      localStorage.setItem('donghuaflix_watched', JSON.stringify(merge(window.getWatched ? window.getWatched() : {}, data.watched)));
      localStorage.setItem('donghuaflix_history', JSON.stringify(merge(window.getHistory ? window.getHistory() : {}, data.history)));
      if (data.resume) { DFX.resume = { ...DFX.resume, ...data.resume }; save('dfx_resume', DFX.resume); }
      if (data.settings) save(prefix() + 'set', data.settings);
      if (data.seen) { DFX.seen = { ...DFX.seen, ...data.seen }; save('dfx_seen_eps', DFX.seen); }
      if (data.badge) { DFX.badge = { ...DFX.badge, ...data.badge }; save('dfx_badge', DFX.badge); }
      if (data.account) { DFX.account = data.account; save('dfx_account', DFX.account); }
      try { window.route && window.route(); } catch { location.reload(); }
      /* radar: integrado como widget en Mi Donghua */
      toast('☁️ Sincronizado');
    });
  }

  /* ---------- pestañas ---------- */
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (['donghuaflix_favs', 'donghuaflix_watched', 'donghuaflix_history'].includes(e.key)) {
      try { window.route && window.route(); } catch {}
      /* radar: integrado como widget en Mi Donghua */
    }
  });

  /* ---------- sleep timer ---------- */
  let sleepTO = null;
  function setSleep(min) {
    clearTimeout(sleepTO);
    DFX.settings.sleepTimer = min;
    save('dfx_settings', DFX.settings);
    if (!min) return toast('⏲️ Temporizador desactivado');
    sleepTO = setTimeout(() => {
      const ifr = document.querySelector('.player iframe');
      if (ifr) ifr.src = 'about:blank';
      toast('😴 Buenas noches. Hasta mañana, guerrero del cultivo.');
      notify('DonghuaFlix', 'Temporizador de sueño: reproducción detenida');
    }, min * 60000);
    toast('😴 Se detendrá en ' + min + ' min');
  }

  /* ---------- rutas nuevas ---------- */
  function addRoutes() {
    const origRoute = window.route;
    if (!origRoute || origRoute.__dfxRoutes) return;
    const r = function () {
      const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
      if (p[0] === 'u') return publicPage(p[1]);
      return origRoute.apply(this, arguments);
    };
    r.__dfxRoutes = true;
    window.route = r;
  }

  /* ---------- modal de ajustes ---------- */
  function buildModal() {
    const m = document.createElement('div');
    m.id = 'dfxModal';
    m.innerHTML = `<div id="dfxSheet">
      <h2>⚙️ Ajustes <span style="flex:1"></span><a id="dfxClose" style="font-size:12px;color:#9a9aa5;cursor:pointer">Cerrar ✕</a></h2>

      <div class="section-head" style="margin-top:6px"><h3 style="font-size:13px">Perfil</h3></div>
      <div class="dfxSetRow"><div class="dfxLbl">Perfil actual<small>${esc(prof().name)}</small></div><div class="dfxSeg" id="dfxProfSeg">${DFX.profiles.map(p => `<button data-p="${p.id}" class="${p.id === DFX.current ? 'on' : ''}">${esc(p.avatar)} ${esc(p.name)}</button>`).join('')}</div></div>
      <div class="dfxSetRow"><div class="dfxLbl">Nuevo perfil</div><button class="dfxChip" id="dfxNewProf">＋ Añadir</button></div>
      <div class="dfxSetRow"><div class="dfxLbl">Avatar</div><div class="dfxAvPick" id="dfxAvPick">${['🐉','🗡️','🪷','👑','🦊','🐼','⚡','🌙'].map(a => `<button class="${prof().avatar === a ? 'on' : ''}" data-a="${a}">${a}</button>`).join('')}</div></div>
      <div class="dfxSetRow"><div class="dfxLbl">Nombre del perfil</div><input id="dfxProfName" class="dfsField" style="width:140px;margin:0" value="${esc(prof().name)}"></div>

      <div class="section-head" style="margin-top:14px"><h3 style="font-size:13px">Reproducción</h3></div>
      <div class="dfxSetRow"><div class="dfxLbl">Auto-siguiente<small>Pasa al siguiente capítulo al terminar</small></div><label class="dfxSwitch"><input type="checkbox" id="dfxAutoNext" ${getSetting('autoplay') ? 'checked' : ''}><i></i></label></div>
      <div class="dfxSetRow"><div class="dfxLbl">Temporizador de sueño</div><select id="dfxSleep"><option value="0">Desactivado</option><option value="15" ${DFX.settings.sleepTimer === 15 ? 'selected' : ''}>15 min</option><option value="30" ${DFX.settings.sleepTimer === 30 ? 'selected' : ''}>30 min</option><option value="45" ${DFX.settings.sleepTimer === 45 ? 'selected' : ''}>45 min</option><option value="60" ${DFX.settings.sleepTimer === 60 ? 'selected' : ''}>60 min</option></select></div>

      <div class="section-head" style="margin-top:14px"><h3 style="font-size:13px">Interfaz</h3></div>
      <div class="dfxSetRow"><div class="dfxLbl">Tamaño del texto</div><div class="dfxSeg" id="dfxTextSize">${[['s', 'S'], ['m', 'M'], ['l', 'L']].map(([v, l]) => `<button data-v="${v}" class="${getSetting('textSize') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="dfxSetRow"><div class="dfxLbl">Reducir animaciones<small>Para móviles lentos</small></div><label class="dfxSwitch"><input type="checkbox" id="dfxReduceMotion" ${getSetting('reduceMotion') ? 'checked' : ''}><i></i></label></div>
      <div class="dfxSetRow"><div class="dfxLbl">Calidad de imágenes<small>Rápido: ahorra datos</small></div><div class="dfxSeg" id="dfxImgQ">${[['fast', '⚡ Rápido'], ['hd', '🖼️ HD']].map(([v, l]) => `<button data-v="${v}" class="${getSetting('imgQ') === v ? 'on' : ''}">${l}</button>`).join('')}</div></div>

      <div class="section-head" style="margin-top:14px"><h3 style="font-size:13px">Cuenta</h3></div>
      <div class="dfxSetRow"><div class="dfxLbl">Notificaciones push<small>Avisos de capítulos nuevos</small></div><button class="dfxChip" id="dfxPushBtn">🔔 Activar</button></div>
      <div class="dfxSetRow"><div class="dfxLbl">Perfil público<small>Otros pueden ver tu colección en #/u/${esc(DFX.account?.uid || 'tu-id')}</small></div><label class="dfxSwitch"><input type="checkbox" id="dfxPublic" ${DFX.account && DFX.account.public ? 'checked' : ''}><i></i></label></div>
      <div class="dfxSetRow"><div class="dfxLbl">Tu página pública</div><button class="dfxChip" id="dfxCopyProfile">${I.copy} Copiar enlace</button></div>

      <div class="section-head" style="margin-top:14px"><h3 style="font-size:13px">Datos</h3></div>
      <div class="dfxSetRow"><div class="dfxLbl">Sincronizar ahora<small>Sube/baja tu perfil de la nube</small></div><button class="dfxChip" id="dfxSyncNow">☁️ Sincronizar</button></div>
      <div class="dfxSetRow"><div class="dfxLbl">Exportar mis datos<small>JSON de respaldo</small></div><button class="dfxChip" id="dfxExport">⬇️ Exportar</button></div>
      <div class="dfxSetRow"><div class="dfxLbl">Importar datos</div><input type="file" id="dfxImport" accept=".json" style="display:none"><button class="dfxChip" onclick="document.getElementById('dfxImport').click()">⬆️ Importar</button></div>
      <div class="dfxSetRow"><div class="dfxLbl">Borrar datos locales<small>Favoritos, vistos, insignias</small></div><button class="dfxChip" style="border-color:#e50914;color:#e50914" id="dfxWipe">🗑️ Borrar</button></div>
    </div>`;
    document.body.appendChild(m);

    $('#dfxClose').onclick = closeSettings;
    m.addEventListener('click', e => { if (e.target === m) closeSettings(); });

    $('#dfxProfSeg').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      DFX.current = b.dataset.p; save('dfx_current', DFX.current);
      afterChange(); applySettings(); checkBadges(); cloudSave(); m.remove(); buildModal(); openSettings();
      toast('👤 Perfil: ' + prof().name);
    };
    $('#dfxNewProf').onclick = () => {
      if (DFX.profiles.length >= 4) return toast('Máximo 4 perfiles');
      const name = prompt('Nombre del nuevo perfil:');
      if (!name) return;
      DFX.profiles.push({ id: uid(), name: name.slice(0, 16), avatar: '🦊', created: Date.now() });
      save('dfx_profiles', DFX.profiles);
      m.remove(); buildModal(); openSettings();
    };
    $('#dfxAvPick').onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      prof().avatar = b.dataset.a; save('dfx_profiles', DFX.profiles);
      $$('#dfxAvPick button').forEach(x => x.classList.toggle('on', x.dataset.a === b.dataset.a));
      cloudSave();
    };
    $('#dfxProfName').onchange = e => {
      prof().name = e.target.value.slice(0, 16) || 'Yo';
      save('dfx_profiles', DFX.profiles); cloudSave();
    };
    $('#dfxAutoNext').onchange = e => {
      setSetting('autoplay', e.target.checked);
      if (window.autoNextEnabled !== undefined) { window.autoNextEnabled = e.target.checked; localStorage.setItem('donghuaflix_autonext', e.target.checked ? 'on' : 'off'); }
    };
    $('#dfxSleep').onchange = e => setSleep(Number(e.target.value));
    $('#dfxTextSize').onclick = e => { const b = e.target.closest('button'); if (!b) return; setSetting('textSize', b.dataset.v); $$('#dfxTextSize button').forEach(x => x.classList.toggle('on', x === b)); };
    $('#dfxReduceMotion').onchange = e => setSetting('reduceMotion', e.target.checked);
    $('#dfxImgQ').onclick = e => { const b = e.target.closest('button'); if (!b) return; setSetting('imgQ', b.dataset.v); $$('#dfxImgQ button').forEach(x => x.classList.toggle('on', x === b)); };
    $('#dfxPushBtn').onclick = requestPush;
    $('#dfxPublic').onchange = e => {
      DFX.account = DFX.account || { uid: 'u' + uid(), name: prof().name, public: false, bio: '' };
      DFX.account.public = e.target.checked;
      save('dfx_account', DFX.account); cloudSave();
      toast(e.target.checked ? '🌐 Perfil público activado' : '🔒 Perfil privado');
    };
    $('#dfxCopyProfile').onclick = () => {
      const url = location.origin + location.pathname + '#/u/' + (DFX.account?.uid || '');
      navigator.clipboard?.writeText(url);
      toast('🔗 Enlace copiado');
    };
    $('#dfxSyncNow').onclick = () => { cloudLoad(); };
    $('#dfxExport').onclick = () => {
      const data = { favs: window.getFavs(), watched: window.getWatched(), history: window.getHistory(), settings: DFX.settings, badge: DFX.badge, resume: DFX.resume, exported: new Date().toISOString() };
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'donghuaflix-backup.json';
      a.click();
      toast('⬇️ Respaldo descargado');
    };
    $('#dfxImport').onchange = e => {
      const f = e.target.files[0]; if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (d.favs) localStorage.setItem('donghuaflix_favs', JSON.stringify(d.favs));
          if (d.watched) localStorage.setItem('donghuaflix_watched', JSON.stringify(d.watched));
          if (d.history) localStorage.setItem('donghuaflix_history', JSON.stringify(d.history));
          toast('⬆️ Datos importados'); afterChange(); checkBadges(); window.route && window.route();
        } catch { toast('Archivo no válido'); }
      };
      r.readAsText(f);
    };
    $('#dfxWipe').onclick = () => {
      if (!confirm('¿Borrar TODOS tus datos locales (favoritos, vistos, insignias)?')) return;
      ['donghuaflix_favs', 'donghuaflix_watched', 'donghuaflix_history', 'dfx_badge', 'dfx_seen_eps', 'dfx_marathon', 'dfx_marathon_best', 'dfx_resume'].forEach(k => localStorage.removeItem(k));
      toast('🗑️ Datos borrados'); setTimeout(() => location.reload(), 800);
    };
  }

  function openSettings() {
    let m = $('#dfxModal');
    if (!m) { buildModal(); m = $('#dfxModal'); }
    m.classList.add('open');
  }
  function closeSettings() { $('#dfxModal')?.classList.remove('open'); }
  window.dfxOpenSettings = openSettings;
  window.dfxCloseSettings = closeSettings;

  /* ---------- waitlist ---------- */
  function toggleWaitlist(seriesId) {
    if (DFX.waitlist[seriesId]) { delete DFX.waitlist[seriesId]; toast('🔕 Quitado de la lista de espera'); }
    else { DFX.waitlist[seriesId] = Date.now(); toast('🔔 Te avisaremos cuando salga más contenido'); }
    save('dfx_waitlist', DFX.waitlist);
    cloudSave();
  }
  window.dfxToggleWaitlist = toggleWaitlist;

  /* ---------- botón de copiar link de episodio ---------- */
  function injectCopyLink() {
    if ($('#dfxCopyLink')) return;
    const nav = $$('.ep-nav')[0];
    if (!nav) return;
    const b = document.createElement('button');
    b.id = 'dfxCopyLink';
    b.className = 'btn-x glass';
    b.innerHTML = I.copy + '<span>Compartir</span>';
    b.onclick = () => {
      navigator.clipboard?.writeText(location.href);
      toast('🔗 Enlace del episodio copiado');
    };
    nav.appendChild(b);
  }

  /* ---------- sala compartida ---------- */
  const BC = ('BroadcastChannel' in window) ? new BroadcastChannel('dfx_room') : null;
  let lastRoomMsg = 0;
  if (BC) {
    BC.onmessage = (e) => {
      const d = e.data || {};
      if (!d.room) return;
      if (d.type === 'ping' && DFX.account && d.uid === DFX.account.uid) return;
      if (d.type === 'seek') {
        lastRoomMsg = Date.now();
        const ifr = document.querySelector('.player iframe');
        if (ifr && d.t != null) ifr.src = ifr.src.split('?')[0] + '?autoplay=1&start=' + Math.floor(d.t);
        toast('📡 Sala: salto a ' + Math.floor(d.t / 60) + 'm');
      }
      if (d.type === 'pause') {
        lastRoomMsg = Date.now();
        const ifr = document.querySelector('.player iframe');
        if (ifr) ifr.src = ifr.src.split('?')[0] + '?autoplay=0';
        toast('📡 Sala: pausado');
      }
    };
  }
  function roomSend(type, t) {
    if (!BC || !DFX.account) return;
    BC.postMessage({ room: true, type, t, uid: DFX.account.uid, at: Date.now() });
  }

  /* ---------- reanudar global ---------- */
  window.dfxResumeEp = function (epId) {
    const r = DFX.resume[epId];
    if (r && r.t > 5) return r.t;
    return 0;
  };


  /* ══════════════════════════════════════════════════════════
     INTEGRACIÓN — pulido (ex-Fase 8) + efectos (ex-dfx-polish)
     + hub "Mi Donghua" (ex-Fase 4)
     ══════════════════════════════════════════════════════════ */

  /* ---------- pulido de imágenes: lazy, rotas con reintento ---------- */
  const f8 = { broken: new Set(), errors: 0 };
  function f8fixImg(im) {
    if (!im || im.__f8) return;
    im.__f8 = true;
    if (!im.getAttribute('loading')) im.setAttribute('loading', 'lazy');
    im.setAttribute('decoding', 'async');
    if (!im.getAttribute('alt')) im.setAttribute('alt', '');
    if (im.complete && im.naturalWidth === 0) f8mark(im);
  }
  function f8mark(im) {
    if (im.classList.contains('f8-img-broken')) return;
    im.classList.add('f8-img-broken');
    f8.broken.add(im.currentSrc || im.src || '(sin src)');
    im.addEventListener('click', () => {
      const s = im.src;
      im.classList.remove('f8-img-broken');
      im.src = '';
      im.src = s;
    }, { once: true });
  }
  document.addEventListener('error', e => { if (e.target && e.target.tagName === 'IMG') f8mark(e.target); }, true);
  new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
    if (n.tagName === 'IMG') f8fixImg(n);
    if (n.querySelectorAll) $$('img', n).forEach(f8fixImg);
  }))).observe(document.documentElement, { childList: true, subtree: true });
  $$('img').forEach(f8fixImg);

  /* ---------- reduced-motion + ahorro de datos ---------- */
  try {
    const rm = matchMedia('(prefers-reduced-motion: reduce)');
    const applyRM = () => document.documentElement.classList.toggle('f8-rm', rm.matches);
    (rm.addEventListener || rm.addListener || function () {}).call(rm, 'change', applyRM);
    applyRM();
    const cn = navigator.connection || {};
    document.documentElement.classList.toggle('f8-lite', !!cn.saveData || cn.effectiveType === 'slow-2g' || cn.effectiveType === '2g');
  } catch {}

  /* ---------- errores de red visibles (throttled) ---------- */
  let f8lastToast = 0;
  addEventListener('unhandledrejection', () => {
    f8.errors++;
    if (Date.now() - f8lastToast > 5000) {
      f8lastToast = Date.now();
      toast('⚠️ Falló una carga. Revisa tu conexión.');
    }
  });

  /* ---------- reintento del selector de catálogos ---------- */
  function fixCatalogWrap() {
    try {
      const wrap = document.getElementById('catalogWrap');
      if (!wrap) return;
      const a = CATALOG_AVAILABLE;
      const n = Object.keys(a).filter(k => a[k]).length;
      if (n > 1) wrap.style.display = '';
    } catch {}
  }
  setTimeout(fixCatalogWrap, 2500);
  setInterval(fixCatalogWrap, 6000);

  /* ---------- glow ambiental (color dominante del póster) ---------- */
  function hexToRgba(hex, a) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
    if (!m) return `rgba(229,9,20,${a})`;
    return `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},${a})`;
  }
  function pickDominantColor(img) {
    try {
      const c = document.createElement('canvas');
      const s = 24;
      c.width = s; c.height = s;
      const x = c.getContext('2d', { willReadFrequently: true });
      x.drawImage(img, 0, 0, s, s);
      const d = x.getImageData(0, 0, s, s).data;
      let r = 0, g = 0, b = 0, n = 0;
      for (let i = 0; i < d.length; i += 16) {
        const rr = d[i], gg = d[i + 1], bb = d[i + 2];
        const lum = 0.2126 * rr + 0.7152 * gg + 0.0722 * bb;
        if (lum > 24 && lum < 216) { r += rr; g += gg; b += bb; n++; }
      }
      if (!n) return '#e50914';
      const h = v => Math.round(v / n).toString(16).padStart(2, '0');
      return `#${h(r)}${h(g)}${h(b)}`;
    } catch { return '#e50914'; }
  }
  function applyGlowFromImage(img) {
    const col = pickDominantColor(img);
    const glow = $('#dfxGlow');
    const player = $('.player');
    if (glow) glow.style.background = `radial-gradient(circle at 50% 20%, ${hexToRgba(col, .5)}, transparent 70%)`;
    if (player) player.style.setProperty('--dfx-glow', hexToRgba(col, .5));
    document.documentElement.style.setProperty('--dfx-glow', hexToRgba(col, .35));
  }
  function watchGlow() {
    const src = (window.currentEpisode && window.findSeries) ? window.getSeriesImage(window.findSeries(window.currentEpisode.seriesId) || {}) : null;
    if (!src) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => applyGlowFromImage(img);
    img.src = src;
  }

  /* ---------- modo cine (solo tecla C) ---------- */
  function toggleCine() {
    document.body.classList.toggle('dfx-cine');
    const on = document.body.classList.contains('dfx-cine');
    try { localStorage.setItem('dfx_cine', on ? '1' : '0'); } catch {}
    toast(on ? '🎬 Modo cine ON — pulsa C para salir' : '🎬 Modo cine OFF');
    if (on) window.scrollTo({ top: 0 });
  }
  if (localStorage.getItem('dfx_cine') === '1') document.body.classList.add('dfx-cine');

  /* ---------- parallax sutil del hero ---------- */
  let f8tick = false;
  addEventListener('scroll', () => {
    if (f8tick) return;
    f8tick = true;
    requestAnimationFrame(() => {
      const hero = $('.hero');
      if (hero && !document.documentElement.classList.contains('f8-rm')) {
        const y = window.scrollY;
        if (y < 600) hero.style.transform = `translateY(${y * 0.18}px)`;
        else hero.style.transform = '';
      }
      f8tick = false;
    });
  }, { passive: true });

  /* ---------- atajos de teclado ---------- */
  function kbdOverlay() {
    let o = $('#dfxKbd');
    if (!o) {
      o = document.createElement('div');
      o.id = 'dfxKbd';
      o.className = 'dfxKbdOverlay';
      o.innerHTML = `<div class="dfxKbdCard">
        <h3>⌨️ Atajos de teclado</h3>
        <div class="dfxKbdRow"><span>Buscar</span><kbd>/</kbd></div>
        <div class="dfxKbdRow"><span>Modo cine</span><kbd>C</kbd></div>
        <div class="dfxKbdRow"><span>🎲 Sorpréndeme</span><kbd>X</kbd></div>
        <div class="dfxKbdRow"><span>Pantalla completa del reproductor</span><kbd>F</kbd></div>
        <div class="dfxKbdRow"><span>Ver/ocultar este panel</span><kbd>?</kbd></div>
        <div class="dfxKbdRow"><span>Cerrar diálogos</span><kbd>Esc</kbd></div>
      </div>`;
      document.body.appendChild(o);
      o.onclick = e => { if (e.target === o) o.classList.remove('open'); };
    }
    o.classList.toggle('open');
  }
  document.addEventListener('keydown', e => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    switch (e.key) {
      case '/': e.preventDefault(); location.hash = '#/search'; break;
      case 'c': case 'C': toggleCine(); break;
      case 'x': case 'X': randomEp(); break;
      case 'f': case 'F': window.togglePlayerFS && window.togglePlayerFS(); break;
      case '?': kbdOverlay(); break;
      case 'Escape':
        $('#dfxKbd')?.classList.remove('open');
        if (document.body.classList.contains('dfx-cine')) toggleCine();
        break;
    }
  });

  /* ---------- gestos en el reproductor (móvil) ---------- */
  function showSeekToast(sec) {
    let t = $('#dfxSeekToast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'dfxSeekToast';
      t.style.cssText = 'position:fixed;top:40%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,.85);color:#fff;padding:12px 26px;border-radius:12px;font-size:20px;font-weight:800;z-index:99999;pointer-events:none;border:1px solid #333';
      document.body.appendChild(t);
    }
    t.textContent = (sec > 0 ? '» +' : '« -') + Math.abs(sec) + 's';
    clearTimeout(showSeekToast._t);
    showSeekToast._t = setTimeout(() => t.remove(), 900);
  }
  function bindPlayerGestures() {
    const player = $('.player');
    if (!player || player.dataset.dfxGest) return;
    player.dataset.dfxGest = '1';
    let startX = 0, seeking = false;
    player.addEventListener('touchstart', e => { startX = e.touches[0].clientX; seeking = false; }, { passive: true });
    player.addEventListener('touchmove', e => {
      if (seeking) return;
      const dx = e.touches[0].clientX - startX;
      if (Math.abs(dx) > 60) {
        seeking = true;
        showSeekToast(dx > 0 ? 10 : -10);
        const ifr = player.querySelector('iframe');
        if (ifr) {
          try {
            const cur = window.dfxResumeEp ? window.dfxResumeEp(window.currentEpisode?.id) : 0;
            const to = Math.max(0, cur + (dx > 0 ? 10 : -10));
            ifr.src = ifr.src.split('?')[0] + '?autoplay=1&start=' + Math.floor(to);
          } catch {}
        }
      }
    }, { passive: true });
    player.addEventListener('touchend', () => { seeking = false; }, { passive: true });
  }


  /* ---------- Descubrir (ex-Fase 7) ---------- */
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
      donghuacli:   "public/data/catalog-donghuacli-index.json",
      dramasyt:     "public/data/catalog-dramasyt-index.json",
      peliculas:    "public/data/catalog-peliculas-index.json",
      doramas:      "public/data/catalog-doramas-index.json"
    },
    labels: {
      donghualife: "DonghuaLife", donghuasub: "DonghuaSub",
 donghuacli: "DonghuaCLI",
      dramasyt: "DramasYT",
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
      '<a class="dfx7-card" href="#/series/' + esc(id) + '">' +
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
    location.hash = "#/series/" + (pick.i || pick.id);
  }

  /* ---------- RENDER ---------- */
  function skeletons() {
    var s = "";
    for (var i = 0; i < 8; i++) s += '<div class="dfx7-sk-card"><div class="dfx7-sk"></div><div class="dfx7-sk dfx7-sk-line"></div></div>';
    return '<div class="dfx7-rail">' + s + '</div>';
  }
  function discoverPage() {
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

  window.discoverPage = discoverPage;
})();
  /* ---------- Mi Donghua — hub del usuario ---------- */
  function miDonghuaPage() {
    const appEl = document.getElementById('app');
    if (!appEl) return;
    document.title = 'Mi Donghua — DonghuaFlix';
    const s = checkBadges();
    const hist = window.getHistory ? window.getHistory() : {};
    const favs = window.getFavs ? window.getFavs() : [];
    const series = (window.DB && window.DB.series) || [];

    const histItems = series
      .filter(x => hist[x.id])
      .sort((a, b) => hist[b.id].timestamp - hist[a.id].timestamp)
      .slice(0, 10);
    const favItems = series.filter(x => favs.includes(x.id)).slice(0, 24);
    const owned = BADGES.filter(b => DFX.badge[DFX.current + ':' + b.id]);

    /* Widget: episodios nuevos de lo que sigues (ex-Radar) */
    let newCount = 0;
    try {
      const follow = new Set([...favs, ...Object.keys(hist)]);
      const eps = ((window.DB && window.DB.episodes) || []);
      for (const e of eps) {
        if (!follow.has(e.seriesId)) continue;
        if (!DFX.seen[e.seriesId + ':' + e.number]) newCount++;
      }
    } catch {}

    const stat = (n, l) => `<div style="flex:1;min-width:70px"><b style="font-size:22px">${n}</b><div style="color:#9a9aa5;font-size:11px;margin-top:2px">${l}</div></div>`;

    appEl.innerHTML = `<section class="section page-top">
      <div class="section-head"><h2>🐉 Mi Donghua</h2><span class="muted">${esc(prof().name)}</span></div>

      <div class="dfxProfileCard">
        <div class="dfxAv">${esc(prof().avatar)}</div>
        <div style="flex:1;min-width:0">
          <b>${esc(prof().name)}</b>
          <div class="dfxMeta">${s.total} capítulos vistos · ${s.list} en Mi lista · ${s.seriesDone} series terminadas</div>
        </div>
        <button class="dfxChip" onclick="dfxOpenSettings()">⚙️ Ajustes</button>
      </div>

      <div style="display:flex;flex-wrap:wrap;gap:14px;background:#141419;border:1px solid #2a2a33;border-radius:14px;padding:16px;margin-bottom:16px">
        ${stat(s.total, 'Episodios vistos')}${stat(s.list, 'Mi lista')}${stat(s.seriesDone, 'Terminadas')}${stat(owned.length, 'Insignias')}
      </div>

      ${newCount ? `<div style="background:linear-gradient(90deg,#2a0a0c,#150607);border:1px solid #e50914;border-radius:12px;padding:12px 14px;margin-bottom:16px;display:flex;align-items:center;gap:10px">
        <span style="font-size:20px">📡</span>
        <div style="flex:1"><b>${newCount} episodio${newCount === 1 ? '' : 's'} nuevo${newCount === 1 ? '' : 's'}</b> <span style="color:#9a9aa5;font-size:12px">de series que sigues</span></div>
        <a class="dfxGo" style="text-decoration:none" href="#/mylist">Ver</a>
      </div>` : ''}

      ${histItems.length ? `<div class="section-head"><h2>Continuar viendo</h2><span class="muted">${histItems.length}</span></div>
      <div class="cw-rail">${histItems.map(x => {
        const h = hist[x.id];
        const img = window.getSeriesImage ? window.getSeriesImage(x) : (x.image || '');
        return `<div class="cw-card" onclick="location.hash='#/episode/${encodeURIComponent(h.episodeId)}'">
          ${img ? `<img loading="lazy" src="${esc(img)}" alt="" onerror="this.remove()">` : ''}
          <div class="cw-shade"></div><div class="cw-play">${I.play}</div>
          <div class="cw-info">${esc(window.cleanTitle ? window.cleanTitle(x) : x.title)} · E${h.episodeNumber}</div>
        </div>`;
      }).join('')}</div>` : ''}

      <div class="section-head" style="margin-top:20px"><h2>Mi lista</h2><span class="muted">${favItems.length}</span></div>
      ${favItems.length ? `<div class="grid">${favItems.map(window.card).join('')}</div>`
        : `<div class="dfxEmpty"><span class="dfxBig">❤️</span>Añade títulos con el corazón de cualquier tarjeta.</div>`}

      <div class="section-head" style="margin-top:22px"><h2>🏅 Insignias</h2><span class="muted">${owned.length}/${BADGES.length}</span></div>
      <div class="dfxBadgeRow">${BADGES.map(b => `<div class="dfxBadge ${DFX.badge[DFX.current + ':' + b.id] ? 'owned' : ''}" title="${esc(b.name)}"><div class="dfxBIcon">${b.icon}</div><span>${esc(b.name)}</span></div>`).join('')}</div>
    </section>`;
  }

  /* ---------- #/diag — diagnóstico (herramienta interna) ---------- */
  function diagPage() {
    const appEl = document.getElementById('app');
    if (!appEl) return;
    document.title = 'Diagnóstico — DonghuaFlix';
    const mem = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
    const imgs = $$('img');
    const li = (k, v) => `<li style="display:flex;justify-content:space-between;gap:12px;padding:8px 0;border-bottom:1px solid rgba(255,255,255,.08)"><span style="color:#9a9aa5">${k}</span><b>${v}</b></li>`;
    const flag = on => on ? '<b style="color:#7CFC9A">✔ activa</b>' : '<b style="color:#ff6b6b">✖ no</b>';
    let catalogosOk = '?';
    try { const a = CATALOG_AVAILABLE; const ks = Object.keys(a); catalogosOk = ks.filter(k => a[k]).length + '/' + ks.length; } catch {}
    appEl.innerHTML = `<div style="max-width:640px;margin:0 auto;padding:20px 16px 90px;font:14px/1.5 system-ui;color:#fff;background:#0b0b0f;min-height:100vh">
      <h1 style="font-size:20px;margin:0 0 4px">Diagnóstico DonghuaFlix</h1>
      <p style="color:#9a9aa5;margin:0 0 16px">versión integrada</p>
      <ul style="list-style:none;margin:0 0 16px;padding:0">
        ${li('Conexión', navigator.onLine ? '🟢 en línea' : '🔴 sin conexión')}
        ${li('Service Worker', ('serviceWorker' in navigator && navigator.serviceWorker.controller) ? 'activo' : 'no controla aún')}
        ${li('Catálogo activo', (typeof currentCatalog !== 'undefined' ? currentCatalog : '?') + ' · ' + ((window.DB && window.DB.series) ? window.DB.series.length : 0) + ' series')}
        ${li('Catálogos disponibles', catalogosOk)}
        ${li('Núcleo Pro', flag(true))}
        ${li('Imágenes rotas', `${f8.broken.size} / ${imgs.length}`)}
        ${li('Errores de red', f8.errors)}
        ${li('Memoria JS', (mem ?? '?') + ' MB')}
      </ul></div>`;
  }

  /* ---------- rutas nuevas ---------- */
  const origRoute2 = window.route;
  if (origRoute2 && !origRoute2.__dfxRoutes2) {
    const r2 = function () {
      const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
      if (p[0] === 'descubrir') return discoverPage();
      if (p[0] === 'mi-donghua') return miDonghuaPage();
      if (p[0] === 'diag') return diagPage();
      return origRoute2.apply(this, arguments);
    };
    r2.__dfxRoutes2 = true;
    window.route = r2;
  }

  /* ---------- arranque de las integraciones ---------- */
  function fxInit() {
    if ($('#dfxGlow')) return;
    const g = document.createElement('div');
    g.id = 'dfxGlow';
    document.body.prepend(g);
    wrap('episode', () => setTimeout(() => { watchGlow(); bindPlayerGestures(); }, 300));
    wrap('home', () => setTimeout(watchGlow, 400));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fxInit);
  else fxInit();

  /* ---------- arranque ---------- */
  function init() {
    splash();
    applySettings();
    addRoutes();
    wrap('toggleFav', afterChange);
    wrap('toggleWatched', afterChange);
    wrap('markWatchedSingle', afterChange);
    wrap('markWatchedUpTo', afterChange);
    wrap('saveHistory', afterChange);
    wrap('home', () => { setTimeout(() => { injectCopyLink(); }, 300); });
    wrap('episode', () => setTimeout(() => { injectCopyLink(); }, 200));

    /* Sin MutationObserver: los controles se inyectan una vez al cargar
       y se re-inyectan solo en los wraps de route()/home()/episode() */

    /* hook de auth: cuando firebase-sync confirma sesión, cargamos la nube */
    window.addEventListener('dfx:login', () => { cloudLoad(); });
    window.addEventListener('dfx:logout', () => { toast('👋 Sesión cerrada'); });

    checkBadges();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  /* exponer api */
  DFX.toast = toast;
  DFX.openSettings = openSettings;
  DFX.randomEp = randomEp;
  DFX.toggleWaitlist = toggleWaitlist;
  DFX.roomSend = roomSend;
  DFX.cloudSave = cloudSave;
  DFX.cloudLoad = cloudLoad;
  DFX.checkBadges = checkBadges;
  DFX.getStats = computeStats;


  /* ---------- puente con firebase-sync.js (si existe) ---------- */
  window.DFX_AUTH = {
    currentUser: function () {
      try {
        return (window.__DFX_FIREBASE_USER__ || null);
      } catch { return null; }
    },
    saveProfile: async function (payload) {
      /* firebase-sync.js expone DFX_CLOUD_SAVE cuando está activo */
      if (window.DFX_CLOUD_SAVE) {
        return window.DFX_CLOUD_SAVE(payload);
      }
      throw new Error('sin nube');
    },
    loadProfile: function (profileId, cb) {
      if (window.DFX_CLOUD_LOAD) {
        return window.DFX_CLOUD_LOAD(profileId, cb);
      }
      cb(null);
    }
  };

  /* firebase-sync.js llama a esto cuando el usuario inicia/cierra sesión */
  window.dfxAuthChanged = function (user) {
    window.__DFX_FIREBASE_USER__ = user;
    if (user) {
      cloudLoad();
      toast('☁️ Sesión iniciada: ' + (user.email || 'cuenta'));
    } else {
      toast('👋 Sesión cerrada');
    }
  };
})();
