// src/backup.js
// Sauvegarde et restauration JSON des données de l'utilisateur, avec migrations de format.
// ATTENTION : la sauvegarde contient le profil (données personnelles). Elle ne doit jamais
// être déposée dans le dépôt (le .gitignore exclut les fichiers nutricible-sauvegarde*.json).
// Pour faire évoluer le format : incrémenter FORMAT et ajouter une migration (n → n+1) dans MIGRATIONS.

import { emptyProfile, normalize } from './calc.js';
import { sanitizeDay } from './day.js';
import { sanitizePlan } from './planner.js';

export const APP = 'NutriCible';
// Format 2 : la sauvegarde contient aussi « Ma journée » (`day`) et le planning de la semaine (`plan`).
// `day` et `plan` valent null quand la sauvegarde n'en contient pas (fichier de format 1, ou pas de planning généré) : rien à restaurer.
export const FORMAT = 2;

export const emptyUser = () => ({ profile: emptyProfile(), meals: [], foods: [], foodEdits: {}, deletedFoods: [], replacements: {}, day: null, plan: null });

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v) => (typeof v === 'string' ? v : '');
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []);
const pairs = (v) => (Array.isArray(v) ? v.filter((p) => Array.isArray(p) && typeof p[0] === 'string' && num(p[1]) > 0).map((p) => [p[0], p[1]]) : []);

export const uid = (prefix) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const PER100_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];
const cleanPer100 = (p) => Object.fromEntries(PER100_KEYS.map((k) => [k, isObj(p) && num(p[k]) !== null && p[k] >= 0 ? p[k] : 0]));
const cleanPortion = (p) => (isObj(p) && str(p.label) && num(p.g) > 0 ? { label: p.label, g: p.g } : null);
/** Clés autorisées dans la modification d'un aliment du recueil. */
export const EDIT_KEYS = ['name', 'type', 'season', 'per100', 'coef', 'weigh', 'portion', 'note', 'estimated'];

export function sanitizeProfile(p) {
  if (!isObj(p)) return emptyProfile();
  return {
    sex: p.sex === 'M' || p.sex === 'F' ? p.sex : '', age: num(p.age), heightCm: num(p.heightCm), weightKg: num(p.weightKg),
    weightMinKg: num(p.weightMinKg), weightMaxKg: num(p.weightMaxKg), restingKcal: num(p.restingKcal), longActiveKcal: num(p.longActiveKcal),
  };
}

export function sanitizeMeal(m) {
  if (!isObj(m) || !str(m.id) || !str(m.name)) return null;
  return {
    id: m.id, name: m.name, category: str(m.category), contexts: strs(m.contexts), tags: strs(m.tags),
    time: num(m.time), notes: str(m.notes), prep: str(m.prep), variant: str(m.variant),
    items: pairs(m.items), internal: pairs(m.internal),
  };
}

export function sanitizeFood(f) {
  if (!isObj(f) || !str(f.id) || !str(f.name)) return null;
  const out = { id: f.id, name: f.name, type: str(f.type) || 'Autres', state: str(f.state) || 'tel quel', unit: f.unit === 'ml' ? 'ml' : 'g', per100: cleanPer100(f.per100), estimated: !!f.estimated };
  if (str(f.note)) out.note = f.note;
  if (str(f.season)) out.season = f.season;
  const portion = cleanPortion(f.portion);
  if (portion) out.portion = portion;
  if (num(f.coef) > 0 && (out.state === 'cru' || out.state === 'cuit')) { out.coef = f.coef; out.weigh = f.weigh === 'cru' || f.weigh === 'cuit' ? f.weigh : out.state; }
  return out;
}

function sanitizeEdits(e) {
  const out = {};
  if (!isObj(e)) return out;
  for (const [id, patch] of Object.entries(e)) {
    if (!isObj(patch)) continue;
    const p = {};
    for (const k of EDIT_KEYS) if (k in patch) p[k] = k === 'per100' ? cleanPer100(patch[k]) : k === 'portion' ? cleanPortion(patch[k]) : patch[k];
    if (Object.keys(p).length) out[id] = p;
  }
  return out;
}

/** Ne garde que les clés connues, avec les bons types : une sauvegarde modifiée à la main ne casse rien. */
export function sanitizeUser(raw) {
  const u = emptyUser();
  if (!isObj(raw)) return u;
  u.profile = sanitizeProfile(raw.profile);
  u.meals = (Array.isArray(raw.meals) ? raw.meals : []).map(sanitizeMeal).filter(Boolean);
  u.foods = (Array.isArray(raw.foods) ? raw.foods : []).map(sanitizeFood).filter(Boolean);
  u.foodEdits = sanitizeEdits(raw.foodEdits);
  u.deletedFoods = strs(raw.deletedFoods);
  if (isObj(raw.replacements)) {
    for (const [mealId, map] of Object.entries(raw.replacements)) {
      if (!isObj(map)) continue;
      const m = Object.fromEntries(Object.entries(map).filter(([, v]) => typeof v === 'string'));
      if (Object.keys(m).length) u.replacements[mealId] = m;
    }
  }
  u.day = isObj(raw.day) ? sanitizeDay(raw.day) : null; // le type de journée est revalidé au chargement (la config n'est pas connue ici)
  u.plan = sanitizePlan(raw.plan);
  return u;
}

/** Migrations successives : MIGRATIONS[n] transforme les données du format n vers n + 1. */
export const MIGRATIONS = {
  0: (d) => ({ ...d, replacements: d?.replacements ?? {} }),
  1: (d) => ({ ...d, day: d?.day ?? null, plan: d?.plan ?? null }), // « Ma journée » et planning : absents des sauvegardes de format 1
};

export function migrate(file) {
  let format = typeof file.format === 'number' ? file.format : 0;
  let data = file.data;
  while (format < FORMAT) { data = (MIGRATIONS[format] ?? ((d) => d))(data); format += 1; }
  return data;
}

export function serialize(user, now = new Date()) {
  return JSON.stringify({ app: APP, format: FORMAT, exportedAt: now.toISOString(), data: user }, null, 2);
}

export function backupFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `nutricible-sauvegarde-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.json`;
}

/** @returns {{ok:true, data:object, exportedAt:string|null}|{ok:false, error:string}} */
export function parseBackup(text) {
  let file;
  try { file = JSON.parse(text); } catch { return { ok: false, error: "Ce fichier n'est pas un JSON valide." }; }
  if (!isObj(file) || file.app !== APP) return { ok: false, error: "Ce fichier n'est pas une sauvegarde NutriCible." };
  if (typeof file.format === 'number' && file.format > FORMAT) return { ok: false, error: 'Cette sauvegarde vient d\'une version plus récente de NutriCible.' };
  return { ok: true, data: sanitizeUser(migrate(file)), exportedAt: str(file.exportedAt) || null };
}

function uniqueName(name, taken) {
  let n = `${name} (importé)`;
  for (let i = 2; taken.has(normalize(n)); i += 1) n = `${name} (importé ${i})`;
  return n;
}

/**
 * Fusion d'une sauvegarde dans les données courantes.
 * strategy : 'replace-all' (tout remplacer), ou en cas de conflit de nom/identifiant :
 *   'keep' (garder l'existant), 'replace' (remplacer par la sauvegarde), 'rename' (importer en renommant).
 * reserved : noms déjà pris par le recueil ({foods:Set, meals:Set} de noms normalisés) ; un conflit avec le recueil
 * se résout toujours par un renommage.
 */
export function mergeBackup(current, incoming, strategy = 'keep', reserved = {}) {
  if (strategy === 'replace-all') return { user: structuredClone(incoming), report: { mode: 'replace-all' } };
  const user = structuredClone(current);
  const report = { addedFoods: 0, skippedFoods: 0, replacedFoods: 0, renamedFoods: 0, addedMeals: 0, skippedMeals: 0, replacedMeals: 0, renamedMeals: 0 };
  const idMap = new Map();
  const reservedFoods = reserved.foods ?? new Set();
  const reservedMeals = reserved.meals ?? new Set();

  const take = (kind, list, item, reservedSet, rep) => {
    const key = normalize(item.name);
    const same = list.find((x) => x.id === item.id) ?? list.find((x) => normalize(x.name) === key);
    const clash = reservedSet.has(key);
    if (!same && !clash) { list.push(item); idMap.set(item.id, item.id); report[`added${rep}`] += 1; return; }
    const strat = clash && !same ? 'rename' : strategy;
    if (strat === 'keep') { idMap.set(item.id, same.id); report[`skipped${rep}`] += 1; }
    else if (strat === 'replace') { Object.assign(same, { ...item, id: same.id }); idMap.set(item.id, same.id); report[`replaced${rep}`] += 1; }
    else {
      const taken = new Set([...list.map((x) => normalize(x.name)), ...reservedSet]);
      const copy = { ...item, id: uid(kind), name: uniqueName(item.name, taken) };
      list.push(copy); idMap.set(item.id, copy.id); report[`renamed${rep}`] += 1;
    }
  };

  for (const f of incoming.foods) take('food', user.foods, f, reservedFoods, 'Foods');
  const remap = (id) => idMap.get(id) ?? id;
  for (const m of incoming.meals) take('meal', user.meals, { ...m, items: m.items.map(([id, g]) => [remap(id), g]) }, reservedMeals, 'Meals');

  // « Ma journée » et planning : suivent les repas renommés ; une sauvegarde qui n'en contient pas (null) ne remplace rien ;
  // en mode « garder l'existant », l'importé ne prend la place que d'une journée vide ou d'une absence de planning.
  if (incoming.day && (strategy !== 'keep' || !user.day?.items.length)) user.day = { ...incoming.day, items: incoming.day.items.map((it) => ({ ...it, meal: remap(it.meal) })) };
  if (incoming.plan && (strategy !== 'keep' || !user.plan)) user.plan = { ...incoming.plan, days: incoming.plan.days.map((d) => ({ ...d, meals: d.meals.map(([slot, id]) => [slot, remap(id)]) })) };

  for (const [id, patch] of Object.entries(incoming.foodEdits)) if (strategy !== 'keep' || !(id in user.foodEdits)) user.foodEdits[id] = patch;
  user.deletedFoods = [...new Set([...user.deletedFoods, ...incoming.deletedFoods])];
  for (const [mealId, map] of Object.entries(incoming.replacements)) {
    const mapped = Object.fromEntries(Object.entries(map).map(([k, v]) => [k, remap(v)]));
    user.replacements[mealId] = strategy === 'keep' ? { ...mapped, ...(user.replacements[mealId] ?? {}) } : { ...(user.replacements[mealId] ?? {}), ...mapped };
  }
  for (const [k, v] of Object.entries(incoming.profile)) {
    const empty = user.profile[k] === null || user.profile[k] === '';
    const hasValue = v !== null && v !== '';
    if (hasValue && (empty || strategy !== 'keep')) user.profile[k] = v;
  }
  return { user, report };
}
