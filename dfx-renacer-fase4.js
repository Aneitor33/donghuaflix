/*
 * DonghuaFlix — Renacer Fase 4
 * Mi universo: lista + progreso + historial + actividad + estadísticas + insignias.
 * Additive: no modifica app.js, dfx-core.js, Firebase ni las claves existentes.
 */
(()=>{
  'use strict';
  if(window.__DFX_RENACER_F4__) return;
  window.__DFX_RENACER_F4__=true;

  const CFG={
    route:'tu-donghuaflix',
    cssId:'dfx4css',
    maxCards:24,
    indexes:{
      donghualife:'./public/data/catalog-donghualife-index.json',
      donghuasub:'./public/data/catalog-donghuasub-index.json',
      donghuaworld:'./public/data/catalog-donghuaworld-index.json',
      peliculas:'./public/data/catalog-peliculas-index.json',
      doramas:'./public/data/catalog-doramas-index.json'
    }
  };
  const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
  const esc=s=>String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const fold=s=>String(s||'').normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase();
  const clean=s=>String(s||'').replace(/[-_]+/g,' ').replace(/\s+/g,' ').trim();
  const read=(k,d)=>{try{const x=JSON.parse(localStorage.getItem(k));return x??d}catch{return d}};
  const write=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch{}};
  const hist=()=>read('donghuaflix_history',{});
  const favs=()=>read('donghuaflix_favs',[]);
  const watched=()=>read('donghuaflix_watched',{});
  const profile=()=>window.DFX?.current||read('dfx_current',null);
  const toast=m=>{try{window.DFX?.toast?window.DFX.toast(m):window.showToast?.(m)}catch{}};
  const title=s=>clean(s?.title||s?.name||s?.slug||'Sin título');
  const slug=s=>String(s?.slug||s?.id||'').toLowerCase();
  const img=s=>{try{return window.getSeriesImage?.(s)||s?.image||s?.poster||''}catch{return s?.image||s?.poster||''}};
  const genres=s=>{try{const g=window.seriesGenres?.(s);if(Array.isArray(g))return g.map(clean).filter(Boolean)}catch{}const g=s?.genres||s?.genre||[];return(Array.isArray(g)?g:String(g).split(',')).map(clean).filter(Boolean)};
  const favId=x=>String(typeof x==='string'?x:(x?.id||x?.slug||'')).toLowerCase();
  const favSet=()=>new Set(favs().map(favId));
  const currentCat=()=>localStorage.getItem('donghuaflix_catalog')||'donghualife';
  const cache=new Map();

  function injectCss(){
    if($('#'+CFG.cssId)) return;
    const l=document.createElement('link');l.id=CFG.cssId;l.rel='stylesheet';l.href='dfx-renacer-fase4.css';document.head.appendChild(l);
  }

  async function loadIndex(id){
    if(cache.has(id))return cache.get(id);
    const url=CFG.indexes[id];
    if(!url)return [];
    try{
      const r=await fetch(url,{cache:'default'});if(!r.ok)throw 0;
      const d=await r.json();
      const gs=d.genres||[],ib=d.imageBase||'';
      const rows=(d.series||[]).map(x=>d.compact?{
        id:x.i,slug:x.s,title:x.t,image:x.p?(x.p.startsWith('http')||x.p.startsWith('./')||x.p.startsWith('/')?x.p:ib+x.p):'',
        genres:(x.g||[]).map(n=>gs[n]).filter(Boolean),status:x.st||'',type:x.ty||'',year:x.y||'',country:x.c||'',totalEpisodes:x.e??0,updatedAt:x.u||''
      }:x);
      cache.set(id,rows);return rows;
    }catch{return []}
  }

  async function catalogPool(){
    const active=currentCat();
    const first=await loadIndex(active);
    /* Solo amplía a otros catálogos si hay actividad que no pudo resolverse localmente. */
    const h=hist(),f=favs(),keys=new Set([...Object.keys(h),...f.map(favId)]);
    const found=new Set(first.map(x=>String(x.id||x.slug).toLowerCase()));
    if([...keys].some(k=>!found.has(String(k).toLowerCase()))){
      const ids=Object.keys(CFG.indexes).filter(x=>x!==active);
      const rest=await Promise.all(ids.map(loadIndex));
      return [first,...rest].flat();
    }
    return first;
  }

  function resolveSeries(pool,id){
    const k=String(id||'').toLowerCase();
    return pool.find(s=>String(s.id||'').toLowerCase()===k||slug(s)===k)||null;
  }

  function watchedCount(){
    let n=0;for(const seasons of Object.values(watched()))if(seasons&&typeof seasons==='object')n+=Object.keys(seasons).filter(k=>seasons[k]).length;return n;
  }

  function historyRows(pool){
    const h=hist();
    return Object.entries(h).map(([id,v])=>({id,v,s:resolveSeries(pool,id)})).filter(x=>x.s).sort((a,b)=>(b.v?.timestamp||0)-(a.v?.timestamp||0));
  }

  function progressFor(s){
    /* Si app.js ya tiene una implementación global y devuelve un valor fiable, reutilízala. */
    try{if(typeof window.seriesProgress==='function'){const p=Number(window.seriesProgress(s));if(Number.isFinite(p)&&p>=0)return p}}catch{}
    const h=hist()[s.id];
    const total=Number(s.totalEpisodes||s.episodesCount||s.episodeCount||0);
    if(!total||!h)return 0;
    return Math.max(0,Math.min(100,Math.round((Number(h.episodeNumber||0)/total)*100)));
  }

  function startedRows(pool){
    return historyRows(pool);
  }

  function completedRows(rows){return rows.filter(x=>progressFor(x.s)>=100)}

  function recommendations(pool,rows){
    const excluded=new Set(rows.map(x=>slug(x.s)).concat(favs().map(favId)));
    const bases=rows.slice(0,5).flatMap(x=>genres(x.s).map(fold));
    const favSeries=favs().map(id=>resolveSeries(pool,favId(id))).filter(Boolean);
    bases.push(...favSeries.flatMap(s=>genres(s).map(fold)));
    const score=s=>genres(s).reduce((n,g)=>n+(bases.includes(fold(g))?1:0),0);
    return pool.filter(s=>slug(s)&&!excluded.has(slug(s))).map(s=>({s,n:score(s)})).sort((a,b)=>b.n-a.n||(String(b.updatedAt).localeCompare(String(a.updatedAt)))).slice(0,8).map(x=>x.s);
  }

  function activity(rows){
    const out=[];
    rows.slice(0,10).forEach(x=>{if(x.v?.timestamp)out.push({t:x.v.timestamp,html:`<span class="dfx4actIcon">▶</span> <b>Continúas</b> ${esc(title(x.s))} · episodio ${esc(x.v.episodeNumber??'?')}`})});
    favs().slice().reverse().slice(0,8).forEach(f=>{const s=rows.find(x=>favId(f)===slug(x.s))?.s;if(s)out.push({t:0,html:`<span class="dfx4actIcon">♡</span> <b>En Mi lista</b> ${esc(title(s))}`})});
    return out.sort((a,b)=>b.t-a.t).slice(0,10);
  }

  function stats(pool,rows,completed){
    const genresMap=new Map();
    rows.forEach(x=>genres(x.s).forEach(g=>genresMap.set(g,(genresMap.get(g)||0)+1)));
    const top=[...genresMap.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4);
    const badges=Object.keys(window.DFX?.badge||{}).filter(k=>k.startsWith(String(profile())+':')).length;
    return {watched:watchedCount(),started:rows.length,completed:completed.length,favs:favs().length,badges,top};
  }

  function badgeRows(){
    const b=window.DFX?.badge||{};const prefix=String(profile())+':';
    const names={first:'Primera vez',fan5:'Fan · 50 caps',fan10:'Fan · 100 caps',fan25:'Fan · 250 caps',fan50:'Fan · 500 caps',fan100:'Leyenda · 1000 caps',marathon5:'Maratón ×5',marathon10:'Maratón ×10',marathon25:'Maratón ×25',genres5:'Explorador',list20:'Coleccionista',genres10:'Trotamundos'};
    return Object.entries(b).filter(([k])=>k.startsWith(prefix)).map(([k,v])=>({id:k.slice(prefix.length),name:names[k.slice(prefix.length)]||k.slice(prefix.length),at:v})).sort((a,b)=>b.at-a.at);
  }

  function card(s,rows){
    const h=hist()[s.id],p=progressFor(s),isf=favSet().has(String(s.id).toLowerCase());
    const ep=h?.episodeNumber;
    return `<article class="dfx4card" data-id="${esc(s.id)}"><button class="dfx4fav ${isf?'on':''}" data-fav="${esc(s.id)}" aria-label="${isf?'Quitar de Mi lista':'Añadir a Mi lista'}">${isf?'♥':'♡'}</button><img loading="lazy" src="${esc(img(s))}" alt="${esc(title(s))}" onerror="this.style.display='none'"><div class="dfx4cardBody"><b>${esc(title(s))}</b><span>${ep?`Episodio ${esc(ep)}`:''}${p>0?`${ep?' · ':''}${p}%`:''}</span><i><em style="width:${p}%"></em></i></div></article>`;
  }

  function navTo(s){location.hash='#/series/'+encodeURIComponent(s.slug||s.id)}
  function bindCards(root,pool,rows){
    $$('.dfx4card',root).forEach(el=>{
      el.onclick=e=>{if(e.target.closest('[data-fav]'))return;const s=resolveSeries(pool,el.dataset.id);if(s)navTo(s)};
      const f=$('[data-fav]',el);if(f)f.onclick=e=>{e.stopPropagation();if(typeof window.toggleFav==='function')window.toggleFav(el.dataset.id);else{const a=favs(),i=a.findIndex(x=>favId(x)===String(el.dataset.id).toLowerCase());i>=0?a.splice(i,1):a.push(el.dataset.id);write('donghuaflix_favs',a)}render()};
    });
  }

  function renderSkeleton(){
    const app=$('#app');if(!app)return;app.innerHTML=`<section class="dfx4 page-top"><div class="dfx4loading"><span></span><span></span><span></span></div></section>`;
  }

  async function render(){
    injectCss();renderSkeleton();
    const pool=await catalogPool(),rows=historyRows(pool),done=completedRows(rows),st=stats(pool,rows,done),recs=recommendations(pool,rows),acts=activity(rows),badges=badgeRows();
    const profObj=(()=>{try{return (window.DFX?.profiles||[]).find(p=>p.id===profile())}catch{return null}})();
    const name=profObj?.name||'Tu DonghuaFlix';
    const recent=rows.slice(0,10),list=favs().map(x=>resolveSeries(pool,favId(x))).filter(Boolean),started=rows.filter(x=>!done.includes(x));
    const cold=rows.length===0&&favs().length===0;
    const cta=`<section class="dfx4section"><div style="text-align:center;padding:28px 16px;border:1px dashed rgba(255,255,255,.2);border-radius:16px"><h2 style="margin:0 0 8px">Empieza a construir tu historia</h2><p style="margin:0 0 16px;color:#9a9aa5">Ver un episodio o guardar un título activa recomendaciones, progreso e insignias.</p><a href="#/series" style="display:inline-block;margin:4px;padding:10px 18px;border-radius:999px;background:#fff;color:#000;font-weight:700;text-decoration:none">Explorar catálogo</a><a href="#/descubrir" style="display:inline-block;margin:4px;padding:10px 18px;border-radius:999px;border:1px solid rgba(255,255,255,.3);color:#fff;text-decoration:none">Descubrir</a></div></section>`;
    const genre=st.top.map(x=>`<span>${esc(x[0])} <b>${x[1]}</b></span>`).join('');
    const activityHtml=acts.length?acts.map(x=>`<div class="dfx4activity">${x.html}</div>`).join(''):`<div class="dfx4empty">Todavía no hay actividad suficiente. Empieza un episodio o añade un título a Mi lista.</div>`;
    const badgesHtml=badges.length?badges.map(b=>`<div class="dfx4badge"><strong>✓</strong><span>${esc(b.name)}</span></div>`).join(''):`<div class="dfx4empty">Tus insignias aparecerán aquí a medida que uses DonghuaFlix.</div>`;
    const recHtml=recs.length?recs.map(s=>card(s,rows)).join(''):`<div class="dfx4empty">Necesitas un poco más de actividad para personalizar recomendaciones.</div>`;
    const favHtml=list.length?list.slice(0,CFG.maxCards).map(s=>card(s,rows)).join(''):`<div class="dfx4empty">Tu lista está vacía. Usa el corazón de una ficha para añadir títulos.</div>`;
    const startedHtml=started.length?started.slice(0,CFG.maxCards).map(x=>card(x.s,rows)).join(''):`<div class="dfx4empty">Aquí aparecerán las series que empieces.</div>`;
    const doneHtml=done.length?done.slice(0,CFG.maxCards).map(x=>card(x.s,rows)).join(''):`<div class="dfx4empty">Todavía no has completado una serie registrada.</div>`;
    const recentHtml=recent.length?recent.slice(0,CFG.maxCards).map(x=>card(x.s,rows)).join(''):`<div class="dfx4empty">No hay historial todavía.</div>`;
    const continueHtml=recent[0]?`<button class="dfx4continue" data-continue="${esc(recent[0].v.episodeId||'')}"><span>CONTINUAR</span><b>${esc(title(recent[0].s))}</b><small>Episodio ${esc(recent[0].v.episodeNumber??'?')}</small></button>`:`<div class="dfx4continue empty"><span>TU UNIVERSO</span><b>Empieza a construir tu historial</b><small>Tu actividad aparecerá aquí.</small></div>`;
    $('#app').innerHTML=`<section class="dfx4 page-top"><header class="dfx4head"><div><div class="dfx4eyebrow">DONGHUAFLIX · TU UNIVERSO</div><h1>${esc(name)}</h1><p>Todo lo que estás viendo, siguiendo y descubriendo, en un solo lugar.</p></div><button class="dfx4refresh" id="dfx4refresh">Actualizar</button></header>
      <div class="dfx4hero">${continueHtml}<div class="dfx4stats"><div><b>${st.watched}</b><span>Episodios vistos</span></div><div><b>${st.started}</b><span>Series empezadas</span></div><div><b>${st.completed}</b><span>Series terminadas</span></div><div><b>${st.favs}</b><span>Mi lista</span></div><div><b>${st.badges}</b><span>Insignias</span></div></div></div>
      <section class="dfx4section"><div class="dfx4title"><h2>Actividad reciente</h2></div><div class="dfx4activityGrid">${activityHtml}</div></section>
      <section class="dfx4section"><div class="dfx4title"><h2>Mi lista</h2><span>${list.length}</span></div><div class="dfx4grid">${favHtml}</div></section>
      ${cold?cta:`<section class="dfx4section"><div class="dfx4title"><h2>Continuando</h2><span>${started.length}</span></div><div class="dfx4grid">${startedHtml}</div></section>
      <section class="dfx4section"><div class="dfx4title"><h2>Terminadas</h2><span>${done.length}</span></div><div class="dfx4grid">${doneHtml}</div></section>
      <section class="dfx4section"><div class="dfx4title"><h2>Historial</h2><span>${rows.length}</span></div><div class="dfx4grid">${recentHtml}</div></section>
      <section class="dfx4section"><div class="dfx4title"><h2>Porque viste esto</h2></div><div class="dfx4grid">${recHtml}</div></section>
      <section class="dfx4section"><div class="dfx4split"><div><div class="dfx4title"><h2>Tus géneros</h2></div><div class="dfx4genres">${genre||'<span>Sin suficientes datos todavía.</span>'}</div></div><div><div class="dfx4title"><h2>Insignias</h2></div><div class="dfx4badges">${badgesHtml}</div></div></div></section>`}
      <div class="dfx4foot">Catálogo activo: <b>${esc(currentCat())}</b> · Los datos personales se reutilizan desde tus sistemas actuales.</div>
    </section>`;
    bindCards($('#app'),pool,rows);
    $('#dfx4refresh')?.addEventListener('click',()=>{cache.clear();render()});
    $('[data-continue]')?.addEventListener('click',e=>{const id=e.currentTarget.dataset.continue;if(id)location.hash='#/episode/'+encodeURIComponent(id);else if(recent[0])navTo(recent[0].s)});
  }

  function installRoute(){
    const wait=()=>{const r=window.route;if(typeof r!=='function')return setTimeout(wait,150);if(r.__dfx4)return;const wrap=function(){const p=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);if(p[0]===CFG.route||p[0]==='perfil')return render();return r.apply(this,arguments)};wrap.__dfx4=true;window.route=wrap};wait();
  }
  function nav(){
    const top=$('.nav nav');if(top&&!$('#dfx4Nav')){const a=document.createElement('a');a.id='dfx4Nav';a.href='#/'+CFG.route;a.dataset.nav='';a.textContent='Tu DonghuaFlix';top.appendChild(a)}
    const more=$('#moreMenu');if(more&&!$('#dfx4More')){const a=document.createElement('a');a.id='dfx4More';a.href='#/'+CFG.route;a.textContent='Tu DonghuaFlix';more.appendChild(a)}
  }
  function boot(){injectCss();nav();installRoute();addEventListener('hashchange',()=>{nav();if(location.hash.includes(CFG.route)||location.hash.includes('#/perfil'))render()});setTimeout(nav,700);console.info('DonghuaFlix Renacer Fase 4 activa')}
  document.readyState==='loading'?addEventListener('DOMContentLoaded',boot):boot();
})();
