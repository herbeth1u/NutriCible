// src/components/MealSwapDialog.js — fenêtre « Remplacer un repas », ouverte par le bouton ⇄ d'une ligne de repas du Planificateur.
// Suggestions (repas proches qui respectent les règles de la semaine) et recherche libre dans tous les repas, avec une pastille par
// règle qui ne serait pas tenue. Choisir un repas le met à la place de l'ancien (même créneau) et ferme la fenêtre ; fermer sans
// choisir ne change rien. Éligibilité et pastilles : src/planner.js ; classement : src/swap.js ; ici, seulement l'affichage.
// Distincte de SubstituteDialog (⇄ d'une ligne d'ingrédient : remplace un aliment, pas un repas).
import { computed, ref, watch } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import { swapCandidates, swapIssues } from '../planner.js';
import { rankMealSwaps } from '../swap.js';
import Modal from './Modal.js';
import MealMacros from './MealMacros.js';

export default {
  components: { Modal, MealMacros },
  props: {
    dayIndex: { type: Number, required: true }, // jour du planning (0 = premier jour)
    mealIndex: { type: Number, required: true }, // rang du repas parmi les repas présents du jour
  },
  emits: ['close'],
  setup(props, { emit }) {
    const swap = S.config.value.planner.swap;
    const query = ref('');
    const q = computed(() => query.value.trim());
    const day = computed(() => S.planView.value?.days[props.dayIndex] ?? null);
    const item = computed(() => day.value?.items[props.mealIndex] ?? null);
    const current = computed(() => item.value?.meal ?? null);
    const factor = computed(() => day.value?.factor ?? 1);
    watch(item, (it) => { if (!it) emit('close'); });

    const rows = computed(() => {
      if (!S.state.plan || !item.value) return [];
      const ctx = S.plannerCtx.value;
      const meals = q.value ? S.meals.value : swapCandidates(ctx, S.state.plan, props.dayIndex, props.mealIndex);
      return rankMealSwaps({ base: current.value, meals, query: q.value, weights: swap.weights, limit: q.value ? swap.searchLimit : swap.limit })
        .map((r) => ({ ...r, issues: q.value ? swapIssues(ctx, S.state.plan, props.dayIndex, props.mealIndex, r.meal) : [] }));
    });
    const empty = computed(() => (rows.value.length ? '' : q.value ? 'Aucun repas ne correspond à cette recherche.' : 'Aucun repas proche à proposer : utilise la recherche.'));
    const count = computed(() => (rows.value.length ? `${rows.value.length} repas proposé${rows.value.length > 1 ? 's' : ''}` : 'Aucun repas proposé'));
    const pick = (r) => { if (S.swapPlanMeal(props.dayIndex, props.mealIndex, r.meal.id)) emit('close'); };
    // Écarts signés au facteur du jour, arrondis à l'unité comme tout l'affichage.
    const sign = (v) => C.fmtSigned(v * factor.value);
    return { query, q, day, item, current, factor, rows, empty, count, pick, sign, kcal: (v) => C.fmtKcal(v * factor.value), g: (v) => C.fmtG(v * factor.value) };
  },
  template: `
    <modal title="Remplacer un repas" @close="$emit('close')">
      <template v-if="item">
        <div class="swap-current">
          <template v-if="current && !current.incomplete">
            <b>{{ current.name }}</b> <span class="muted">({{ item.slot }}, {{ day.label.toLowerCase() }})</span>
            <meal-macros :meal="current" :factor="factor" />
          </template>
          <template v-else>⚠ {{ current ? current.name + ' est incomplet (aliment supprimé)' : 'Repas introuvable' }} <span class="muted">({{ item.slot }}, {{ day.label.toLowerCase() }})</span></template>
        </div>
        <p class="muted small">Rien ne change tant que tu n'as pas choisi un repas. Les portions du jour sont recalculées.</p>
        <div class="sub-ctl">
          <input type="search" v-model="query" class="sub-search" placeholder="Rechercher dans tous les repas…" aria-label="Rechercher dans tous les repas">
        </div>
        <p class="muted small">{{ q ? 'Résultats de la recherche, toutes catégories et tous contextes (une pastille signale chaque règle qui ne serait pas tenue) :' : 'Repas proches, qui respectent les règles de la semaine :' }}</p>
        <p class="sr-only" role="status">{{ count }}</p>
        <ul v-if="rows.length" class="sublist">
          <li v-for="r in rows" :key="r.meal.id">
            <button type="button" class="subitem" @click="pick(r)">
              <strong>{{ r.meal.name }}<abbr v-if="r.meal.estimated" title="valeurs estimées">*</abbr><span v-if="q" class="muted"> · {{ r.meal.category }}</span></strong>
              <small>{{ kcal(r.meal.totals.kcal) }} kcal · P {{ g(r.meal.totals.protein) }} · G {{ g(r.meal.totals.carbs) }} · L {{ g(r.meal.totals.fat) }} · F {{ g(r.meal.totals.fiber) }}</small>
              <small v-if="r.delta" class="swap-delta">Écart : {{ sign(r.delta.kcal) }} kcal · {{ sign(r.delta.protein) }} g P · {{ sign(r.delta.carbs) }} g G</small>
              <span v-if="r.issues.length" class="swap-flags"><span v-for="f in r.issues" :key="f.code" class="badge warn">⚠ {{ f.label }}</span></span>
            </button>
          </li>
        </ul>
        <p v-else class="empty">{{ empty }}</p>
      </template>
      <template #footer><button type="button" class="btn" @click="$emit('close')">Annuler</button></template>
    </modal>`,
};
