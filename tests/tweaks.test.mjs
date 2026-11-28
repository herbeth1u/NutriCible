import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import { DEFAULT_MAX_TWEAKS, mealTweakLevel, shortTweaks, tweakLevel, tweakLimits, tweakLine, tweakTitle, tweakedMeal, usableTweaks } from '../src/tweaks.js';
import { near, world } from './helpers.mjs';

const flat = (s) => s.replace(/[\s ]/g, ' ');

test('tweakLevel : les exemples du filet de poulet (100 g dans la recette) et les bornes inclusives', async () => {
  const { config } = await world();
  const limits = tweakLimits(config);
  const level = (g) => tweakLevel(g / 100, limits);
  assert.equal(level(120), 'minor');
  assert.equal(level(75), 'minor');
  assert.equal(level(140), 'major');
  assert.equal(level(180), 'major');
  assert.equal(level(60), 'major');
  assert.equal(level(201), 'forbidden');
  assert.equal(level(49), 'forbidden');
  assert.equal(level(50), 'major', '50 % autorisé, retouche importante');
  assert.equal(level(200), 'major', '200 % autorisé, retouche importante');
  assert.equal(level(70), 'minor');
  assert.equal(level(130), 'minor');
  assert.equal(level(130.0000001), 'minor', 'tolérance de 1e-9 sur r, jamais une égalité flottante brute');
  assert.equal(level(131), 'major');
});

test('tweakLevel : ne dépend que des seuils de la config (aucun seuil en dur)', () => {
  const limits = { bounds: { min: 0.4, max: 3 }, major: { min: 0.9, max: 1.1 } };
  assert.equal(tweakLevel(0.4, limits), 'major');
  assert.equal(tweakLevel(3, limits), 'major');
  assert.equal(tweakLevel(3.01, limits), 'forbidden');
  assert.equal(tweakLevel(0.39, limits), 'forbidden');
  assert.equal(tweakLevel(1.1, limits), 'minor');
  assert.equal(tweakLevel(1.2, limits), 'major');
  assert.equal(tweakLevel(0.95, limits), 'minor');
  assert.equal(DEFAULT_MAX_TWEAKS, 5);
});

/** Un repas complet (non cheat) avec au moins une ligne d'aliment et une autre ligne, pour les tests de lecture. */
async function sample() {
  const w = await world();
  const meal = w.meals.find((m) => !m.cheat && !m.incomplete && m.lines.filter((l) => l.kind === 'food').length >= 2);
  const lines = meal.lines.map((l, i) => [l, i]).filter(([l]) => l.kind === 'food');
  return { w, meal, limits: tweakLimits(w.config), a: lines[0], b: lines[1] };
}

test('usableTweaks : garde les retouches valides, ignore le reste sans erreur', async () => {
  const { w, meal, limits, a: [la, ia], b: [lb, ib] } = await sample();
  const ok = [ia, la.id, la.qty * 1.2];
  assert.deepEqual(usableTweaks(meal, [ok], limits), [ok]);
  assert.deepEqual(usableTweaks(meal, [[ia, 'autre-aliment', la.qty * 1.2]], limits), [], 'foodId qui ne correspond plus');
  assert.deepEqual(usableTweaks(meal, [[99, la.id, 50]], limits), [], 'ligne hors liste');
  assert.deepEqual(usableTweaks(meal, [[-1, la.id, 50]], limits), []);
  assert.deepEqual(usableTweaks(meal, [[1.5, la.id, 50]], limits), []);
  assert.deepEqual(usableTweaks(meal, [[ia, la.id, la.qty * 2.01]], limits), [], 'r > 2');
  assert.deepEqual(usableTweaks(meal, [[ia, la.id, la.qty * 0.49]], limits), [], 'r < 0,5');
  assert.equal(usableTweaks(meal, [[ia, la.id, la.qty * 2]], limits).length, 1, 'r = 2 autorisé');
  assert.equal(usableTweaks(meal, [[ia, la.id, la.qty * 0.5]], limits).length, 1, 'r = 0,5 autorisé');
  for (const bad of ['120', NaN, Infinity, null, undefined, 0, -3, {}]) assert.deepEqual(usableTweaks(meal, [[ia, la.id, bad]], limits), [], `grams ${String(bad)}`);
  assert.deepEqual(usableTweaks(meal, [[ia, la.id, la.qty]], limits), [], 'r = 1 : pas une retouche');
  assert.deepEqual(usableTweaks(meal, [[ia, la.id, la.qty * 1.1], [ia, la.id, la.qty * 1.3]], limits), [[ia, la.id, la.qty * 1.1]], 'doublon de ligne : la première');
  assert.deepEqual(usableTweaks(meal, [ok, [ib, lb.id, lb.qty * 0.8]], limits).length, 2);
  assert.deepEqual(usableTweaks(meal, 'n\'importe quoi', limits), []);
  assert.deepEqual(usableTweaks(meal, [null, 3, [1], 'x'], limits), []);
  assert.deepEqual(usableTweaks(null, [ok], limits), []);
  assert.deepEqual(usableTweaks(meal, [ok], null), []);
  // ligne interne, repas cheat, repas incomplet
  const internal = w.meals.find((m) => m.lines.some((l) => l.kind === 'internal'));
  const ii = internal.lines.findIndex((l) => l.kind === 'internal');
  assert.deepEqual(usableTweaks(internal, [[ii, internal.lines[ii].id, internal.lines[ii].qty * 1.2]], limits), []);
  const cheat = w.meals.find((m) => m.cheat);
  assert.deepEqual(usableTweaks(cheat, [[0, 'x', 50]], limits), []);
  const gone = await world({ deleted: [la.id] });
  const incomplete = gone.meals.find((m) => m.id === meal.id);
  assert.ok(incomplete.incomplete);
  assert.deepEqual(usableTweaks(incomplete, [[ib, lb.id, lb.qty * 1.2]], limits), []);
});

test('tweakedMeal : repas d\'origine rendu tel quel sans retouche valide ; sinon quantités, totaux et détail à afficher', async () => {
  const { meal, limits, a: [la, ia], b: [lb, ib] } = await sample();
  assert.equal(tweakedMeal(meal, [], limits), meal);
  assert.equal(tweakedMeal(meal, [[ia, 'x', 10]], limits), meal);
  const t = tweakedMeal(meal, [[ia, la.id, la.qty * 1.4], [ib, lb.id, lb.qty * 0.8]], limits);
  assert.equal(t.tuned, true);
  assert.deepEqual(t.tweaks.map((x) => [x.line, x.foodId, x.level]), [[ia, la.id, 'major'], [ib, lb.id, 'minor']]);
  near(assert, t.tweaks[0].ratio, 1.4, 1e-9);
  assert.equal(t.tweaks[0].name, la.food.name);
  assert.equal(mealTweakLevel(t.tweaks), 'major');
  assert.equal(mealTweakLevel([t.tweaks[1]]), 'minor');
  assert.equal(mealTweakLevel([]), null);
  assert.deepEqual(shortTweaks(t), [[ia, la.id, la.qty * 1.4], [ib, lb.id, lb.qty * 0.8]]);
  near(assert, t.totals.kcal, meal.totals.kcal + la.macros.kcal * 0.4 - lb.macros.kcal * 0.2, 1e-9);
  assert.equal(meal.tuned, undefined);
});

test('tweakLine et tweakTitle : quantités × facteur de portion, pourcentage du rapport (sans facteur), « importante » seulement si major', async () => {
  const { meal, limits, a: [la, ia], b: [lb, ib] } = await sample();
  const t = tweakedMeal(meal, [[ia, la.id, la.qty * 1.4], [ib, lb.id, lb.qty * 0.8]], limits);
  const unit = C.unitOf(la.food);
  const stateOfA = la.food.convertible ? C.weighState(la.food) : null;
  const shown = (q) => C.fmtQty(la.food.convertible ? C.convertQty(la.food, q, la.food.state, stateOfA) : q);
  assert.equal(flat(tweakLine(meal, t.tweaks[0], 1.25)), flat(`${la.food.name} : ${shown(la.qty * 1.4 * 1.25)} ${unit} au lieu de ${shown(la.qty * 1.25)} ${unit} (+40 %, importante)`));
  assert.ok(!tweakLine(meal, t.tweaks[1], 1).includes('importante'));
  assert.match(flat(tweakLine(meal, t.tweaks[1], 1)), /\(-20 %\)$/);
  const lines = tweakTitle(t, 1).split('\n');
  assert.equal(lines.length, 3);
  assert.equal(lines[0], 'Quantités ajustées pour approcher vos cibles du jour (retouche importante)');
  const minor = tweakedMeal(meal, [[ib, lb.id, lb.qty * 0.8]], limits);
  assert.equal(tweakTitle(minor, 1).split('\n')[0], 'Quantités ajustées pour approcher vos cibles du jour (retouche légère)');
});
