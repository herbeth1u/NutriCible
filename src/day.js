// src/day.js — modèle de « Ma journée » : fonctions pures (aucun DOM, aucun Vue, aucun stockage).
//
// Chaque repas de la journée a un facteur de départ (`base`, souvent 1) et peut avoir un facteur propre (`own`)
// réglé à la main, et des retouches de quantités (`tweaks`, venues du planificateur : [ligne, idAliment, grammes][], clé absente
// quand il n'y en a pas, voir src/tweaks.js). La journée a un facteur global (`global`). Règle « le dernier changement l'emporte » :
//   - facteur effectif d'un repas = own s'il existe, sinon base × global ;
//   - déplacer le curseur global annule tous les facteurs propres ;
//   - un facteur réglé ensuite sur un repas ne s'applique qu'à ce repas.

import { DEFAULT_MAX_TWEAKS, shortTweaks } from './tweaks.js';

export const FACTOR_MIN = 0.5; // plage du curseur global
export const FACTOR_MAX = 2;
export const FACTOR_STEP = 0.05;
export const OWN_MIN = 0.1; // plage d'un facteur propre (saisie libre)
export const OWN_MAX = 5;

const r2 = (n) => Math.round(n * 100) / 100;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, r2(Number(v))));

export const clampFactor = (v) => clamp(v, FACTOR_MIN, FACTOR_MAX);
export const clampOwn = (v) => clamp(v, OWN_MIN, OWN_MAX);
export const emptyDay = () => ({ dayType: 'repos', global: 1, items: [] });

/** Facteur effectif d'un repas de « Ma journée ». */
export const effectiveFactor = (item, global = 1) => (Number.isFinite(item.own) && item.own > 0 ? item.own : r2(item.base * global));

/**
 * Relit une journée enregistrée. Accepte l'ancien format (items { meal, factor }, sans facteur global).
 * @param {any} raw
 * @param {string[]} [dayTypeIds] types de journée connus ; sans liste (lecture d'une sauvegarde, avant le chargement de la
 *   config), tout texte est accepté et le type est revalidé au chargement dans l'application.
 * @param {{maxTweaks?: number}} [opts] `maxTweaks` (config.planner.tune.maxTweaks) : plafond de lignes retouchées sur toute la journée, 5 par défaut.
 */
export function sanitizeDay(raw, dayTypeIds, { maxTweaks = DEFAULT_MAX_TWEAKS } = {}) {
  const d = emptyDay();
  if (!raw || typeof raw !== 'object') return d;
  if (dayTypeIds ? dayTypeIds.includes(raw.dayType) : typeof raw.dayType === 'string' && raw.dayType) d.dayType = raw.dayType;
  if (Number.isFinite(raw.global)) d.global = clampFactor(raw.global);
  let tweaked = 0; // lignes retouchées sur toute la journée (plafond `maxTweaks`)
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    if (!it || typeof it.meal !== 'string') continue;
    const base = Number.isFinite(it.base) ? it.base : it.factor; // ancien format : « factor » devient le facteur de départ
    if (!(Number.isFinite(base) && base > 0)) continue;
    const item = { meal: it.meal, base: r2(base) };
    if (Number.isFinite(it.own) && it.own > 0) item.own = clampOwn(it.own);
    const tweaks = cleanTweaks(it.tweaks, maxTweaks - tweaked);
    if (tweaks.length) { item.tweaks = tweaks; tweaked += tweaks.length; }
    d.items.push(item);
  }
  return d;
}

/**
 * Retouches d'un repas : [ligne, idAliment, grammes] bien formés (ligne entier ≥ 0, texte non vide, nombre fini > 0 et ≤ 10 000), sans
 * doublon de ligne, grammes arrondis à 0,01, au plus `room` lignes (ce qui reste du plafond de la journée). Les autres sont ignorées.
 * Les bornes (50 à 200 %) et l'aliment sont vérifiés à la lecture (`tweakedMeal`), là où la recette est connue.
 */
function cleanTweaks(list, room) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const t of list) {
    if (out.length >= room) break;
    if (!Array.isArray(t) || t.length !== 3) continue;
    const [line, foodId, grams] = t;
    if (!Number.isInteger(line) || line < 0 || typeof foodId !== 'string' || !foodId || typeof grams !== 'number' || !Number.isFinite(grams) || !(grams > 0) || grams > 10000 || seen.has(line)) continue;
    const g = r2(grams);
    if (!(g > 0)) continue;
    seen.add(line);
    out.push([line, foodId, g]);
  }
  return out;
}

/** Le curseur global remet tous les repas sur ce facteur : les facteurs propres sont annulés. */
export const withGlobal = (day, g) => ({ ...day, global: clampFactor(g), items: day.items.map(({ own, ...item }) => item) });

/** Règle un facteur propre sur un repas (il l'emporte sur le facteur global). */
export const withOwn = (day, index, f) => ({ ...day, items: day.items.map((it, i) => (i === index ? { ...it, own: clampOwn(f) } : it)) });

/** Rend un repas au facteur global. */
export const withoutOwn = (day, index) => ({ ...day, items: day.items.map((it, i) => { if (i !== index) return it; const { own, ...rest } = it; return rest; }) });

/**
 * Remplace le repas d'une ligne de « Ma journée » (variante, par exemple) en gardant son facteur de départ et son facteur propre.
 * Les retouches de l'ancien repas disparaissent : le nouveau repas n'a pas les mêmes lignes.
 */
export const withMeal = (day, index, mealId) => ({ ...day, items: day.items.map((it, i) => { if (i !== index) return it; const { tweaks, ...rest } = it; return { ...rest, meal: mealId }; }) });

/**
 * Items de « Ma journée » pour un jour du planning lu par `viewPlan` : [[idRepas, 1, retouches?], …] pour les repas complets (les repas
 * retirés ne sont pas ajoutés). Les retouches sont celles que `viewPlan` a retenues (valides), pas le stock brut ; le troisième élément est
 * absent quand le repas n'est pas retouché. Le facteur de portion du jour reste celui de `viewPlan` (`loadDay(…, d.factor)`).
 * @param {{items: {id: string, meal: object|null}[]}} dayView
 */
export const itemsFromPlanDay = (dayView) => dayView.items
  .filter((it) => it.meal && !it.meal.incomplete)
  .map((it) => (it.meal.tweaks?.length ? [it.id, 1, shortTweaks(it.meal)] : [it.id, 1]));
