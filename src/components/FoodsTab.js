// src/components/FoodsTab.js — gestion complète des aliments : recherche, filtres, tri sur chaque colonne,
// valeurs dans les deux états (cru/cuit), modifier / dupliquer / supprimer / réinitialiser / restaurer.
import { computed, ref } from '../vue.js';
import * as C from '../calc.js';
import * as S from '../store.js';
import Pills from './Pills.js';

const COLS = [['name', 'Aliment'], ['type', 'Type'], ['season', 'Saison'], ['kcal', 'Kcal'], ['protein', 'Prot.'], ['carbs', 'Gluc.'], ['fat', 'Lip.'], ['fiber', 'Fibres'], ['usage', 'Repas']];

export default {
  components: { Pills },
  setup() {
    const ff = S.state.ui.foodFilters;
    const view = ref('ref'); // valeurs affichées pour les aliments ⇄ : état de référence, cru ou cuit
    const seasonLabel = (id) => S.config.value.seasons.find((s) => s.id === id)?.label ?? 'Toute l\'année';
    const shown = (x) => (view.value === 'ref' ? x.per100 : C.per100In(x, view.value));
    const seasonOpts = computed(() => [...S.config.value.seasons.map((s) => ({ value: s.id, label: s.label })), { value: 'none', label: 'Toute l\'année' }]);

    const sortVal = (x, k) => (k === 'name' || k === 'type' ? x[k] : k === 'season' ? seasonLabel(x.season) : k === 'usage' ? S.usage.value.get(x.id) ?? 0 : shown(x)[k]);
    const rows = computed(() => {
      const q = C.normalize(ff.q);
      const list = S.foods.value.filter((x) => {
        if (q && !C.normalize(x.name).includes(q)) return false;
        if (ff.types.length && !ff.types.includes(x.type)) return false;
        if (ff.seasons.length && !ff.seasons.includes(x.season ?? 'none')) return false;
        if (ff.origins.length && !ff.origins.some((o) => (o === 'Perso' ? x.origin === 'perso' : o === 'Recueil' ? x.origin === 'recueil' : x.modified))) return false;
        const n = S.usage.value.get(x.id) ?? 0;
        return !(ff.usage === 'used' && !n) && !(ff.usage === 'unused' && n);
      });
      return list.sort((a, b) => {
        const va = sortVal(a, ff.sort); const vb = sortVal(b, ff.sort);
        const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb), 'fr');
        return (c || a.name.localeCompare(b.name, 'fr')) * ff.dir;
      });
    });
    const sortBy = (k) => { if (ff.sort === k) ff.dir = -ff.dir; else { ff.sort = k; ff.dir = 1; } };
    const arrow = (k) => (ff.sort === k ? (ff.dir === 1 ? ' ↑' : ' ↓') : '');
    const ariaSort = (k) => (ff.sort === k ? (ff.dir === 1 ? 'ascending' : 'descending') : 'none');
    const split = (x) => { const p = shown(x); const a = p.protein * 4; const b = p.carbs * 4; const c = p.fat * 9; const t = a + b + c || 1; return { p: (a / t) * 100, g: (b / t) * 100, l: (c / t) * 100 }; };

    const modifiedCount = computed(() => Object.keys(S.state.user.foodEdits).length);
    const add = () => S.openDialog('food', { foodId: null });
    const edit = (x) => S.openDialog('food', { foodId: x.id });
    const remove = (x) => S.openDialog('foodDelete', { foodId: x.id });
    const dup = (x) => {
      let name = `${x.name} (copie)`;
      for (let i = 2; C.nameTaken(name, S.foodNames()); i += 1) name = `${x.name} (copie ${i})`;
      const def = { name, type: x.type, season: x.season, unit: x.unit, state: x.state, per100: x.per100, portion: x.portion, note: x.note, estimated: x.estimated };
      if (x.convertible) { def.coef = x.coef; def.weigh = x.weigh; }
      S.openDialog('food', { foodId: S.addFood(def) });
      S.toast('Copie créée : modifie-la puis enregistre.');
    };
    const reset = (x) => { S.resetFood(x.id); S.toast(x.composed ? 'Retour au calcul par la recette.' : 'Valeurs d\'origine rétablies.'); };
    const resetAll = () => { if (window.confirm(`Réinitialiser les ${modifiedCount.value} aliment(s) du recueil que tu as modifiés ?`)) S.resetAllFoodEdits(); };
    const meals = (x) => { Object.assign(S.state.ui.filters, C.defaultFilters(), { foods: [x.id] }); S.setTab('meals'); };
    const resetFilters = () => Object.assign(ff, { q: '', types: [], seasons: [], origins: [], usage: '' });
    return { ff, view, COLS, rows, seasonOpts, seasonLabel, shown, split, sortBy, arrow, ariaSort, types: S.foodTypes, usage: S.usage, deleted: S.deletedFoods, modifiedCount, total: computed(() => S.foods.value.length), add, edit, remove, dup, reset, resetAll, meals, resetFilters, restore: S.restoreFood, p: C.fmtPer100 };
  },
  template: `
    <section aria-labelledby="t-foods">
      <h2 id="t-foods" class="sr-only">Aliments</h2>
      <div class="toolbar">
        <input type="search" class="grow" v-model="ff.q" placeholder="Rechercher un aliment…" aria-label="Rechercher un aliment">
        <button type="button" class="btn primary" @click="add">+ Ajouter un aliment</button>
        <button type="button" class="btn" :disabled="!modifiedCount" @click="resetAll">Réinitialiser toutes mes modifications ({{ modifiedCount }})</button>
      </div>
      <details class="filters" open>
        <summary>Filtres</summary>
        <pills label="Type d'aliment" :options="types" v-model="ff.types" />
        <pills label="Saison" :options="seasonOpts" v-model="ff.seasons" />
        <pills label="Origine" :options="['Recueil', 'Perso', 'Modifié']" v-model="ff.origins" />
        <div class="row">
          <label>Utilisation <select v-model="ff.usage"><option value="">Tous</option><option value="used">Utilisés dans des repas</option><option value="unused">Non utilisés</option></select></label>
          <label>Valeurs affichées (aliments ⇄)
            <select v-model="view"><option value="ref">État de référence</option><option value="cru">Cru</option><option value="cuit">Cuit</option></select>
          </label>
          <button type="button" class="btn" @click="resetFilters">Réinitialiser les filtres</button>
        </div>
      </details>
      <p role="status" aria-live="polite"><b>{{ rows.length }}</b> aliments sur {{ total }} · valeurs pour 100 g (100 ml pour les liquides) · * valeur estimée</p>

      <div class="table-wrap">
        <table class="foods-table">
          <thead><tr>
            <th v-for="c in COLS" :key="c[0]" scope="col" :aria-sort="ariaSort(c[0])"><button type="button" class="linklike" @click="sortBy(c[0])">{{ c[1] }}{{ arrow(c[0]) }}</button></th>
            <th scope="col">Macros</th><th scope="col">Actions</th>
          </tr></thead>
          <tbody>
            <tr v-for="x in rows" :key="x.id" :class="{ perso: x.origin === 'perso' }">
              <th scope="row">{{ x.name }}<abbr v-if="x.estimated" title="valeur estimée">*</abbr>
                <span v-if="x.origin === 'perso'" class="badge perso">✏️ Perso</span><span v-if="x.composed" class="badge">Composé</span><span v-if="x.modified" class="badge warn">Modifié</span>
                <small class="muted block">{{ x.convertible ? (view === 'ref' ? x.state : view) : x.state }}</small></th>
              <td>{{ x.type }}</td><td>{{ seasonLabel(x.season) }}</td>
              <td>{{ p(shown(x).kcal) }}</td><td>{{ p(shown(x).protein) }}</td><td>{{ p(shown(x).carbs) }}</td><td>{{ p(shown(x).fat) }}</td><td>{{ p(shown(x).fiber) }}</td>
              <td>{{ usage.get(x.id) || 0 }}</td>
              <td><span class="split" :title="'Protéines ' + Math.round(split(x).p) + ' %, glucides ' + Math.round(split(x).g) + ' %, lipides ' + Math.round(split(x).l) + ' % des kcal'"><i class="sp" :style="{ width: split(x).p + '%' }"></i><i class="sg" :style="{ width: split(x).g + '%' }"></i><i class="sl" :style="{ width: split(x).l + '%' }"></i></span></td>
              <td class="acts">
                <button type="button" class="btn sm" @click="edit(x)">Modifier</button>
                <button type="button" class="btn sm" @click="dup(x)">Dupliquer</button>
                <button type="button" class="btn sm" v-if="x.modified" @click="reset(x)">Réinitialiser</button>
                <button type="button" class="btn sm" v-if="usage.get(x.id)" @click="meals(x)">Repas</button>
                <button type="button" class="btn sm danger" @click="remove(x)">Supprimer</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="foods-cards">
        <article v-for="x in rows" :key="'c' + x.id" class="card" :class="{ perso: x.origin === 'perso' }">
          <h3 class="card-title">{{ x.name }}<abbr v-if="x.estimated" title="valeur estimée">*</abbr></h3>
          <div class="badges"><span class="badge">{{ x.type }}</span><span class="badge soft">{{ x.convertible ? (view === 'ref' ? x.state : view) : x.state }}</span><span v-if="x.season" class="badge soft">{{ seasonLabel(x.season) }}</span>
            <span v-if="x.origin === 'perso'" class="badge perso">✏️ Perso</span><span v-if="x.composed" class="badge">Composé</span><span v-if="x.modified" class="badge warn">Modifié</span></div>
          <div class="macros"><strong class="kcal">{{ p(shown(x).kcal) }} kcal</strong><span>P <b>{{ p(shown(x).protein) }}</b></span><span>G <b>{{ p(shown(x).carbs) }}</b></span><span>L <b>{{ p(shown(x).fat) }}</b></span><span>F <b>{{ p(shown(x).fiber) }}</b></span><span class="muted">{{ usage.get(x.id) || 0 }} repas</span></div>
          <div class="actions">
            <button type="button" class="btn sm" @click="edit(x)">Modifier</button><button type="button" class="btn sm" @click="dup(x)">Dupliquer</button>
            <button type="button" class="btn sm" v-if="x.modified" @click="reset(x)">Réinitialiser</button><button type="button" class="btn sm" v-if="usage.get(x.id)" @click="meals(x)">Repas</button>
            <button type="button" class="btn sm danger" @click="remove(x)">Supprimer</button>
          </div>
        </article>
      </div>
      <p v-if="!rows.length" class="empty">Aucun aliment ne correspond.</p>

      <details v-if="deleted.length" class="box" open>
        <summary>Aliments supprimés ({{ deleted.length }})</summary>
        <ul class="used"><li v-for="x in deleted" :key="x.id">{{ x.name }} <button type="button" class="btn sm" @click="restore(x.id)">Restaurer</button></li></ul>
      </details>
    </section>`,
};
