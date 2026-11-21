// tests/helpers.mjs — utilitaires partagés (ce fichier n'est pas un test).
// ATTENTION : les tests utilisent exclusivement des profils FICTIFS.
import { loadData } from '../scripts/validate-data.mjs';
import { buildFoodIndex, resolveMeal } from '../src/calc.js';

/** Profil fictif (aucune personne réelle). */
export const FICTIVE = { sex: 'M', age: 30, heightCm: 180, weightKg: 75, weightMinKg: null, weightMaxKg: null, restingKcal: null, longActiveKcal: null };
export const FICTIVE_F = { sex: 'F', age: 40, heightCm: 165, weightKg: 60, weightMinKg: null, weightMaxKg: null, restingKcal: null, longActiveKcal: null };

export const near = (assert, a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);

/** Données réelles du projet, résolues avec la fonction de calcul unique. */
export async function world(overrides = {}) {
  const d = await loadData();
  const internal = d.internal.ingredients;
  const foodIdx = buildFoodIndex({ foods: d.foods.foods, internal, ...overrides });
  const internalIdx = new Map(internal.map((i) => [i.id, i]));
  const ctx = { foodIdx, internalIdx, config: d.config, repl: overrides.repl };
  const meals = d.meals.meals.map((m) => resolveMeal({ ...m, origin: 'recueil' }, ctx));
  return { ...d, internal, foodIdx, internalIdx, ctx, meals, mealIdx: new Map(meals.map((m) => [m.id, m])) };
}
