// src/prefs.js — préférences d'interface enregistrées dans le navigateur (filtres, tris, onglet actif).
// Fonctions pures : une valeur enregistrée est toujours revalidée à la lecture (liste de catégories modifiée,
// aliment supprimé, fichier édité à la main…), jamais prise telle quelle.

import { defaultFilters } from './calc.js';

export const TAB_IDS = ['meals', 'days', 'planner', 'targets', 'subs', 'foods'];
export const MEAL_SORTS = ['name', 'kcal', 'protein', 'carbs', 'fiber', 'time'];
export const FOOD_SORTS = ['name', 'type', 'season', 'kcal', 'protein', 'carbs', 'fat', 'fiber', 'usage'];

/** Liste de textes, sans doublon, restreinte aux valeurs autorisées (si `allowed` est fourni). */
const strs = (v, allowed) => (Array.isArray(v) ? [...new Set(v.filter((x) => typeof x === 'string' && (!allowed || allowed.includes(x))))] : []);
const numOrNull = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

/**
 * Filtres de l'onglet Repas.
 * @param {any} raw valeur lue dans le stockage
 * @param {{config?:any, foodIds?:string[]}} ctx listes de référence ; les valeurs inconnues sont retirées
 */
export function sanitizeFilters(raw, { config, foodIds } = {}) {
  const d = defaultFilters();
  if (!raw || typeof raw !== 'object') return d;
  const tags = config ? [...Object.values(config.autoTags).map((t) => t.label), ...config.manualTags] : undefined;
  return {
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    categories: strs(raw.categories, config?.categories),
    contexts: strs(raw.contexts, config?.contexts),
    foods: strs(raw.foods, foodIds),
    foodTypes: strs(raw.foodTypes, config?.foodTypes),
    densities: strs(raw.densities, config?.densityLevels.map((l) => l.id)),
    tags: strs(raw.tags, tags),
    origins: strs(raw.origins, ['Recueil', 'Perso']),
    kcalMin: numOrNull(raw.kcalMin), kcalMax: numOrNull(raw.kcalMax), proteinMin: numOrNull(raw.proteinMin),
    carbsMin: numOrNull(raw.carbsMin), carbsMax: numOrNull(raw.carbsMax),
    fiberMin: numOrNull(raw.fiberMin), fiberMax: numOrNull(raw.fiberMax), timeMax: numOrNull(raw.timeMax),
    sort: MEAL_SORTS.includes(raw.sort) ? raw.sort : 'name',
    dir: raw.dir === -1 ? -1 : 1,
  };
}

/** Nombre de filtres actifs (recherche, chaque groupe de pastilles, chaque curseur) : le tri n'en fait pas partie. */
export function activeFilterCount(f) {
  const groups = ['categories', 'contexts', 'foods', 'foodTypes', 'densities', 'tags', 'origins'];
  const ranges = ['kcalMin', 'kcalMax', 'proteinMin', 'carbsMin', 'carbsMax', 'fiberMin', 'fiberMax', 'timeMax'];
  return (f.q && f.q.trim() ? 1 : 0) + groups.filter((g) => f[g].length).length + ranges.filter((k) => f[k] !== null && f[k] !== undefined && f[k] !== '').length;
}

/** Filtres de l'onglet Aliments. */
export function sanitizeFoodFilters(raw, config) {
  const d = { q: '', types: [], seasons: [], origins: [], usage: '', sort: 'name', dir: 1 };
  if (!raw || typeof raw !== 'object') return d;
  return {
    q: typeof raw.q === 'string' ? raw.q.slice(0, 200) : '',
    types: strs(raw.types, config?.foodTypes),
    seasons: strs(raw.seasons, config ? [...config.seasons.map((s) => s.id), 'none'] : undefined),
    origins: strs(raw.origins, ['Recueil', 'Perso', 'Modifié']),
    usage: ['used', 'unused'].includes(raw.usage) ? raw.usage : '',
    sort: FOOD_SORTS.includes(raw.sort) ? raw.sort : 'name',
    dir: raw.dir === -1 ? -1 : 1,
  };
}

export const sanitizeTab = (t) => (TAB_IDS.includes(t) ? t : 'meals');
