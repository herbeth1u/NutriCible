// src/vue.js
// Point d'entrée unique de Vue pour toute l'application.
// Charge la copie vendorisée (vendor/vue.esm-browser.prod.js, version et empreinte dans vendor/VERSIONS.md).
// Aucun repli réseau : l'application ne dépend d'aucun CDN et se comporte de la même façon hors ligne.
import * as V from '../vendor/vue.esm-browser.prod.js';

export const { createApp, reactive, computed, watch, ref, nextTick, onMounted, onBeforeUnmount } = V;
