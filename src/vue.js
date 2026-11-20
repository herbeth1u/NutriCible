// src/vue.js
// Point d'entrée unique de Vue pour toute l'application.
// Charge la copie vendorisée (vendor/vue.esm-browser.prod.js, voir vendor/VERSIONS.md).
// Tant que ce fichier n'a pas été ajouté au dépôt, repli sur le même build servi par un CDN, épinglé
// à la version exacte : le site fonctionne dès le premier déploiement.
let V;
try {
  V = await import('../vendor/vue.esm-browser.prod.js');
} catch (e) {
  console.warn('vendor/vue.esm-browser.prod.js introuvable : repli sur le CDN épinglé (voir vendor/VERSIONS.md).', e);
  V = await import('https://cdn.jsdelivr.net/npm/vue@3.5.44/dist/vue.esm-browser.prod.js');
}
export const { createApp, reactive, computed, watch, ref, nextTick, onMounted, onBeforeUnmount } = V;
