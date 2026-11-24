import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import { weekBalance, weekBudget } from '../src/week.js';
import { FICTIVE, FICTIVE_F, near, world } from './helpers.mjs';

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
    const rep = weekBalance(w.days.week, w.days.days, w.mealIdx, t, w.config.dayTypes);
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
    const rep = weekBalance(w.days.week, w.days.days, w.mealIdx, C.allTargets(p, w.config), w.config.dayTypes);
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
