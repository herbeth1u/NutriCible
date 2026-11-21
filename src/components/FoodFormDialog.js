// src/components/FoodFormDialog.js — ajouter un aliment perso ou modifier n'importe quel aliment (recueil ou perso).
// Aperçu d'impact avant enregistrement : repas concernés, kcal avant → après, changements de densité.
// Les aliments ⇄ se saisissent dans l'état cru OU cuit : conversion par le coefficient, stockée dans l'état de référence.
import { computed, reactive, watch } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Modal from './Modal.js';

const KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];
const FIELD = { kcal: 'Kcal', protein: 'Protéines (g)', carbs: 'Glucides (g)', fat: 'Lipides (g)', fiber: 'Fibres (g)' };
const LABELS = ['tel quel', 'égoutté', 'surgelé', 'sec', 'poudre'];

export default {
  components: { Modal },
  props: { foodId: { type: String, default: null } },
  emits: ['close'],
  setup(props, { emit }) {
    const ex = props.foodId ? S.foodIdx.value.get(props.foodId) : null;
    const f = reactive({
      name: ex?.name ?? '', type: ex?.type ?? 'Autres', season: ex?.season ?? '', unit: ex?.unit ?? 'g',
      convertible: !!(ex && ex.convertible), refState: ex && ex.convertible ? ex.state : 'cuit', label: ex && !ex.convertible ? ex.state : 'tel quel',
      coef: ex?.coef ?? 2.5, weigh: ex?.weigh ?? (ex && ex.convertible ? ex.state : 'cuit'), entered: ex && ex.convertible ? ex.state : 'cuit',
      v: Object.fromEntries(KEYS.map((k) => [k, ex ? Math.round(ex.per100[k] * 100) / 100 : 0])),
      portionLabel: ex?.portion?.label ?? '', portionG: ex?.portion?.g ?? null,
      note: ex?.note ?? '', estimated: ex ? !!ex.estimated : false,
    });
    const nums = () => Object.fromEntries(KEYS.map((k) => [k, +f.v[k] || 0]));
    const pf = () => ({ state: f.refState, coef: +f.coef });
    const refValues = () => (f.convertible ? C.per100ToRef(pf(), f.entered, nums()) : nums());

    // Basculer l'état de saisie convertit les valeurs affichées (les nutriments ne changent pas).
    watch(() => f.entered, (to, from) => {
      if (!f.convertible || to === from) return;
      const out = C.per100In({ ...pf(), per100: C.per100ToRef(pf(), from, nums()) }, to);
      for (const k of KEYS) f.v[k] = Math.round(out[k] * 100) / 100;
    });
    watch(() => f.refState, (s) => { f.entered = s; f.weigh = s; });

    const errors = computed(() => {
      const e = [];
      if (!f.name.trim()) e.push('Le nom est obligatoire.');
      else if (C.nameTaken(f.name, S.foodNames(props.foodId))) e.push('Un aliment porte déjà ce nom : choisis un nom unique.');
      if (KEYS.some((k) => !(Number.isFinite(+f.v[k]) && +f.v[k] >= 0 && f.v[k] !== ''))) e.push('Les valeurs nutritionnelles doivent être des nombres positifs ou nuls.');
      if (f.convertible && !(+f.coef > 0 && +f.coef <= 6)) e.push('Le coefficient cuit ÷ cru doit être compris entre 0 et 6.');
      if ((f.portionLabel.trim() && !(+f.portionG > 0)) || (!f.portionLabel.trim() && +f.portionG > 0)) e.push('La portion usuelle demande un libellé et un poids en g.');
      return e;
    });
    const warning = computed(() => C.kcalWarning(C.normPer100(refValues()), S.config.value, ex));

    const impact = computed(() => {
      if (!ex) return [];
      const nf = { ...ex, name: f.name, type: f.type, per100: C.normPer100(refValues()), season: f.season || undefined, ...(f.convertible ? { coef: +f.coef, weigh: f.weigh } : {}) };
      const idx = new Map(S.foodIdx.value);
      idx.set(ex.id, nf);
      return C.foodImpact(ex.id, S.foodIdx.value, idx, S.mealDefs.value, S.config.value, S.state.base.internal, S.state.user.replacements);
    });
    const moved = computed(() => impact.value.filter((i) => Math.abs(i.after - i.before) >= 1).sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before)));
    const densityMoves = computed(() => impact.value.filter((i) => i.densityBefore.id !== i.densityAfter.id));

    const submit = () => {
      if (errors.value.length) return;
      // Valeurs inchangées (à l'arrondi de saisie près) : on garde les valeurs exactes, sinon un simple « Enregistrer »
      // créerait une fausse modification (arrondis sur les aliments composés, bruit de conversion cru/cuit).
      const ref = C.normPer100(refValues());
      const same = ex && KEYS.every((k) => Math.abs(ref[k] - ex.per100[k]) < 0.006);
      const next = {
        name: f.name.trim(), type: f.type, season: f.season || null, per100: same ? ex.per100 : ref, note: f.note.trim(), estimated: f.estimated,
        portion: f.portionLabel.trim() && +f.portionG > 0 ? { label: f.portionLabel.trim(), g: +f.portionG } : null,
      };
      if (f.convertible) { next.coef = +f.coef; next.weigh = f.weigh; }
      if (ex) S.updateFood(ex.id, next);
      else S.addFood({ ...next, unit: f.unit, state: f.convertible ? f.refState : f.label });
      S.toast(ex ? 'Aliment enregistré : repas, totaux et export sont à jour.' : 'Aliment ajouté : utilisable dans tes repas.');
      emit('close');
    };
    const revert = () => { S.resetFood(ex.id); S.toast('Valeurs d\'origine rétablies.'); emit('close'); };
    return {
      ex, f, errors, warning, impact, moved, densityMoves, submit, revert, KEYS, FIELD, LABELS, types: S.foodTypes, seasons: computed(() => S.config.value.seasons),
      kcal: C.fmtKcal, p: C.fmtPer100, title: ex ? `Modifier « ${ex.name} »` : 'Ajouter un aliment perso',
    };
  },
  template: `
    <modal :title="title" wide @close="$emit('close')">
      <form class="form" @submit.prevent="submit">
        <div class="grid2">
          <label>Nom <input v-model="f.name" required maxlength="80"></label>
          <label>Type <select v-model="f.type"><option v-for="t in types" :key="t" :value="t">{{ t }}</option></select></label>
          <label>Saison <select v-model="f.season"><option value="">Aucune</option><option v-for="s in seasons" :key="s.id" :value="s.id">{{ s.label }}</option></select></label>
          <label v-if="!ex">Unité <select v-model="f.unit"><option value="g">g</option><option value="ml">ml (liquide, 1 ml = 1 g)</option></select></label>
        </div>
        <p v-if="ex && f.name !== ex.name" class="notice">Renommer un aliment change aussi son nom dans l'export Notion (colonnes « Aliments principaux » et « Ingrédients »).</p>

        <fieldset class="box" v-if="!ex || ex.convertible">
          <legend>Cru / cuit</legend>
          <label v-if="!ex" class="check"><input type="checkbox" v-model="f.convertible"> Aliment ⇄ (existe en version crue et cuite)</label>
          <template v-if="f.convertible">
            <div class="grid2">
              <label>État de référence (quantités des repas) <select v-model="f.refState" :disabled="!!ex"><option value="cru">cru</option><option value="cuit">cuit</option></select></label>
              <label>Coefficient : poids cuit ÷ poids cru <input type="number" min="0.1" max="6" step="0.01" v-model="f.coef"></label>
              <label>État de pesée habituel <select v-model="f.weigh"><option value="cru">cru</option><option value="cuit">cuit</option></select></label>
            </div>
            <div class="seg" role="radiogroup" aria-label="État des valeurs saisies">
              <span class="muted">Valeurs saisies pour :</span>
              <button type="button" role="radio" :aria-checked="f.entered === 'cru'" :aria-pressed="f.entered === 'cru'" @click="f.entered = 'cru'">cru</button>
              <button type="button" role="radio" :aria-checked="f.entered === 'cuit'" :aria-pressed="f.entered === 'cuit'" @click="f.entered = 'cuit'">cuit</button>
            </div>
          </template>
          <label v-if="!ex && !f.convertible">État de référence <select v-model="f.label"><option v-for="l in LABELS" :key="l" :value="l">{{ l }}</option></select></label>
        </fieldset>

        <fieldset class="box">
          <legend>Valeurs pour 100 {{ f.unit }}<template v-if="f.convertible"> ({{ f.entered }})</template></legend>
          <div class="grid5">
            <label v-for="k in KEYS" :key="k">{{ FIELD[k] }} <input type="number" min="0" step="any" v-model="f.v[k]" required></label>
          </div>
          <p v-if="warning" class="notice warn">⚠ Les kcal ({{ p(+f.v.kcal) }}) s'écartent de plus de 15 % de ce que laissent attendre les macros (environ {{ warning.expected }}). Avertissement non bloquant : vérifie la saisie.</p>
          <p v-if="ex && ex.composed" class="muted small">Aliment composé : valeurs calculées depuis la recette. Les modifier crée une surcharge réinitialisable.</p>
        </fieldset>

        <div class="grid2">
          <label>Portion usuelle : libellé <input v-model="f.portionLabel" placeholder="1 banane"></label>
          <label>Portion usuelle : poids (g) <input type="number" min="0" step="any" v-model="f.portionG"></label>
        </div>
        <label>Note ou source <input v-model="f.note"></label>
        <label class="check"><input type="checkbox" v-model="f.estimated"> Valeur estimée (affichée avec un astérisque)</label>

        <section v-if="ex" class="impact" aria-live="polite">
          <h3>Aperçu d'impact</h3>
          <p v-if="!impact.length">Cet aliment n'est utilisé dans aucun repas.</p>
          <template v-else>
            <p><b>{{ impact.length }}</b> repas concerné<template v-if="impact.length > 1">s</template>, dont <b>{{ moved.length }}</b> dont les kcal changent.</p>
            <ul v-if="moved.length"><li v-for="i in moved.slice(0, 5)" :key="i.id">{{ i.name }} : {{ kcal(i.before) }} → {{ kcal(i.after) }} kcal</li></ul>
            <p v-if="densityMoves.length"><b>{{ densityMoves.length }}</b> repas changent de densité :</p>
            <ul v-if="densityMoves.length"><li v-for="i in densityMoves.slice(0, 8)" :key="i.id">{{ i.name }} : {{ i.densityBefore.emoji }} {{ i.densityBefore.label }} → {{ i.densityAfter.emoji }} {{ i.densityAfter.label }}</li></ul>
          </template>
        </section>
        <ul class="errors" role="alert"><li v-for="e in errors" :key="e">{{ e }}</li></ul>
      </form>
      <template #footer>
        <button v-if="ex && ex.modified" type="button" class="btn" @click="revert">{{ ex.composed ? 'Revenir au calcul par la recette' : 'Revenir aux valeurs d\\'origine' }}</button>
        <button type="button" class="btn" @click="$emit('close')">Annuler</button>
        <button type="button" class="btn primary" :disabled="errors.length > 0" @click="submit">Enregistrer</button>
      </template>
    </modal>`,
};
