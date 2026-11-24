import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import { BASES, NEAR_LIMIT, compositionKey, equivalentQty, findIdenticalMeal, macroDistance, macroShares, mealKey, rankSubstitutes, roundQty, substituteItems, variantBase } from '../src/substitute.js';
import { world } from './helpers.mjs';

const foodsOf = (w) => [...w.foodIdx.values()];

// ------------------------------------------------------------------ équivalences
test('équivalence : même quantité de kcal, de protéines ou de glucides', async () => {
  const w = await world();
  const riz = w.foodIdx.get('riz-complet');
  const pates = w.foodIdx.get('pates-completes');
  // kcal : 150 g × 130 / 145
  assert.ok(Math.abs(equivalentQty(riz, 150, pates, 'kcal') - (150 * 130) / 145) < 1e-9);
  assert.ok(Math.abs(equivalentQty(riz, 150, pates, 'protein') - (150 * 2.8) / 5.6) < 1e-9);
  assert.ok(Math.abs(equivalentQty(riz, 150, pates, 'carbs') - 150) < 1e-9); // 27 g de glucides pour 100 g des deux
  assert.deepEqual(BASES.map((b) => b.id), ['kcal', 'protein', 'carbs']);
});

test('équivalence impossible : quantité nulle ou aliment sans la valeur demandée', async () => {
  const w = await world();
  const riz = w.foodIdx.get('riz-complet');
  const huile = w.foodIdx.get('huile-olive'); // 0 g de glucides et de protéines
  assert.equal(equivalentQty(riz, 100, huile, 'carbs'), null);
  assert.equal(equivalentQty(huile, 10, riz, 'protein'), null);
  assert.equal(equivalentQty(riz, 0, huile, 'kcal'), null);
  assert.ok(equivalentQty(huile, 10, riz, 'kcal') > 0);
});

test('quantité arrondie comme à l\'affichage : gramme, ou 0,1 sous 5 g, jamais nulle', () => {
  assert.equal(roundQty(123.4), 123);
  assert.equal(roundQty(4.26), 4.3);
  assert.equal(roundQty(0.01), 0.1);
  assert.equal(roundQty(5), 5);
});

test('répartition de macros : distance nulle avec soi-même, symétrique', async () => {
  const w = await world();
  const a = w.foodIdx.get('riz-complet');
  const b = w.foodIdx.get('lentilles-vertes');
  assert.equal(macroShares(a).length, 3);
  assert.equal(macroDistance(a, a), 0);
  assert.equal(macroDistance(a, b), macroDistance(b, a));
  assert.ok(macroDistance(a, b) > 0);
});

// ------------------------------------------------------------------ classement des aliments proches
test('aliments proches : même type, sans l\'aliment lui-même, triés par répartition de macros, limités', async () => {
  const w = await world();
  const foods = foodsOf(w);
  const base = w.foodIdx.get('riz-complet');
  const rows = rankSubstitutes({ base, qty: 150, foods });
  assert.ok(rows.length > 0 && rows.length <= NEAR_LIMIT);
  assert.ok(rows.every((r) => r.food.type === base.type && r.food.id !== base.id));
  for (let i = 1; i < rows.length; i += 1) assert.ok(rows[i - 1].distance <= rows[i].distance);
  // les ingrédients internes ne sont jamais proposés (ils ne sont pas dans l'index des aliments visibles)
  assert.ok(rows.every((r) => !r.food.internal && !String(r.food.id).startsWith('i-')));
});

test('aliments proches : la quantité équivalente garde les kcal, les protéines ou les glucides (à l\'arrondi près)', async () => {
  const w = await world();
  const foods = foodsOf(w);
  const base = w.foodIdx.get('riz-complet');
  const target = C.scale(base.per100, 150 / 100);
  for (const [basis, key] of [['kcal', 'kcal'], ['protein', 'protein'], ['carbs', 'carbs']]) {
    const rows = rankSubstitutes({ base, qty: 150, foods, basis, query: 'a', limit: 200 });
    assert.ok(rows.length > 5, basis);
    for (const r of rows) {
      const tol = Math.max(target[key] * 0.03, (r.food.per100[key] * 0.5) / 100 + 0.01); // arrondi à 1 g (0,1 g sous 5 g)
      assert.ok(Math.abs(r.macros[key] - target[key]) <= tol, `${basis} ${r.food.id} : ${r.macros[key]} ≠ ${target[key]}`);
    }
  }
});

test('aliments proches : un aliment sans glucides ne se propose pas à glucides égaux', async () => {
  const w = await world();
  const foods = foodsOf(w);
  const base = w.foodIdx.get('riz-complet');
  const ids = (basis) => rankSubstitutes({ base, qty: 100, foods, basis, query: 'huile', limit: 50 }).map((r) => r.food.id);
  assert.ok(!ids('carbs').includes('huile-olive'));
  assert.ok(!ids('protein').includes('huile-olive'));
  assert.ok(ids('kcal').includes('huile-olive'));
});

test('recherche libre : tous les types, insensible à la casse et aux accents', async () => {
  const w = await world();
  const foods = foodsOf(w);
  const base = w.foodIdx.get('riz-complet');
  const types = (q) => new Set(rankSubstitutes({ base, qty: 100, foods, query: q }).map((r) => r.food.type));
  assert.ok(types('LENTILLES').has('Légumineuses'));
  assert.ok(rankSubstitutes({ base, qty: 100, foods, query: 'pates' }).every((r) => C.normalize(r.food.name).includes('pates')));
  assert.ok(rankSubstitutes({ base, qty: 100, foods, query: 'pâtes' }).some((r) => r.food.id === 'pates-completes'));
  assert.deepEqual(rankSubstitutes({ base, qty: 100, foods, query: 'zzzzz' }), []);
  assert.deepEqual(rankSubstitutes({ base: null, qty: 100, foods }), []);
  assert.deepEqual(rankSubstitutes({ base, qty: 0, foods }), []);
});

// ------------------------------------------------------------------ construction de la variante
test('substituteItems : remplace une seule ligne, ne modifie pas l\'original, ignore un indice invalide', () => {
  const items = [['a', 100], ['b', 50], ['a', 20]];
  const next = substituteItems(items, 1, 'c', 70);
  assert.deepEqual(next, [['a', 100], ['c', 70], ['a', 20]]);
  assert.deepEqual(items, [['a', 100], ['b', 50], ['a', 20]]);
  assert.deepEqual(substituteItems(items, 9, 'c', 70), items);
  assert.deepEqual(substituteItems(items, -1, 'c', 70), items);
  assert.notEqual(substituteItems(items, 9, 'c', 70), items);
});

test('variantBase : retire le suffixe « (copie) » ou « (variante) », numéroté ou non', () => {
  assert.equal(variantBase('Porridge (variante)'), 'Porridge');
  assert.equal(variantBase('Porridge (copie) 2'), 'Porridge');
  assert.equal(variantBase('Porridge (variante) 12'), 'Porridge');
  assert.equal(variantBase('Porridge (au miel)'), 'Porridge (au miel)');
  assert.equal(variantBase('Porridge'), 'Porridge');
});

test('une variante calculée par resolveMeal garde les kcal du repas à l\'équivalence près', async () => {
  const w = await world();
  const meal = w.mealIdx.get('pdj-porridge-banane-chia');
  const items = meal.def.items.map(([id, g]) => [id, g]);
  const idx = items.findIndex(([id]) => id === 'banane');
  const base = w.foodIdx.get('banane');
  const [best] = rankSubstitutes({ base, qty: items[idx][1], foods: foodsOf(w), basis: 'kcal' });
  const variant = C.resolveMeal({ ...meal.def, id: 'variante', origin: 'perso', items: substituteItems(items, idx, best.food.id, best.qty) }, w.ctx);
  assert.ok(!variant.incomplete);
  assert.ok(Math.abs(variant.totals.kcal - meal.totals.kcal) < meal.totals.kcal * 0.02, `${variant.totals.kcal} ≠ ${meal.totals.kcal}`);
  assert.ok(variant.lines.some((l) => l.id === best.food.id));
});

// ------------------------------------------------------------------ garde-fou : variante identique
test('variante identique : même catégorie, mêmes aliments aux mêmes quantités, dans n\'importe quel ordre', async () => {
  const w = await world();
  const meal = w.mealIdx.get('pdj-porridge-banane-chia');
  const draft = { category: meal.category, items: [...meal.def.items].reverse().map(([id, g]) => [id, g]), internal: [] };
  assert.equal(findIdenticalMeal(draft, w.meals)?.id, meal.id);
  assert.equal(findIdenticalMeal({ ...draft, items: draft.items.map(([id, g], i) => (i === 0 ? [id, g + 1] : [id, g])) }, w.meals), null);
  assert.equal(findIdenticalMeal({ ...draft, category: 'Dîner' }, w.meals), null);
  assert.equal(findIdenticalMeal({ ...draft, items: draft.items.slice(1) }, w.meals), null);
});

test('variante identique : les repas incomplets et les blocs de composition libre ne sont jamais proposés', async () => {
  const w = await world();
  const cheat = w.meals.find((m) => m.cheat);
  assert.equal(mealKey(cheat), null);
  assert.equal(findIdenticalMeal({ category: cheat.category, items: [], internal: [] }, w.meals), null);
  const broken = C.resolveMeal({ id: 'x', name: 'x', category: 'Dîner', items: [['inconnu', 100]] }, w.ctx);
  assert.equal(broken.incomplete, true);
  assert.equal(mealKey(broken), null);
});

test('variante identique : les ingrédients internes comptent, les remplacements d\'aliments sont pris en compte', async () => {
  const w = await world();
  const withInternal = w.meals.find((m) => m.lines.some((l) => l.kind === 'internal') && !m.cheat && !m.incomplete);
  const items = withInternal.lines.filter((l) => l.kind === 'food').map((l) => [l.id, l.qty]);
  const internal = withInternal.lines.filter((l) => l.kind === 'internal').map((l) => [l.id, l.qty]);
  assert.equal(findIdenticalMeal({ category: withInternal.category, items, internal }, w.meals)?.id, withInternal.id);
  assert.equal(findIdenticalMeal({ category: withInternal.category, items, internal: [] }, w.meals), null);
  // remplacement d'un aliment supprimé : la composition résolue (et non l'identifiant d'origine) fait foi
  const meal = w.mealIdx.get('pdj-porridge-banane-chia');
  const repl = C.resolveMeal(meal.def, { ...w.ctx, repl: { [meal.id]: { banane: 'kiwi' } } });
  const draft = { category: meal.category, items: meal.def.items.map(([id, g]) => [id === 'banane' ? 'kiwi' : id, g]), internal: [] };
  assert.equal(compositionKey(draft), mealKey(repl));
});
