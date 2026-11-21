// src/components/IngredientList.js
// Lignes d'ingrédients avec switch Cru / Cuit : il convertit la quantité AFFICHÉE sans changer l'aliment
// réellement consommé (les macros et les kcal restent identiques). État initial : pesée habituelle de l'aliment.
import { reactive } from '../vue.js';
import * as C from '../calc.js';

export default {
  props: { lines: { type: Array, required: true }, factor: { type: Number, default: 1 } },
  setup(props) {
    const disp = reactive({});
    const stateOf = (l) => disp[l.id] ?? C.weighState(l.food);
    const qty = (l) => {
      const q = l.qty * props.factor;
      return l.food && l.food.convertible ? C.convertQty(l.food, q, l.food.state, stateOf(l)) : q;
    };
    return { disp, stateOf, qty, fmtQty: C.fmtQty, unitOf: C.unitOf };
  },
  template: `
    <ul class="ingr">
      <li v-for="l in lines" :key="l.kind + l.id" :class="{ missing: l.missing }">
        <span class="q">{{ fmtQty(qty(l)) }}&nbsp;{{ unitOf(l.food) }}</span>
        <span class="n">
          <template v-if="l.missing">⚠ aliment supprimé ({{ l.missingId }})</template>
          <template v-else>{{ l.food.name }}<abbr v-if="l.food.estimated" title="valeur estimée">*</abbr></template>
        </span>
        <span v-if="l.food && l.food.convertible" class="seg" role="group" :aria-label="'État de pesée : ' + l.food.name">
          <button type="button" :aria-pressed="stateOf(l) === 'cru'" @click="disp[l.id] = 'cru'">Cru</button>
          <button type="button" :aria-pressed="stateOf(l) === 'cuit'" @click="disp[l.id] = 'cuit'">Cuit</button>
        </span>
      </li>
    </ul>`,
};
