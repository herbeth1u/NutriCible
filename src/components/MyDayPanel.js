// src/components/MyDayPanel.js — « Ma journée » : repas du jour, portions, totaux en direct contre la cible.
// Les totaux suivent automatiquement toute modification d'aliment ou de profil (rien n'est stocké).
import * as C from '../calc.js';
import * as S from '../store.js';
import Bar from './Bar.js';
import IngredientList from './IngredientList.js';

export default {
  components: { Bar, IngredientList },
  setup() {
    const d = S.state.day;
    const copy = () => S.copyWithToast(C.dayToText(S.config.value.dayTypes.find((t) => t.id === d.dayType).label, S.dayRows.value, S.dayTotals.value, S.dayTarget.value), 'Journée copiée.');
    return { d, rows: S.dayRows, totals: S.dayTotals, target: S.dayTarget, status: S.profileStatus, dayTypes: S.config.value.dayTypes, factors: S.config.value.portionFactors, kcal: C.fmtKcal, g: C.fmtG, remove: S.removeFromDay, setFactor: S.setDayFactor, clear: S.clearDay, copy, profile: () => S.openDialog('profile'), close: () => { S.state.ui.dayOpen = false; }, config: S.config };
  },
  template: `
    <aside class="myday" aria-labelledby="myday-h">
      <div class="myday-head"><h2 id="myday-h">Ma journée</h2><button type="button" class="icon only-mobile" @click="close" aria-label="Fermer Ma journée">✕</button></div>
      <label>Type de journée
        <select v-model="d.dayType"><option v-for="t in dayTypes" :key="t.id" :value="t.id">{{ t.label }}</option></select>
      </label>
      <p v-if="!status.complete" class="notice small">Renseigne <button type="button" class="linklike" @click="profile">Mon profil</button> pour comparer à ta cible (il manque : {{ status.missing.join(', ') }}).</p>
      <ul v-if="rows.length" class="dayrows">
        <li v-for="r in rows" :key="r.index">
          <div class="dayrow-head"><b>{{ r.meal.name }}</b><button type="button" class="icon" @click="remove(r.index)" :aria-label="'Retirer ' + r.meal.name">✕</button></div>
          <div class="dayrow-ctl">
            <span class="seg" role="group" :aria-label="'Portion de ' + r.meal.name">
              <button v-for="f in factors" :key="f" type="button" :aria-pressed="r.factor === f" @click="setFactor(r.index, f)">×{{ f }}</button>
            </span>
            <label class="inline"><span class="sr-only">Portion libre</span><input type="number" min="0.1" max="5" step="0.05" :value="r.factor" @change="setFactor(r.index, $event.target.value)"></label>
            <span class="muted">{{ kcal(r.meal.totals.kcal * r.factor) }} kcal</span>
          </div>
          <details v-if="r.meal.lines.length"><summary>Ingrédients</summary><ingredient-list :lines="r.meal.lines" :factor="r.factor" /></details>
        </li>
      </ul>
      <p v-else class="empty">Ajoute des repas avec « + Ma journée ».</p>
      <div class="bars" aria-live="polite">
        <bar label="Kcal" :value="totals.kcal" :target="target ? target.kcal : null" unit="kcal" />
        <bar label="Protéines" :value="totals.protein" :min="target ? target.protein.min : null" :max="target ? target.protein.max : null" />
        <bar label="Glucides" :value="totals.carbs" :target="target ? target.carbs : null" />
        <bar label="Lipides" :value="totals.fat" :target="target ? target.fat : null" />
        <bar label="Fibres" :value="totals.fiber" :target="target ? target.fiber : null" />
      </div>
      <p v-if="!target" class="muted small">Sans profil, les totaux sont affichés sans comparaison à une cible.</p>
      <div class="actions"><button type="button" class="btn" :disabled="!rows.length" @click="copy">Copier la journée</button><button type="button" class="btn danger" :disabled="!rows.length" @click="clear">Vider</button></div>
    </aside>`,
};
