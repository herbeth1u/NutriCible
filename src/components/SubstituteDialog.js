// src/components/SubstituteDialog.js — popup de substitution, ouverte par le bouton ⇄ d'une ligne d'ingrédient
// (fiche repas, Ma journée, planificateur). Choisir un aliment ouvre « Dupliquer ce repas » avec la variante préremplie ;
// fermer la popup ne change rien.
import { computed, watch } from '../vue.js';
import * as S from '../store.js';
import Modal from './Modal.js';
import SubstitutePanel from './SubstitutePanel.js';

export default {
  components: { Modal, SubstitutePanel },
  props: {
    mealId: { type: String, required: true },
    foodIndex: { type: Number, required: true }, // rang de l'aliment parmi les aliments du repas (hors ingrédients internes)
    replace: { type: Object, default: null }, // où mettre la variante à l'enregistrement (voir store.applyReplace)
    factor: { type: Number, default: 1 },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const meal = computed(() => S.mealIdx.value.get(props.mealId) ?? null);
    const line = computed(() => meal.value?.lines.filter((l) => l.kind === 'food')[props.foodIndex] ?? null);
    watch(line, (l) => { if (!l || l.missing) emit('close'); });
    const pick = ({ foodId, qty }) => {
      if (!meal.value) return;
      S.replaceDialog('meal', {
        draft: S.substitutionDraft(meal.value, props.foodIndex, foodId, qty),
        mode: 'duplicate',
        substitution: { replace: props.replace, sourceMealId: meal.value.id },
      });
    };
    return { meal, line, pick };
  },
  template: `
    <modal title="Substituer un aliment" @close="$emit('close')">
      <template v-if="meal && line && !line.missing">
        <p class="muted small">Dans « {{ meal.name }} ». Choisir un aliment ouvre « Dupliquer ce repas » avec cette variante : rien ne change tant que tu n'as pas enregistré.</p>
        <substitute-panel :food-id="line.id" :qty="line.qty" :factor="factor" @pick="pick" />
      </template>
      <template #footer><button type="button" class="btn" @click="$emit('close')">Annuler</button></template>
    </modal>`,
};
