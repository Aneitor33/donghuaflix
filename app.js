console.log("%c DonghuaFlix — Creado por @bledark__ ", "background: #111; color: #00ffcc; font-size: 14px; font-weight: bold;");

let DB = { series: [], seasons: [], episodes: [], genres: [], meta: {} };
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const qs = s => encodeURIComponent(s || '');

// Función inteligente para limpiar el título si viene como "Temporadas" usando el slug
const cleanTitle = (s) => {
  const title = s?.title;
  if (!title || title.toLowerCase() === 'temporadas') {
    const rawSlug = s?.slug || s?.id || '';
    if (rawSlug) {
      return rawSlug
        .split('-')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
    }
    return 'Donghua';
  }
  return title;
};

// Función auxiliar para validar, limpiar y buscar imágenes alternativas en las temporadas si falta en la serie
const getSeriesImage = (s) => {
  if (s?.image && !s.image.includes('IcoPrueba.png')) {
    return s.image;
  }
  const associatedSeasons = DB.seasons.filter(seas => seas.seriesId === s.id);
  for (const seas of associatedSeasons) {
    if (seas.image && !seas.image.includes('IcoPrueba.png')) {
      return seas.image;
    }
  }
  return '';
};

async function load() {
  app.innerHTML = '<section class="section"><div class="grid">' + Array(8).fill('<div class="skeleton"></div>').join('') + '</div></section>';
  try {
    const r = await fetch('./public/data/catalog.json?ts=' + Date.now(), { 
      cache: 'reload',
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });
    DB = await r.json();
    const footerStatus = document.getElementById('footerStatus');
    if (footerStatus) {
      footerStatus.innerHTML = `
        ${DB.meta?.syncedAt ? `Actualizado: ${new Date(DB.meta.syncedAt).toLocaleString('es-ES')}` : 'Catálogo listo'}<br>
        <span style="opacity: 0.85; font-size: 12px; margin-top: 4px; display: inline-block;">
          Desarrollado con ❤️ por <a href="https://instagram.com/bledark__" target="_blank" rel="noopener" style="color: #00ffcc; text-decoration: none; font-weight: 600;">@bledark__</a>
        </span>
      `;
    }
    route();
  } catch (err) {
    app.innerHTML = '<section class="empty"><h2>Error al cargar el catálogo</h2></section>';
  }
}

function card(s) {
  const imgUrl = getSeriesImage(s);
  const title = cleanTitle(s);
  return `<article class="card" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
    <div class="poster">
      ${imgUrl ? `<img loading="lazy" src="${esc(imgUrl)}" alt="${esc(title)}">` : '<div class="no-img" style="display:flex;align-items:center;justify-content:center;height:100%;background:#1a1a1a;color:#666;font-weight:bold;font-size:12px;text-align:center;padding:5px;">DONGHUAFLIX</div>'}
      <span class="badge">${esc(s.status || 'DONGHUA')}</span>
    </div>
    <h3 style="color:#ffffff; font-weight:600; font-size:14px; margin-top:8px;">${esc(title)}</h3>
  </article>`;
}

// --- VISTA HOME OPTIMIZADA (Estilo Netflix con filas y carrusel) ---
function home() {
  const recent = DB.series.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const hero = recent[0];
  const heroImg = hero ? getSeriesImage(hero) : '';
  const heroTitle = hero ? cleanTitle(hero) : 'DonghuaFlix';

  const airingList = DB.series.filter(s => (s.status || '').toLowerCase().includes('emisión'));

  app.innerHTML = `
  <section class="hero" style="--hero:url('${esc(heroImg)}')">
    <div class="hero-content">
      <div class="eyebrow">DONGHUAFLIX EXCLUSIVE</div>
      <h1>${esc(heroTitle)}</h1>
      <p>${esc(hero?.synopsis || 'Catálogo de animación china en alta calidad.')}</p>
      <div class="buttons">
        ${hero ? `<button class="btn primary" onclick="location.hash='#/series/${qs(hero.slug || hero.id)}'">▶ Ver serie</button>` : ''}
      </div>
    </div>
  </section>

  ${airingList.length ? `
  <section class="section" style="padding: 20px 4%;">
    <div class="section-head"><h2>En Emisión</h2><span class="muted">${airingList.length}</span></div>
    <div class="horizontal-scroll" style="display: flex; gap: 15px; overflow-x: auto; padding-bottom: 15px; scroll-behavior: smooth; -webkit-overflow-scrolling: touch;">
      ${airingList.map(s => `<div style="flex: 0 0 150px; min-width: 150px;">${card(s)}</div>`).join('')}
    </div>
  </section>` : ''}

  <section class="section" style="padding: 20px 4%;">
    <div class="section-head"><h2>Catálogo de Series</h2><span class="muted">${DB.series.length}</span></div>
    <div class="grid">${DB.series.slice(0, 24).map(card).join('')}</div>
    ${DB.series.length > 24 ? `
      <div style="text-align:center; margin: 30px 0;">
        <button class="btn dark" onclick="location.hash='#/series'" style="padding: 12px 25px; background: rgba(255,255,255,0.1); color:#fff; border: 1px solid rgba(255,255,255,0.2); border-radius: 6px; cursor:pointer; font-weight: 500; font-size: 14px;">
          Ver todas las series (${DB.series.length})
        </button>
      </div>` : ''}
  </section>`;
}

// --- VISTAS DE NAVEGACIÓN SUPERIOR ---

function listAllSeries() {
  app.innerHTML = `
    <section class="section" style="padding: 20px 4%;">
      <div class="section-head"><h2>Todas las Series</h2><span class="muted">${DB.series.length}</span></div>
      <div class="grid">${DB.series.map(card).join('')}</div>
    </section>
  `;
}

function listByStatus(statusKeyword, titleText) {
  const filtered = DB.series.filter(s => (s.status || '').toLowerCase().includes(statusKeyword.toLowerCase()));
  app.innerHTML = `
    <section class="section" style="padding: 20px 4%;">
      <div class="section-head"><h2>${titleText}</h2><span class="muted">${filtered.length}</span></div>
      <div class="grid">${filtered.length ? filtered.map(card).join('') : '<p style="color:#888;">No hay elementos en esta categoría.</p>'}</div>
    </section>
  `;
}

function listMovies() {
  const movies = DB.series.filter(s => (s.type || '').toLowerCase() === 'movie' || (s.title || '').toLowerCase().includes('película'));
  app.innerHTML = `
    <section class="section" style="padding: 20px 4%;">
      <div class="section-head"><h2>Películas</h2><span class="muted">${movies.length}</span></div>
      <div class="grid">${movies.length ? movies.map(card).join('') : '<p style="color:#888;">No hay películas disponibles por el momento.</p>'}</div>
    </section>
  `;
}

function listGenres() {
  app.innerHTML = `
    <section class="section" style="padding: 20px 4%;">
      <div class="section-head"><h2>Géneros</h2></div>
      <p style="color: #888;">Sección en desarrollo para explorar por categorías.</p>
    </section>
  `;
}

function search(q = '') {
  if (!document.getElementById('q')) {
    app.innerHTML = `
      <section class="search" style="max-width: 800px; margin: 0 auto; padding: 30px 4%;">
        <h1 style="margin-bottom: 15px; font-size: 24px;">Buscar Donghua</h1>
        <div class="searchbar" style="position: relative; margin-bottom: 25px;">
          <input id="q" type="text" value="${esc(q)}" autocomplete="off" placeholder="Escribe el nombre del donghua..." 
            style="width: 100%; padding: 12px 16px; background: #1a1a1a; border: 1px solid #333; color: #fff; border-radius: 8px; font-size: 16px; outline: none;">
        </div>
        <div id="results" class="grid"></div>
      </section>
    `;

    const input = document.getElementById('q');
    input.addEventListener('input', (e) => updateSearchResults(e.target.value));

    setTimeout(() => {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }, 50);
  }

  updateSearchResults(q);
}

function updateSearchResults(q = '') {
  const container = document.getElementById('results');
  if (!container) return;

  const queryClean = q.trim().toLowerCase();

  if (!queryClean) {
    container.innerHTML = '<p style="color: #888; grid-column: 1/-1;">Escribe para ver sugerencias...</p>';
    return;
  }

  const list = DB.series.filter(s => {
    const title = cleanTitle(s).toLowerCase();
    const words = title.split(' ');
    return title.startsWith(queryClean) || words.some(w => w.startsWith(queryClean)) || title.includes(queryClean);
  });

  if (list.length === 0) {
    container.innerHTML = '<p style="color: #888; grid-column: 1/-1;">No se encontraron donghuas con ese nombre.</p>';
    return;
  }

  container.innerHTML = list.map(card).join('');
}

function detail(slug) {
  const s = DB.series.find(x => (x.slug || x.id) === slug);
  if (!s) return notfound();

  const seasons = DB.seasons.filter(x => x.seriesId === s.id);
  const imgUrl = getSeriesImage(s);
  const title = cleanTitle(s);

  app.innerHTML = `<section class="detail" style="padding: 20px 4%;">
    <div class="detail-top">
      <div class="detail-poster">${imgUrl ? `<img src="${esc(imgUrl)}" alt="${esc(title)}">` : ''}</div>
      <div>
        <div class="eyebrow">${esc(s.status || '')}</div>
        <h1>${esc(title)}</h1>
        <p style="margin-top:10px;">${esc(s.synopsis || 'Sinopsis no disponible.')}</p>
      </div>
    </div>
    <div style="margin-top:30px">
      ${seasons.length ? seasons.map(season => {
        const rawEps = DB.episodes.filter(e => e.seasonId === season.id);
        const epMap = new Map();
        rawEps.forEach(e => {
          if (!epMap.has(e.number)) epMap.set(e.number, e);
        });
        const eps = Array.from(epMap.values()).sort((a, b) => a.number - b.number);

        return `<div class="season" style="margin-bottom:30px; background:#121212; padding:20px; border-radius:8px;">
          <h3 style="color:#00ffcc; margin-bottom:15px; font-size:18px;">${esc(season.title)} <span style="font-size:12px; color:#888;">(${eps.length} episodios)</span></h3>
          <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(70px, 1fr)); gap:10px;">
            ${eps.map(e => `<a class="btn dark" style="padding:10px 5px; text-align:center; font-size:13px;" href="#/episode/${qs(e.slug || e.id)}">Ep. ${e.number}</a>`).join('')}
          </div>
        </div>`;
      }).join('') : '<div class="empty">No hay episodios disponibles.</div>'}
    </div>
  </section>`;
}

function episode(slug) {
  const e = DB.episodes.find(x => (x.slug || x.id) === slug);
  if (!e) return notfound();

  const seasonEps = DB.episodes.filter(x => x.seasonId === e.seasonId).sort((a, b) => a.number - b.number);
  const currentIndex = seasonEps.findIndex(x => x.id === e.id);
  const prevEp = currentIndex > 0 ? seasonEps[currentIndex - 1] : null;
  const nextEp = currentIndex < seasonEps.length - 1 ? seasonEps[currentIndex + 1] : null;

  let current = e.servers?.[0];
  const render = () => {
    const playerEl = document.getElementById('player');
    if (playerEl) {
      playerEl.innerHTML = current?.url
        ? `<iframe src="${esc(current.url)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`
        : '<div class="empty">Servidor no disponible.</div>';
    }
  };

  app.innerHTML = `<section class="detail" style="padding: 20px 4%;">
    <div class="eyebrow">EPISODIO ${e.number}</div>
    <h1 style="font-size:22px; margin-bottom:15px;">${esc(e.title)}</h1>
    <div class="player" id="player"></div>
    <div class="server-tabs" style="margin-top:15px">
      ${(e.servers || []).map((s, i) => `<button class="${i === 0 ? 'active' : ''}" data-i="${i}">${esc(s.name)}</button>`).join('')}
    </div>
    <div style="display:flex; justify-content:space-between; margin-top:20px; gap:10px;">
      ${prevEp ? `<a class="btn dark" href="#/episode/${qs(prevEp.slug || prevEp.id)}">◄ Anterior</a>` : '<button class="btn dark" disabled style="opacity:0.3">◄ Anterior</button>'}
      <a class="btn primary" href="#/series/${qs(e.seriesId)}">☰ Serie</a>
      ${nextEp ? `<a class="btn dark" href="#/episode/${qs(nextEp.slug || nextEp.id)}">Siguiente ►</a>` : '<button class="btn dark" disabled style="opacity:0.3">Siguiente ►</button>'}
    </div>
  </section>`;

  render();
  document.querySelectorAll('.server-tabs button').forEach(b => b.onclick = () => {
    document.querySelectorAll('.server-tabs button').forEach(x => x.classList.remove('active'));
    b.classList.add('active');
    current = e.servers[Number(b.dataset.i)];
    render();
  });
}

function notfound() { app.innerHTML = '<section class="empty"><h2>No encontrado</h2></section>'; }

// --- ENRUTADOR PRINCIPAL ---
function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const type = p[0], arg = p[1];
  
  if (!type) return home();
  if (type === 'search') return search(arg || '');
  if (type === 'series' && !arg) return listAllSeries();
  if (type === 'series' && arg) return detail(arg);
  if (type === 'airing') return listByStatus('emisión', 'Donghuas En Emisión');
  if (type === 'completed') return listByStatus('finaliz', 'Donghuas Finalizados');
  if (type === 'movies') return listMovies();
  if (type === 'genres') return listGenres();
  if (type === 'episode') return episode(arg);
  
  return home();
}

// Configuración de eventos globales (Cambio de ruta y Botón de Recarga)
window.addEventListener('hashchange', route);

document.addEventListener('DOMContentLoaded', () => {
  const reloadBtn = document.getElementById('reloadBtn');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', async () => {
      reloadBtn.style.transform = 'rotate(360deg)';
      reloadBtn.style.transition = 'transform 0.5s ease';
      
      await load();
      
      setTimeout(() => {
        reloadBtn.style.transform = 'none';
      }, 500);
    });
  }
});

load();
