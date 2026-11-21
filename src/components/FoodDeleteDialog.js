// src/components/FoodDeleteDialog.js — suppression d'un aliment : liste des repas concernés, puis
// annuler, supprimer quand même (repas « ⚠ Incomplet ») ou remplacer par un autre aliment (même quantité).
import { computed, reactive } from '../vue.js';
import * as S from '../store.js';
import Modal from './Modal.js';

export default {
  components: { Modal },
  props: { foodId: { type: String, required: true } },
  emits: ['close'],
  setup(props, { emit }) {
    const food = S.foodIdx.value.get(props.foodId);
    const used = computed(() => S.mealsUsing(props.foodId));
    const f = reactive({ mode: 'delete', by: '' });
    const candidates = computed(() => [...S.foods.value].filter((x) => x.id !== props.foodId).sort((a, b) => (b.type === food.type) - (a.type === food.type) || a.name.localeCompare(b.name, 'fr')));
    const run = () => {
      S.deleteFood(props.foodId, f.mode, f.mode === 'replace' ? f.by : null);
      S.toast(food.origin === 'recueil' ? `« ${food.name} » supprimé : restaurable dans « Aliments supprimés ».` : `« ${food.name} » supprimé.`);
      emit('close');
    };
    return { food, used, f, candidates, run };
  },
  template: `
    <modal :title="'Supprimer « ' + food.name + ' »'" @close="$emit('close')">
      <p v-if="!used.length">Cet aliment n'est utilisé dans aucun repas.<template v-if="food.origin === 'recueil'"> Il restera restaurable dans la zone « Aliments supprimés ».</template></p>
      <template v-else>
        <p>Cet aliment est utilisé dans <b>{{ used.length }}</b> repas :</p>
        <ul class="used"><li v-for="m in used" :key="m.id">{{ m.name }}<span v-if="m.origin === 'perso'" class="badge">✏️ Perso</span></li></ul>
        <fieldset class="box">
          <legend>Que faire de ces repas ?</legend>
          <label class="check"><input type="radio" value="delete" v-model="f.mode"> Supprimer quand même : les repas concernés passent en « ⚠ Incomplet » (visibles, mais impossibles à ajouter à « Ma journée »).</label>
          <label class="check"><input type="radio" value="replace" v-model="f.mode"> Remplacer l'aliment par un autre dans ces repas (même quantité, modifiable ensuite).</label>
          <label v-if="f.mode === 'replace'">Aliment de remplacement
            <select v-model="f.by"><option value="" disabled>Choisir…</option><option v-for="x in candidates" :key="x.id" :value="x.id">{{ x.name }} ({{ x.type }})</option></select>
          </label>
        </fieldset>
      </template>
      <template #footer>
        <button type="button" class="btn" @click="$emit('close')">Annuler</button>
        <button type="button" class="btn danger" :disabled="used.length > 0 && f.mode === 'replace' && !f.by" @click="run">{{ used.length && f.mode === 'replace' ? 'Remplacer et supprimer' : 'Supprimer' }}</button>
      </template>
    </modal>`,
};
