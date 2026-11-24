// src/components/MealCard.js — carte de repas : bande de densité, macros visibles, détail au clic (MealDetail).
import { ref } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import MealDetail from './MealDetail.js';
import MealMacros from './MealMacros.js';

export default {
  components: { MealDetail, MealMacros },
  props: { meal: { type: Object, required: true } },
  setup(props) {
    const open = ref(false);
    const copy = () => S.copyWithToast(C.mealToText(props.meal), 'Repas copié.');
    const add = () => { if (S.addToDay(props.meal.id)) S.toast(`« ${props.meal.name} » ajouté à Ma journée.`); };
    const dup = () => S.duplicateMeal(props.meal);
    const edit = () => S.editMeal(props.meal);
    const remove = () => { if (window.confirm(`Supprimer « ${props.meal.name} » ?`)) S.deleteMeal(props.meal.id); };
    return { open, copy, add, dup, edit, remove };
  },
  template: `
    <article class="card" :class="['d-' + meal.density.id, { perso: meal.origin === 'perso', incomplete: meal.incomplete }]">
      <div class="card-top">
        <h3 class="card-title"><button type="button" class="linklike" :aria-expanded="open" @click="open = !open">{{ meal.name }}</button></h3>
        <span class="dens" :title="'Densité : ' + meal.density.label">{{ meal.density.emoji }} {{ meal.density.label }}</span>
      </div>
      <div class="badges">
        <span v-if="meal.origin === 'perso'" class="badge perso">✏️ Perso</span>
        <span v-if="meal.incomplete" class="badge warn">⚠ Incomplet</span>
        <span class="badge">{{ meal.category }}</span>
        <span v-for="t in meal.tags" :key="t" class="badge soft">{{ t }}</span>
      </div>
      <meal-macros :meal="meal" />
      <meal-detail v-if="open" class="detail" :meal="meal" />
      <div class="actions">
        <button type="button" class="btn" @click="open = !open">{{ open ? 'Replier' : 'Détails' }}</button>
        <button type="button" class="btn primary" :disabled="meal.incomplete" @click="add">+ Ma journée</button>
        <button type="button" class="btn" @click="copy">Copier</button>
        <button v-if="!meal.cheat" type="button" class="btn" @click="dup">Dupliquer</button>
        <template v-if="meal.origin === 'perso'">
          <button type="button" class="btn" @click="edit">Modifier</button>
          <button type="button" class="btn danger" @click="remove">Supprimer</button>
        </template>
      </div>
    </article>`,
};
