// src/components/SubstitutePanel.js — panneau de substitution d'un aliment.
// Propose des aliments proches (même type, triés par répartition de macros) avec la quantité équivalente en kcal,
// protéines ou glucides au choix, et une recherche libre (tous les types). Utilisé :
//  - en popup (SubstituteDialog), depuis le bouton ⇄ d'une ligne d'ingrédient ;
//  - intégré à « Dupliquer ce repas » (MealFormDialog), pour substituer plusieurs aliments avant d'enregistrer ;
//  - en calculateur (mode « calc », page « Échanger un aliment ») : même classement, sans bouton de choix.
// Toute la logique de classement est dans src/substitute.js ; ce composant ne stocke rien.
import { computed, ref } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import { BASES, DEFAULT_BASIS, rankSubstitutes } from '../substitute.js';

export default {
  props: {
    foodId: { type: String, required: true }, // aliment à remplacer
    qty: { type: Number, required: true }, // sa quantité, dans son état de référence
    factor: { type: Number, default: 1 }, // portion affichée (Ma journée) : n'agit que sur l'affichage des quantités
    mode: { type: String, default: 'pick' }, // 'pick' : choisir un aliment ; 'calc' : calculateur seul
  },
  emits: ['pick', 'open-food'],
  setup(props, { emit }) {
    const basis = ref(DEFAULT_BASIS);
    const query = ref('');
    const base = computed(() => S.foodIdx.value.get(props.foodId) ?? null);
    const rows = computed(() => rankSubstitutes({ base: base.value, qty: props.qty, foods: S.foods.value, basis: basis.value, query: query.value }));
    // Le calculateur affiche l'état de référence (celui dans lequel la quantité est saisie) ; en repas, l'état de pesée habituel.
    const shown = (food, ref0) => {
      const q = ref0 * props.factor;
      const state = props.mode === 'calc' ? food.state : C.weighState(food);
      return { q: food.convertible ? C.convertQty(food, q, food.state, state) : q, state: food.convertible ? state : null };
    };
    const source = computed(() => (base.value ? { ...shown(base.value, props.qty), macros: C.scale(base.value.per100, props.qty / 100) } : null));
    const baseHas = (id) => !!base.value && base.value.per100[id] > 0;
    const basisLabel = computed(() => BASES.find((b) => b.id === basis.value).label.toLowerCase());
    const empty = computed(() => {
      if (!base.value || rows.value.length) return '';
      if (!baseHas(basis.value)) return `${base.value.name} n'apporte pas de ${basisLabel.value} : choisis une autre équivalence.`;
      return query.value.trim() ? 'Aucun aliment ne correspond à cette recherche.' : 'Aucun aliment du même type à proposer : utilise la recherche.';
    });
    return {
      basis, query, base, rows, source, bases: BASES, baseHas, empty, shown,
      pick: (r) => emit('pick', { foodId: r.food.id, qty: r.qty }),
      openFood: (r) => emit('open-food', r.food.id),
      kcal: C.fmtKcal, g: C.fmtG, q: C.fmtQty, p: C.fmtPer100, unitOf: C.unitOf,
    };
  },
  template: `
    <div class="subpanel">
      <p v-if="base && source" class="sub-source">
        <b>{{ q(source.q) }}&nbsp;{{ unitOf(base) }}<template v-if="source.state"> ({{ source.state }})</template></b> de <b>{{ base.name }}</b>
        <span class="muted">: {{ kcal(source.macros.kcal) }} kcal · P {{ g(source.macros.protein) }} · G {{ g(source.macros.carbs) }} · L {{ g(source.macros.fat) }}</span>
      </p>
      <div class="sub-ctl">
        <span class="seg" role="group" aria-label="Garder la même quantité de">
          <span class="muted">Même quantité de</span>
          <button v-for="b in bases" :key="b.id" type="button" :aria-pressed="basis === b.id" :disabled="!baseHas(b.id)" @click="basis = b.id">{{ b.label }}</button>
        </span>
        <input type="search" v-model="query" class="sub-search" placeholder="Rechercher un autre aliment…" aria-label="Rechercher un aliment de remplacement">
      </div>
      <p class="muted small">{{ query.trim() ? 'Résultats de la recherche, tous types d\\'aliments :' : 'Aliments proches du même type, par répartition de macros :' }}</p>
      <ul v-if="rows.length" class="sublist">
        <li v-for="r in rows" :key="r.food.id">
          <button v-if="mode === 'pick'" type="button" class="subitem" @click="pick(r)">
            <strong>{{ q(shown(r.food, r.qty).q) }}&nbsp;{{ unitOf(r.food) }}<template v-if="shown(r.food, r.qty).state"> ({{ shown(r.food, r.qty).state }})</template> de {{ r.food.name }}<abbr v-if="r.food.estimated" title="valeur estimée">*</abbr></strong>
            <small>{{ kcal(r.macros.kcal) }} kcal · P {{ g(r.macros.protein) }} · G {{ g(r.macros.carbs) }} · L {{ g(r.macros.fat) }} · F {{ g(r.macros.fiber) }}</small>
          </button>
          <div v-else class="subitem calc">
            <strong>{{ q(shown(r.food, r.qty).q) }}&nbsp;{{ unitOf(r.food) }}<template v-if="shown(r.food, r.qty).state"> ({{ shown(r.food, r.qty).state }})</template> de {{ r.food.name }}<abbr v-if="r.food.estimated" title="valeur estimée">*</abbr></strong>
            <small>{{ kcal(r.macros.kcal) }} kcal · P {{ g(r.macros.protein) }} · G {{ g(r.macros.carbs) }} · L {{ g(r.macros.fat) }} · F {{ g(r.macros.fiber) }}
              <span class="muted">({{ p(r.food.per100.kcal) }} kcal pour 100 {{ unitOf(r.food) }})</span>
              · <button type="button" class="linklike" @click="openFood(r)">Fiche de l'aliment</button></small>
          </div>
        </li>
      </ul>
      <p v-else-if="empty" class="empty">{{ empty }}</p>
    </div>`,
};
