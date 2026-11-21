// src/components/FoodPicker.js — sélecteur d'aliments (recherche + filtre par type) parmi TOUS les aliments :
// recueil, aliments perso et aliments composés. Les ingrédients internes n'apparaissent jamais ici.
import { computed, reactive } from '../vue.js';
import * as S from '../store.js';
import * as C from '../calc.js';

export default {
  emits: ['pick'],
  setup(_, { emit }) {
    const f = reactive({ q: '', type: '' });
    const list = computed(() => {
      const q = C.normalize(f.q);
      return S.foods.value
        .filter((x) => (!f.type || x.type === f.type) && (!q || C.normalize(x.name).includes(q)))
        .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    });
    return { f, list, types: S.foodTypes, p: C.fmtPer100, pick: (id) => emit('pick', id) };
  },
  template: `
    <div class="picker">
      <div class="row">
        <input type="search" v-model="f.q" placeholder="Rechercher un aliment…" aria-label="Rechercher un aliment">
        <select v-model="f.type" aria-label="Filtrer par type d'aliment">
          <option value="">Tous les types</option>
          <option v-for="t in types" :key="t" :value="t">{{ t }}</option>
        </select>
      </div>
      <ul class="picklist">
        <li v-for="x in list" :key="x.id">
          <button type="button" @click="pick(x.id)">
            <strong>{{ x.name }}<span v-if="x.origin === 'perso'" class="badge">✏️ Perso</span></strong>
            <small>{{ x.type }} · {{ p(x.per100.kcal) }} kcal · P {{ p(x.per100.protein) }} · G {{ p(x.per100.carbs) }} · L {{ p(x.per100.fat) }} · F {{ p(x.per100.fiber) }} pour 100 {{ x.unit }}</small>
          </button>
        </li>
        <li v-if="!list.length" class="empty">Aucun aliment ne correspond.</li>
      </ul>
    </div>`,
};
