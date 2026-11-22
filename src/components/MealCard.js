// src/components/MealCard.js — carte de repas : bande de densité, macros visibles, détail au clic.
import { ref } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import IngredientList from './IngredientList.js';

export default {
  components: { IngredientList },
  props: { meal: { type: Object, required: true } },
  setup(props) {
    const open = ref(false);
    const copy = () => S.copyWithToast(C.mealToText(props.meal), 'Repas copié.');
    const add = () => { if (S.addToDay(props.meal.id)) S.toast(`« ${props.meal.name} » ajouté à Ma journée.`); };
    const dup = () => S.openDialog('meal', { draft: S.duplicateDraft(props.meal), mode: 'duplicate' });
    const edit = () => S.openDialog('meal', { draft: { ...S.duplicateDraft(props.meal), id: props.meal.id, name: props.meal.name }, mode: 'edit' });
    const remove = () => { if (window.confirm(`Supprimer « ${props.meal.name} » ?`)) S.deleteMeal(props.meal.id); };
    return { open, copy, add, dup, edit, remove, kcal: C.fmtKcal, g: C.fmtG };
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
      <div class="macros" role="group" aria-label="Valeurs nutritionnelles">
        <strong class="kcal">{{ kcal(meal.totals.kcal) }} kcal<abbr v-if="meal.estimated" title="valeurs estimées">*</abbr></strong>
        <span>P <b>{{ g(meal.totals.protein) }}</b> g</span>
        <span>G <b>{{ g(meal.totals.carbs) }}</b> g</span>
        <span>L <b>{{ g(meal.totals.fat) }}</b> g</span>
        <span>F <b>{{ g(meal.totals.fiber) }}</b> g</span>
        <span v-if="meal.time" class="muted">⏱ {{ meal.time }} min</span>
      </div>
      <div v-if="open" class="detail">
        <p v-if="meal.incomplete" class="notice warn">Un aliment de ce repas a été supprimé : modifie le repas ou restaure l'aliment (onglet Aliments) pour pouvoir l'ajouter à « Ma journée ».</p>
        <ingredient-list v-if="meal.lines.length" :lines="meal.lines" />
        <p v-if="meal.cheat" class="notice">Bloc fixe de composition libre : macros estimées, sans liste d'aliments.</p>
        <p v-if="meal.prep"><b>Préparation.</b> {{ meal.prep }}</p>
        <p v-if="meal.variant"><b>Variante.</b> {{ meal.variant }}</p>
        <p v-if="meal.notes"><b>Notes.</b> {{ meal.notes }}</p>
        <p class="muted small">Contextes : {{ meal.contexts.join(' · ') }}<template v-if="meal.estimated"> · * valeur estimée</template></p>
      </div>
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
