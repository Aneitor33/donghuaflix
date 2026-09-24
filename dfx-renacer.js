/* =========================================================
   DonghuaFlix — RENACER / UX Enhancer v1
   No sustituye app.js. Observa las vistas existentes y
   mejora su jerarquía visual sin duplicar la lógica.
   ========================================================= */
(function(){
  'use strict';

  const $=(s,r)=>(r||document).querySelector(s);
  const $$=(s,r)=>Array.from((r||document).querySelectorAll(s));

  function isHome(){
    const h=location.hash.replace(/^#\/?/,'').split('/').filter(Boolean);
    return !h.length;
  }

  function enhanceHome(){
    if(!isHome()||!$('#hero')||document.body.dataset.renHome==='1')return;
    document.body.dataset.renHome='1';

    const hero=$('#hero');
    if(hero){
      if(!$('.ren-hero-topline',hero)){
        const line=document.createElement('div');
        line.className='ren-hero-topline';
        line.innerHTML='<span>DONGHUAFLIX</span><i></i><span>DESCUBRE · SIGUE · CONTINÚA</span>';
        hero.appendChild(line);
      }
      if(!$('.ren-hero-scroll',hero)){
        const s=document.createElement('div');
        s.className='ren-hero-scroll';
        s.innerHTML='<span>Explora tu catálogo</span><b>↓</b>';
        hero.appendChild(s);
      }
    }

    const firstSection=$('.hero + .section');
    if(firstSection&&!$('.ren-intro')){
      const intro=document.createElement('section');
      intro.className='ren-intro';
      const count=$$('.card').length;
      intro.innerHTML='<div><span class="ren-intro-kicker">TU CENTRO DE ENTRETENIMIENTO</span><h2>Todo lo que sigues,<br><em>en un solo lugar.</em></h2></div><div class="ren-pills"><span class="ren-pill">'+count.toLocaleString('es-ES')+' elementos visibles</span><span class="ren-pill">Experiencia personalizada</span></div>';
      firstSection.parentNode.insertBefore(intro,firstSection);
    }

    $$('.section').forEach(sec=>{
      if(sec.classList.contains('ren-section'))return;
      sec.classList.add('ren-section');
      const head=$('.section-head',sec);
      if(head&&!$('.ren-kicker',head)){
        const h=$('h2',head);
        if(h){
          const k=document.createElement('span');
          k.className='ren-kicker';
          k.textContent='DONGHUAFLIX';
          h.parentNode.insertBefore(k,h);
        }
      }
    });

    const sections=$$('.section');
    const last=sections.length?sections[sections.length-1]:null;
    if(last&&!$('.ren-discover')){
      const panel=document.createElement('section');
      panel.className='ren-discover';
      panel.innerHTML='<div><span class="ren-kicker">DESCUBRIR</span><h2>Encuentra tu próxima historia.</h2><p>Explora por género, año, país o tipo, o deja que DonghuaFlix elija algo por ti.</p></div><div class="ren-actions"><button class="btn-x play" onclick="location.hash=\'#/series\'"><span>Explorar</span></button><button class="btn-x glass" onclick="window.DFX&&DFX.randomEp&&DFX.randomEp()"><span>Sorpréndeme</span></button></div>';
      last.parentNode.insertBefore(panel,last.nextSibling);
    }

    $$('.section.center').forEach(x=>x.classList.add('ren-end'));
  }

  function reset(){
    delete document.body.dataset.renHome;
    requestAnimationFrame(enhanceHome);
  }

  const observer=new MutationObserver(()=>{
    if(isHome())requestAnimationFrame(enhanceHome);
  });
  observer.observe(document.body,{childList:true,subtree:true});

  window.addEventListener('hashchange',reset);
  window.addEventListener('load',()=>setTimeout(enhanceHome,120));
})();