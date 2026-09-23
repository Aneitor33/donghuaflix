// ══════════════════════════════════════════════════════════
//  firebase-sync.js — DonghuaFlix
//  Cuentas de usuario + sincronización en la nube (Firebase).
//
//  · Se carga como <script type="module"> DESPUÉS de app.js.
//  · NO modifica app.js: envuelve toggleFav / toggleWatched /
//    saveHistory y añade un botón "Entrar" + modal de cuenta.
//  · Favoritos, vistos e historial se guardan en Firestore
//    (colección "users", un documento por usuario) y se fusionan
//    con lo local al iniciar sesión: nada se pierde.
//  · Cambios en otro dispositivo aparecen al instante (en vivo).
// ══════════════════════════════════════════════════════════

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  GoogleAuthProvider,
  signInWithPopup,
  updateProfile
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ── Config de tu proyecto Donghuafilx ── */
const firebaseConfig = {
  apiKey: "AIzaSyCtLAgr3dx8DUHN1EfCgVbpyU7ntlqz_wE",
  authDomain: "donghuaflix.firebaseapp.com",
  projectId: "donghuaflix",
  storageBucket: "donghuaflix.firebasestorage.app",
  messagingSenderId: "34514786637",
  appId: "1:34514786637:web:bcb501301b7e0b9f967f04"
};

const LS_FAVS = 'donghuaflix_favs';
const LS_WATCHED = 'donghuaflix_watched';
const LS_HISTORY = 'donghuaflix_history';

/* ── Estado interno ── */
let lastWriteAt = 0;
let unsubSnapshot = null;
let authMode = 'login'; // 'login' | 'register'

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* ════════════════ LECTURA / ESCRITURA LOCAL ════════════════ */
/* Mismas claves que usa app.js, para que la app entera lo vea. */

const readLS = (key, fb) => {
  try { return JSON.parse(localStorage.getItem(key) || JSON.stringify(fb)); }
  catch { return fb; }
};
const writeLS = (key, val) =>
  localStorage.setItem(key, JSON.stringify(val));

const getFavsL = () => readLS(LS_FAVS, []);
const getWatchedL = () => readLS(LS_WATCHED, {});
const getHistoryL = () => readLS(LS_HISTORY, {});

/* ════════════════ FUSIÓN NUBE ↔ LOCAL ════════════════ */

function mergeAll(cloud) {
  let changed = false;

  // Favoritos: unión de ambos lados
  const localFavs = new Set(getFavsL());
  const cloudFavs = Array.isArray(cloud.favs) ? cloud.favs : [];
  const union = [...new Set([...localFavs, ...cloudFavs])];
  if (union.length !== localFavs.size ||
      union.some(id => !localFavs.has(id))) {
    writeLS(LS_FAVS, union);
    changed = true;
  }

  // Vistos e historial: gana el timestamp más reciente por clave
  for (const [lsKey, cloudVal] of [[LS_WATCHED, cloud.watched], [LS_HISTORY, cloud.history]]) {
    const local = readLS(lsKey, {});
    const remote = cloudVal && typeof cloudVal === 'object' ? cloudVal : {};
    const out = { ...local };
    for (const [k, v] of Object.entries(remote)) {
      const rt = (v && (v.timestamp || v.ts)) || 0;
      const lt = (out[k] && (out[k].timestamp || out[k].ts)) || 0;
      if (!out[k] || rt > lt) { out[k] = v; changed = true; }
    }
    if (changed) writeLS(lsKey, out);
  }

  return changed;
}

/* ════════════════ GUARDADO EN LA NUBE (con anti-rebote) ════════════════ */

let saveTimer = null;

function scheduleCloudSave() {
  if (!auth.currentUser) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(cloudSave, 800);
}

async function cloudSave() {
  const u = auth.currentUser;
  if (!u) return;

  lastWriteAt = Date.now();

  try {
    await setDoc(doc(db, 'users', u.uid), {
      favs: getFavsL(),
      watched: getWatchedL(),
      history: getHistoryL(),
      updatedAt: Date.now()
    });
  } catch (e) {
    console.warn('[sync] No se pudo guardar en la nube:', e.message);
  }
}

/* ════════════════ ENVOLTORIOS sobre las funciones de app.js ════════════════
   Se cargan tras app.js; las funciones son globales. Tras la acción
   original, se programa la subida a la nube. */

function wrapGlobal(name) {
  const orig = window[name];
  if (typeof orig !== 'function' || orig.__syncWrapped) return;
  const wrapped = function (...args) {
    const r = orig.apply(this, args);
    scheduleCloudSave();
    return r;
  };
  wrapped.__syncWrapped = true;
  window[name] = wrapped;
}

['toggleFav', 'toggleWatched', 'markWatchedSingle', 'markWatchedUpTo', 'saveHistory']
  .forEach(wrapGlobal);

/* ════════════════ UI: ESTILOS + BOTÓN + MODAL ════════════════ */

const STYLES = `
#dfsAuthBtn{flex:none;display:inline-flex;align-items:center;gap:7px;background:#e50914;color:#fff;
  border:none;border-radius:999px;padding:8px 16px;font-size:13px;font-weight:700;cursor:pointer;
  font-family:inherit;transition:transform .15s ease,background .2s;margin-left:6px}
#dfsAuthBtn:hover{transform:scale(1.05)}
#dfsAuthBtn.logged{background:#1d1d24;border:1px solid #333;color:#fff}
#dfsOverlay{position:fixed;inset:0;background:rgba(0,0,0,.78);z-index:9999;display:none;
  align-items:center;justify-content:center;padding:20px;backdrop-filter:blur(6px)}
#dfsOverlay.open{display:flex}
#dfsCard{width:100%;max-width:380px;background:#141419;border:1px solid #2a2a33;border-radius:16px;
  padding:28px 24px;color:#fff;font-family:inherit;box-shadow:0 20px 60px rgba(0,0,0,.6);
  animation:dfsIn .25s ease}
@keyframes dfsIn{from{opacity:0;transform:translateY(14px) scale(.97)}to{opacity:1;transform:none}}
#dfsCard h2{margin:0 0 4px;font-size:20px}
#dfsCard .dfsSub{color:#9a9aa5;font-size:13px;margin-bottom:18px}
.dfsField{width:100%;box-sizing:border-box;background:#1d1d24;border:1px solid #333;color:#fff;
  border-radius:10px;padding:12px 14px;font-size:14px;margin-bottom:12px;font-family:inherit;outline:none}
.dfsField:focus{border-color:#e50914}
#dfsCard .dfsMain{width:100%;background:#e50914;color:#fff;border:none;border-radius:10px;
  padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;margin-top:2px}
#dfsCard .dfsMain:disabled{opacity:.6;cursor:wait}
#dfsCard .dfsGoogle{width:100%;background:#1d1d24;color:#fff;border:1px solid #444;border-radius:10px;
  padding:11px;font-size:14px;cursor:pointer;font-family:inherit;display:flex;align-items:center;
  justify-content:center;gap:8px;margin-top:10px}
#dfsCard .dfsSwap{margin-top:16px;font-size:13px;color:#9a9aa5;text-align:center}
#dfsCard .dfsSwap a{color:#e50914;cursor:pointer;text-decoration:none;font-weight:600}
#dfsErr{color:#ff6b6b;font-size:13px;min-height:18px;margin:4px 0 6px}
.dfsUserRow{display:flex;align-items:center;gap:10px;background:#1d1d24;border:1px solid #2a2a33;
  border-radius:10px;padding:10px 12px;margin-bottom:14px}
.dfsAvatar{width:34px;height:34px;border-radius:50%;background:#e50914;color:#fff;display:flex;
  align-items:center;justify-content:center;font-weight:800;font-size:15px;flex:none;text-transform:uppercase}
.dfsUserRow .dfsMail{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dfsCloseRow{margin-top:16px;text-align:center}
.dfsCloseRow a{color:#9a9aa5;font-size:13px;cursor:pointer;text-decoration:none}
.dfsCloseRow a:hover{color:#fff}
`;

function injectStyles() {
  if (document.getElementById('dfsStyles')) return;
  const s = document.createElement('style');
  s.id = 'dfsStyles';
  s.textContent = STYLES;
  document.head.appendChild(s);
}

function injectModal() {
  if (document.getElementById('dfsOverlay')) return;

  const overlay = document.createElement('div');
  overlay.id = 'dfsOverlay';
  overlay.innerHTML = `
    <div id="dfsCard" role="dialog" aria-modal="true">
      <h2 id="dfsTitle">Iniciar sesión</h2>
      <div class="dfsSub">Tus favoritos y vistos te seguirán en todos tus dispositivos.</div>

      <div id="dfsLoggedView" style="display:none">
        <div class="dfsUserRow">
          <div class="dfsAvatar" id="dfsAvatar">?</div>
          <div class="dfsMail" id="dfsMail"></div>
        </div>
        <button class="dfsMain" id="dfsLogoutBtn">Cerrar sesión</button>
      </div>

      <div id="dfsFormView">
        <input class="dfsField" id="dfsName" type="text" placeholder="Nombre (solo al crear cuenta)" style="display:none">
        <input class="dfsField" id="dfsEmail" type="email" placeholder="Correo electrónico" autocomplete="email">
        <input class="dfsField" id="dfsPass" type="password" placeholder="Contraseña" autocomplete="current-password">
        <div id="dfsErr"></div>
        <button class="dfsMain" id="dfsSubmit">Entrar</button>
        <button class="dfsGoogle" id="dfsGoogleBtn">
          <svg width="17" height="17" viewBox="0 0 48 48"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34.5 6.1 29.5 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C41 35.4 44 30.2 44 24c0-1.3-.1-2.6-.4-3.9z"/></svg>
          <span>Entrar con Google</span>
        </button>
        <div class="dfsSwap" id="dfsSwap"></div>
      </div>

      <div class="dfsCloseRow"><a id="dfsClose">Cerrar</a></div>
    </div>`;
  document.body.appendChild(overlay);

  overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
  document.getElementById('dfsClose').onclick = closeModal;
  document.getElementById('dfsSubmit').onclick = submitForm;
  document.getElementById('dfsGoogleBtn').onclick = googleLogin;
  document.getElementById('dfsLogoutBtn').onclick = doLogout;
  document.getElementById('dfsSwap').onclick = () => setMode(authMode === 'login' ? 'register' : 'login');
}

function injectButton() {
  if (document.getElementById('dfsAuthBtn')) return;
  const nav = document.querySelector('.nav') || document.body;
  const btn = document.createElement('button');
  btn.id = 'dfsAuthBtn';
  btn.innerHTML = '👤 Entrar';
  btn.onclick = openModal;
  if (nav === document.body) {
    btn.style.cssText += 'position:fixed;top:14px;right:14px;z-index:9998';
  }
  nav.appendChild(btn);
}

function setMode(mode) {
  authMode = mode;
  const isReg = mode === 'register';
  document.getElementById('dfsTitle').textContent = isReg ? 'Crear cuenta' : 'Iniciar sesión';
  document.getElementById('dfsName').style.display = isReg ? '' : 'none';
  document.getElementById('dfsSubmit').textContent = isReg ? 'Crear cuenta' : 'Entrar';
  document.getElementById('dfsSwap').innerHTML = isReg
    ? '¿Ya tienes cuenta? <a>Inicia sesión</a>'
    : '¿No tienes cuenta? <a>Crea una gratis</a>';
  document.getElementById('dfsErr').textContent = '';
}

function openModal() {
  injectModal();
  const u = auth.currentUser;
  document.getElementById('dfsLoggedView').style.display = u ? '' : 'none';
  document.getElementById('dfsFormView').style.display = u ? 'none' : '';
  if (u) {
    document.getElementById('dfsMail').textContent = u.email || u.displayName || 'Cuenta';
    document.getElementById('dfsAvatar').textContent = (u.email || 'U')[0];
  } else {
    setMode(authMode);
  }
  document.getElementById('dfsOverlay').classList.add('open');
}
function closeModal() {
  document.getElementById('dfsOverlay')?.classList.remove('open');
}

/* ════════════════ AUTENTICACIÓN ════════════════ */

function showErr(msg) {
  const el = document.getElementById('dfsErr');
  if (el) el.textContent = msg;
}

const ERRORS = {
  'auth/email-already-in-use': 'Ese correo ya está registrado. Inicia sesión.',
  'auth/invalid-email': 'Correo electrónico no válido.',
  'auth/wrong-password': 'Contraseña incorrecta.',
  'auth/invalid-credential': 'Credenciales incorrectas.',
  'auth/user-not-found': 'No existe ninguna cuenta con ese correo.',
  'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
  'auth/popup-closed-by-user': 'Se cerró la ventana de Google.',
  'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase (revisa Authentication → Configuración → Dominios autorizados).'
};

async function submitForm() {
  const email = document.getElementById('dfsEmail').value.trim();
  const pass = document.getElementById('dfsPass').value;
  const name = document.getElementById('dfsName').value.trim();
  const btn = document.getElementById('dfsSubmit');

  if (!email || !pass) return showErr('Escribe tu correo y contraseña.');
  btn.disabled = true;

  try {
    if (authMode === 'register') {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      if (name) { try { await updateProfile(cred.user, { displayName: name }); } catch {} }
    } else {
      await signInWithEmailAndPassword(auth, email, pass);
    }
    closeModal();
  } catch (e) {
    showErr(ERRORS[e.code] || ('Error: ' + (e.message || e.code)));
  } finally {
    btn.disabled = false;
  }
}

async function googleLogin() {
  try {
    await signInWithPopup(auth, new GoogleAuthProvider());
    closeModal();
  } catch (e) {
    showErr(ERRORS[e.code] || ('Error: ' + (e.message || e.code)));
  }
}

async function doLogout() {
  try { await signOut(auth); } catch {}
  closeModal();
  updateAuthButton(null);
}

/* ════════════════ ESTADO DE SESIÓN + SINCRONIZACIÓN ════════════════ */

function updateAuthButton(user) {
  const btn = document.getElementById('dfsAuthBtn');
  if (!btn) return;
  if (user) {
    btn.classList.add('logged');
    const initial = (user.email || 'U')[0].toUpperCase();
    btn.innerHTML = `<span style="width:20px;height:20px;border-radius:50%;background:#e50914;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800">${initial}</span><span style="max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${user.email || 'Mi cuenta'}</span>`;
  } else {
    btn.classList.remove('logged');
    btn.innerHTML = '👤 Entrar';
  }
}

onAuthStateChanged(auth, async user => {
  updateAuthButton(user);

  if (unsubSnapshot) { unsubSnapshot(); unsubSnapshot = null; }

  if (!user) return;

  // 1) Carga inicial: fusionar nube → local
  try {
    const snap = await getDoc(doc(db, 'users', user.uid));
    if (snap.exists()) {
      const changed = mergeAll(snap.data());
      if (changed) refreshUI();
    }
    // Si el usuario es nuevo en la nube, sube lo que tiene local
    await cloudSave();
  } catch (e) {
    console.warn('[sync] Error al cargar la nube:', e.message);
  }

  // 2) En vivo: lo que cambie en OTRO dispositivo se aplica aquí
  unsubSnapshot = onSnapshot(doc(db, 'users', user.uid), snap => {
    if (!snap.exists()) return;
    if (Date.now() - lastWriteAt < 2500) return; // eco de mi propia escritura
    if (mergeAll(snap.data())) refreshUI();
  });
});

function refreshUI() {
  try { window.route && window.route(); }
  catch { try { location.reload(); } catch {} }
}

/* ════════════════ ARRANQUE ════════════════ */

function boot() {
  injectStyles();
  injectButton();
  // Por si la navegación de app.js re-renderiza la barra, re-inyecta el botón
  new MutationObserver(() => {
    if (!document.getElementById('dfsAuthBtn')) injectButton();
  }).observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
