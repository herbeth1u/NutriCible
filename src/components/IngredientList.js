// src/components/IngredientList.js
// Lignes d'ingrédients avec switch Cru / Cuit : il convertit la quantité AFFICHÉE sans changer l'aliment
// réellement consommé (les macros et les kcal restent identiques). État initial : pesée habituelle de l'aliment.
// Avec `substitutable`, chaque aliment (hors ingrédients internes et aliments supprimés) a un bouton ⇄ : il émet
// `substitute` avec { line, index } où `index` = rang de l'aliment parmi les aliments du repas (hors ingrédients internes).
import { computed, reactive } from '../vue.js';
import * as C from '../calc.js';
import { tweakLevelLabel, tweakText } from '../tweaks.js';
import TweakMark from './TweakMark.js';

// `tweaks` (facultatif) : retouches du repas [{ line, base, qty, ratio, level }] (voir src/tweaks.js) ; la ligne concernée affiche une pastille
// « ± » (non cliquable) dont l'infobulle donne les quantités avant et après, dans l'état de pesée affiché (cru ou cuit). Sans cette propriété,
// le composant se comporte exactement comme avant.
export default {
  components: { TweakMark },
  props: { lines: { type: Array, required: true }, factor: { type: Number, default: 1 }, substitutable: Boolean, tweaks: { type: Array, default: null } },
  emits: ['substitute'],
  setup(props, { emit }) {
    const disp = reactive({});
    const stateOf = (l) => disp[l.id] ?? C.weighState(l.food);
    const qty = (l) => {
      const q = l.qty * props.factor;
      return l.food && l.food.convertible ? C.convertQty(l.food, q, l.food.state, stateOf(l)) : q;
    };
    const foodRank = computed(() => {
      let n = 0;
      return props.lines.map((l) => (l.kind === 'food' ? n++ : -1));
    });
    const canSubstitute = (l, i) => props.substitutable && foodRank.value[i] >= 0 && !l.missing;
    const substitute = (l, i) => emit('substitute', { line: l, index: foodRank.value[i] });
    const tweakOf = (i) => props.tweaks?.find((t) => t.line === i) ?? null;
    const shown = (l, q) => (l.food && l.food.convertible ? C.convertQty(l.food, q * props.factor, l.food.state, stateOf(l)) : q * props.factor);
    const tweakLabel = (l, t) => `${tweakLevelLabel(t.level)} : ${tweakText(l.food.name, C.unitOf(l.food), shown(l, t.qty), shown(l, t.base), t.ratio, t.level)}`;
    return { disp, stateOf, qty, canSubstitute, substitute, tweakOf, tweakLabel, fmtQty: C.fmtQty, unitOf: C.unitOf };
  },
  template: `
    <ul class="ingr">
      <li v-for="(l, i) in lines" :key="l.kind + l.id + i" :class="{ missing: l.missing }">
        <span class="q">{{ fmtQty(qty(l)) }}&nbsp;{{ unitOf(l.food) }}<tweak-mark v-if="tweakOf(i)" plain :level="tweakOf(i).level" :label="tweakLabel(l, tweakOf(i))" /></span>
        <span class="n">
          <template v-if="l.missing">⚠ aliment supprimé ({{ l.missingId }})</template>
          <template v-else>{{ l.food.name }}<abbr v-if="l.food.estimated" title="valeur estimée">*</abbr></template>
        </span>
        <span v-if="l.food && l.food.convertible" class="seg" role="group" :aria-label="'État de pesée : ' + l.food.name">
          <button type="button" :aria-pressed="stateOf(l) === 'cru'" @click="disp[l.id] = 'cru'">{{ l.food.state === 'surgelé' ? 'Surgelé' : 'Cru' }}</button>
          <button type="button" :aria-pressed="stateOf(l) === 'cuit'" @click="disp[l.id] = 'cuit'">Cuit</button>
        </span>
        <button v-if="canSubstitute(l, i)" type="button" class="icon subbtn" :aria-label="'Substituer ' + l.food.name" title="Substituer un aliment" @click="substitute(l, i)">⇄</button>
      </li>
    </ul>`,
};
