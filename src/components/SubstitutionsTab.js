// src/components/SubstitutionsTab.js — substitutions et ajustements :
// équivalences d'aliments à kcal constantes, et lecture des calories actives Garmin pour caler les repas.
import { computed, reactive } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';

export default {
  setup() {
    const sub = reactive({ id: '', qty: 100 });
    const sorted = computed(() => [...S.foods.value].sort((a, b) => a.name.localeCompare(b.name, 'fr')));
    const base = computed(() => S.foodIdx.value.get(sub.id) ?? null);
    // Proximité = écart des parts de protéines, glucides et lipides par kcal ; on garde le même type d'aliment.
    const share = (f) => { const k = f.per100.kcal || 1; return [f.per100.protein * 4 / k, f.per100.carbs * 4 / k, f.per100.fat * 9 / k]; };
    const similar = computed(() => {
      const b = base.value;
      if (!b || !(+sub.qty > 0) || !(b.per100.kcal > 0)) return [];
      const sb = share(b);
      return S.foods.value.filter((f) => f.id !== b.id && f.type === b.type && f.per100.kcal > 0)
        .map((f) => ({ f, d: share(f).reduce((s, v, i) => s + Math.abs(v - sb[i]), 0), qty: (+sub.qty * b.per100.kcal) / f.per100.kcal }))
        .sort((x, y) => x.d - y.d).slice(0, 6);
    });

    const act = reactive({ kcal: null });
    const outing = computed(() => (act.kcal === null || act.kcal === '' || !(+act.kcal >= 0) ? null : [...S.config.value.outings].reverse().find((o) => +act.kcal >= o.minKcal)));
    const dayType = computed(() => (outing.value ? S.config.value.dayTypes.find((d) => d.outing === outing.value.id && d.kcalFactor === 1) : null));
    const today = computed(() => {
      const t = S.targets.value;
      if (!t || !outing.value) return null;
      const cfg = S.config.value;
      const rest = C.restKcal(S.state.user.profile, cfg.calc);
      const kcal = rest + +act.kcal;
      return { kcal, ref: t[dayType.value.id].kcal, factor: C.fitFactor(t[dayType.value.id].kcal, kcal) };
    });
    return { sub, sorted, base, similar, act, outing, dayType, today, status: S.profileStatus, cfg: S.config, kcal: C.fmtKcal, q: C.fmtQty, p: C.fmtPer100, n: C.fmtNum, profile: () => S.openDialog('profile') };
  },
  template: `
    <section aria-labelledby="t-subs">
      <h2 id="t-subs">Substitutions et ajustements</h2>

      <h3>Échanger un aliment</h3>
      <p class="muted">Pour garder les mêmes kcal, remplace l'aliment par un autre du même type en ajustant la quantité. Les aliments proposés ont la répartition protéines / glucides / lipides la plus proche. Dans un repas, change l'aliment depuis le créateur de repas (« Dupliquer » puis « Modifier »).</p>
      <div class="box form">
        <div class="grid2">
          <label>Aliment à remplacer <select v-model="sub.id"><option value="">Choisir…</option><option v-for="f in sorted" :key="f.id" :value="f.id">{{ f.name }}</option></select></label>
          <label>Quantité ({{ base ? (base.unit) : 'g' }}, état de référence) <input type="number" min="1" step="any" v-model="sub.qty"></label>
        </div>
        <p v-if="base" class="muted small">{{ base.name }} : {{ p(base.per100.kcal) }} kcal pour 100 {{ base.unit }}<template v-if="base.convertible"> ({{ base.state }})</template>.</p>
        <ul v-if="similar.length" class="used">
          <li v-for="s in similar" :key="s.f.id"><b>{{ q(s.qty) }} {{ s.f.unit }}</b> de {{ s.f.name }} <span class="muted">({{ p(s.f.per100.kcal) }} kcal, P {{ p(s.f.per100.protein) }} · G {{ p(s.f.per100.carbs) }} · L {{ p(s.f.per100.fat) }} pour 100)</span></li>
        </ul>
        <p v-else-if="base" class="muted">Aucun aliment du même type à proposer.</p>
      </div>

      <h3>Ajuster les quantités à la dépense réelle du jour</h3>
      <ul>
        <li>Les repas du recueil sont dimensionnés pour un adulte actif moyen : ajuste les portions avec les boutons ×0,75, ×1, ×1,25 (ou une valeur libre) dans « Ma journée », ou avec « Ajuster à ma cible » dans les journées types.</li>
        <li>Plus la dépense du jour est haute, plus tu augmentes les <b>glucides</b> (féculents, fruits, aliments de sport) ; les protéines restent à {{ cfg.calc.protein.minPerKg }}–{{ cfg.calc.protein.maxPerKg }} g/kg et varient peu.</li>
        <li>Si tu as souvent faim, privilégie le volume (légumes, légumineuses, fibres, fromage blanc) avant d'augmenter les matières grasses ; garde de l'énergie suffisante pour soutenir l'entraînement.</li>
        <li>Les aliments pesés crus ou cuits : utilise le switch Cru / Cuit d'une ligne d'ingrédient, les kcal et les macros ne changent pas.</li>
      </ul>

      <h3>Lire mes calories actives Garmin</h3>
      <p class="muted">Le type de sortie se lit sur les <b>calories actives</b> de la montre : <template v-for="(o, i) in cfg.outings" :key="o.id"><b>{{ o.label.toLowerCase() }}</b> {{ o.maxKcal === null ? n(o.minKcal) + ' ou plus' : n(o.minKcal) + ' à ' + n(o.maxKcal) }}<template v-if="i < cfg.outings.length - 1">, </template></template>.</p>
      <div class="box form">
        <label>Calories actives du jour (kcal) <input type="number" min="0" step="10" v-model="act.kcal"></label>
        <p v-if="outing" aria-live="polite">C'est une <b>{{ outing.label.toLowerCase() }}</b> : prends la journée type « <b>{{ dayType.label }}</b> ».</p>
        <template v-if="outing && today">
          <p>Cible du jour avec cette dépense : <b>{{ kcal(today.kcal) }} kcal</b> (journée type : {{ kcal(today.ref) }} kcal) : portions de la journée type × <b>{{ n(today.factor, 2) }}</b>.</p>
        </template>
        <p v-else-if="outing && !status.complete" class="muted small">Renseigne <button type="button" class="linklike" @click="profile">Mon profil</button> pour obtenir la cible exacte du jour.</p>
      </div>
    </section>`,
};
