// src/components/PlannerTab.js — planificateur de semaine : budget par jour, repas tirés au sort (planning mémorisé),
// régénération d'un jour, ajustements de portions (semaine et jour), retrait, rétablissement et remplacement d'un repas, bilan hebdomadaire
// et liste de courses dédoublonnée. Le moteur est dans src/planner.js ; ici seulement l'affichage et les actions du store.
// Tout ce qui est affiché est dérivé du planning (rien n'est stocké).
import { computed } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Bar from './Bar.js';
import TweakMark from './TweakMark.js';

const STATUS = { maintien: 'maintien du poids', surplus: 'surplus', déficit: 'déficit' };

export default {
  components: { Bar, TweakMark },
  setup() {
    const view = S.planView;
    const dayTypes = S.config.value.dayTypes;
    const minLegume = S.config.value.planner.rules.minLegumeMeals;
    const { maxPerMeal, minDistinctShare } = S.config.value.planner.variety;
    const distinctPct = Math.round(minDistinctShare * 100);
    const adjust = S.config.value.planner.adjust;
    // Un jour a-t-il des ajustements qui changent ses portions ? (le jour fixe n'en a pas)
    const adjusted = (d) => Math.abs(d.mult - 1) > 1e-9;
    const hasFixed = computed(() => !!view.value?.days.some((d) => d.fixed));
    const toMyDayDisabled = (d) => !d.items.some((it) => it.meal && !it.meal.incomplete);
    const sameAsTemplate = computed(() => !S.state.plan || S.state.plan.days.every((d, i) => d.dayType === S.plannerCtx.value.week[i]?.dayType));
    // Avertissements (règle non tenue, jaune) et informations (à savoir, bleu) d'un jour (ou de la semaine : `label` null).
    const warnings = (label, level = 'warn') => view.value.warnings.filter((w) => w.day === label && w.level === level);
    // Écart signé, arrondi à l'unité comme tout l'affichage : jamais « -0 » ni « +0 ».
    const sign = C.fmtSigned;
    const sheet = (d, it) => S.openMealSheet(it.id, null, { portion: d.factor, replaceWhere: { where: 'plan', day: d.index, mealId: it.id }, planDay: d.index, slot: it.slot });
    const toMyDay = (d) => {
      if (S.state.day.items.length && !window.confirm('Remplacer le contenu de « Ma journée » par ce jour du planning ?')) return;
      if (S.addPlanDayToMyDay(d.index)) S.toast(`${d.label} ajouté à Ma journée.`);
    };
    return {
      state: S.state, view, dayTypes, minLegume, maxPerMeal, distinctPct, adjust, adjusted, hasFixed, toMyDayDisabled, sameAsTemplate, warnings, sign, sheet, toMyDay, status: S.profileStatus, STATUS,
      setAdjust: S.setPlanAdjust, setDayAdjust: S.setPlanDayAdjust, realign: (d) => S.realignPlanDay(d.index),
      swapMeal: (d, i) => S.openDialog('mealSwap', { dayIndex: d.index, mealIndex: i }), removeMeal: (d, i) => S.removePlanMeal(d.index, i), restoreMeal: (d, j) => S.restorePlanMeal(d.index, j),
      dayResetLabel: (d) => `Remettre l'ajustement du ${d.label} à ×1`, n2: (v) => C.fmtNum(v, 2), pct: (v) => C.fmtSigned((v - 1) * 100),
      generate: () => S.generatePlan(), reset: () => S.generatePlan({ reset: true }), undo: () => { if (S.undoPlan()) S.toast('Dernière modification annulée.'); },
      regenerate: (d) => S.regeneratePlanDay(d.index), setType: S.setPlanDayType, copyList: S.copyShoppingList, profile: () => S.openDialog('profile'),
      kcal: C.fmtKcal, g: C.fmtG, fmtQty: C.fmtQty, unitOf: C.unitOf, n: (v) => C.fmtNum(v, v % 1 ? 2 : 0),
    };
  },
  template: `
    <section aria-labelledby="t-planner">
      <h2 id="t-planner">Planificateur de semaine</h2>
      <p class="muted">Une semaine de repas tirés au sort parmi le recueil, selon le type de chaque journée (la semaine type se règle dans l'onglet Cibles et hypothèses). Le budget de chaque jour vient de ta dépense (le jour du cheat meal est fixe, les autres jours se partagent le reste, jamais sous 90 % de leur dépense) ; un facteur de portion ramène chaque jour à son budget. Règles tenues : légumineuses au moins {{ minLegume }} fois dans la semaine, saumon au moins une fois, abats une fois au plus, lait et cacao sucré seulement après une sortie moyenne ou longue ; un repas peut revenir jusqu'à {{ maxPerMeal }} fois dans la semaine (jamais deux fois le même jour), avec au moins {{ distinctPct }} % de repas distincts. Les curseurs d'ajustement (semaine, jour) multiplient les portions calculées ; le Planificateur peut ajuster de quelques dizaines de grammes la quantité de quelques aliments pour mieux approcher vos cibles ; une pastille bleue signale un ajustement léger, une pastille jaune un ajustement important ; ⇄ remplace un repas par un autre repas proche (les portions du jour sont recalculées) ; ✕ retire un repas sans recalculer les autres portions : le total du jour baisse, et « Rétablir » le remet.</p>
      <p v-if="!status.complete" class="notice">Renseigne <button type="button" class="linklike" @click="profile">Mon profil</button> pour obtenir les budgets et les facteurs de portion (il manque : {{ status.missing.join(', ') }}). Sans profil, les repas sont tirés près d'une journée type, avec des portions ×1 et sans écart à la cible.</p>

      <div class="plan-actions">
        <button type="button" class="btn primary" @click="generate">Générer une nouvelle semaine</button>
        <button type="button" class="btn" :disabled="!state.planUndo" :title="state.planUndo ? 'Annuler : ' + state.planUndo.label : 'Rien à annuler'" @click="undo">Annuler</button>
        <button v-if="state.plan" type="button" class="btn" :disabled="sameAsTemplate" title="Remet les types de journée de la semaine type et tire de nouveaux repas" @click="reset">Semaine type</button>
      </div>

      <div v-if="view" class="globalfactor plan-adjust">
        <label>Ajustement de la semaine <b>×{{ n2(state.plan.adjust) }} ({{ pct(state.plan.adjust) }}&nbsp;%)</b>
          <input type="range" :min="adjust.week.min" :max="adjust.week.max" :step="adjust.step" :value="state.plan.adjust" @input="setAdjust($event.target.value)" aria-describedby="plan-adj-help">
        </label>
        <button type="button" class="btn sm" :disabled="state.plan.adjust === 1" aria-label="Remettre l'ajustement de la semaine à ×1" @click="setAdjust(1)">×1</button>
        <small id="plan-adj-help" class="muted">Multiplie les portions calculées de tous les jours. <template v-if="hasFixed">Le jour du cheat meal n'est pas concerné. </template>Le résultat réel se lit dans le bilan de la semaine (solde hebdomadaire, maintien, surplus ou déficit).</small>
      </div>

      <p v-if="!sameAsTemplate" class="muted small">Cette semaine ne suit pas ta semaine type : « Semaine type » la rétablit.</p>

      <p v-if="!view" class="empty">Aucune semaine pour l'instant : « Générer une nouvelle semaine » tire les repas de chaque jour. Le planning est enregistré dans ce navigateur et dans la sauvegarde JSON.</p>

      <template v-else>
        <div v-if="warnings(null).length" class="notice warn" role="status" aria-live="polite">
          <b>À noter pour la semaine</b>
          <ul class="plan-warn"><li v-for="w in warnings(null)" :key="w.code + w.text">⚠ {{ w.text }}</li></ul>
        </div>
        <div v-if="warnings(null, 'info').length" class="notice info" role="status" aria-live="polite">
          <b>Information</b>
          <ul class="plan-warn"><li v-for="w in warnings(null, 'info')" :key="w.code + w.text">ℹ {{ w.text }}</li></ul>
        </div>

        <article v-for="d in view.days" :key="d.index" class="card day plan-day" :aria-labelledby="'plan-h-' + d.index">
          <div class="card-top">
            <h3 class="card-title" :id="'plan-h-' + d.index">{{ d.label }}</h3>
            <label class="plan-type"><span class="sr-only">Type de journée du {{ d.label }}</span>
              <select :value="d.dayType.id" @change="setType(d.index, $event.target.value)">
                <option v-for="t in dayTypes" :key="t.id" :value="t.id">{{ t.label }}</option>
              </select>
            </label>
          </div>
          <ul v-if="warnings(d.label).length" class="plan-warn" role="status"><li v-for="w in warnings(d.label)" :key="w.code + w.text" class="notice warn">⚠ {{ w.text }}</li></ul>
          <ul v-if="warnings(d.label, 'info').length" class="plan-warn" role="status"><li v-for="w in warnings(d.label, 'info')" :key="w.code + w.text" class="notice info">ℹ {{ w.text }}</li></ul>
          <table class="daytable">
            <caption class="sr-only">Repas du {{ d.label }}</caption>
            <tbody>
              <tr v-for="(it, i) in d.items" :key="it.slot + it.id + '-' + i">
                <template v-if="it.meal">
                  <th scope="row"><span class="plan-meal"><button type="button" class="linklike dayrow-name" :title="'Ouvrir la fiche de ' + it.meal.name" @click="sheet(d, it)">{{ it.meal.name }}</button><tweak-mark v-if="it.tweaks" :meal="it.meal" :factor="d.factor" @open="sheet(d, it)" /></span></th>
                  <td class="muted">{{ it.slot }}</td>
                  <td>{{ kcal(it.meal.totals.kcal * d.factor) }} kcal</td>
                  <td class="plan-x">
                    <button type="button" class="icon" :aria-label="'Remplacer ce repas : ' + it.meal.name" title="Remplacer ce repas" @click="swapMeal(d, i)">⇄</button>
                    <button type="button" class="icon" :aria-label="'Retirer ' + it.meal.name" title="Retirer ce repas" @click="removeMeal(d, i)">✕</button>
                  </td>
                </template>
                <template v-else>
                  <th scope="row">⚠ repas introuvable</th><td class="muted">{{ it.slot }}</td><td></td>
                  <td class="plan-x">
                    <button type="button" class="icon" :aria-label="'Remplacer ce repas : repas introuvable (' + it.slot + ')'" title="Remplacer ce repas" @click="swapMeal(d, i)">⇄</button>
                    <button type="button" class="icon" :aria-label="'Retirer le repas introuvable (' + it.slot + ')'" title="Retirer ce repas" @click="removeMeal(d, i)">✕</button>
                  </td>
                </template>
              </tr>
            </tbody>
            <tfoot>
              <tr><th scope="row">Total</th><td colspan="3"><b>{{ kcal(d.adjusted.kcal) }} kcal</b> · P {{ g(d.adjusted.protein) }} g · G {{ g(d.adjusted.carbs) }} g · L {{ g(d.adjusted.fat) }} g · F {{ g(d.adjusted.fiber) }} g</td></tr>
            </tfoot>
          </table>
          <ul v-if="d.removedItems.length" class="plan-removed">
            <li v-for="(r, j) in d.removedItems" :key="r.slot + r.id + '-' + j">Retiré : <b>{{ r.meal ? r.meal.name : 'repas introuvable' }}</b> ({{ r.slot }}) · <button type="button" class="btn sm" :aria-label="'Rétablir ' + (r.meal ? r.meal.name : 'le repas introuvable')" @click="restoreMeal(d, j)">Rétablir</button></li>
          </ul>
          <p class="plan-meta">
            <template v-if="d.fixed">Jour fixe : le repas est un bloc estimé, sans facteur de portion.</template>
            <template v-else>Portions <b>×{{ n(d.factor) }}</b><template v-if="adjusted(d)"> (tirage ×{{ n2(d.base) }} · ajustements ×{{ n2(d.mult) }})</template></template>
            <template v-if="d.budget !== null"> · {{ d.fixed ? 'cible' : 'cible de maintien' }} <b>{{ kcal(d.budget) }} kcal</b> · écart <b>{{ sign(d.delta) }} kcal</b></template>
          </p>
          <div v-if="!d.fixed" class="globalfactor plan-adjust">
            <label>Ajustement du jour <b>×{{ n2(d.adjust) }}</b>
              <input type="range" :min="adjust.day.min" :max="adjust.day.max" :step="adjust.step" :value="d.adjust" :aria-label="'Ajustement du ' + d.label" @input="setDayAdjust(d.index, $event.target.value)">
            </label>
            <button type="button" class="btn sm" :disabled="d.adjust === 1" :aria-label="dayResetLabel(d)" @click="setDayAdjust(d.index, 1)">×1</button>
            <button type="button" class="btn sm" :disabled="d.budget === null" :aria-label="'Réaligner le ' + d.label + ' sur la cible'" title="Règle l'ajustement du jour pour que ses apports rejoignent la cible (utile après un retrait)" @click="realign(d)">Réaligner sur la cible</button>
          </div>
          <div class="actions">
            <button type="button" class="btn" :aria-label="'Regénérer le ' + d.label" @click="regenerate(d)">Regénérer ce jour</button>
            <button type="button" class="btn primary" :disabled="toMyDayDisabled(d)" :aria-label="'Ajouter le ' + d.label + ' à Ma journée'" @click="toMyDay(d)">Ajouter à Ma journée</button>
          </div>
        </article>

        <section class="card plan-summary" aria-labelledby="plan-sum-h">
          <h3 id="plan-sum-h" class="card-title">Bilan de la semaine</h3>
          <p><b>{{ kcal(view.week.total.kcal) }} kcal</b> · P {{ g(view.week.total.protein) }} g · G {{ g(view.week.total.carbs) }} g · L {{ g(view.week.total.fat) }} g · F {{ g(view.week.total.fiber) }} g</p>
          <p class="muted">Par jour en moyenne : {{ kcal(view.week.average) }} kcal · P {{ g(view.week.total.protein / view.days.length) }} g · G {{ g(view.week.total.carbs / view.days.length) }} g · L {{ g(view.week.total.fat / view.days.length) }} g · F {{ g(view.week.total.fiber / view.days.length) }} g</p>
          <p>Légumineuses : <b>{{ view.week.legumes.count }} repas</b> (minimum {{ view.week.legumes.min }}).</p>
          <template v-if="view.week.expenditure !== null">
            <div class="bars"><bar label="Apports de la semaine" :value="view.week.total.kcal" :target="view.week.expenditure" unit="kcal" /></div>
            <p>Dépense de la semaine : {{ kcal(view.week.expenditure) }} kcal · <b>solde hebdomadaire {{ sign(view.week.balance) }} kcal</b> ({{ STATUS[view.week.status] }}).</p>
          </template>
          <p v-else class="muted small">Sans profil, le bilan n'a pas de dépense à laquelle se comparer : renseigne « Mon profil ».</p>
        </section>

        <section class="card plan-shop" aria-labelledby="plan-shop-h">
          <div class="card-top">
            <h3 id="plan-shop-h" class="card-title">Liste de courses</h3>
            <button type="button" class="btn" :disabled="!view.shopping.groups.length" @click="copyList">Copier la liste</button>
          </div>
          <p class="muted small">Aliments dédoublonnés, quantités cumulées sur la semaine (portions de chaque jour comprises), regroupés par type. Les féculents et légumes qui se pèsent cru ou cuit sont comptés crus.</p>
          <div v-for="grp in view.shopping.groups" :key="grp.type" class="shop-group">
            <h4>{{ grp.type }}</h4>
            <ul class="shoplist">
              <li v-for="e in grp.items" :key="e.id"><span class="q">{{ fmtQty(e.qty) }}&nbsp;{{ e.unit }}</span> {{ e.name }}<span v-if="e.state" class="muted"> ({{ e.state }})</span></li>
            </ul>
          </div>
          <p v-if="!view.shopping.groups.length" class="empty">Aucun aliment à acheter.</p>
          <p v-if="view.shopping.cheat" class="muted small">Le cheat meal (composition libre) n'est pas compté.</p>
        </section>
      </template>
    </section>`,
};
