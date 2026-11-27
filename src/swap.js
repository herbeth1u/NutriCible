// src/swap.js — remplacement d'un repas du planificateur : fonctions pures (aucun DOM, aucun Vue, aucun stockage).
//
// Classe des repas candidats par proximité du repas à remplacer sur les kcal, les protéines et les glucides :
//   distance = Σ poids × |Δ| / max(valeur actuelle, 1)
// Les poids et les limites viennent de config.planner.swap (rien n'est fixé ici). L'éligibilité des suggestions et les
// pastilles d'alerte (règles du planificateur) sont dans src/planner.js : `swapCandidates` et `swapIssues`.
// Aucun calcul de macros ici : les totaux d'un repas sont ceux de `resolveMeal` (calc.js), rien n'est stocké.

import { defaultFilters, filterMeals } from './calc.js';

/** Macros comparées pour classer les repas (dans l'ordre d'affichage de l'écart). */
export const SWAP_KEYS = ['kcal', 'protein', 'carbs'];

/** Écart de `meal` avec `base` sur toutes les macros (sans facteur de portion : à multiplier par celui du jour pour l'affichage). */
export const swapDelta = (base, meal) => ({
  kcal: meal.totals.kcal - base.totals.kcal,
  protein: meal.totals.protein - base.totals.protein,
  carbs: meal.totals.carbs - base.totals.carbs,
  fat: meal.totals.fat - base.totals.fat,
  fiber: meal.totals.fiber - base.totals.fiber,
});

/** Distance d'un repas au repas actuel : Σ poids × |Δ| / max(valeur actuelle, 1) sur kcal, protéines et glucides. */
export function swapDistance(base, meal, weights) {
  return SWAP_KEYS.reduce((s, k) => s + weights[k] * Math.abs(meal.totals[k] - base.totals[k]) / Math.max(base.totals[k], 1), 0);
}

/**
 * Repas à proposer à la place de `base`, du plus proche au plus éloigné (à distance égale : par nom).
 * - `meals` : repas résolus parmi lesquels choisir (suggestions : celles de `swapCandidates` ; recherche : tous les repas) ;
 * - `query` : recherche libre, même normalisation que l'onglet Repas (nom, ingrédients, tags ; sans accents ni casse) ;
 * - `weights` : { kcal, protein, carbs } (config.planner.swap.weights) ; `limit` : nombre maximal de résultats.
 * Le repas actuel et les repas incomplets ne sont jamais proposés. Sans `base` (repas introuvable ou incomplet dans le planning),
 * il n'y a pas de proximité : tri par nom, sans écart.
 * @returns {{ meal: any, distance: number, delta: {kcal:number, protein:number, carbs:number, fat:number, fiber:number} | null }[]}
 */
export function rankMealSwaps({ base, meals, query = '', weights, limit }) {
  const usable = meals.filter((m) => !m.incomplete && m.id !== base?.id);
  const found = query.trim() ? filterMeals(usable, { ...defaultFilters(), q: query }) : usable;
  const rows = found.map((meal) => (base && !base.incomplete
    ? { meal, distance: swapDistance(base, meal, weights), delta: swapDelta(base, meal) }
    : { meal, distance: 0, delta: null }));
  rows.sort((a, b) => a.distance - b.distance || a.meal.name.localeCompare(b.meal.name, 'fr'));
  return limit === undefined ? rows : rows.slice(0, limit);
}
