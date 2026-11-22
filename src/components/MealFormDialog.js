// src/components/MealFormDialog.js — créer, modifier ou dupliquer un repas perso.
// Aperçu en direct via la même fonction de calcul que le recueil (resolveMeal) : kcal, macros, densité, tags.
import { computed, reactive } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Modal from './Modal.js';
import FoodPicker from './FoodPicker.js';

export default {
  components: { Modal, FoodPicker },
  props: { draft: { type: Object, required: true }, mode: { type: String, default: 'create' } },
  emits: ['close'],
  setup(props, { emit }) {
    const cfg = S.config;
    const d = reactive({ id: props.draft.id ?? null, name: props.draft.name, category: props.draft.category || 'Dîner', contexts: [...props.draft.contexts], tags: [...props.draft.tags], time: props.draft.time ?? null, notes: props.draft.notes ?? '', prep: props.draft.prep ?? '', variant: props.draft.variant ?? '' });
    const lines = reactive(props.draft.items.map(([id, g]) => ({ id, g })));
    const internal = reactive(props.draft.internal.map(([id, g]) => ({ id, g })));
    const disp = reactive({});
    const food = (id) => S.foodIdx.value.get(id) ?? null;
    const stateOf = (l) => disp[l.id] ?? C.weighState(food(l.id));
    const shown = (l) => { const f = food(l.id); return Math.round((f && f.convertible ? C.convertQty(f, l.g, f.state, stateOf(l)) : l.g) * 10) / 10; };
    const setQty = (l, v) => { const f = food(l.id); const n = +v; l.g = f && f.convertible ? C.convertQty(f, n, stateOf(l), f.state) : n; };
    const portions = (l) => { const p = food(l.id)?.portion; return p ? Math.round((l.g / p.g) * 100) / 100 : null; };
    const setPortions = (l, v) => { const p = food(l.id)?.portion; if (p && +v >= 0) l.g = Math.round(+v * p.g * 10) / 10; };
    const add = (id) => { const f = food(id); lines.push({ id, g: f && f.portion ? f.portion.g : 100 }); };
    const toggle = (arr, v) => { const i = arr.indexOf(v); if (i >= 0) arr.splice(i, 1); else arr.push(v); };

    const def = () => ({ ...d, time: d.time === '' || d.time === null ? null : +d.time, items: lines.map((l) => [l.id, +l.g]), internal: internal.map((l) => [l.id, +l.g]) });
    const preview = computed(() => C.resolveMeal({ ...def(), id: d.id ?? 'brouillon', origin: 'perso' }, S.resolveCtx.value));
    const errors = computed(() => {
      const e = [];
      if (!d.name.trim()) e.push('Le nom est obligatoire.');
      else if (C.nameTaken(d.name, S.mealNames(d.id))) e.push('Un repas porte déjà ce nom : choisis un nom unique.');
      if (!lines.length && !internal.length) e.push('Ajoute au moins un aliment.');
      if ([...lines, ...internal].some((l) => !(+l.g > 0))) e.push('Chaque quantité doit être supérieure à zéro.');
      if (lines.some((l) => !food(l.id))) e.push('Un aliment a été supprimé : retire cette ligne ou restaure l\'aliment.');
      return e;
    });
    const save = () => {
      if (errors.value.length) return;
      S.saveMeal(def());
      S.toast(props.mode === 'edit' ? 'Repas enregistré.' : 'Repas ajouté à ta bibliothèque.');
      emit('close');
    };
    const title = { create: 'Créer mon repas', edit: 'Modifier mon repas', duplicate: 'Dupliquer ce repas' }[props.mode];
    return { cfg, d, lines, internal, disp, food, stateOf, shown, setQty, portions, setPortions, add, toggle, remove: (i) => lines.splice(i, 1), preview, errors, save, title, kcal: C.fmtKcal, g: C.fmtG, unitOf: C.unitOf, nameOf: (id) => S.internalIdx.value.get(id)?.name ?? id };
  },
  template: `
    <modal :title="title" wide @close="$emit('close')">
      <form class="form" @submit.prevent="save">
        <div class="grid2">
          <label>Nom <input v-model="d.name" required maxlength="120" aria-describedby="meal-err"></label>
          <label>Catégorie <select v-model="d.category"><option v-for="c in cfg.categories" :key="c" :value="c">{{ c }}</option></select></label>
          <label>Temps de préparation (min) <input type="number" min="0" step="1" v-model="d.time"></label>
        </div>
        <fieldset class="pills"><legend>Contextes</legend>
          <button v-for="c in cfg.contexts" :key="c" type="button" class="pill" :class="{ on: d.contexts.includes(c) }" :aria-pressed="d.contexts.includes(c)" @click="toggle(d.contexts, c)">{{ c }}</button>
        </fieldset>
        <fieldset class="pills"><legend>Tags manuels</legend>
          <button v-for="t in cfg.manualTags" :key="t" type="button" class="pill" :class="{ on: d.tags.includes(t) }" :aria-pressed="d.tags.includes(t)" @click="toggle(d.tags, t)">{{ t }}</button>
        </fieldset>

        <h3>Ingrédients</h3>
        <ul class="lines">
          <li v-for="(l, i) in lines" :key="i" :class="{ missing: !food(l.id) }">
            <span class="n">{{ food(l.id) ? food(l.id).name : '⚠ aliment supprimé (' + l.id + ')' }}</span>
            <label class="inline"><span class="sr-only">Quantité</span>
              <input type="number" min="0" step="any" :value="shown(l)" @input="setQty(l, $event.target.value)"> {{ unitOf(food(l.id)) }}
            </label>
            <label v-if="food(l.id) && food(l.id).portion" class="inline"><span class="sr-only">Portions</span>
              <input type="number" min="0" step="0.5" :value="portions(l)" @input="setPortions(l, $event.target.value)"> × {{ food(l.id).portion.label }}
            </label>
            <span v-if="food(l.id) && food(l.id).convertible" class="seg" role="group" aria-label="État de pesée">
              <button type="button" :aria-pressed="stateOf(l) === 'cru'" @click="disp[l.id] = 'cru'">Cru</button>
              <button type="button" :aria-pressed="stateOf(l) === 'cuit'" @click="disp[l.id] = 'cuit'">Cuit</button>
            </span>
            <button type="button" class="icon" @click="remove(i)" :aria-label="'Retirer la ligne ' + (food(l.id) ? food(l.id).name : l.id)">✕</button>
          </li>
          <li v-for="(l, i) in internal" :key="'i' + i" class="internal">
            <span class="n">{{ nameOf(l.id) }} <small class="muted">(ingrédient de la recette)</small></span>
            <label class="inline"><span class="sr-only">Quantité</span><input type="number" min="0" step="any" v-model.number="l.g"> g</label>
          </li>
        </ul>
        <p v-if="!lines.length && !internal.length" class="empty">Aucun ingrédient pour l'instant.</p>
        <details open><summary>Ajouter un aliment</summary><food-picker @pick="add" /></details>

        <label>Préparation <textarea rows="3" v-model="d.prep"></textarea></label>
        <label>Variante <textarea rows="2" v-model="d.variant"></textarea></label>
        <label>Notes <textarea rows="2" v-model="d.notes"></textarea></label>

        <div class="preview" :class="'d-' + preview.density.id" aria-live="polite">
          <b>Aperçu :</b> {{ kcal(preview.totals.kcal) }} kcal · P {{ g(preview.totals.protein) }} g · G {{ g(preview.totals.carbs) }} g · L {{ g(preview.totals.fat) }} g · F {{ g(preview.totals.fiber) }} g
          · {{ preview.density.emoji }} {{ preview.density.label }}
          <span v-for="t in preview.tags" :key="t" class="badge soft">{{ t }}</span>
        </div>
        <ul id="meal-err" class="errors" role="alert"><li v-for="e in errors" :key="e">{{ e }}</li></ul>
      </form>
      <template #footer>
        <button type="button" class="btn" @click="$emit('close')">Annuler</button>
        <button type="button" class="btn primary" :disabled="errors.length > 0" @click="save">Enregistrer</button>
      </template>
    </modal>`,
};
