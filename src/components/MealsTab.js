// src/components/MealsTab.js — onglet Repas : recherche, filtres combinables (ET entre groupes, OU dans un groupe),
// curseurs, tri, compteur, réinitialisation et création de repas perso.
import { computed } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Pills from './Pills.js';
import MealCard from './MealCard.js';

/** Curseur « au moins » / « au plus » : null = indifférent (aucune borne). */
const RangeFilter = {
  props: { label: String, max: { type: Number, required: true }, step: { type: Number, default: 1 }, unit: { type: String, default: '' }, kind: { type: String, default: 'min' }, modelValue: { type: Number, default: null } },
  emits: ['update:modelValue'],
  computed: { shown() { return this.modelValue ?? (this.kind === 'min' ? 0 : this.max); } },
  methods: {
    set(e) {
      const v = +e.target.value;
      this.$emit('update:modelValue', this.kind === 'min' ? (v <= 0 ? null : v) : (v >= this.max ? null : v));
    },
  },
  template: `
    <label class="range"><span>{{ label }} <b>{{ modelValue === null ? 'indifférent' : (kind === 'min' ? '≥ ' : '≤ ') + shown + ' ' + unit }}</b></span>
      <input type="range" min="0" :max="max" :step="step" :value="shown" @input="set"></label>`,
};

export default {
  components: { Pills, MealCard, RangeFilter },
  setup() {
    const f = S.state.ui.filters;
    const cfg = S.config;
    const sortedFoods = computed(() => [...S.foods.value].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
    const filtered = computed(() => C.sortMeals(C.filterMeals(S.meals.value, f), f.sort, f.dir));
    const up = (n, step) => Math.ceil(Math.max(step, n) / step) * step;
    const bounds = computed(() => {
      const m = S.meals.value;
      const max = (fn) => Math.max(0, ...m.map(fn));
      return { kcal: up(max((x) => C.roundKcal(x.totals.kcal)), 100), protein: up(max((x) => x.totals.protein), 10), carbs: up(max((x) => x.totals.carbs), 10), fiber: up(max((x) => x.totals.fiber), 5), time: up(max((x) => x.time ?? 0), 5) };
    });
    const densities = computed(() => cfg.value.densityLevels.map((l) => ({ value: l.id, label: `${l.emoji} ${l.label}` })));
    const tagOptions = computed(() => [...Object.values(cfg.value.autoTags).map((t) => t.label), ...cfg.value.manualTags]);
    const foodName = (id) => S.foodIdx.value.get(id)?.name ?? id;
    const addFood = (e) => { const id = e.target.value; if (id && !f.foods.includes(id)) f.foods.push(id); e.target.value = ''; };
    const reset = () => Object.assign(f, C.defaultFilters());
    const create = () => S.openDialog('meal', { draft: { id: null, name: '', category: 'Dîner', contexts: [], tags: [], time: null, notes: '', prep: '', variant: '', items: [], internal: [] }, mode: 'create' });
    return { f, cfg, filtered, bounds, densities, tagOptions, sortedFoods, foodName, addFood, reset, create, total: computed(() => S.meals.value.length) };
  },
  template: `
    <section aria-labelledby="t-meals">
      <h2 id="t-meals" class="sr-only">Repas</h2>
      <div class="toolbar">
        <input type="search" class="grow" v-model="f.q" placeholder="Rechercher un repas, un ingrédient, un tag…" aria-label="Rechercher un repas">
        <button type="button" class="btn primary" @click="create">+ Créer mon repas</button>
      </div>
      <details class="filters" open>
        <summary>Filtres</summary>
        <pills label="Catégorie" :options="cfg.categories" v-model="f.categories" />
        <pills label="Contexte" :options="cfg.contexts" v-model="f.contexts" />
        <pills label="Type d'aliment" :options="cfg.foodTypes" v-model="f.foodTypes" />
        <pills label="Densité" :options="densities" v-model="f.densities" />
        <pills label="Tags" :options="tagOptions" v-model="f.tags" />
        <pills label="Origine" :options="['Recueil', 'Perso']" v-model="f.origins" />
        <fieldset class="pills">
          <legend>Aliment principal</legend>
          <select aria-label="Ajouter un aliment au filtre" @change="addFood"><option value="">Ajouter un aliment…</option><option v-for="x in sortedFoods" :key="x.id" :value="x.id">{{ x.name }}</option></select>
          <button v-for="id in f.foods" :key="id" type="button" class="pill on" @click="f.foods = f.foods.filter((x) => x !== id)" :aria-label="'Retirer ' + foodName(id)">{{ foodName(id) }} ✕</button>
        </fieldset>
        <div class="ranges">
          <range-filter label="Kcal min" :max="bounds.kcal" :step="10" unit="kcal" v-model="f.kcalMin" />
          <range-filter label="Kcal max" :max="bounds.kcal" :step="10" unit="kcal" kind="max" v-model="f.kcalMax" />
          <range-filter label="Protéines min" :max="bounds.protein" unit="g" v-model="f.proteinMin" />
          <range-filter label="Glucides min" :max="bounds.carbs" unit="g" v-model="f.carbsMin" />
          <range-filter label="Glucides max" :max="bounds.carbs" unit="g" kind="max" v-model="f.carbsMax" />
          <range-filter label="Fibres min" :max="bounds.fiber" unit="g" v-model="f.fiberMin" />
          <range-filter label="Fibres max" :max="bounds.fiber" unit="g" kind="max" v-model="f.fiberMax" />
          <range-filter label="Temps max" :max="bounds.time" :step="5" unit="min" kind="max" v-model="f.timeMax" />
        </div>
      </details>
      <div class="resultbar">
        <span role="status" aria-live="polite"><b>{{ filtered.length }}</b> repas sur {{ total }}</span>
        <label>Tri
          <select v-model="f.sort">
            <option value="name">Nom</option><option value="kcal">Kcal</option><option value="protein">Protéines</option>
            <option value="carbs">Glucides</option><option value="fiber">Fibres</option><option value="time">Temps</option>
          </select>
        </label>
        <button type="button" class="btn" @click="f.dir = -f.dir" :aria-label="f.dir === 1 ? 'Tri croissant' : 'Tri décroissant'">{{ f.dir === 1 ? '↑ croissant' : '↓ décroissant' }}</button>
        <button type="button" class="btn" @click="reset">Réinitialiser les filtres</button>
      </div>
      <div class="cards">
        <meal-card v-for="m in filtered" :key="m.id" :meal="m" />
      </div>
      <p v-if="!filtered.length" class="empty">Aucun repas ne correspond à ces filtres.</p>
    </section>`,
};
