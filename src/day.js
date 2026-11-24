// src/day.js — modèle de « Ma journée » : fonctions pures (aucun DOM, aucun Vue, aucun stockage).
//
// Chaque repas de la journée a un facteur de départ (`base`, souvent 1) et peut avoir un facteur propre (`own`)
// réglé à la main. La journée a un facteur global (`global`). Règle « le dernier changement l'emporte » :
//   - facteur effectif d'un repas = own s'il existe, sinon base × global ;
//   - déplacer le curseur global annule tous les facteurs propres ;
//   - un facteur réglé ensuite sur un repas ne s'applique qu'à ce repas.

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
 */
export function sanitizeDay(raw, dayTypeIds) {
  const d = emptyDay();
  if (!raw || typeof raw !== 'object') return d;
  if (dayTypeIds ? dayTypeIds.includes(raw.dayType) : typeof raw.dayType === 'string' && raw.dayType) d.dayType = raw.dayType;
  if (Number.isFinite(raw.global)) d.global = clampFactor(raw.global);
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    if (!it || typeof it.meal !== 'string') continue;
    const base = Number.isFinite(it.base) ? it.base : it.factor; // ancien format : « factor » devient le facteur de départ
    if (!(Number.isFinite(base) && base > 0)) continue;
    const item = { meal: it.meal, base: r2(base) };
    if (Number.isFinite(it.own) && it.own > 0) item.own = clampOwn(it.own);
    d.items.push(item);
  }
  return d;
}

/** Le curseur global remet tous les repas sur ce facteur : les facteurs propres sont annulés. */
export const withGlobal = (day, g) => ({ ...day, global: clampFactor(g), items: day.items.map(({ own, ...item }) => item) });

/** Règle un facteur propre sur un repas (il l'emporte sur le facteur global). */
export const withOwn = (day, index, f) => ({ ...day, items: day.items.map((it, i) => (i === index ? { ...it, own: clampOwn(f) } : it)) });

/** Rend un repas au facteur global. */
export const withoutOwn = (day, index) => ({ ...day, items: day.items.map((it, i) => { if (i !== index) return it; const { own, ...rest } = it; return rest; }) });

/** Remplace le repas d'une ligne de « Ma journée » (variante, par exemple) en gardant son facteur de départ et son facteur propre. */
export const withMeal = (day, index, mealId) => ({ ...day, items: day.items.map((it, i) => (i === index ? { ...it, meal: mealId } : it)) });
