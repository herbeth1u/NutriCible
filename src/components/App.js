// src/components/App.js — coque de l'application : en-tête, bandeaux, onglets, panneau « Ma journée », boîtes de dialogue.
import { computed } from '../vue.js';
import * as S from '../store.js';
import MealsTab from './MealsTab.js';
import DaysTab from './DaysTab.js';
import TargetsTab from './TargetsTab.js';
import SubstitutionsTab from './SubstitutionsTab.js';
import FoodsTab from './FoodsTab.js';
import MyDayPanel from './MyDayPanel.js';
import ProfileDialog from './ProfileDialog.js';
import MealFormDialog from './MealFormDialog.js';
import FoodFormDialog from './FoodFormDialog.js';
import FoodDeleteDialog from './FoodDeleteDialog.js';
import ExportDialog from './ExportDialog.js';
import BackupDialog from './BackupDialog.js';

const TABS = [['meals', 'Repas'], ['days', 'Journées types'], ['targets', 'Cibles et hypothèses'], ['subs', 'Substitutions et ajustements'], ['foods', 'Aliments']];
const VIEWS = { meals: 'meals-tab', days: 'days-tab', targets: 'targets-tab', subs: 'substitutions-tab', foods: 'foods-tab' };
const DIALOGS = { profile: ProfileDialog, meal: MealFormDialog, food: FoodFormDialog, foodDelete: FoodDeleteDialog, export: ExportDialog, backup: BackupDialog };
const THEMES = { auto: ['🌓', 'automatique'], dark: ['🌙', 'sombre'], light: ['☀️', 'clair'] };

export default {
  components: { MealsTab, DaysTab, TargetsTab, SubstitutionsTab, FoodsTab, MyDayPanel },
  setup() {
    const dlg = computed(() => S.state.ui.dialog);
    const onTabKey = (e) => {
      const i = TABS.findIndex((t) => t[0] === S.state.ui.tab);
      const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? TABS.length - 1 : null;
      if (next === null) return;
      e.preventDefault();
      const t = TABS[(next + TABS.length) % TABS.length][0];
      S.setTab(t);
      document.getElementById(`tab-${t}`)?.focus();
    };
    return {
      state: S.state, tabs: TABS, views: VIEWS, status: S.profileStatus, count: computed(() => S.state.day.items.length),
      dlgComp: computed(() => (dlg.value ? DIALOGS[dlg.value.name] : null)), dlgProps: computed(() => dlg.value?.props ?? {}),
      dlgKey: computed(() => (dlg.value ? JSON.stringify([dlg.value.name, dlg.value.props.foodId ?? null, dlg.value.props.draft?.id ?? null, dlg.value.props.mode ?? null]) : '')),
      open: S.openDialog, close: S.closeDialog, setTab: S.setTab, cycle: S.cycleTheme, onTabKey, themeIcon: computed(() => THEMES[S.state.theme][0]), themeName: computed(() => THEMES[S.state.theme][1]),
      toggleDay: () => { S.state.ui.dayOpen = !S.state.ui.dayOpen; },
    };
  },
  template: `
    <div class="app">
      <a class="skip" href="#main">Aller au contenu</a>
      <header class="app-head">
        <div class="brand"><span aria-hidden="true">🎯</span><h1>NutriCible</h1><span class="muted">maintien du poids</span></div>
        <div class="head-actions">
          <button type="button" class="btn" @click="open('profile')">Mon profil<span v-if="!status.complete" class="dot" title="À renseigner"></span></button>
          <button type="button" class="btn primary" @click="open('export')">Exporter vers Notion</button>
          <button type="button" class="btn" @click="open('backup')">Sauvegarde</button>
          <button type="button" class="btn" @click="cycle" :aria-label="'Thème : ' + themeName + ' (changer)'" :title="'Thème : ' + themeName">{{ themeIcon }}</button>
          <button type="button" class="btn only-mobile" @click="toggleDay" :aria-expanded="state.ui.dayOpen">Ma journée ({{ count }})</button>
        </div>
      </header>

      <div v-if="state.error" class="banner warn" role="alert">{{ state.error }}</div>
      <p v-else-if="!state.ready" class="boot">Chargement…</p>
      <template v-else>
        <div v-if="!state.storageOk" class="banner warn" role="alert">Le stockage du navigateur est indisponible : l'appli reste utilisable en mémoire, mais ton profil et tes repas perso ne seront pas conservés. Utilise « Sauvegarde » pour les garder.</div>
        <div v-if="!status.complete" class="banner" role="status">Renseigne <button type="button" class="linklike" @click="open('profile')">Mon profil</button> pour obtenir tes cibles : tant qu'il est vide, les totaux restent affichés sans comparaison à une cible (il manque : {{ status.missing.join(', ') }}).</div>
        <nav class="tabs" role="tablist" aria-label="Sections" @keydown="onTabKey">
          <button v-for="t in tabs" :key="t[0]" type="button" role="tab" :id="'tab-' + t[0]" :aria-selected="state.ui.tab === t[0]" :aria-controls="'panel-' + t[0]" :tabindex="state.ui.tab === t[0] ? 0 : -1" @click="setTab(t[0])">{{ t[1] }}</button>
        </nav>
        <div class="layout">
          <main id="main" role="tabpanel" tabindex="-1" :aria-labelledby="'tab-' + state.ui.tab"><div :id="'panel-' + state.ui.tab"><component :is="views[state.ui.tab]" /></div></main>
          <my-day-panel :class="{ open: state.ui.dayOpen }" />
        </div>
      </template>

      <component v-if="dlgComp" :is="dlgComp" :key="dlgKey" v-bind="dlgProps" @close="close" />
      <div v-if="state.ui.toast" class="toast" role="status" aria-live="polite">{{ state.ui.toast }}</div>
    </div>`,
};
