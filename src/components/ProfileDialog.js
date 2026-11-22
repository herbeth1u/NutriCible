// src/components/ProfileDialog.js — « Mon profil ».
// Données personnelles : saisies ici, sauvegardées UNIQUEMENT dans ce navigateur (localStorage), jamais dans le projet.
import { computed, reactive } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Modal from './Modal.js';

const NUM = ['age', 'heightCm', 'weightKg', 'weightMinKg', 'weightMaxKg', 'restingKcal', 'longActiveKcal'];

export default {
  components: { Modal },
  emits: ['close'],
  setup(_, { emit }) {
    const f = reactive({ ...C.emptyProfile(), ...S.state.user.profile });
    const out = () => ({ sex: f.sex, ...Object.fromEntries(NUM.map((k) => [k, f[k] === '' || f[k] === null || f[k] === undefined || !(+f[k] > 0) ? null : +f[k]])) });
    const status = computed(() => C.profileStatus(out()));
    const rest = computed(() => (status.value.complete ? C.restKcal(out(), S.config.value.calc) : null));
    const rangeError = computed(() => { const p = out(); return p.weightMinKg && p.weightMaxKg && p.weightMinKg > p.weightMaxKg ? 'Le poids minimum dépasse le poids maximum.' : ''; });
    const save = () => { if (rangeError.value) return; S.saveProfile(out()); S.toast('Profil enregistré dans ce navigateur : les cibles sont recalculées.'); emit('close'); };
    const clear = () => { if (window.confirm('Effacer ton profil de ce navigateur ?')) { S.saveProfile(C.emptyProfile()); emit('close'); } };
    return { f, status, rest, rangeError, save, clear, kcal: C.fmtKcal, long: computed(() => S.config.value.outings.find((o) => o.maxKcal === null)) };
  },
  template: `
    <modal title="Mon profil" @close="$emit('close')">
      <p class="notice">Ces informations restent <b>uniquement dans ton navigateur</b> : elles ne sont jamais écrites dans le projet ni dans l'export Notion. Elles servent à calculer tes cibles.</p>
      <form class="form" @submit.prevent="save">
        <div class="grid2">
          <label>Sexe <select v-model="f.sex"><option value="">Non renseigné</option><option value="M">Homme</option><option value="F">Femme</option></select></label>
          <label>Âge (ans) <input type="number" min="10" max="110" step="1" v-model="f.age"></label>
          <label>Taille (cm) <input type="number" min="100" max="230" step="1" v-model="f.heightCm"></label>
          <label>Poids (kg) <input type="number" min="30" max="250" step="0.1" v-model="f.weightKg"></label>
          <label>Poids cible minimum (kg, facultatif) <input type="number" min="30" max="250" step="0.1" v-model="f.weightMinKg"></label>
          <label>Poids cible maximum (kg, facultatif) <input type="number" min="30" max="250" step="0.1" v-model="f.weightMaxKg"></label>
          <label>Dépense « au repos » de ma montre Garmin (kcal, facultatif) <input type="number" min="800" max="4000" step="1" v-model="f.restingKcal"></label>
          <label>Calories actives d'une sortie longue de référence (kcal) <input type="number" :min="long.minKcal" max="6000" step="10" v-model="f.longActiveKcal" :placeholder="'par défaut ' + long.minKcal"></label>
        </div>
        <p class="muted small">Dépense hors entraînement : métabolisme de base (Mifflin-St Jeor) × 1,2 par défaut ; si tu saisis la valeur « au repos » de ta montre, elle est utilisée telle quelle (aucun facteur d'activité ajouté).</p>
        <p v-if="status.complete" class="notice" aria-live="polite">Dépense hors entraînement : <b>{{ kcal(rest) }} kcal</b> par jour.</p>
        <p v-else class="muted" aria-live="polite">Pour calculer les cibles, il manque : {{ status.missing.join(', ') }}.</p>
        <p v-if="rangeError" class="errors" role="alert">{{ rangeError }}</p>
      </form>
      <template #footer>
        <button type="button" class="btn danger" @click="clear">Effacer mon profil</button>
        <button type="button" class="btn" @click="$emit('close')">Annuler</button>
        <button type="button" class="btn primary" :disabled="!!rangeError" @click="save">Enregistrer</button>
      </template>
    </modal>`,
};
