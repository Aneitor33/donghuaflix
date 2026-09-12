console.log("%c DonghuaFlix — Creado por @bledark__ ", "background: #111; color: #00ffcc; font-size: 14px; font-weight: bold;");

let DB = { series: [], seasons: [], episodes: [], movies: [], genres: [], meta: {} };
const app = document.getElementById('app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const sortTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'es');
const qs = s => encodeURIComponent(s || '');

async function load() {
  app.innerHTML = '<section class="section"><div class="grid">' + Array(8).fill('<div class="skeleton"></div>').join('') + '</div></section>';
  try {
    const r = await fetch('./public/data/catalog.json?ts=' + Date.now());
    DB = await r.json();
    document.getElementById('footerStatus').innerHTML = `
      ${DB.meta.syncedAt ? `Última actualización: ${new Date(DB.meta.syncedAt).toLocaleString('es-ES')}` : 'Catálogo listo'}<br>
      <span style="opacity: 0.85; font-size: 12px; margin-top: 4px; display: inline-block;">
        Desarrollado con ❤️ por <a href="https://instagram.com/bledark__" target="_blank" rel="noopener" style="color: #00ffcc; text-decoration: none; font-weight: 600;">@bledark__</a>
      </span>
    `;
    route();
  } catch (err) {
    app.innerHTML = '<section class="empty"><h2>Error al cargar el catálogo</h2><p>Ejecuta la sincronización en GitHub para generar catalog.json</p></section>';
  }
}

function card(s) {
  const displayTitle = (!s.title || s.title.toLowerCase() === 'temporadas') ? (s.originalTitle || s.name || 'Donghua') : s.title;
  return `<article class="card" onclick="location.hash='#/series/${qs(s.slug || s.id)}'">
    <div class="poster">
      ${s.image ? `<img loading="lazy" src="${esc(s.image)}" alt="${esc(displayTitle)}">` : ''}
      <span class="badge">${esc(s.status || 'DONGHUA')}</span>
    </div>
    <h3 style="color:#ffffff; font-weight:600; font-size:14px; margin-top:8px;">${esc(displayTitle)}</h3>
    <div class="meta" style="color:#a0a0a0; font-size:12px;">${esc(s.originalTitle || s.releaseDate || '')}</div>
  </article>`;
}

function rail(title, list) {
  if (!list.length) return '';
  return `<section class="section"><div class="section-head"><h2>${esc(title)}</h2><span class="muted">${list.length}</span></div><div class="rail">${list.map(card).join('')}</div></section>`;
}

function home() {
  const recent = DB.series.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  const hero = recent[0];
  const heroTitle = (!hero?.title || hero?.title.toLowerCase() === 'temporadas') ? 'DonghuaFlix' : hero.title;

  app.innerHTML = `<section class="hero" style="--hero:url('${esc(hero?.image || '')}')">
    <div class="hero-content">
      <div class="eyebrow">DONGHUAFLIX EXCLUSIVE</div>
      <h1>${esc(heroTitle)}</h1>
      <p>${esc(hero?.synopsis || 'Disfruta del mejor catálogo de animación china en alta calidad.')}</p>
      <div class="buttons">
        ${hero ? `<button class="btn primary" onclick="location.hash='#/series/${qs(hero.slug || hero.id)}'">▶ Ver ficha</button>` : ''}
        <button class="btn dark" onclick="location.hash='#/series'">Catálogo completo</button>
      </div>
    </div>
  </section>
  ${rail('Novedades', recent.slice(0, 12))}
  ${rail('En emisión', DB.series.filter(s => /emisión/i.test(s.status || '')).slice(0, 12))}
  ${rail('Finalizadas', DB.series.filter(s => /finalizado/i.test(s.status || '')).slice(0, 12))}`;
}

function seriesPage(list = DB.series, title = 'Series') {
  const arr = list.slice().sort(sortTitle);
  app.innerHTML = `<section class="section"><div class="section-head"><h2>${esc(title)}</h2><span class="muted">${arr.length} títulos</span></div><div class="grid">${arr.map(card).join('')}</div></section>`;
}

function detail(slug) {
  const s = DB.series.find(x => (x.slug || x.id) === slug);
  if (!s) return notfound();

  const displayTitle = (!s.title || s.title.toLowerCase() === 'temporadas') ? (s.originalTitle || 'Serie') : s.title;
  const seasons = DB.seasons.filter(x => x.seriesId === s.id);

  app.innerHTML = `<section class="detail">
    <div class="detail-top">
      <div class="detail-poster">${s.image ? `<img src="${esc(s.image)}" alt="${esc(displayTitle)}">` : ''}</div>
      <div>
        <div class="eyebrow">${esc(s.status || '')}</div>
        <h1>${esc(displayTitle)}</h1>
        <div class="chips" style="margin:15px 0">${(s.genres || []).map(g => `<span class="chip" onclick="location.hash='#/genre/${qs(g)}'">${esc(g)}</span>`).join('')}</div>
        <p>${esc(s.synopsis || 'Sinopsis no disponible.')}</p>
      </div>
    </div>
    <div style="margin-top:40px">
      <h2>Temporadas</h2>
      ${seasons.length ? seasons.map(season => {
        const eps = DB.episodes.filter(e => e.seasonId === season.id).sort((a, b) => (a.number || 0) - (b.number || 0));
        return `<div class="season" style="margin-bottom:25px;">
          <div class="section-head">
            <h3>${esc(season.title)}</h3>
            <span class="muted">${eps.length} episodios</span>
          </div>
          <div class="episode-list">${eps.map(e => `<a class="episode" href="#/episode/${qs(e.slug || e.id)}"><span>${esc(e.title)}</span><span>Ep. ${e.number ?? ''}</span></a>`).join('')}</div>
        </div>`;
      }).join('') : '<div class="empty">No hay temporadas asociadas.</div>'}
    </div>
  </section>`;
}

function episode(slug) {
  const e = DB.episodes.find(x => (x.slug || x.id) === slug);
  if (!e) return notfound();

  const seasonEps = DB.episodes.filter(x => x.seasonId === e.seasonId).sort((a, b) => (a.number || 0) - (b.number || 0));
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
    <div class="eyebrow">EPISODIO ${e.number ?? ''}</div>
    <h1 style="font-size:26px">${esc(e.title)}</h1>
    <div class="player" id="player"></div>
    <div class="server-tabs" style="margin-top:15px">
      ${(e.servers || []).map((s, i) => `<button class="${i === 0 ? 'active' : ''}" data-i="${i}">${esc(s.name)}</button>`).join('')}
    </div>
    <div style="display:flex; justify-content:space-between; margin-top:20px; gap:10px; flex-wrap:wrap;">
      ${prevEp ? `<a class="btn dark" href="#/episode/${qs(prevEp.slug || prevEp.id)}">◄ Ep. Anterior</a>` : '<button class="btn dark" disabled style="opacity:0.3">◄ Anterior</button>'}
      <a class="btn primary" href="#/series/${qs(e.seriesId)}">☰ Ver Serie</a>
      ${nextEp ? `<a class="btn dark" href="#/episode/${qs(nextEp.slug || nextEp.id)}">Ep. Siguiente ►</a>` : '<button class="btn dark" disabled style="opacity:0.3">Siguiente ►</button>'}
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

function search(q = '') {
  const list = DB.series.filter(s => [s.title, s.synopsis, ...(s.genres || [])].join(' ').toLowerCase().includes(q.toLowerCase()));
  app.innerHTML = `<section class="search">
    <h1>Buscar Donghua</h1>
    <div class="searchbar"><input id="q" value="${esc(q)}" autofocus placeholder="Buscar serie o género..."></div>
    <div style="margin-top:30px" class="grid">${list.map(card).join('')}</div>
  </section>`;
  document.getElementById('q').oninput = e => search(e.target.value);
}

function notfound() { app.innerHTML = '<section class="empty"><h2>Contenido no encontrado</h2></section>'; }

function route() {
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const type = p[0], arg = p[1];
  if (!type) return home();
  if (type === 'series' && !arg) return seriesPage();
  if (type === 'series' && arg) return detail(arg);
  if (type === 'episode') return episode(arg);
  if (type === 'search') return search(arg || '');
  return home();
}

document.getElementById('searchBtn').onclick = () => location.hash = '#/search';
window.addEventListener('hashchange', route);
load();
