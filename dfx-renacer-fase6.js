/* DonghuaFlix RENACER — Fase 6: Rendimiento y carga inteligente
 * Capa aditiva. No reemplaza app.js ni modifica sus datos.
 * - Cache de fetch deduplicado en memoria
 * - Prioriza índices ligeros
 * - Lazy images / content-visibility
 * - Prefetch conservador de rutas y detalles
 * - Skeleton/estado de carga
 * - Resource timing básico
 * - Protección contra tareas repetidas
 */
(()=>{'use strict';
const DFX6=window.DFX6=window.DFX6||{};
const nativeFetch=window.fetch.bind(window), inflight=new Map(), cache=new Map(), PREF=new Set();
const TTL=15*60*1000;
const isJSON=u=>/\.json(?:\?|$)/i.test(String(u));
const isSameOrigin=u=>{try{return new URL(u,location.href).origin===location.origin}catch{return false}};
const keyOf=(input,init)=>{let u=typeof input==='string'?input:input?.url||'';return new URL(u,location.href).href+'|'+(init?.method||'GET').toUpperCase()};
function shouldCache(input,init){let m=(init?.method||'GET').toUpperCase();return m==='GET'&&isSameOrigin(typeof input==='string'?input:input?.url||'')&&isJSON(typeof input==='string'?input:input?.url||'')}
window.fetch=async function(input,init={}){
 if(!shouldCache(input,init))return nativeFetch(input,init);
 const key=keyOf(input,init),now=Date.now(),hit=cache.get(key);
 if(hit&&now-hit.t<TTL)return hit.response.clone();
 if(inflight.has(key))return (await inflight.get(key)).clone();
 const p=nativeFetch(input,init).then(r=>{if(r.ok)cache.set(key,{t:Date.now(),response:r.clone()});return r}).finally(()=>inflight.delete(key));
 inflight.set(key,p);return (await p).clone();
};
DFX6.clearCache=()=>{cache.clear()};
DFX6.stats=()=>({jsonCache:cache.size,inflight:inflight.size,connection:navigator.connection?.effectiveType||'unknown',saveData:!!navigator.connection?.saveData});
function idle(fn,timeout=1200){if('requestIdleCallback'in window)return requestIdleCallback(fn,{timeout});return setTimeout(fn,Math.min(timeout,600))}
function lazyImages(root=document){root.querySelectorAll('img:not([data-dfx6])').forEach(img=>{img.dataset.dfx6='1';if(!img.loading)img.loading='lazy';img.decoding='async';});}
function observeImages(){lazyImages();if(!('IntersectionObserver'in window))return;const io=new IntersectionObserver(es=>es.forEach(e=>{if(!e.isIntersecting)return;const im=e.target;if(im.dataset.src&&!im.src)im.src=im.dataset.src;io.unobserve(im)}),{rootMargin:'300px 0px'});document.querySelectorAll('img[data-src]').forEach(im=>io.observe(im));}
function prefetch(url){if(!url||PREF.has(url)||PREF.size>=3||navigator.connection?.saveData)return;try{const u=new URL(url,location.href);if(u.origin!==location.origin)return;PREF.add(u.href);const l=document.createElement('link');l.rel='prefetch';l.href=u.href;l.as='document';document.head.appendChild(l)}catch{}}
function routePrefetch(){document.addEventListener('pointerover',e=>{const a=e.target.closest?.('a[href]');if(a&&a.href&&a.origin===location.origin)prefetch(a.href)}, {passive:true});document.addEventListener('touchstart',e=>{const a=e.target.closest?.('a[href]');if(a&&a.href&&a.origin===location.origin)prefetch(a.href)}, {passive:true});}
function skeletonObserver(){if(!('MutationObserver'in window))return;let scheduled=false;const run=()=>{scheduled=false;lazyImages(document);document.querySelectorAll('.card,.episode,.section,.rail').forEach(x=>x.style.contentVisibility='auto')};const mo=new MutationObserver(()=>{if(scheduled)return;scheduled=true;idle(run,500)});mo.observe(document.getElementById('app')||document.body,{childList:true,subtree:true});}
function perf(){if(!window.performance?.getEntriesByType)return;idle(()=>{const nav=performance.getEntriesByType('navigation')[0];const paints=performance.getEntriesByType('paint');DFX6.metrics={domContentLoaded:nav?.domContentLoadedEventEnd||0,load:nav?.loadEventEnd||0,firstPaint:paints.find(x=>x.name==='first-paint')?.startTime||0,firstContentfulPaint:paints.find(x=>x.name==='first-contentful-paint')?.startTime||0};document.documentElement.dataset.dfx6Perf='ready'},2500)}
function loading(){document.documentElement.classList.add('dfx6-ready');const app=document.getElementById('app');if(!app)return;const mo=new MutationObserver(()=>{app.classList.remove('dfx6-loading')});app.classList.add('dfx6-loading');mo.observe(app,{childList:true});setTimeout(()=>app.classList.remove('dfx6-loading'),5000)}
function boot(){observeImages();routePrefetch();skeletonObserver();perf();loading();idle(observeImages,900);DFX6.version='6.0.0';}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();
})();
