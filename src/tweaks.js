// src/tweaks.js — retouches de quantités : fonctions pures (aucun DOM, aucun Vue, aucun stockage), partagées par le planificateur
// (viewPlan), « Ma journée » (day.js, store.js) et l'interface.
//
// Une retouche change la quantité d'une ligne d'aliment d'un repas pour un jour (planning) ou pour un repas de « Ma journée ». On ne
// stocke que des choix, sous la forme courte [lineIndex, foodId, grams] (grams = quantité absolue avant facteur de portion) ; le rapport
// r = grams / quantité de la recette, le niveau (léger ou important), les macros et les totaux sont dérivés à la lecture.
//
// `tweakLevel` est le SEUL endroit qui connaît les seuils (bornes absolues `bounds`, seuil du marqueur jaune `major`) : ils viennent de
// config.planner.tune, jamais en dur, et ni l'interface ni l'algorithme ne comparent un rapport à un seuil eux-mêmes.

import { convertQty, fmtPct, fmtQty, unitOf, weighState, withQuantities } from './calc.js';

const EPS = 1e-9;

/** `bounds` et `major` de la config, lus même quand `enabled` est faux (un planning retouché reste lisible) ; null si le bloc est absent. */
export const tweakLimits = (config) => config?.planner?.tune ?? null;

/** Retouches maximales par jour (config.planner.tune.maxTweaks) ; 5 par défaut avant le chargement de la config. */
export const DEFAULT_MAX_TWEAKS = 5;

/**
 * Niveau d'une retouche d'après son rapport r = quantité retouchée ÷ quantité de la recette :
 * 'forbidden' (hors de `bounds`), 'major' (hors de `major` : marqueur jaune) ou 'minor' (marqueur bleu). Bornes inclusives des deux côtés,
 * comparées à 1e-9 près (jamais d'égalité flottante brute).
 * @param {number} ratio @param {{bounds:{min:number,max:number}, major:{min:number,max:number}}} limits
 */
export function tweakLevel(ratio, limits) {
  const { bounds, major } = limits;
  if (!(ratio >= bounds.min - EPS && ratio <= bounds.max + EPS)) return 'forbidden';
  return ratio < major.min - EPS || ratio > major.max + EPS ? 'major' : 'minor';
}

/**
 * Ne garde que les retouches valides à la lecture : le repas existe, n'est ni un cheat meal ni incomplet ; la ligne existe, est un aliment
 * (pas un ingrédient interne) du même aliment qu'à l'enregistrement (`foodId`) avec une quantité > 0 ; la quantité est un nombre fini et
 * le rapport est dans `bounds`. Les autres sont ignorées sans erreur (le planning stocké n'est pas réécrit).
 * @param {object|null} meal repas résolu (recette) @param {[number, string, number][]} tweaks @returns {[number, string, number][]}
 */
export function usableTweaks(meal, tweaks, limits) {
  if (!meal || meal.cheat || meal.incomplete || !limits || !Array.isArray(tweaks)) return [];
  const seen = new Set();
  const out = [];
  for (const t of tweaks) {
    if (!Array.isArray(t) || t.length < 3) continue;
    const [line, foodId, grams] = t;
    const l = Number.isInteger(line) ? meal.lines[line] : null;
    if (!l || l.kind !== 'food' || l.missing || !l.food || l.id !== foodId || !(l.qty > 0) || seen.has(line)) continue;
    if (typeof grams !== 'number' || !Number.isFinite(grams) || !(grams > 0) || Math.abs(grams - l.qty) < EPS) continue;
    if (tweakLevel(grams / l.qty, limits) === 'forbidden') continue;
    seen.add(line);
    out.push([line, foodId, grams]);
  }
  return out;
}

/**
 * Repas retouché : `withQuantities` (calc.js) avec, pour l'affichage, `tweaks` = [{ line, foodId, name, base, qty, ratio, level }]
 * (quantités de la recette et retouchées, avant facteur de portion). Le repas d'origine est rendu tel quel quand aucune retouche n'est valide.
 */
export function tweakedMeal(meal, tweaks, limits) {
  const usable = usableTweaks(meal, tweaks, limits);
  if (!usable.length) return meal;
  const tuned = withQuantities(meal, new Map(usable.map(([line, , grams]) => [line, grams])));
  if (!tuned.tuned) return meal;
  return { ...tuned, tweaks: tuned.tweaks.map((t) => ({ ...t, name: meal.lines[t.line].food.name, ratio: t.qty / t.base, level: tweakLevel(t.qty / t.base, limits) })) };
}

/** Niveau d'un repas retouché : celui de sa retouche la plus forte (« major » dès qu'une retouche l'est, sinon « minor »). null sans retouche. */
export const mealTweakLevel = (tweaks) => (!tweaks?.length ? null : tweaks.some((t) => t.level === 'major') ? 'major' : 'minor');

/** Libellé du niveau (infobulle, aria-label, bloc de la fiche) : la couleur n'est jamais le seul indice. */
export const tweakLevelLabel = (level) => (level === 'major' ? 'retouche importante' : 'retouche légère');

/**
 * Quantité d'une ligne affichée dans l'état de pesée `state` (cru ou cuit), multipliée par le facteur de portion : comme `IngredientList`.
 * @param {object} line ligne du repas (`meal.lines[i]`) @param {number} qty quantité avant facteur @param {number} factor @param {string} [state]
 */
export function displayQty(line, qty, factor, state) {
  const q = qty * factor;
  const food = line?.food;
  return food && food.convertible ? convertQty(food, q, food.state, state ?? weighState(food)) : q;
}

/**
 * Texte d'une retouche à partir de quantités déjà converties pour l'affichage : « Filet de poulet : 126 g au lieu de 90 g (+40 %, importante) ».
 * Le pourcentage est celui du rapport r (il ignore le facteur de portion) ; « importante » n'apparaît que pour un niveau major.
 */
export function tweakText(name, unit, shownQty, shownBase, ratio, level) {
  return `${name} : ${fmtQty(shownQty)} ${unit} au lieu de ${fmtQty(shownBase)} ${unit} (${fmtPct(ratio)}${level === 'major' ? ', importante' : ''})`;
}

/**
 * Détail d'une retouche d'un repas : les quantités sont multipliées par le facteur de portion du repas et converties dans l'état de pesée
 * `state` (par défaut celui de l'aliment, comme `IngredientList`).
 */
export function tweakLine(meal, t, factor = 1, state) {
  const line = meal.lines[t.line];
  return tweakText(t.name, unitOf(line?.food), displayQty(line, t.qty, factor, state), displayQty(line, t.base, factor, state), t.ratio, t.level);
}

/** Texte de l'infobulle d'un repas retouché (et son aria-label) : une ligne de synthèse, puis une ligne par aliment retouché. */
export function tweakTitle(meal, factor = 1) {
  const level = mealTweakLevel(meal.tweaks);
  return [`Quantités ajustées pour approcher vos cibles du jour (${tweakLevelLabel(level)})`, ...meal.tweaks.map((t) => tweakLine(meal, t, factor))].join('\n');
}

/** Forme courte stockée [lineIndex, foodId, grams] des retouches valides d'un repas lu par `viewPlan` (celles que « Ma journée » reprend). */
export const shortTweaks = (meal) => (meal?.tweaks ?? []).map((t) => [t.line, t.foodId, t.qty]);
