import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import { WEEK_LENGTH, effectiveWeek, normalizeUserWeek, weekBalance, weekBudget } from '../src/week.js';
import { FICTIVE, FICTIVE_F, near, world } from './helpers.mjs';

const fixedOf = (w) => ({ fixedDayTypes: w.config.planner.fixedDayTypes });
const totalOf = (w, d) => C.dayTotals(d.items.map(([meal, factor]) => ({ meal, factor })), w.mealIdx).totals;

test('journées types : une seule collation par journée (le goûter de 16 h), aucune le jour du cheat meal', async () => {
  const w = await world();
  for (const d of w.days.days) {
    const n = d.items.filter(([id]) => w.mealIdx.get(id).category === 'Collation').length;
    assert.ok(n <= 1, `${d.id} : ${n} collations`);
    assert.equal(n, d.dayType === 'cheat' ? 0 : 1, d.id);
  }
});

test('semaine type : le lundi est un jour de sortie courte', async () => {
  const w = await world();
  assert.equal(w.days.week[0].label, 'Lundi');
  assert.equal(w.days.days.find((d) => d.id === w.days.week[0].day).dayType, 'courte');
  assert.deepEqual(w.days.week.map((x) => x.label), ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']);
});

test('journées types : proches de la cible du profil de référence fictif (±6 %), cheat meal exclu', async () => {
  const w = await world();
  const targets = C.allTargets(FICTIVE, w.config);
  for (const d of w.days.days.filter((x) => x.dayType !== 'cheat')) {
    const ratio = totalOf(w, d).kcal / targets[d.dayType].kcal;
    assert.ok(ratio > 0.94 && ratio < 1.06, `${d.id} : ${Math.round((ratio - 1) * 100)} %`);
  }
});

test('weekBudget : somme des budgets = somme des dépenses (maintien), journée fixe conservée', () => {
  const rows = [
    { expenditure: 2400, target: 2400, fixed: false, fixedKcal: 0 },
    { expenditure: 2400, target: 2350, fixed: false, fixedKcal: 0 },
    { expenditure: 2400, target: 2400, fixed: true, fixedKcal: 3000 },
    { expenditure: 3500, target: 3500, fixed: false, fixedKcal: 0 },
  ];
  const b = weekBudget(rows);
  near(assert, b.reduce((a, x) => a + x, 0), rows.reduce((a, r) => a + r.expenditure, 0), 1e-6);
  assert.equal(b[2], 3000);
  assert.ok(b[0] < 2400 && b[3] < 3500, 'les autres jours compensent le cheat meal');
  near(assert, b[1] / b[0], 2350 / 2400, 1e-9); // au prorata des cibles
});

test('weekBudget : plancher à 90 % de la dépense, le reste est redistribué sur les autres jours', () => {
  const rows = [
    { expenditure: 2000, target: 1000, fixed: false, fixedKcal: 0 }, // cible très basse : le plancher s'applique
    { expenditure: 3000, target: 3000, fixed: false, fixedKcal: 0 },
    { expenditure: 2000, target: 2000, fixed: true, fixedKcal: 2500 },
  ];
  const b = weekBudget(rows);
  assert.equal(b[0], 1800);
  near(assert, b[1], 7000 - 2500 - 1800, 1e-6);
  near(assert, b.reduce((a, x) => a + x, 0), 7000, 1e-6);
  assert.equal(b[2], 2500);
  assert.ok(weekBudget(rows, { floor: 0.5 })[0] < 1800, 'avec un plancher plus bas, la cible basse est respectée');
});

test('bilan hebdomadaire : en maintien avec les facteurs conseillés, pour des profils fictifs variés', async () => {
  const w = await world();
  const profiles = [
    FICTIVE, FICTIVE_F,
    { ...FICTIVE, age: 45, heightCm: 170, weightKg: 62 },
    { ...FICTIVE, age: 25, heightCm: 190, weightKg: 95 },
    { sex: '', age: null, heightCm: null, weightKg: 70, weightMinKg: null, weightMaxKg: null, restingKcal: 1650, longActiveKcal: 2200 },
  ];
  for (const p of profiles) {
    const t = C.allTargets(p, w.config);
    const rep = weekBalance(w.days.week, w.days.days, w.mealIdx, t, w.config.dayTypes, fixedOf(w));
    assert.ok(Math.abs(rep.adjustedBalance) < 0.02 * rep.expenditure, `maintien : ${Math.round(rep.adjustedBalance)} kcal pour ${Math.round(rep.expenditure)} kcal de dépense`);
    near(assert, rep.budgetTotal, rep.expenditure, 1e-6);
    for (const r of rep.rows) {
      if (r.fixed) { assert.equal(r.fit, 1); assert.equal(r.day.dayType, 'cheat'); continue; }
      assert.ok(r.fit >= 0.5 && r.fit <= 2, `${r.label} : facteur ${r.fit}`);
      assert.ok(r.adjusted.kcal >= 0.86 * r.target.expenditure, `${r.label} : jamais de restriction excessive`);
      assert.ok(Math.abs(r.adjusted.kcal - r.budget) <= 0.03 * r.budget + 1, `${r.label} : proche du budget (pas de 5 %)`);
    }
  }
});

test('bilan hebdomadaire : la correction rapproche du maintien (le solde avec portions d\'origine peut être en surplus ou en déficit)', async () => {
  const w = await world();
  const heavy = { ...FICTIVE, weightKg: 95, heightCm: 190, age: 25 };
  const light = { ...FICTIVE_F, weightKg: 52, heightCm: 160 };
  for (const p of [heavy, light]) {
    const rep = weekBalance(w.days.week, w.days.days, w.mealIdx, C.allTargets(p, w.config), w.config.dayTypes, fixedOf(w));
    assert.ok(Math.abs(rep.adjustedBalance) < Math.abs(rep.balance), 'meilleur après ajustement');
  }
});

test('bilan hebdomadaire sans profil : lignes et totaux, ni budget ni facteur', async () => {
  const w = await world();
  const rep = weekBalance(w.days.week, w.days.days, w.mealIdx, null, w.config.dayTypes);
  assert.equal(rep.rows.length, 7);
  assert.equal(rep.balance, null);
  assert.equal(rep.adjustedBalance, null);
  assert.ok(rep.rows.every((r) => r.budget === null && r.fit === 1));
  assert.ok(rep.total.kcal > 14000);
});

// ------------------------------------------------------------------ semaine type modifiable
const IDS = ['j-repos', 'j-courte', 'j-moyenne', 'j-longue', 'j-dimanche', 'j-veille-longue', 'j-cheat', 'j-veille-plaisir', 'j-lendemain-plaisir'];
const BASE = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'].map((label, i) => ({ label, day: IDS[i] }));
const dayOf = (week) => week.map((x) => x.day);

test('effectiveWeek : sans choix (null ou absent), la semaine d\'origine', () => {
  assert.deepEqual(effectiveWeek(BASE, null, IDS), BASE);
  assert.deepEqual(effectiveWeek(BASE, undefined, IDS), BASE);
  assert.equal(WEEK_LENGTH, 7);
});

test('effectiveWeek : le choix de l\'utilisateur l\'emporte jour par jour, les libellés restent ceux d\'origine', () => {
  const user = ['j-longue', 'j-courte', 'j-moyenne', 'j-longue', 'j-dimanche', 'j-veille-longue', 'j-repos'];
  const eff = effectiveWeek(BASE, user, IDS);
  assert.deepEqual(dayOf(eff), user);
  assert.deepEqual(eff.map((x) => x.label), BASE.map((x) => x.label));
  assert.equal(BASE[0].day, 'j-repos', 'la semaine d\'origine n\'est pas modifiée');
});

test('effectiveWeek : identifiant inconnu → repli jour par jour sur la semaine d\'origine', () => {
  const user = ['j-longue', 'j-disparue', 'j-moyenne', 3, null, 'j-veille-longue', 'j-repos'];
  assert.deepEqual(dayOf(effectiveWeek(BASE, user, IDS)), ['j-longue', 'j-courte', 'j-moyenne', 'j-longue', 'j-dimanche', 'j-veille-longue', 'j-repos']);
});

test('effectiveWeek : une liste de longueur différente de 7, ou qui n\'est pas une liste, est ignorée', () => {
  for (const bad of [[], ['j-longue'], IDS.slice(0, 6), IDS, 'j-longue', { 0: 'j-longue' }, 7]) assert.deepEqual(effectiveWeek(BASE, bad, IDS), BASE, JSON.stringify(bad));
});

test('normalizeUserWeek : null quand la semaine choisie est celle d\'origine, sinon la liste revalidée', () => {
  assert.equal(normalizeUserWeek(BASE, null, IDS), null);
  assert.equal(normalizeUserWeek(BASE, dayOf(BASE), IDS), null, 'choix égal au défaut : stocker null');
  assert.equal(normalizeUserWeek(BASE, ['j-repos', 'j-inconnue', ...dayOf(BASE).slice(2)], IDS), null, 'l\'identifiant inconnu retombe sur le défaut');
  assert.equal(normalizeUserWeek(BASE, IDS, IDS), null, 'longueur invalide');
  const mine = ['j-longue', ...dayOf(BASE).slice(1)];
  assert.deepEqual(normalizeUserWeek(BASE, mine, IDS), mine);
  assert.deepEqual(normalizeUserWeek(BASE, ['j-longue', 'j-fantome', ...dayOf(BASE).slice(2)], IDS), mine, 'inconnu ramené à l\'origine, le reste gardé');
});

test('effectiveWeek sur les données du projet : la semaine d\'origine de days.json (lundi = sortie courte) reste le défaut', async () => {
  const w = await world();
  assert.deepEqual(effectiveWeek(w.days.week, null, w.days.days.map((d) => d.id)), w.days.week);
});

test('bilan hebdomadaire d\'une semaine personnalisée : se recalcule (apports, budgets, facteurs) et reste en maintien', async () => {
  const w = await world();
  const ids = w.days.days.map((d) => d.id);
  const custom = effectiveWeek(w.days.week, ['j-repos', 'j-courte', 'j-moyenne', 'j-longue', 'j-dimanche', 'j-veille-longue', 'j-cheat'], ids);
  const t = C.allTargets(FICTIVE, w.config);
  const a = weekBalance(w.days.week, w.days.days, w.mealIdx, t, w.config.dayTypes, fixedOf(w));
  const b = weekBalance(custom, w.days.days, w.mealIdx, t, w.config.dayTypes, fixedOf(w));
  assert.deepEqual(b.rows.map((r) => r.day.id), dayOf(custom));
  assert.notEqual(Math.round(a.total.kcal), Math.round(b.total.kcal));
  near(assert, b.budgetTotal, b.expenditure, 1e-6);
  assert.ok(Math.abs(b.adjustedBalance) < 0.02 * b.expenditure);
});

test('weekBalance : le jour fixe vient de config.planner.fixedDayTypes — aucun jour fixe', async () => {
  const w = await world();
  const t = C.allTargets(FICTIVE, w.config);
  const rep = weekBalance(w.days.week, w.days.days, w.mealIdx, t, w.config.dayTypes, { fixedDayTypes: [] });
  assert.ok(rep.rows.every((r) => !r.fixed && r.fit >= 0.5 && r.fit <= 2), 'le cheat meal n\'est plus fixe : il a un facteur');
  assert.ok(rep.rows.find((r) => r.day.dayType === 'cheat').fit < 1, 'le cheat meal est ramené à son budget');
  near(assert, rep.budgetTotal, rep.expenditure, 1e-6);
  assert.ok(Math.abs(rep.adjustedBalance) < 0.03 * rep.expenditure);
});

test('weekBalance : le jour fixe vient de config.planner.fixedDayTypes — deux jours fixes', async () => {
  const w = await world();
  const ids = w.days.days.map((d) => d.id);
  const t = C.allTargets(FICTIVE, w.config);
  const week = effectiveWeek(w.days.week, ['j-courte', 'j-veille-plaisir', 'j-cheat', 'j-cheat', 'j-veille-longue', 'j-longue', 'j-dimanche'], ids);
  const rep = weekBalance(week, w.days.days, w.mealIdx, t, w.config.dayTypes, fixedOf(w));
  const fixed = rep.rows.filter((r) => r.fixed);
  assert.equal(fixed.length, 2);
  for (const r of fixed) { assert.equal(r.day.dayType, 'cheat'); assert.equal(r.fit, 1); near(assert, r.budget, r.totals.kcal, 1e-6); }
  near(assert, rep.budgetTotal, rep.expenditure, 1e-6);
  const open = rep.rows.filter((r) => !r.fixed);
  assert.ok(open.every((r) => r.fit >= 0.5 && r.fit <= 2 && r.adjusted.kcal >= 0.86 * r.target.expenditure));
  // sans la liste des types fixes, rien n'est fixe : le test ne dépend pas d'un identifiant en dur
  assert.ok(weekBalance(week, w.days.days, w.mealIdx, t, w.config.dayTypes).rows.every((r) => !r.fixed));
});

test('weekBalance sans profil : pas de jour fixe ni de budget, quelle que soit la liste des types fixes', async () => {
  const w = await world();
  const rep = weekBalance(w.days.week, w.days.days, w.mealIdx, null, w.config.dayTypes, fixedOf(w));
  assert.ok(rep.rows.every((r) => r.budget === null && !r.fixed && r.fit === 1));
});
