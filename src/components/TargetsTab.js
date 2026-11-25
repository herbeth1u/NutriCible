// src/components/TargetsTab.js — « Cibles et hypothèses » : formules et coefficients génériques (config.json),
// cibles par type de journée (calculées depuis Mon profil), règles de densité et de tags, bilan hebdomadaire.
import { computed } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import { weekBalance } from '../week.js';

export default {
  setup() {
    const cfg = S.config;
    const week = computed(() => weekBalance(S.state.base.week, S.state.base.days, S.mealIdx.value, S.targets.value, cfg.value.dayTypes, { floor: cfg.value.planner.floor, step: cfg.value.planner.step }));
    const range = computed(() => {
      const p = S.state.user.profile; // lu dans le computed : le profil est remplacé à chaque enregistrement
      return p.weightMinKg && p.weightMaxKg && p.weightKg ? { min: p.weightMinKg, max: p.weightMaxKg, ok: p.weightKg >= p.weightMinKg && p.weightKg <= p.weightMaxKg } : null;
    });
    const outLabel = (id) => (id ? cfg.value.outings.find((o) => o.id === id).label : 'aucune sortie');
    const sgn = C.fmtSigned;
    const fit = (v) => C.fmtNum(v, v % 1 ? 2 : 0);
    return { cfg, targets: S.targets, status: S.profileStatus, week, range, outLabel, sgn, fit, profile: () => S.openDialog('profile'), kcal: C.fmtKcal, g: C.fmtG, n: C.fmtNum };
  },
  template: `
    <section aria-labelledby="t-targets">
      <h2 id="t-targets">Cibles et hypothèses</h2>
      <p v-if="!status.complete" class="notice">Les cibles se calculent à partir de <button type="button" class="linklike" @click="profile">Mon profil</button> (il manque : {{ status.missing.join(', ') }}). Les formules et coefficients génériques sont affichés ci-dessous.</p>
      <p v-else-if="range" class="notice" :class="{ warn: !range.ok }">Fourchette de poids cible : {{ n(range.min, 1) }}–{{ n(range.max, 1) }} kg : {{ range.ok ? 'poids actuel dans la fourchette.' : 'poids actuel hors de la fourchette.' }}</p>

      <h3>Méthode</h3>
      <ol class="method">
        <li><b>Métabolisme de base</b> : Mifflin-St Jeor, {{ cfg.calc.mifflin.perKg }} × poids (kg) + {{ cfg.calc.mifflin.perCm }} × taille (cm) − {{ -cfg.calc.mifflin.perYear }} × âge, puis + {{ cfg.calc.mifflin.male }} (homme) ou − {{ -cfg.calc.mifflin.female }} (femme).</li>
        <li><b>Dépense hors entraînement</b> : métabolisme de base × {{ cfg.calc.activityFactor }} par défaut, ou la valeur « au repos » de ta montre Garmin si tu la saisis (dans ce cas, aucun facteur d'activité n'est ajouté).</li>
        <li><b>Calories actives de référence</b> : milieu de la plage pour une sortie courte ({{ cfg.outings[0].minKcal }} à {{ cfg.outings[0].maxKcal }} kcal actives) ou moyenne ({{ cfg.outings[1].minKcal }} à {{ cfg.outings[1].maxKcal }}) ; valeur de ton profil pour une sortie longue ({{ n(cfg.outings[2].minKcal) }} kcal actives ou plus ; par défaut le seuil bas).</li>
        <li><b>Cible calorique</b> = (dépense hors entraînement + calories actives) × coefficient du type de journée. <b>Protéines</b> : {{ cfg.calc.protein.minPerKg }} à {{ cfg.calc.protein.maxPerKg }} g/kg. <b>Lipides</b> : coefficient en g/kg du type de journée. <b>Glucides</b> : le reste des kcal. <b>Fibres</b> : {{ cfg.calc.fiberPer1000kcal }} g pour 1 000 kcal.</li>
        <li>Objectif : <b>maintien du poids</b>, sans sous-alimentation chronique. La veille de sortie longue est un chargement modéré (kcal majorées, lipides réduits) ; la veille et le lendemain d'un repas plaisir sont un peu plus légers, sans restriction excessive ni jeûne compensatoire.</li>
      </ol>

      <h3>Cibles par type de journée</h3>
      <div class="table-wrap">
        <table class="targets">
          <thead><tr><th scope="col">Type de journée</th><th scope="col">Sortie</th><th scope="col">Coef.</th><th scope="col">Lipides g/kg</th><template v-if="targets"><th scope="col">Dépense</th><th scope="col">Cible kcal</th><th scope="col">Protéines g</th><th scope="col">Glucides g (g/kg)</th><th scope="col">Lipides g</th><th scope="col">Fibres g</th></template></tr></thead>
          <tbody>
            <tr v-for="d in cfg.dayTypes" :key="d.id">
              <th scope="row">{{ d.label }}</th><td>{{ outLabel(d.outing) }}</td><td>×{{ n(d.kcalFactor, d.kcalFactor % 1 ? 2 : 0) }}</td><td>{{ n(d.fatPerKg, 1) }}</td>
              <template v-if="targets">
                <td>{{ kcal(targets[d.id].expenditure) }}</td><td><b>{{ kcal(targets[d.id].kcal) }}</b></td>
                <td>{{ g(targets[d.id].protein.min) }}–{{ g(targets[d.id].protein.max) }}</td>
                <td>{{ g(targets[d.id].carbs) }} ({{ n(targets[d.id].carbsPerKg, 1) }})</td><td>{{ g(targets[d.id].fat) }}</td><td>{{ g(targets[d.id].fiber) }}</td>
              </template>
            </tr>
          </tbody>
        </table>
      </div>

      <h3>Règles automatiques</h3>
      <div class="grid2">
        <div class="box"><h4>Densité (kcal du repas, par catégorie)</h4>
          <table class="mini"><thead><tr><th scope="col">Catégorie</th><th scope="col">🟢 Léger</th><th scope="col">🟡 Modéré</th><th scope="col">🔴 Dense</th></tr></thead>
            <tbody><tr v-for="c in cfg.categories" :key="c"><th scope="row">{{ c }}</th><td>≤ {{ cfg.density[c].lightMax }}</td><td>≤ {{ cfg.density[c].moderateMax }}</td><td>&gt; {{ cfg.density[c].moderateMax }}</td></tr></tbody></table>
          <p class="muted small">Seuils appliqués aux kcal arrondies à l'unité, identiques pour le recueil et les repas perso.</p>
        </div>
        <div class="box"><h4>Tags calculés</h4>
          <ul>
            <li><b>{{ cfg.autoTags.okBeforeEffort.label }}</b> : fibres ≤ {{ cfg.autoTags.okBeforeEffort.maxFiber }} g ({{ cfg.autoTags.okBeforeEffort.categories.join(', ') }}).</li>
            <li><b>{{ cfg.autoTags.highProtein.label }}</b> : au moins {{ cfg.autoTags.highProtein.minProtein }} g de protéines.</li>
            <li><b>{{ cfg.autoTags.highFiber.label }}</b> : au moins {{ cfg.autoTags.highFiber.minFiber }} g de fibres.</li>
            <li><b>{{ cfg.autoTags.seasonal.label }}</b> : le repas contient un aliment qui a une saison (la saison est indiquée).</li>
          </ul>
        </div>
      </div>

      <h3>Bilan hebdomadaire d'une semaine type (cheat meal inclus)</h3>
      <div class="table-wrap">
        <table class="targets">
          <thead><tr><th scope="col">Jour</th><th scope="col">Journée type</th><th scope="col">Apports kcal</th>
            <template v-if="targets"><th scope="col">Dépense</th><th scope="col">Budget de maintien</th><th scope="col">Facteur conseillé</th><th scope="col">Apports ajustés</th><th scope="col">Écart</th></template></tr></thead>
          <tbody>
            <tr v-for="r in week.rows" :key="r.label"><th scope="row">{{ r.label }}</th><td>{{ r.day.name }}</td><td>{{ kcal(r.totals.kcal) }}</td>
              <template v-if="targets"><td>{{ kcal(r.target.expenditure) }}</td><td>{{ kcal(r.budget) }}</td><td>{{ r.fixed ? 'fixe' : '×' + fit(r.fit) }}</td><td>{{ kcal(r.adjusted.kcal) }}</td><td>{{ sgn(r.adjusted.kcal - r.budget) }}</td></template></tr>
          </tbody>
          <tfoot><tr><th scope="row" colspan="2">Semaine</th><td><b>{{ kcal(week.total.kcal) }}</b> (≈ {{ kcal(week.average) }} par jour)</td>
            <template v-if="targets"><td><b>{{ kcal(week.expenditure) }}</b></td><td><b>{{ kcal(week.budgetTotal) }}</b></td><td></td><td><b>{{ kcal(week.adjusted.kcal) }}</b></td><td></td></template></tr></tfoot>
        </table>
      </div>
      <p v-if="targets" class="notice" :class="{ warn: Math.abs(week.adjustedBalance) > 300 }" aria-live="polite">
        Solde hebdomadaire avec les portions d'origine : <b>{{ sgn(week.balance) }} kcal</b> ({{ sgn(week.balance / 7) }} par jour).
        Avec les facteurs conseillés : <b>{{ sgn(week.adjustedBalance) }} kcal</b> ({{ sgn(week.adjustedBalance / 7) }} par jour), soit un maintien.
      </p>
      <p class="muted small">Les journées types sont dimensionnées pour un adulte moyen : le <b>budget de maintien</b> de chaque jour est calculé ici à partir de ton profil. Il part de la dépense du jour (coefficient du type de journée compris) et répartit le reste de la semaine pour que la somme des apports égale la somme des dépenses ; le jour du cheat meal reste tel quel (bloc fixe) et aucun jour ne descend sous 90 % de sa dépense. Le <b>facteur conseillé</b> (par pas de {{ n(cfg.planner.step * 100) }} %) est celui à appliquer aux portions de la journée type, par exemple avec « Ajuster à ma cible ». Semaine type : une sortie chaque soir du lundi au jeudi, repos le vendredi (veille de sortie longue), sortie longue le samedi, récupération le dimanche ; un seul cheat meal par semaine, un jour de sortie courte.</p>
    </section>`,
};
