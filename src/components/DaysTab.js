// src/components/DaysTab.js — journées types : composition, totaux, écart à la cible, ajustement et chargement.
import { computed, reactive } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Bar from './Bar.js';

export default {
  components: { Bar },
  setup() {
    const fits = reactive({}); // facteur de portion global par journée (« Ajuster à ma cible »)
    const idx = S.mealIdx;
    const stored = (day) => day.items.map(([meal, factor]) => ({ meal, factor }));
    const days = computed(() => S.state.base.days.map((day) => {
      const fit = fits[day.id] ?? 1;
      const items = day.items.map(([meal, factor]) => ({ meal, factor: Math.round(factor * fit * 100) / 100 }));
      const { totals, missing } = C.dayTotals(items, idx.value);
      return { day, fit, totals, missing, target: S.targets.value?.[day.dayType] ?? null, rows: items.map((it) => ({ meal: idx.value.get(it.meal), factor: it.factor })).filter((r) => r.meal) };
    }));
    const label = (id) => S.config.value.dayTypes.find((t) => t.id === id)?.label ?? id;
    const adjust = (x) => { fits[x.day.id] = C.fitFactor(C.dayTotals(stored(x.day), idx.value).totals.kcal, x.target.kcal); };
    const load = (x) => { S.loadDay(x.day, x.fit); S.toast(`« ${x.day.name} » chargée dans Ma journée.`); };
    const delta = (x) => (x.target ? Math.round(x.totals.kcal - x.target.kcal) : null);
    return { days, fits, label, adjust, load, delta, status: S.profileStatus, profile: () => S.openDialog('profile'), kcal: C.fmtKcal, g: C.fmtG, n: (v) => C.fmtNum(v, v % 1 ? 2 : 0) };
  },
  template: `
    <section aria-labelledby="t-days">
      <h2 id="t-days">Journées types</h2>
      <p class="muted">Une journée complète par type de journée, composée de repas du recueil. Les repas sont dimensionnés pour un adulte actif moyen : une fois ton profil renseigné, « Ajuster à ma cible » calcule un facteur de portion global (par pas de 5 %).</p>
      <p v-if="!status.complete" class="notice">Renseigne <button type="button" class="linklike" @click="profile">Mon profil</button> pour voir l'écart à ta cible (il manque : {{ status.missing.join(', ') }}). Les totaux restent affichés sans comparaison.</p>
      <article v-for="x in days" :key="x.day.id" class="card day">
        <div class="card-top"><h3 class="card-title">{{ x.day.name }}</h3><span class="badge">{{ label(x.day.dayType) }}</span></div>
        <p class="muted">{{ x.day.note }}</p>
        <p v-if="x.missing.length" class="notice warn">⚠ Repas incomplet ou introuvable ignoré dans le total : {{ x.missing.join(', ') }}.</p>
        <table class="daytable">
          <caption class="sr-only">Repas de {{ x.day.name }}</caption>
          <tbody>
            <tr v-for="r in x.rows" :key="r.meal.id + r.factor">
              <th scope="row">{{ r.meal.name }}</th><td class="muted">{{ r.meal.category }}</td><td>×{{ n(r.factor) }}</td><td>{{ kcal(r.meal.totals.kcal * r.factor) }} kcal</td>
            </tr>
          </tbody>
          <tfoot><tr><th scope="row">Total</th><td colspan="3"><b>{{ kcal(x.totals.kcal) }} kcal</b> · P {{ g(x.totals.protein) }} g · G {{ g(x.totals.carbs) }} g · L {{ g(x.totals.fat) }} g · F {{ g(x.totals.fiber) }} g</td></tr></tfoot>
        </table>
        <div v-if="x.target" class="bars" aria-live="polite">
          <p><b>Cible : {{ kcal(x.target.kcal) }} kcal</b> · écart <b>{{ delta(x) > 0 ? '+' : '' }}{{ delta(x) }} kcal</b><template v-if="x.fit !== 1"> · portions ×{{ n(x.fit) }}</template></p>
          <bar label="Kcal" :value="x.totals.kcal" :target="x.target.kcal" unit="kcal" />
          <bar label="Protéines" :value="x.totals.protein" :min="x.target.protein.min" :max="x.target.protein.max" />
          <bar label="Glucides" :value="x.totals.carbs" :target="x.target.carbs" />
        </div>
        <div class="actions">
          <button type="button" class="btn" :disabled="!x.target" @click="adjust(x)">Ajuster à ma cible</button>
          <button type="button" class="btn" v-if="x.fit !== 1" @click="delete fits[x.day.id]">Revenir aux portions d'origine</button>
          <button type="button" class="btn primary" @click="load(x)">Charger dans Ma journée</button>
        </div>
      </article>
    </section>`,
};
