// src/components/MealMacros.js — kcal et macros d'un repas pour une portion (facteur), avec le temps de préparation.
import * as C from '../calc.js';

export default {
  props: { meal: { type: Object, required: true }, factor: { type: Number, default: 1 } },
  setup() { return { kcal: C.fmtKcal, g: C.fmtG }; },
  template: `
    <div class="macros" role="group" aria-label="Valeurs nutritionnelles">
      <strong class="kcal">{{ kcal(meal.totals.kcal * factor) }} kcal<abbr v-if="meal.estimated" title="valeurs estimées">*</abbr></strong>
      <span>P <b>{{ g(meal.totals.protein * factor) }}</b> g</span>
      <span>G <b>{{ g(meal.totals.carbs * factor) }}</b> g</span>
      <span>L <b>{{ g(meal.totals.fat * factor) }}</b> g</span>
      <span>F <b>{{ g(meal.totals.fiber * factor) }}</b> g</span>
      <span v-if="meal.time" class="muted">⏱ {{ meal.time }} min</span>
    </div>`,
};
