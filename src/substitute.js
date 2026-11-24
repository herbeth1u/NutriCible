// src/substitute.js — substitution d'aliments : fonctions pures (aucun DOM, aucun Vue, aucun stockage).
//
// Une substitution remplace un aliment d'un repas par un autre, à quantité équivalente en kcal, en protéines
// ou en glucides. Les quantités sont toujours exprimées dans l'état de référence de chaque aliment (celui de
// `per100`) : aucun calcul de macros ici, seulement des rapports de valeurs pour 100 g et un classement.
// Les totaux restent dérivés par `resolveMeal` (calc.js) ; rien n'est stocké.

import { normalize, scale } from './calc.js';

/** Bases d'équivalence proposées : on garde la même quantité de kcal, de protéines ou de glucides. */
export const BASES = [
  { id: 'kcal', label: 'Kcal' },
  { id: 'protein', label: 'Protéines' },
  { id: 'carbs', label: 'Glucides' },
];
export const DEFAULT_BASIS = 'kcal';
export const NEAR_LIMIT = 8; // aliments proches proposés sans recherche
export const SEARCH_LIMIT = 24; // résultats d'une recherche libre

/** Part des kcal venant des protéines, glucides et lipides (4, 4 et 9 kcal/g). */
export function macroShares(food) {
  const k = food.per100.kcal || 1;
  return [(food.per100.protein * 4) / k, (food.per100.carbs * 4) / k, (food.per100.fat * 9) / k];
}

/** Écart de répartition de macros entre deux aliments (0 = répartition identique). */
export function macroDistance(a, b) {
  const sa = macroShares(a);
  const sb = macroShares(b);
  return sa.reduce((s, v, i) => s + Math.abs(v - sb[i]), 0);
}

/** Quantité arrondie comme à l'affichage : au gramme, ou à 0,1 sous 5 g (jamais nulle). */
export const roundQty = (n) => (n < 5 ? Math.max(0.1, Math.round(n * 10) / 10) : Math.round(n));

/**
 * Quantité de `candidate` (dans son état de référence) qui apporte autant de `basis` que `qty` de `base`.
 * null si l'équivalence est impossible (quantité nulle, ou un des deux aliments sans cette valeur).
 */
export function equivalentQty(base, qty, candidate, basis = DEFAULT_BASIS) {
  const a = base.per100[basis];
  const b = candidate.per100[basis];
  if (!(qty > 0) || !(a > 0) || !(b > 0)) return null;
  return (qty * a) / b;
}

/**
 * Aliments à proposer pour remplacer `qty` de `base`, triés par proximité de répartition de macros.
 * - sans recherche : aliments du même type (au plus `limit`) ;
 * - avec recherche : tous les types, sur le nom (insensible à la casse et aux accents).
 * Chaque résultat : { food, qty (arrondie, état de référence), macros (de cette quantité), distance }.
 * @param {{base: any, qty: number, foods: any[], basis?: string, query?: string, limit?: number}} p
 */
export function rankSubstitutes({ base, qty, foods, basis = DEFAULT_BASIS, query = '', limit }) {
  if (!base || !(qty > 0)) return [];
  const q = normalize(query);
  const out = [];
  for (const food of foods) {
    if (food.id === base.id) continue;
    if (q ? !normalize(food.name).includes(q) : food.type !== base.type) continue;
    const eq = equivalentQty(base, qty, food, basis);
    if (eq === null) continue;
    const rounded = roundQty(eq);
    out.push({ food, qty: rounded, macros: scale(food.per100, rounded / 100), distance: macroDistance(base, food) });
  }
  out.sort((x, y) => x.distance - y.distance || x.food.name.localeCompare(y.food.name, 'fr'));
  return out.slice(0, limit ?? (q ? SEARCH_LIMIT : NEAR_LIMIT));
}

/** Copie de `items` ([[id, g], …]) où la ligne `index` devient `[foodId, qty]`. */
export function substituteItems(items, index, foodId, qty) {
  if (!Number.isInteger(index) || index < 0 || index >= items.length) return items.map(([id, g]) => [id, g]);
  return items.map(([id, g], i) => (i === index ? [foodId, qty] : [id, g]));
}

/** Nom de base d'un repas sans suffixe « (copie) » ou « (variante) » (éventuellement numéroté). */
export const variantBase = (name) => String(name).replace(/\s\((?:copie|variante)\)(?:\s\d+)?$/, '');

// ---------------------------------------------------------------- garde-fou : variante identique
const part = (list, kind) => list.map(([id, g]) => `${kind}:${id}:${Math.round(g * 10)}`).sort().join('|');

/** Signature d'une composition : catégorie, aliments et ingrédients internes avec leurs quantités (au 0,1 g), sans l'ordre. */
export const compositionKey = ({ category, items = [], internal = [] }) => `${category ?? ''}#${part(items, 'f')}#${part(internal, 'i')}`;

/** Signature d'un repas résolu (lignes après remplacements). null pour un bloc de composition libre ou un repas incomplet. */
export function mealKey(meal) {
  if (meal.cheat || meal.incomplete) return null;
  const lines = (kind) => meal.lines.filter((l) => l.kind === kind).map((l) => [l.id, l.qty]);
  return compositionKey({ category: meal.category, items: lines('food'), internal: lines('internal') });
}

/**
 * Repas déjà présent (recueil ou perso) dont la composition est identique à celle du brouillon `def`
 * (même catégorie, mêmes aliments aux mêmes quantités). null s'il n'y en a pas.
 */
export function findIdenticalMeal(def, meals) {
  const key = compositionKey(def);
  return meals.find((m) => mealKey(m) === key) ?? null;
}
