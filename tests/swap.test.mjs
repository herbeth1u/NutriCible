import test from 'node:test';
import assert from 'node:assert/strict';
import { rankMealSwaps, swapDelta, swapDistance } from '../src/swap.js';
import { contextsFor, dayTypeOf, generateWeek, swapCandidates } from '../src/planner.js';
import { FICTIVE, FICTIVE_F, near, plannerCtx, world } from './helpers.mjs';

// Repas fictifs minimaux : seuls les champs lus par swap.js (identifiant, nom, totaux, lignes, tags) sont renseignés.
const meal = (id, name, kcal, protein, carbs, extra = {}) => ({
  id, name, category: 'Déjeuner', totals: { kcal, protein, carbs, fat: 10, fiber: 5 }, lines: [], tags: [], incomplete: false, ...extra,
});
const WEIGHTS = { kcal: 1, protein: 1, carbs: 1 };
const ids = (rows) => rows.map((r) => r.meal.id);

test('swap : le repas le plus proche vient en premier, avec distance et écart exacts', () => {
  const base = meal('b', 'Base', 500, 30, 60);
  const a = meal('a', 'A', 520, 30, 60); // 20 / 500
  const b = meal('b2', 'B', 500, 36, 60); // 6 / 30
  const c = meal('c', 'C', 650, 30, 60); // 150 / 500
  const d = meal('d', 'D', 500, 30, 90); // 30 / 60
  const rows = rankMealSwaps({ base, meals: [d, c, b, a], weights: WEIGHTS });
  assert.deepEqual(ids(rows), ['a', 'b2', 'c', 'd']);
  [0.04, 0.2, 0.3, 0.5].forEach((v, i) => near(assert, rows[i].distance, v));
  assert.deepEqual(rows[0].delta, { kcal: 20, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  near(assert, swapDistance(base, c, WEIGHTS), 0.3);
  assert.deepEqual(swapDelta(base, b), { kcal: 0, protein: 6, carbs: 0, fat: 0, fiber: 0 });
});

test('swap : une valeur actuelle nulle ne divise pas par zéro (max(valeur, 1))', () => {
  const base = meal('b', 'Base', 500, 0, 60);
  const [r] = rankMealSwaps({ base, meals: [meal('x', 'X', 500, 3, 60)], weights: WEIGHTS });
  near(assert, r.distance, 3);
});

test('swap : le repas actuel et les repas incomplets ne sont jamais proposés (suggestions comme recherche)', () => {
  const base = meal('b', 'Base', 500, 30, 60);
  const meals = [base, meal('inc', 'Incomplet', 500, 30, 60, { incomplete: true }), meal('ok', 'Autre', 510, 30, 60)];
  assert.deepEqual(ids(rankMealSwaps({ base, meals, weights: WEIGHTS })), ['ok']);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'base', weights: WEIGHTS })), []);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'incomplet', weights: WEIGHTS })), []);
});

test('swap : les poids de la config changent le classement', () => {
  const base = meal('b', 'Base', 500, 30, 60);
  const protein = meal('p', 'Protéines', 500, 33, 60); // 0,1 sur les protéines
  const kcal = meal('k', 'Kcal', 525, 30, 60); // 0,05 sur les kcal
  const meals = [protein, kcal];
  assert.deepEqual(ids(rankMealSwaps({ base, meals, weights: WEIGHTS })), ['k', 'p']);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, weights: { kcal: 4, protein: 1, carbs: 1 } })), ['p', 'k']);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, weights: { kcal: 0, protein: 1, carbs: 0 } })), ['k', 'p']);
  near(assert, rankMealSwaps({ base, meals, weights: { kcal: 0, protein: 2, carbs: 0 } })[1].distance, 0.2);
});

test('swap : la recherche ignore accents et casse, et lit le nom, les ingrédients et les tags', () => {
  const base = meal('b', 'Base', 500, 30, 60);
  const meals = [
    meal('n', 'Œufs brouillés', 500, 30, 60),
    meal('i', 'Gratin', 500, 30, 60, { lines: [{ food: { name: 'Épinards' } }, { food: undefined }] }),
    meal('t', 'Soupe', 500, 30, 60, { tags: ['Riche en fibres'] }),
    meal('z', 'Autre', 500, 30, 60),
  ];
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'OEUFS', weights: WEIGHTS })), ['n']);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'épinard', weights: WEIGHTS })), ['i']);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'EPINARDS', weights: WEIGHTS })), ['i']);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'fibres', weights: WEIGHTS })), ['t']);
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'gratin epinards', weights: WEIGHTS })), ['i']); // tous les mots
  assert.deepEqual(ids(rankMealSwaps({ base, meals, query: 'introuvable', weights: WEIGHTS })), []);
  assert.equal(rankMealSwaps({ base, meals, query: '   ', weights: WEIGHTS }).length, 4); // recherche vide : tous les repas
});

test('swap : la limite est respectée, à distance égale le tri est par nom', () => {
  const base = meal('b', 'Base', 500, 30, 60);
  const meals = ['Zèbre', 'Abricot', 'Ananas', 'Écrevisse', 'Banane'].map((n, i) => meal(`m${i}`, n, 510, 30, 60));
  assert.deepEqual(rankMealSwaps({ base, meals, weights: WEIGHTS }).map((r) => r.meal.name), ['Abricot', 'Ananas', 'Banane', 'Écrevisse', 'Zèbre']);
  assert.equal(rankMealSwaps({ base, meals, weights: WEIGHTS, limit: 3 }).length, 3);
  assert.equal(rankMealSwaps({ base, meals, weights: WEIGHTS, limit: 0 }).length, 0);
  assert.equal(rankMealSwaps({ base, meals, query: 'a', weights: WEIGHTS, limit: 2 }).length, 2);
});

test('swap : sans repas actuel (introuvable ou incomplet) pas de proximité : tri par nom, sans écart', () => {
  const meals = [meal('b', 'Banane', 100, 1, 1), meal('a', 'Abricot', 900, 50, 50)];
  for (const base of [null, undefined, meal('x', 'Incomplet', 500, 30, 60, { incomplete: true })]) {
    const rows = rankMealSwaps({ base, meals, weights: WEIGHTS });
    assert.deepEqual(rows.map((r) => r.meal.name), ['Abricot', 'Banane']);
    assert.ok(rows.every((r) => r.delta === null && r.distance === 0));
  }
});

test('swap : ne modifie ni les repas ni la liste passés en paramètre', () => {
  const base = meal('b', 'Base', 500, 30, 60);
  const meals = [meal('y', 'Y', 600, 30, 60), meal('x', 'X', 510, 30, 60)];
  const snap = JSON.stringify([base, meals]);
  rankMealSwaps({ base, meals, query: 'x', weights: WEIGHTS, limit: 1 });
  rankMealSwaps({ base, meals, weights: WEIGHTS });
  assert.equal(JSON.stringify([base, meals]), snap);
});

// ------------------------------------------------------------------ avec les données du projet
test('suggestions : seule la catégorie du créneau, jamais le repas actuel, triées et limitées (un repas déjà dans la semaine peut être proposé)', async () => {
  const w = await world();
  const { limit, weights } = w.config.planner.swap;
  let checked = 0;
  for (const profile of [FICTIVE, FICTIVE_F, null]) {
    const ctx = plannerCtx(w, profile);
    for (const seed of [1, 7920, 15839, 23758, 31677]) {
      const plan = generateWeek(ctx, { seed });
      plan.days.forEach((d, di) => {
        d.meals.forEach(([slot, id], mi) => {
          const where = `${profile ? profile.sex : 'sans profil'}, graine ${seed}, ${d.label}, ${slot}`;
          const rows = rankMealSwaps({ base: ctx.mealIdx.get(id), meals: swapCandidates(ctx, plan, di, mi), weights, limit });
          assert.ok(rows.length <= limit, where);
          assert.ok(rows.every((r) => r.meal.category === slot), `${where} : autre catégorie`);
          assert.ok(rows.every((r) => r.meal.id !== id), `${where} : repas actuel`);
          assert.ok(rows.every((r) => r.meal.contexts.some((c) => contextsFor(w.config, dayTypeOf(w.config, d.dayType)).includes(c))), `${where} : contexte`);
          for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].distance <= rows[i].distance, `${where} : tri`);
          checked += rows.length;
        });
      });
    }
  }
  assert.ok(checked > 500, `${checked} suggestions vérifiées`);
});
