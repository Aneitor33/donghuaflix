// ══════════════════════════════════════════════════════════
//  dfx-core.js — DonghuaFlix Pro (núcleo)
//  Perfiles, ajustes, insignias, radar, sala, calendario,
//  versus, cronómetro, sleep timer, perfiles públicos,
//  sincronización multi-perfil y push FCM.
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
  DFX.marathon = load('dfx_marathon', { key: null, count: 0, best: load('dfx_marathon_best', 0) });
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
.dfxDot{position:fixed;top:70px;right:16px;z-index:9999;width:12px;height:12px;border-radius:50%;background:#e50914;box-shadow:0 0 0 4px rgba(229,9,20,.3);animation:dfxPulse 1.5s infinite}
.dfxGrid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
@media(max-width:560px){.dfxGrid2{grid-template-columns:1fr}}
.dfxVsCard{position:relative;border-radius:14px;overflow:hidden;background:#141419;border:1px solid #2a2a33;cursor:pointer;transition:transform .2s ease,border-color .2s ease}
.dfxVsCard:hover{transform:translateY(-4px);border-color:#e50914}
.dfxVsCard img{width:100%;aspect-ratio:2/3;object-fit:cover;display:block}
.dfxVsCard .dfxVsTitle{position:absolute;inset:auto 0 0 0;padding:26px 12px 10px;background:linear-gradient(transparent,rgba(0,0,0,.9));color:#fff;font-weight:700;font-size:13px}
.dfxVsCard.sel{border-color:#e50914;box-shadow:0 0 0 2px #e50914}
.dfxVsCard.sel::after{content:'✓';position:absolute;top:8px;right:8px;width:24px;height:24px;border-radius:50%;background:#e50914;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800}
.dfxVsTable{width:100%;border-collapse:collapse;margin-top:14px;color:#ddd;font-size:13px}
.dfxVsTable td,.dfxVsTable th{padding:9px 10px;border-bottom:1px solid #222;text-align:left}
.dfxVsTable th{color:#9a9aa5;font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.5px}
.dfxBadgeRow{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px}
.dfxBadge{width:64px;text-align:center}
.dfxBadge .dfxBIcon{width:52px;height:52px;margin:0 auto;border-radius:50%;background:linear-gradient(145deg,#1d1d24,#111);border:2px solid #333;display:flex;align-items:center;justify-content:center;font-size:22px}
.dfxBadge.owned .dfxBIcon{border-color:#e50914;background:linear-gradient(145deg,#2a0a0c,#150607)}
.dfxBadge span{display:block;font-size:9px;color:#9a9aa5;margin-top:4px;line-height:1.2}
.dfxCalWrap{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.dfxCalDay{background:#141419;border:1px solid #2a2a33;border-radius:12px;padding:10px;min-height:120px}
.dfxCalDay.today{border-color:#e50914;box-shadow:0 0 0 1px #e50914}
.dfxCalDay h4{margin:0 0 8px;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#9a9aa5;text-align:center}
.dfxCalDay.today h4{color:#e50914}
.dfxCalItem{display:flex;gap:6px;align-items:center;padding:4px;border-radius:6px;cursor:pointer;margin-bottom:4px}
.dfxCalItem:hover{background:#1d1d24}
.dfxCalItem img{width:26px;height:38px;object-fit:cover;border-radius:4px}
.dfxCalItem span{font-size:10px;color:#ddd;line-height:1.2}
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
.dfxMarathonChip{display:inline-flex;align-items:center;gap:6px;background:linear-gradient(90deg,#2a0a0c,#150607);border:1px solid #e50914;color:#fff;border-radius:99px;padding:6px 14px;font-size:12px;font-weight:700}
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

  /* Cambio de perfil real: guarda el actual en su prefijo,
     conmuta y restaura los datos del perfil destino. */
  function switchProfile(newId) {
    if (!DFX.profiles.some(p => p.id === newId) || newId === DFX.current) return;
    const USER_KEYS = {
      favs: 'donghuaflix_favs',
      watched: 'donghuaflix_watched',
      history: 'donghuaflix_history',
      autonext: 'donghuaflix_autonext'
    };
    save(prefix() + 'favs', window.getFavs ? window.getFavs() : []);
    save(prefix() + 'watched', window.getWatched ? window.getWatched() : {});
    save(prefix() + 'history', window.getHistory ? window.getHistory() : {});
    save(prefix() + 'autonext', window.autoNextEnabled !== false);
    cloudSave();
    DFX.current = newId;
    save('dfx_current', DFX.current);
    const restore = (k, fb) => {
      const v = load(prefix() + k, null);
      localStorage.setItem(USER_KEYS[k], JSON.stringify(v == null ? fb : v));
    };
    restore('favs', []);
    restore('watched', {});
    restore('history', []);
    const an = load(prefix() + 'autonext', true);
    localStorage.setItem('donghuaflix_autonext', an === false ? 'off' : 'on');
    window.autoNextEnabled = an !== false;
    applySettings();
    checkBadges();
    injectRadar();
    cloudSave();
    try { window.route && window.route(); } catch {}
    toast('👤 Perfil: ' + prof().name);
  }

  /* insignias: conteo de episodios vistos */
  const BADGES = [
    { id: 'first', name: 'Primera vez', icon: '🎬', test: s => s.total >= 1 },
    { id: 'fan5', name: 'Fan · 50 caps', icon: '🍿', test: s => s.total >= 50 },
    { id: 'fan10', name: 'Fan · 100 caps', icon: '⭐', test: s => s.total >= 100 },
    { id: 'fan25', name: 'Fan · 250 caps', icon: '🔥', test: s => s.total >= 250 },
    { id: 'fan50', name: 'Fan · 500 caps', icon: '💎', test: s => s.total >= 500 },
    { id: 'fan100', name: 'Leyenda · 1000 caps', icon: '👑', test: s => s.total >= 1000 },
    { id: 'marathon5', name: 'Maratón ×5', icon: '🏃', test: s => s.best >= 5 },
    { id: 'marathon10', name: 'Maratón ×10', icon: '🏆', test: s => s.best >= 10 },
    { id: 'marathon25', name: 'Maratón ×25', icon: '🚀', test: s => s.best >= 25 },
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
    return { total, seriesDone, list: favs.length, genres: genres.size, best: DFX.marathon.best || 0 };
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

  /* ---------- radar de episodios nuevos ---------- */
  function newEpisodesCount() {
    try {
      const seen = DFX.seen || {};
      const eps = (window.DB && window.DB.episodes) || [];
      const favs = window.getFavs ? window.getFavs() : [];
      const hist = window.getHistory ? window.getHistory() : {};
      const follow = new Set([...favs, ...Object.keys(hist)]);
      const series = (window.DB.series || []);
      let count = 0;
      const items = [];
      for (const s of series) {
        if (!follow.has(s.id)) continue;
        const sEps = eps.filter(e => e.seriesId === s.id);
        let newOnes = 0;
        for (const e of sEps) {
          const k = s.id + ':' + e.number;
          if (!seen[k]) newOnes++;
        }
        if (newOnes > 0) { count += newOnes; items.push({ s, n: newOnes }); }
      }
      items.sort((a, b) => b.n - a.n);
      return { count, items: items.slice(0, 6) };
    } catch { return { count: 0, items: [] }; }
  }

  function markSeenCurrent() {
    try {
      const eps = (window.DB && window.DB.episodes) || [];
      const favs = window.getFavs ? window.getFavs() : [];
      const hist = window.getHistory ? window.getHistory() : {};
      const follow = new Set([...favs, ...Object.keys(hist)]);
      let changed = false;
      for (const e of eps) {
        if (!follow.has(e.seriesId)) continue;
        const k = e.seriesId + ':' + e.number;
        if (!DFX.seen[k]) { DFX.seen[k] = 1; changed = true; }
      }
      if (changed) save('dfx_seen_eps', DFX.seen);
    } catch {}
  }

  function injectRadar() {
    const r = newEpisodesCount();
    let bar = $('#dfxRadarBar');
    if (r.count > 0) {
      if (!bar) {
        bar = document.createElement('div');
        bar.id = 'dfxRadarBar';
        bar.className = 'dfxTop';
        document.body.appendChild(bar);
      }
      bar.innerHTML = `<span style="font-size:20px">📡</span><div style="flex:1;min-width:0"><b>${r.count} episodio${r.count === 1 ? '' : 's'} nuevo${r.count === 1 ? '' : 's'}</b> <span>de series que sigues</span></div><button class="dfxGo" id="dfxRadarGo">Ver</button>`;
      $('#dfxRadarGo').onclick = () => { location.hash = '#/radar'; };
      let dot = $('#dfxRadarDot');
      if (!dot) { dot = document.createElement('div'); dot.id = 'dfxRadarDot'; dot.className = 'dfxDot'; document.body.appendChild(dot); }
    } else {
      bar && bar.remove();
      $('#dfxRadarDot') && $('#dfxRadarDot').remove();
    }
    return r;
  }

  function radarPage() {
    const r = newEpisodesCount();
    let html = '<section class="section page-top"><div class="section-head"><h2>📡 Radar de episodios</h2><span class="muted">' + r.count + '</span></div>';
    if (!r.items.length) {
      html += '<div class="dfxEmpty"><span class="dfxBig">📡</span>Añade series a Mi lista o empieza a verlas: aquí aparecerán sus capítulos nuevos tras cada sincronización.</div></section>';
    } else {
      html += '<div class="grid">';
      for (const it of r.items) {
        const s = it.s;
        const img = window.getSeriesImage ? window.getSeriesImage(s) : (s.image || '');
        html += `<article class="card" onclick="location.hash='#/series/${encodeURIComponent(s.slug || s.id)}'"><div class="poster">${img ? `<img loading="lazy" src="${esc(img)}" alt="">` : '<div class="no-img">DFX</div>'}<span class="badge" style="background:#e50914">${it.n} NUEVO${it.n === 1 ? '' : 'S'}</span></div><h3>${esc(window.cleanTitle ? window.cleanTitle(s) : s.title)}</h3></article>`;
      }
      html += '</div></section>';
    }
    const app = document.getElementById('app');
    if (app) { app.innerHTML = html; }
  }

  /* ---------- episodio aleatorio ---------- */
  function randomEp() {
    try {
      const eps = (window.DB && window.DB.episodes) || [];
      if (!eps.length) return toast('No hay episodios en el catálogo');
      const e = eps[Math.floor(Math.random() * eps.length)];
      location.hash = '#/episode/' + encodeURIComponent(e.slug || e.id);
    } catch { toast('No se pudo elegir episodio'); }
  }

  /* ---------- cronómetro de maratón ---------- */
  let marathonTimer = null;
  function startMarathon() {
    const s = window.detailState && window.detailState.seriesId;
    if (!s) return toast('Abre una serie primero');
    DFX.marathon = { key: s, count: 0, best: DFX.marathon.best || 0 };
    save('dfx_marathon', DFX.marathon);
    clearTimeout(marathonTimer);
    marathonTimer = setTimeout(() => {
      if (DFX.marathon.key === s && DFX.marathon.count > 0) {
        DFX.marathon.count = 0;
        save('dfx_marathon', DFX.marathon);
      }
    }, 3 * 3600 * 1000);
    toast('🏃 Modo maratón activado — a ver esos capítulos');
  }
  function stopMarathon() {
    DFX.marathon.key = null; DFX.marathon.count = 0;
    save('dfx_marathon', DFX.marathon);
    toast('Maratón finalizado');
  }

  wrap('episode', () => {
    afterChange();
    checkBadges();
    const m = DFX.marathon;
    if (m.key) {
      m.count++;
      if (m.count > (m.best || 0)) { m.best = m.count; save('dfx_marathon_best', m.best); }
      save('dfx_marathon', m);
      if ([5, 10, 25].includes(m.count)) {
        toast('🏃 ¡Llevas ' + m.count + ' capítulos seguidos!');
        notify('DonghuaFlix — Maratón ×' + m.count, '¡Sigue así!');
      }
    }
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

  /* ---------- calendario ---------- */
  function calendarPage() {
    const eps = (window.DB && window.DB.episodes) || [];
    const byDay = {};
    const days = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
    for (let i = 0; i < 7; i++) byDay[i] = [];
    for (const e of eps) {
      const t = Date.parse(e.updatedAt || 0);
      if (!t) continue;
      const d = new Date(t).getDay();
      byDay[d].push(e);
    }
    for (const k of Object.keys(byDay)) {
      byDay[k].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
      byDay[k] = byDay[k].slice(0, 8);
    }
    const today = new Date().getDay();
    let html = '<section class="section page-top"><div class="section-head"><h2>📅 Calendario de estrenos</h2><span class="muted">por día de actualización</span></div><div class="dfxCalWrap">';
    const order = [1, 2, 3, 4, 5, 6, 0];
    for (const d of order) {
      html += `<div class="dfxCalDay ${d === today ? 'today' : ''}"><h4>${days[d]}${d === today ? ' · hoy' : ''}</h4>`;
      if (!byDay[d].length) html += '<div style="color:#555;font-size:10px;text-align:center;padding:14px 0">Sin estrenos</div>';
      for (const e of byDay[d]) {
        const s = window.findSeries ? window.findSeries(e.seriesId) : null;
        const img = s && window.getSeriesImage ? window.getSeriesImage(s) : '';
        html += `<div class="dfxCalItem" onclick="location.hash='#/episode/${encodeURIComponent(e.slug || e.id)}'">${img ? `<img src="${esc(img)}" alt="">` : '<div style="width:26px;height:38px;background:#222;border-radius:4px"></div>'}<span>${esc(s ? (window.cleanTitle ? window.cleanTitle(s) : s.title) : e.seriesId)}<br><b style="color:#e50914">E${e.number}</b></span></div>`;
      }
      html += '</div>';
    }
    html += '</div></section>';
    const app = document.getElementById('app');
    if (app) app.innerHTML = html;
  }

  /* ---------- versus ---------- */
  let vsSel = [];
  function versusPage() {
    const series = (window.DB && window.DB.series) || [];
    let html = '<section class="section page-top"><div class="section-head"><h2>⚔️ Versus</h2><span class="muted">elige 2 donghuas</span></div>';
    html += '<div class="dfxGrid2" id="vsPick" style="margin-bottom:16px">' + series.slice(0, 24).map(s => {
      const img = window.getSeriesImage ? window.getSeriesImage(s) : (s.image || '');
      return `<div class="dfxVsCard" data-id="${esc(s.id)}">${img ? `<img src="${esc(img)}" alt="">` : ''}<div class="dfxVsTitle">${esc(window.cleanTitle ? window.cleanTitle(s) : s.title)}</div></div>`;
    }).join('') + '</div>';
    html += '<div id="vsResult"></div></section>';
    const app = document.getElementById('app');
    if (!app) return;
    app.innerHTML = html;
    $$('#vsPick .dfxVsCard').forEach(c => c.onclick = () => {
      const id = c.dataset.id;
      if (vsSel.includes(id)) { vsSel = vsSel.filter(x => x !== id); c.classList.remove('sel'); }
      else if (vsSel.length < 2) { vsSel.push(id); c.classList.add('sel'); }
      else { vsSel = [vsSel[1], id]; $$('#vsPick .dfxVsCard').forEach(x => x.classList.toggle('sel', vsSel.includes(x.dataset.id))); }
      renderVs();
    });
    function renderVs() {
      const box = $('#vsResult');
      if (vsSel.length !== 2) { box.innerHTML = '<p class="muted" style="text-align:center">Selecciona 2 títulos para compararlos</p>'; return; }
      const a = series.find(s => s.id === vsSel[0]);
      const b = series.find(s => s.id === vsSel[1]);
      if (!a || !b) return;
      const row = (l, va, vb) => `<tr><th>${l}</th><td>${va}</td><td>${vb}</td></tr>`;
      const imgA = window.getSeriesImage ? window.getSeriesImage(a) : (a.image || '');
      const imgB = window.getSeriesImage ? window.getSeriesImage(b) : (b.image || '');
      const epsA = (window.DB.episodes || []).filter(e => e.seriesId === a.id).length;
      const epsB = (window.DB.episodes || []).filter(e => e.seriesId === b.id).length;
      box.innerHTML = `<div class="dfxGrid2" style="align-items:end">
        <div style="text-align:center"><img src="${esc(imgA)}" style="width:100%;max-width:180px;border-radius:12px;aspect-ratio:2/3;object-fit:cover"><h3 style="margin:8px 0 0">${esc(window.cleanTitle ? window.cleanTitle(a) : a.title)}</h3></div>
        <div style="text-align:center"><img src="${esc(imgB)}" style="width:100%;max-width:180px;border-radius:12px;aspect-ratio:2/3;object-fit:cover"><h3 style="margin:8px 0 0">${esc(window.cleanTitle ? window.cleanTitle(b) : b.title)}</h3></div>
      </div>
      <table class="dfxVsTable">
        ${row('Estado', esc(a.status || '—'), esc(b.status || '—'))}
        ${row('Año', esc(a.year || '—'), esc(b.year || '—'))}
        ${row('Episodios', epsA, epsB)}
        ${row('Géneros', esc((window.seriesGenres ? window.seriesGenres(a) : a.genres || []).slice(0, 3).join(', ') || '—'), esc((window.seriesGenres ? window.seriesGenres(b) : b.genres || []).slice(0, 3).join(', ') || '—'))}
        ${row('Origen', esc((window.SRC_LABEL && window.SRC_LABEL[a._cat || a.src]) || a.src || '—'), esc((window.SRC_LABEL && window.SRC_LABEL[b._cat || b.src]) || b.src || '—'))}
      </table>
      <div style="text-align:center;margin-top:14px"><button class="dfxGo" style="padding:10px 22px;font-size:13px" onclick="location.hash='#/series/${encodeURIComponent(a.slug || a.id)}'">Ver ${esc(window.cleanTitle ? window.cleanTitle(a) : a.title)}</button> <button class="dfxGo" style="padding:10px 22px;font-size:13px;background:#333" onclick="location.hash='#/series/${encodeURIComponent(b.slug || b.id)}'">Ver ${esc(window.cleanTitle ? window.cleanTitle(b) : b.title)}</button></div>`;
    }
    renderVs();
  }

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
          marathon: DFX.marathon,
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
      if (data.marathon) { DFX.marathon = data.marathon; save('dfx_marathon', DFX.marathon); }
      if (data.account) { DFX.account = data.account; save('dfx_account', DFX.account); }
      try { window.route && window.route(); } catch { location.reload(); }
      injectRadar();
      toast('☁️ Sincronizado');
    });
  }

  /* ---------- pestañas ---------- */
  window.addEventListener('storage', (e) => {
    if (!e.key) return;
    if (['donghuaflix_favs', 'donghuaflix_watched', 'donghuaflix_history', 'dfx_seen_eps'].includes(e.key)) {
      try { window.route && window.route(); } catch {}
      injectRadar();
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
      if (p[0] === 'radar') return radarPage();
      if (p[0] === 'calendar') return calendarPage();
      if (p[0] === 'versus') return versusPage();
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
      switchProfile(b.dataset.p);
      m.remove(); buildModal(); openSettings();
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

  /* ---------- menú "Más" limpio ---------- */
  function cleanMoreMenu() {
    const mm = document.getElementById('moreMenu');
    if (!mm) return;
    /* quita los enlaces antiguos, deja solo cuenta + ajustes */
    $$('a', mm).forEach(a => a.remove());
    if (!$('#dfxAuthMobile')) {
      const a = document.createElement('a');
      a.id = 'dfxAuthMobile';
      a.href = '#/';
      a.textContent = '👤 Mi cuenta';
      a.onclick = e => { e.preventDefault(); window.toggleMoreMenu && window.toggleMoreMenu(); if (window.dfxOpenAuth) window.dfxOpenAuth(); };
      mm.appendChild(a);
    }
    if (!$('#dfxSettingsMobile')) {
      const s = document.createElement('a');
      s.id = 'dfxSettingsMobile';
      s.href = '#/';
      s.textContent = '⚙️ Ajustes';
      s.onclick = e => { e.preventDefault(); window.toggleMoreMenu && window.toggleMoreMenu(); openSettings(); };
      mm.appendChild(s);
    }
  }

  /* ---------- barra de estado global (contador) ----------
     La píldora flotante tapaba la bottom-nav en móvil: se elimina.
     Las estadísticas vivirán en el perfil. Se conserva checkBadges(). */
  function injectGlobalStats() {
    checkBadges();
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

  /* ---------- arranque ---------- */
  function init() {
    splash();
    applySettings();
    addRoutes();
    cleanMoreMenu();
    wrap('toggleFav', afterChange);
    wrap('toggleWatched', afterChange);
    wrap('markWatchedSingle', afterChange);
    wrap('markWatchedUpTo', afterChange);
    wrap('saveHistory', afterChange);
    wrap('home', () => { setTimeout(() => { injectRadar(); injectGlobalStats(); cleanMoreMenu(); }, 300); });
    wrap('episode', () => setTimeout(() => { injectCopyLink(); injectGlobalStats(); }, 200));

    /* barra inferior extra: radar, calendario, versus, random */
    const bn = document.querySelector('.bottom-nav');
    if (bn && !$('#dfxBNWrap')) {
      const w = document.createElement('div');
      w.id = 'dfxBNWrap';
      w.style.cssText = 'display:flex;gap:6px;justify-content:center;padding:8px 10px;flex-wrap:wrap';
      w.innerHTML = `
        <button class="dfxChip" onclick="location.hash='#/radar'">📡 Radar</button>
        <button class="dfxChip" onclick="location.hash='#/calendar'">📅 Estrenos</button>
        <button class="dfxChip" onclick="location.hash='#/versus'">⚔️ Versus</button>
        <button class="dfxChip" id="dfxRandBtn">${I.dice} Aleatorio</button>
        <button class="dfxChip" id="dfxMarathonBtn">🏃 Maratón</button>`;
      bn.parentNode.insertBefore(w, bn.nextSibling);
      $('#dfxRandBtn').onclick = randomEp;
      $('#dfxMarathonBtn').onclick = () => {
        if (DFX.marathon.key) { stopMarathon(); $('#dfxMarathonBtn').classList.remove('on'); }
        else { startMarathon(); $('#dfxMarathonBtn').classList.add('on'); }
      };
    }

    /* Sin MutationObserver: los controles se inyectan una vez al cargar
       y se re-inyectan solo en los wraps de route()/home()/episode() */
    setTimeout(() => { cleanMoreMenu(); injectGlobalStats(); }, 500);

    setTimeout(() => { injectRadar(); injectGlobalStats(); markSeenCurrent(); }, 800);

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
  DFX.startMarathon = startMarathon;
  DFX.stopMarathon = stopMarathon;
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
