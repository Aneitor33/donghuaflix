// ══════════════════════════════════════════════════════════
//  dfx-boot.js — DonghuaFlix · Fase 0 (arranque y contrato)
//  Se carga DESPUÉS de app.js, dfx-core.js y dfx-polish.js.
//  1) Unifica la API pública de toasts (DFX.toast → showToast).
//  2) Verifica el contrato de globals entre el núcleo y las
//     capas Pro, avisando en consola si falta algo.
//  3) Expone DFX.boot para diagnóstico.
// ══════════════════════════════════════════════════════════
(function () {
  'use strict';

  const DFX = window.DFX = window.DFX || {};

  /* 1) API pública de toast unificada: todo lo que las capas Pro
     expongan como DFX.toast acaba en el toast del núcleo. */
  DFX.toast = function (msg) {
    try { window.showToast(String(msg)); } catch (e) {}
  };

  /* 2) Contrato de globals: app.js expone su estado vía
     defineProperty (parche Fase 0). Si falta algo, lo decimos
     claramente en consola en vez de fallar en silencio. */
  const CONTRACT = [
    ['DB', 'app.js · parche Fase 0 (defineProperty)'],
    ['currentEpisode', 'app.js · parche Fase 0'],
    ['detailState', 'app.js · parche Fase 0'],
    ['autoNextEnabled', 'app.js · parche Fase 0'],
    ['SRC_LABEL', 'app.js · parche Fase 0'],
    ['getSeriesImage', 'app.js · parche Fase 0'],
    ['findSeries', 'app.js · parche Fase 0'],
    ['cleanTitle', 'app.js · parche Fase 0'],
    ['seriesGenres', 'app.js · parche Fase 0'],
    ['route', 'app.js'],
    ['home', 'app.js'],
    ['episode', 'app.js'],
    ['toggleFav', 'app.js'],
    ['toggleWatched', 'app.js'],
    ['card', 'app.js'],
    ['showToast', 'app.js']
  ];

  const missing = CONTRACT.filter(function (c) { return !(c[0] in window); });
  if (missing.length) {
    console.warn('[dfx-boot] Faltan globals del contrato: ' +
      missing.map(function (m) { return m[0] + ' → ' + m[1]; }).join(' | '));
  }

  DFX.boot = { phase: 0, at: Date.now(), missing: missing.map(function (m) { return m[0]; }) };
})();
