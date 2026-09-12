console.log("%c DonghuaFlix — Creado por @bledark__ ", "background: #111; color: #00ffcc; font-size: 14px; font-weight: bold;");

let DB = { series: [], seasons: [], episodes: [], genres: [], meta: {} };
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const qs = s => encodeURIComponent(s || '');

async function load() {
  app.innerHTML = '<section class="section"><div class="grid">' + Array(8).fill('<div class="skeleton"></div>').join('') + '</div></section>';
  try {
    const r = await fetch('./public/data/catalog.json?ts=' + Date.now());
    DB = await r.json();
    document.getElementById('footerStatus').innerHTML = `
      ${DB.meta.syncedAt ? `Actualizado: ${new Date(DB.meta.syncedAt).toLocaleString('es-ES')}` : 'Catálogo listo'}<br>
      <span style="opacity: 0.85; font-size: 12px; margin-top: 4px; display: inline-block;">
        Desarrollado con ❤️ por <a href="https://instagram.com/bledark__" target="_blank" rel="noopener" style="color: #00ffcc; text-decoration: none; font-weight: 600;">@bledark__</a>
      </span>
    `;
    route();
  } catch (err) {
    app.innerHTML = '<section class="empty"><h2>Error al cargar el catálogo</h2></section>';
  }
}

function card(s) {
  return `<article class="card" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
    <div class="poster">
      ${s.image ? `<img loading="lazy" src="${esc(s.image)}" alt="${esc(s.title)}">` : '<div class="no-img">DONGHUA</div>'}
      <span class="badge">${esc(s.status || 'DONGHUA')}</span>
    </div>
    <h3 style="color:#ffffff; font-weight:600; font-size:14px; margin-top:8px;">${esc(s.title)}</h3>
  </article>`;
}

function home() {
  const recent = DB.series.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const hero = recent[0];

  app.innerHTML = `
  <section class="hero" style="--hero:url('${esc(hero?.image || '')}')">
    <div class="hero-content">
      <div class="eyebrow">DONGHUAFLIX EXCLUSIVE</div>
      <h1>${esc(hero?.title || 'DonghuaFlix')}</h1>
      <p>${esc(hero?.synopsis || 'Catálogo de animación china en alta calidad.')}</p>
      <div class="buttons">
        ${hero ? `<button class="btn primary" onclick="location.hash='#/series/${qs(hero.slug || hero.id)}'">▶ Ver serie</button>` : ''}
      </div>
    </div>
  </section>
  <section class="section">
    <div class="section-head"><h2>Catálogo de Series</h2><span class="muted">${DB.series.length}</span></div>
    <div class="grid">${DB.series.map(card).join('')}</div>
  </section>`;
}

function search(q = '') {
  if (!document.getElementById('q')) {
    app.innerHTML = `
      <section class="search" style="max-width: 800px; margin: 0 auto; padding: 20px;">
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
    const title = (s.title || '').toLowerCase();
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

  app.innerHTML = `<section class="detail">
    <div class="detail-top">
      <div class="detail-poster">${s.image ? `<img src="${esc(s.image)}" alt="${esc(s.title)}">` : ''}</div>
      <div>
        <div class="eyebrow">${esc(s.status || '')}</div>
        <h1>${esc(s.title)}</h1>
        <p style="margin-top:10px;">${esc(s.synopsis || 'Sinopsis no disponible.')}</p>
      </div>
    </div>
    <div style="margin-top:30px">
      ${seasons.length ? seasons.map(season => {
        // Desduplicación estricta por número de episodio
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
    document.getElementById('player').innerHTML = current?.url
      ? `<iframe src="${esc(current.url)}" allow="autoplay; fullscreen" allowfullscreen loading="lazy"></iframe>`
      : '<div class="empty">Servidor no disponible.</div>';
  };

  app.innerHTML = `<section class="detail">
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

function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const type = p[0], arg = p[1];
  if (!type) return home();
  if (type === 'search') return search(arg || '');
  if (type === 'series' && arg) return detail(arg);
  if (type === 'episode') return episode(arg);
  return home();
}

window.addEventListener('hashchange', route);
load();
