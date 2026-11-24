// src/components/MealSheetDialog.js — fiche complète d'un repas en popup, ouverte depuis « Ma journée » (ou le planificateur).
// Le panneau de « Ma journée » est étroit (une feuille en bas du mobile) : il ne garde que le nom, la catégorie, la densité,
// les kcal et les ingrédients ; la recette, les macros et les actions sont ici.
import { computed, watch } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Modal from './Modal.js';
import MealDetail from './MealDetail.js';

export default {
  components: { Modal, MealDetail },
  props: {
    mealId: { type: String, required: true },
    dayIndex: { type: Number, default: null }, // ligne de « Ma journée » d'où vient la fiche (portion, retrait, remplacement)
    // Fiche ouverte hors de « Ma journée » (planificateur) : portion affichée, et où mettre une variante (voir store.applyReplace).
    portion: { type: Number, default: null },
    replaceWhere: { type: Object, default: null },
  },
  emits: ['close'],
  setup(props, { emit }) {
    const meal = computed(() => S.mealIdx.value.get(props.mealId) ?? null);
    const row = computed(() => (props.dayIndex === null ? null : S.dayRows.value.find((r) => r.index === props.dayIndex && r.meal.id === props.mealId) ?? null));
    const factor = computed(() => row.value?.factor ?? props.portion ?? 1);
    const replace = computed(() => (row.value ? { where: 'day', index: row.value.index, mealId: props.mealId } : props.replaceWhere));
    watch(meal, (m) => { if (!m) emit('close'); });
    watch(() => props.dayIndex !== null && !row.value, (gone) => { if (gone) emit('close'); });
    const copy = () => S.copyWithToast(C.mealToText(meal.value), 'Repas copié.');
    const add = () => { if (S.addToDay(props.mealId)) S.toast(`« ${meal.value.name} » ajouté à Ma journée.`); };
    const remove = () => { S.removeFromDay(row.value.index); S.toast(`« ${meal.value.name} » retiré de Ma journée.`); emit('close'); };
    return { meal, row, factor, replace, copy, add, remove, dup: () => S.duplicateMeal(meal.value), edit: () => S.editMeal(meal.value) };
  },
  template: `
    <modal v-if="meal" :title="meal.name" wide @close="$emit('close')">
      <div class="badges">
        <span class="dens" :title="'Densité : ' + meal.density.label">{{ meal.density.emoji }} {{ meal.density.label }}</span>
        <span v-if="meal.origin === 'perso'" class="badge perso">✏️ Perso</span>
        <span v-if="meal.incomplete" class="badge warn">⚠ Incomplet</span>
        <span class="badge">{{ meal.category }}</span>
        <span v-for="t in meal.tags" :key="t" class="badge soft">{{ t }}</span>
      </div>
      <meal-detail :meal="meal" :factor="factor" :replace="replace" show-macros />
      <template #footer>
        <button v-if="!row" type="button" class="btn primary" :disabled="meal.incomplete" @click="add">+ Ma journée</button>
        <button type="button" class="btn" @click="copy">Copier</button>
        <button v-if="!meal.cheat" type="button" class="btn" @click="dup">Dupliquer</button>
        <button v-if="meal.origin === 'perso'" type="button" class="btn" @click="edit">Modifier</button>
        <button v-if="row" type="button" class="btn danger" @click="remove">Retirer de Ma journée</button>
        <button type="button" class="btn" @click="$emit('close')">Fermer</button>
      </template>
    </modal>`,
};
