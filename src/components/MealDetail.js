// src/components/MealDetail.js — détail d'un repas : macros (facultatives), ingrédients avec switch Cru / Cuit et bouton ⇄
// de substitution, préparation, variante, notes et contextes. Partagé par la carte de l'onglet Repas, la fiche en popup
// (MealSheetDialog) et le planificateur. Les actions (copier, dupliquer…) restent à la charge de l'hôte.
import * as C from '../calc.js';
import * as S from '../store.js';
import { mealTweakLevel, tweakLine } from '../tweaks.js';
import IngredientList from './IngredientList.js';
import MealMacros from './MealMacros.js';

export default {
  components: { IngredientList, MealMacros },
  props: {
    meal: { type: Object, required: true },
    factor: { type: Number, default: 1 }, // portion affichée (quantités et macros)
    showMacros: Boolean,
    // Où mettre la variante à l'enregistrement d'une substitution (voir store.applyReplace) ; null = l'enregistrer seulement.
    replace: { type: Object, default: null },
    substitutable: { type: Boolean, default: true },
  },
  setup(props) {
    const substitute = ({ index }) => S.startSubstitution(props.meal, index, props.replace, props.factor);
    // Repas retouché par le planificateur : bloc explicatif (même détail que l'infobulle), jaune dès qu'une retouche est importante.
    const tweakLevel = (m) => mealTweakLevel(m.tweaks);
    const tweakLines = (m) => (m.tweaks ?? []).map((t) => tweakLine(m, t, props.factor));
    return { substitute, tweakLevel, tweakLines, n: (v) => C.fmtNum(v, v % 1 ? 2 : 0) };
  },
  template: `
    <div class="meal-detail">
      <template v-if="showMacros">
        <meal-macros :meal="meal" :factor="factor" />
        <p v-if="factor !== 1" class="muted small">Portion ×{{ n(factor) }} (quantités et macros ci-dessous).</p>
      </template>
      <p v-if="meal.incomplete" class="notice warn">Un aliment de ce repas a été supprimé : modifie le repas ou restaure l'aliment (onglet Aliments) pour pouvoir l'ajouter à « Ma journée ».</p>
      <div v-if="meal.tweaks && meal.tweaks.length" class="notice tweak-notice" :class="tweakLevel(meal) === 'major' ? 'warn' : 'info'" role="note">
        <b>Quantités ajustées</b>
        <p>Quantités ajustées pour approcher les cibles du jour. La recette de base est inchangée.</p>
        <ul><li v-for="(t, i) in tweakLines(meal)" :key="i">{{ t }}</li></ul>
      </div>
      <ingredient-list v-if="meal.lines.length" :lines="meal.lines" :factor="factor" :substitutable="substitutable" :tweaks="meal.tweaks" @substitute="substitute" />
      <p v-if="meal.cheat" class="notice">Bloc fixe de composition libre : macros estimées, sans liste d'aliments.</p>
      <p v-if="meal.prep"><b>Préparation.</b> {{ meal.prep }}</p>
      <p v-if="meal.variant"><b>Variante.</b> {{ meal.variant }}</p>
      <p v-if="meal.notes"><b>Notes.</b> {{ meal.notes }}</p>
      <p class="muted small">Contextes : {{ meal.contexts.join(' · ') }}<template v-if="meal.estimated"> · * valeur estimée</template></p>
    </div>`,
};
