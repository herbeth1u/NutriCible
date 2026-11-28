// src/store.js
// État de l'application, valeurs dérivées (computed) et persistance dans le navigateur.
// INVARIANTS : une seule fonction de calcul (calc.js) ; aucun total stocké ; clés de stockage
// préfixées « nutricible:v1: » (le domaine GitHub Pages est partagé entre dépôts) ; tout accès au
// stockage est protégé par try/catch (l'appli reste utilisable en mémoire).

import { reactive, computed, watch } from './vue.js';
import * as C from './calc.js';
import { EDIT_KEYS, backupFileName, emptyUser, mergeBackup, sanitizeUser, serialize, uid } from './backup.js';
import { clampFactor, effectiveFactor, emptyDay, itemsFromPlanDay, sanitizeDay, withGlobal, withMeal, withOwn, withoutOwn } from './day.js';
import { carryAdjust, clampAdjust, generateWeek, realignedDayAdjust, referenceKcal, regenerateDay, removeMealAt, replacePlanMeal, replacePlanMealAt, restoreMealAt, sanitizePlan, setDayType, shoppingToText, viewPlan, weekTypes } from './planner.js';
import { findIdenticalMeal, substituteItems, variantBase } from './substitute.js';
import { sanitizeFilters, sanitizeFoodFilters, sanitizeTab } from './prefs.js';
import { tweakedMeal, tweakLimits } from './tweaks.js';
import { effectiveWeek, normalizeUserWeek } from './week.js';

export const PREFIX = 'nutricible:v1:';
const FORMAT_VERSION = 1;
const USER_KEYS = ['profile', 'meals', 'foods', 'foodEdits', 'deletedFoods', 'replacements', 'week'];

let storage = null;
try {
  storage = globalThis.localStorage ?? null;
  if (storage) { storage.setItem(`${PREFIX}probe`, '1'); storage.removeItem(`${PREFIX}probe`); }
} catch { storage = null; }

// Les données utilisateur du stockage (sans « Ma journée » ni le planning, qui ont leur propre clé) : voir emptyUser dans backup.js.
const emptyStored = () => { const { day, plan, ...rest } = emptyUser(); return rest; };

export const state = reactive({
  ready: false,
  error: '',
  storageOk: !!storage,
  base: { foods: [], internal: [], meals: [], days: [], week: [], config: null },
  user: emptyStored(),
  day: emptyDay(), // « Ma journée » : { dayType, global, items: [{ meal, base, own?, tweaks? }] } (voir src/day.js)
  plan: null, // planning de la semaine : { v, seed, adjust, days: [{ label, dayType, seed, adjust, meals: [[créneau, idRepas]], removed: [[créneau, idRepas]], tweaks? }] } (voir src/planner.js)
  planUndo: null, // un niveau d'annulation, en mémoire seulement : { plan, label }
  theme: 'auto',
  ui: { tab: 'meals', dialogs: [], dayOpen: false, filters: C.defaultFilters(), foodFilters: { q: '', types: [], seasons: [], origins: [], usage: '', sort: 'name', dir: 1 }, toast: '' },
});

const readKey = (k, fallback) => {
  if (!storage) return fallback;
  try { const v = storage.getItem(PREFIX + k); return v === null ? fallback : JSON.parse(v); } catch { return fallback; }
};
const writeKey = (k, v) => {
  if (!storage) return;
  try { storage.setItem(PREFIX + k, JSON.stringify(v)); } catch { state.storageOk = false; }
};

// ------------------------------------------------------------------ valeurs dérivées
export const config = computed(() => state.base.config);
export const internalIdx = computed(() => new Map(state.base.internal.map((i) => [i.id, i])));
export const foodIdx = computed(() => C.buildFoodIndex({ foods: state.base.foods, internal: state.base.internal, perso: state.user.foods, edits: state.user.foodEdits, deleted: state.user.deletedFoods }));
export const foods = computed(() => [...foodIdx.value.values()]);
export const resolveCtx = computed(() => ({ foodIdx: foodIdx.value, internalIdx: internalIdx.value, config: config.value, repl: state.user.replacements }));
export const mealDefs = computed(() => [...state.base.meals.map((m) => ({ ...m, origin: 'recueil' })), ...state.user.meals.map((m) => ({ ...m, origin: 'perso' }))]);
export const meals = computed(() => mealDefs.value.map((d) => C.resolveMeal(d, resolveCtx.value)));
export const mealIdx = computed(() => new Map(meals.value.map((m) => [m.id, m])));
export const usage = computed(() => {
  const u = new Map();
  for (const m of meals.value) for (const id of new Set(m.lines.filter((l) => l.kind === 'food').map((l) => l.id))) u.set(id, (u.get(id) ?? 0) + 1);
  return u;
});
export const deletedFoods = computed(() => state.base.foods.filter((f) => state.user.deletedFoods.includes(f.id)));
export const profileStatus = computed(() => C.profileStatus(state.user.profile));
export const targets = computed(() => (profileStatus.value.complete && config.value ? C.allTargets(state.user.profile, config.value) : null));
/** Repas d'une ligne de « Ma journée » : la recette, retouchée par les `tweaks` de la ligne (seules les retouches valides à la lecture s'appliquent). */
const dayMeal = (it) => {
  const m = mealIdx.value.get(it.meal);
  return m && it.tweaks ? tweakedMeal(m, it.tweaks, tweakLimits(config.value)) : m;
};
export const dayRows = computed(() => state.day.items.map((it, index) => {
  const meal = dayMeal(it);
  return { ...it, index, factor: effectiveFactor(it, state.day.global), own: Number.isFinite(it.own), meal, tweaks: meal?.tweaks }; // `tweaks` : le détail à afficher (absent si non retouché)
}).filter((r) => r.meal));
export const dayTotals = computed(() => C.dayTotals(state.day.items.map((it) => ({ meal: it.meal, factor: effectiveFactor(it, state.day.global), resolved: dayMeal(it) })), mealIdx.value).totals);
export const dayTarget = computed(() => targets.value?.[state.day.dayType] ?? null);
export const foodTypes = computed(() => config.value?.foodTypes ?? []);
/** Semaine type effective : celle d'origine (data/days.json), avec les journées types choisies dans « Cibles et hypothèses » (state.user.week). */
export const week = computed(() => effectiveWeek(state.base.week, state.user.week, state.base.days.map((d) => d.id)));
/** La semaine type diffère-t-elle de celle d'origine ? */
export const weekCustom = computed(() => normalizeUserWeek(state.base.week, state.user.week, state.base.days.map((d) => d.id)) !== null);
/** Contexte du planificateur : repas résolus, config, cibles (null sans profil), semaine type, kcal de référence des journées types. */
export const plannerCtx = computed(() => ({
  meals: meals.value, mealIdx: mealIdx.value, config: config.value, targets: targets.value,
  week: weekTypes(week.value, state.base.days), reference: referenceKcal(state.base.days, mealIdx.value),
}));
/** Planning lu : jours, budgets, facteurs, bilan, avertissements, liste de courses (tout est recalculé, rien n'est stocké). */
export const planView = computed(() => (state.plan && config.value ? viewPlan(plannerCtx.value, state.plan) : null));

// ------------------------------------------------------------------ interface
let toastTimer;
export const setTab = (t) => { state.ui.tab = t; };
// Boîtes de dialogue : une pile (la dernière est au premier plan). `openDialog` repart d'une pile vide ;
// `pushDialog` empile par-dessus (la fermer revient à la précédente) ; `replaceDialog` remplace celle du dessus.
let dialogSeq = 0;
const dialogEntry = (name, props) => ({ id: (dialogSeq += 1), name, props });
export const openDialog = (name, props = {}) => { state.ui.dialogs = [dialogEntry(name, props)]; };
export const pushDialog = (name, props = {}) => { state.ui.dialogs.push(dialogEntry(name, props)); };
export const replaceDialog = (name, props = {}) => { state.ui.dialogs.splice(Math.max(0, state.ui.dialogs.length - 1), 1, dialogEntry(name, props)); };
/** Ferme la boîte `id`, ou celle du dessus. */
export const closeDialog = (id) => {
  const i = id === undefined ? state.ui.dialogs.length - 1 : state.ui.dialogs.findIndex((d) => d.id === id);
  if (i >= 0) state.ui.dialogs.splice(i, 1);
};
export const closeAllDialogs = () => { state.ui.dialogs = []; };
export function toast(msg) {
  state.ui.toast = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { state.ui.toast = ''; }, 4000);
}

function applyTheme() {
  if (typeof document === 'undefined') return;
  if (state.theme === 'light' || state.theme === 'dark') document.documentElement.dataset.theme = state.theme;
  else delete document.documentElement.dataset.theme;
}
export function cycleTheme() { state.theme = state.theme === 'auto' ? 'dark' : state.theme === 'dark' ? 'light' : 'auto'; }

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* repli ci-dessous */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.append(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
export async function copyWithToast(text, label = 'Copié dans le presse-papiers.') {
  toast((await copyText(text)) ? label : 'Copie impossible : sélectionne le texte manuellement.');
}

export function downloadFile(name, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ------------------------------------------------------------------ profil
export function saveProfile(p) { state.user.profile = { ...C.emptyProfile(), ...p }; }

// ------------------------------------------------------------------ repas perso
export const mealNames = (exceptId) => meals.value.filter((m) => m.id !== exceptId).map((m) => m.name);
export const foodNames = (exceptId) => foods.value.filter((f) => f.id !== exceptId).map((f) => f.name);

export function uniqueMealName(base) {
  const taken = mealNames();
  let n = base;
  for (let i = 2; C.nameTaken(n, taken); i += 1) n = `${base} ${i}`;
  return n;
}

/** Brouillon de duplication : n'importe quel repas (recueil ou perso) devient un repas perso modifiable. */
export function duplicateDraft(m) {
  return {
    id: null, name: uniqueMealName(`${m.name} (copie)`), category: m.category, contexts: [...m.contexts], tags: [...m.manualTags],
    time: m.time, notes: m.notes, prep: m.prep, variant: m.variant,
    items: m.lines.filter((l) => l.kind === 'food').map((l) => [l.id, l.qty]),
    internal: m.lines.filter((l) => l.kind === 'internal').map((l) => [l.id, l.qty]),
  };
}

/** Brouillon de variante : le repas dupliqué, avec l'aliment de la ligne `foodIndex` (parmi les aliments) remplacé. */
export function substitutionDraft(m, foodIndex, foodId, qty) {
  const d = duplicateDraft(m);
  d.items = substituteItems(d.items, foodIndex, foodId, qty);
  d.name = uniqueMealName(`${variantBase(m.name)} (variante)`);
  return d;
}

/** Repas déjà présent (recueil ou perso) dont la composition est identique à celle du brouillon. */
export const findIdentical = (def) => findIdenticalMeal(def, meals.value);

// Actions de repas partagées par la carte, la fiche en popup et le planificateur. Elles s'empilent sur la boîte ouverte.
export const duplicateMeal = (m) => pushDialog('meal', { draft: duplicateDraft(m), mode: 'duplicate' });
export const editMeal = (m) => pushDialog('meal', { draft: { ...duplicateDraft(m), id: m.id, name: m.name }, mode: 'edit' });
/**
 * Fiche complète d'un repas en popup ; `dayIndex` = sa ligne dans « Ma journée » (portion, retrait, remplacement).
 * Hors « Ma journée » (planificateur) : `portion` = facteur à afficher, `replaceWhere` = où mettre une variante (voir `applyReplace`),
 * `planDay` et `slot` = le jour du planning et le créneau du repas (la fiche affiche alors le repas retouché de ce jour).
 */
export const openMealSheet = (mealId, dayIndex = null, { portion = null, replaceWhere = null, planDay = null, slot = null } = {}) => pushDialog('mealSheet', { mealId, dayIndex, portion, replaceWhere, planDay, slot });
/**
 * Ouvre le panneau de substitution pour l'aliment n° `foodIndex` (parmi les aliments, hors ingrédients internes) d'un repas.
 * `replace` : où mettre la variante à l'enregistrement (voir `applyReplace`), ou null pour seulement l'enregistrer.
 */
export const startSubstitution = (m, foodIndex, replace = null, factor = 1) => pushDialog('substitute', { mealId: m.id, foodIndex, replace, factor });

export function saveMeal(def) {
  const clean = { ...def, id: def.id ?? uid('meal'), items: def.items.map(([id, g]) => [id, +g]), internal: (def.internal ?? []).map(([id, g]) => [id, +g]) };
  const i = state.user.meals.findIndex((m) => m.id === clean.id);
  if (i >= 0) state.user.meals.splice(i, 1, clean); else state.user.meals.push(clean);
  return clean.id;
}

export function deleteMeal(id) {
  state.user.meals = state.user.meals.filter((m) => m.id !== id);
  state.day.items = state.day.items.filter((it) => it.meal !== id);
  if (state.user.replacements[id]) delete state.user.replacements[id];
}

// ------------------------------------------------------------------ aliments
const cleanNum = (v) => (Number.isFinite(+v) && +v >= 0 ? +v : 0);

export function addFood(def) {
  const food = { id: uid('food'), ...def, per100: C.normPer100(def.per100) };
  for (const k of Object.keys(food)) if (food[k] === null || food[k] === undefined || food[k] === '') delete food[k];
  state.user.foods.push(food);
  return food.id;
}

/** Modifie un aliment : perso = remplacement direct ; recueil = modification stockée à part (réinitialisable). */
export function updateFood(id, next) {
  const f = foodIdx.value.get(id);
  if (!f) return;
  if (f.origin === 'perso') {
    const i = state.user.foods.findIndex((x) => x.id === id);
    const merged = { ...state.user.foods[i], ...next, per100: C.normPer100(next.per100 ?? f.per100) };
    for (const k of Object.keys(merged)) if (merged[k] === null || merged[k] === undefined || merged[k] === '') delete merged[k];
    state.user.foods.splice(i, 1, merged);
    return;
  }
  const base = state.base.foods.find((x) => x.id === id);
  const patch = {};
  for (const k of EDIT_KEYS) {
    if (!(k in next)) continue;
    const ref = k === 'per100' ? f.original : base[k];
    if (JSON.stringify(next[k] ?? null) !== JSON.stringify(ref ?? null)) patch[k] = k === 'per100' ? C.normPer100(next[k]) : next[k];
  }
  if (Object.keys(patch).length) state.user.foodEdits[id] = patch; else delete state.user.foodEdits[id];
}

export function resetFood(id) { delete state.user.foodEdits[id]; }
export function resetAllFoodEdits() { state.user.foodEdits = {}; }

export const mealsUsing = (foodId) => meals.value.filter((m) => m.lines.some((l) => l.kind === 'food' && l.id === foodId));

/** mode : 'delete' (les repas concernés deviennent « Incomplet ») ou 'replace' (par l'aliment `by`, même quantité). */
export function deleteFood(id, mode = 'delete', by = null) {
  const affected = mealsUsing(id);
  if (mode === 'replace' && by) {
    for (const m of affected) {
      if (m.origin === 'perso') {
        const i = state.user.meals.findIndex((x) => x.id === m.id);
        state.user.meals[i] = { ...state.user.meals[i], items: state.user.meals[i].items.map(([fid, g]) => [fid === id ? by : fid, g]) };
      } else state.user.replacements[m.id] = { ...(state.user.replacements[m.id] ?? {}), [id]: by };
    }
  }
  if (foodIdx.value.get(id)?.origin === 'perso') state.user.foods = state.user.foods.filter((f) => f.id !== id);
  else if (!state.user.deletedFoods.includes(id)) state.user.deletedFoods.push(id);
  delete state.user.foodEdits[id];
}

export function restoreFood(id) {
  state.user.deletedFoods = state.user.deletedFoods.filter((x) => x !== id);
  for (const [mealId, map] of Object.entries(state.user.replacements)) {
    if (id in map) { delete map[id]; if (!Object.keys(map).length) delete state.user.replacements[mealId]; }
  }
}

// ------------------------------------------------------------------ semaine type (Cibles et hypothèses)
// state.user.week : null (semaine d'origine) ou 7 identifiants de journées types. Le planning existant n'est jamais modifié :
// la semaine type sert aux prochaines générations et au bouton « Semaine type » du planificateur.
const dayIds = () => state.base.days.map((d) => d.id);
/** Choisit la journée type d'un jour (0 = lundi). Enregistré tout de suite ; `null` si le résultat est la semaine d'origine. */
export function setWeekDay(index, dayId) {
  if (!Number.isInteger(index) || index < 0 || index >= state.base.week.length || !dayIds().includes(dayId)) return false;
  const next = week.value.map((w) => w.day);
  if (next[index] === dayId) return false;
  next[index] = dayId;
  state.user.week = normalizeUserWeek(state.base.week, next, dayIds());
  toast('Semaine type enregistrée : le Planificateur l\'utilisera pour « Semaine type » et pour les nouvelles semaines.');
  return true;
}
/** Rétablit la semaine type d'origine (data/days.json). */
export function resetWeek() {
  if (state.user.week === null) return false;
  state.user.week = null;
  toast('Semaine type d\'origine rétablie.');
  return true;
}

// ------------------------------------------------------------------ « Ma journée »
// Le dernier changement l'emporte (voir src/day.js) : un facteur réglé sur un repas lui est propre ;
// le curseur global remet tous les repas sur ce facteur.
export function addToDay(mealId, factor = 1) {
  const m = mealIdx.value.get(mealId);
  if (!m || m.incomplete) return false;
  state.day.items.push({ meal: mealId, base: factor });
  return true;
}
export const removeFromDay = (index) => { state.day.items.splice(index, 1); };
/**
 * Remplace le repas d'une ligne de « Ma journée » (variante), avec le même facteur. La ligne est retrouvée par son
 * indice, ou à défaut par le repas d'origine ; sans correspondance (ou repas incomplet), rien ne change.
 */
export function replaceInDay(index, fromMealId, toMealId) {
  const m = mealIdx.value.get(toMealId);
  if (!m || m.incomplete) return false;
  const i = state.day.items[index]?.meal === fromMealId ? index : state.day.items.findIndex((it) => it.meal === fromMealId);
  if (i < 0) return false;
  Object.assign(state.day, withMeal(state.day, i, toMealId));
  return true;
}
/**
 * Met la variante à la place du repas là où la substitution a été lancée :
 * `replace` = { where: 'day', index, mealId } (« Ma journée ») ou { where: 'plan', day, mealId } (planificateur).
 */
export function applyReplace(replace, toMealId) {
  if (replace?.where === 'day') return replaceInDay(replace.index, replace.mealId, toMealId);
  if (replace?.where === 'plan') return replaceInPlan(replace.day, replace.mealId, toMealId);
  return false;
}
/** Où la variante est mise, pour les messages (« dans Ma journée », « dans le planning »). */
export const replaceLabel = (replace) => (replace?.where === 'plan' ? 'le planning' : 'Ma journée');
export const setDayFactor = (index, factor) => { if (Number.isFinite(+factor) && +factor > 0) Object.assign(state.day, withOwn(state.day, index, factor)); };
export const releaseDayFactor = (index) => { Object.assign(state.day, withoutOwn(state.day, index)); };
export const setDayGlobal = (g) => { Object.assign(state.day, withGlobal(state.day, g)); };
export const clearDay = () => { state.day.items = []; state.day.global = 1; };

/**
 * Charge une journée dans « Ma journée » : items [idRepas, facteur de départ, retouches?], facteur global = `factor`. Un repas introuvable ou
 * incomplet est ignoré ; les retouches [ligne, idAliment, grammes] sont recopiées dans l'item (clé absente sans retouche).
 */
export function loadDay(day, factor = 1) {
  state.day.dayType = day.dayType;
  state.day.global = clampFactor(factor);
  state.day.items = day.items.filter(([id]) => mealIdx.value.get(id) && !mealIdx.value.get(id).incomplete).map(([meal, f, tweaks]) => (tweaks?.length ? { meal, base: f, tweaks: tweaks.map((t) => [...t]) } : { meal, base: f }));
  state.ui.dayOpen = true;
}

// ------------------------------------------------------------------ planificateur de semaine
// Le planning ne stocke que des choix (graines, types de journée, repas, repas retirés, ajustements) : tout le reste est dérivé (planView).
// Chaque modification lourde garde la version précédente en mémoire pour un « Annuler » d'un niveau ; les curseurs d'ajustement n'y passent pas.
const newSeed = () => Math.floor(Math.random() * 4294967296);
function commitPlan(next, label) {
  if (!next || next === state.plan) return false;
  state.planUndo = state.plan ? { plan: plain(state.plan), label } : null; // la première génération n'a rien à annuler
  state.plan = next;
  return true;
}
/**
 * Génère une nouvelle semaine. Les types de journée du planning actuel sont gardés, avec ses ajustements de portions (semaine et jours) ;
 * les repas retirés ne sont pas repris. `reset` revient à la semaine type et remet tous les ajustements à ×1.
 */
export function generatePlan({ reset = false } = {}) {
  if (!plannerCtx.value.config) return false;
  const dayTypes = state.plan && !reset ? state.plan.days.map((d) => d.dayType) : null;
  const next = generateWeek(plannerCtx.value, { seed: newSeed(), dayTypes });
  return commitPlan(reset ? next : carryAdjust(next, state.plan), reset ? 'retour à la semaine type' : 'nouvelle semaine');
}
export const regeneratePlanDay = (index) => commitPlan(state.plan && regenerateDay(plannerCtx.value, state.plan, index, { seed: newSeed() }), `régénération du ${state.plan?.days[index]?.label ?? 'jour'}`.toLowerCase());
export const setPlanDayType = (index, dayTypeId) => commitPlan(state.plan && setDayType(plannerCtx.value, state.plan, index, dayTypeId, { seed: newSeed() }), `changement de type du ${state.plan?.days[index]?.label ?? 'jour'}`.toLowerCase());
/** Remplace un repas du planning par une variante (même créneau). */
export function replaceInPlan(dayIndex, fromMealId, toMealId) {
  const m = mealIdx.value.get(toMealId);
  if (!state.plan || !m || m.incomplete) return false;
  const next = replacePlanMeal(state.plan, dayIndex, fromMealId, toMealId);
  return next !== state.plan && commitPlan(next, 'remplacement d\'un repas');
}
/**
 * Remplace le repas n° `mealIndex` d'un jour par `toMealId`, en gardant son créneau (par rang, pas par identifiant). Les repas retirés et
 * les ajustements sont conservés ; le facteur du jour est recalculé comme d'habitude. « Annuler » revient en arrière d'un niveau.
 */
export function swapPlanMeal(dayIndex, mealIndex, toMealId) {
  const day = state.plan?.days[dayIndex];
  const from = day?.meals[mealIndex];
  const to = mealIdx.value.get(toMealId);
  if (!from || !to || to.incomplete) return false;
  const fromName = mealIdx.value.get(from[1])?.name;
  if (!commitPlan(replacePlanMealAt(state.plan, dayIndex, mealIndex, toMealId), 'remplacement d\'un repas')) return false;
  toast(`« ${to.name} » remplace ${fromName ? `« ${fromName} »` : 'un repas introuvable'} le ${day.label.toLowerCase()}.`);
  return true;
}
/** Retire un repas d'un jour (n° `mealIndex` parmi ses repas) : il reste compté pour le facteur et le budget du jour, mais plus dans les apports. */
export const removePlanMeal = (dayIndex, mealIndex) => !!state.plan && commitPlan(removeMealAt(state.plan, dayIndex, mealIndex), 'retrait d\'un repas');
/** Rétablit un repas retiré (n° `removedIndex` parmi les repas retirés du jour), à sa place dans l'ordre des créneaux. */
export const restorePlanMeal = (dayIndex, removedIndex) => !!state.plan && commitPlan(restoreMealAt(plannerCtx.value, state.plan, dayIndex, removedIndex), 'rétablissement d\'un repas');
/**
 * Ajustements de portions : le curseur de la semaine et ceux des jours modifient le planning SANS passer par `commitPlan`
 * (chaque cran effacerait sinon l'annulation d'une régénération). Valeurs bornées par config.planner.adjust ; enregistrées comme le reste du planning.
 */
export function setPlanAdjust(v) {
  if (!state.plan) return false;
  state.plan.adjust = clampAdjust(config.value, 'week', v);
  return true;
}
export function setPlanDayAdjust(index, v) {
  const day = state.plan?.days[index];
  if (!day) return false;
  day.adjust = clampAdjust(config.value, 'day', v);
  return true;
}
/** Règle l'ajustement du jour pour que ses apports rejoignent sa cible (budget × ajustement de la semaine). */
export function realignPlanDay(index) {
  if (!state.plan?.days[index]) return false;
  return setPlanDayAdjust(index, realignedDayAdjust(plannerCtx.value, state.plan, index));
}
/** Annule la dernière modification du planning (un seul niveau). */
export function undoPlan() {
  if (!state.planUndo) return false;
  state.plan = state.planUndo.plan;
  state.planUndo = null;
  return true;
}
/** Met un jour du planning dans « Ma journée » (type de journée, repas et facteur de portion du jour) : remplace son contenu. */
export function addPlanDayToMyDay(index) {
  const d = planView.value?.days[index];
  const items = d ? itemsFromPlanDay(d) : [];
  if (!items.length) return false;
  loadDay({ dayType: d.dayType.id, items }, d.factor); // les retouches valides du jour suivent chaque repas : mêmes totaux que le planning
  return true;
}
export const copyShoppingList = () => planView.value && copyWithToast(shoppingToText(planView.value.shopping), 'Liste de courses copiée.');

// ------------------------------------------------------------------ sauvegarde et restauration
const plain = (x) => JSON.parse(JSON.stringify(x));
// Format 4 : la sauvegarde contient aussi « Ma journée », le planning (retouches de quantités comprises) et la semaine type choisie (voir src/backup.js).
const snapshot = () => ({ ...plain(state.user), day: plain(state.day), plan: plain(state.plan) });
export const exportBackup = () => downloadFile(backupFileName(), serialize(snapshot()), 'application/json');

export function restoreBackup(incoming, strategy) {
  const reserved = { foods: new Set(state.base.foods.map((f) => C.normalize(f.name))), meals: new Set(state.base.meals.map((m) => C.normalize(m.name))) };
  const { user, report } = mergeBackup(snapshot(), plain(incoming), strategy, reserved); // plain : `incoming` vient d'un état réactif, que structuredClone ne copie pas
  const { day, plan, ...rest } = user;
  Object.assign(state.user, rest);
  state.user.week = normalizeUserWeek(state.base.week, state.user.week, state.base.days.map((d) => d.id));
  const dayTypeIds = (state.base.config?.dayTypes ?? []).map((t) => t.id);
  // null = la sauvegarde n'en contient pas (format 1, ou pas de planning) : on garde l'actuel. Objet day.js : mêmes références (Ma journée le lit).
  const maxTweaks = state.base.config?.planner?.tune?.maxTweaks;
  if (day) Object.assign(state.day, sanitizeDay(day, dayTypeIds, { maxTweaks }));
  const restored = plan ? sanitizePlan(plan, { dayTypeIds, adjust: state.base.config?.planner?.adjust, maxTweaks }) : null;
  if (restored) { state.plan = restored; state.planUndo = null; }
  return report;
}

// ------------------------------------------------------------------ initialisation
// `no-cache` : le navigateur revalide les fichiers de data/ à chaque chargement (sinon une ancienne copie en cache, p. ex. un config.json sans planner, peut être servie).
const fetchJson = (name) => fetch(`./data/${name}.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`data/${name}.json : HTTP ${r.status}`); return r.json(); });

const readDay = () => sanitizeDay(readKey('day', null), (state.base.config?.dayTypes ?? []).map((t) => t.id), { maxTweaks: state.base.config?.planner?.tune?.maxTweaks });

export async function init(load = fetchJson) {
  try {
    const [foodsJson, internal, mealsJson, days, cfg] = await Promise.all(['foods', 'internal-ingredients', 'meals', 'days', 'config'].map(load));
    state.base = { foods: foodsJson.foods, internal: internal.ingredients, meals: mealsJson.meals, days: days.days, week: days.week, config: cfg };
    const { day: _day, plan: _plan, ...stored } = sanitizeUser(Object.fromEntries(USER_KEYS.map((k) => [k, readKey(k, undefined)])));
    state.user = stored;
    state.user.week = normalizeUserWeek(state.base.week, state.user.week, state.base.days.map((d) => d.id)); // identifiants revalidés : days.json a pu changer
    state.day = readDay();
    state.plan = sanitizePlan(readKey('plan', null), { dayTypeIds: cfg.dayTypes.map((t) => t.id), adjust: cfg.planner?.adjust, maxTweaks: cfg.planner?.tune?.maxTweaks });
    // Préférences d'interface : revalidées à la lecture (le contenu de data/ ou les aliments ont pu changer).
    Object.assign(state.ui.filters, sanitizeFilters(readKey('filters', null), { config: cfg, foodIds: [...foodIdx.value.keys()] }));
    Object.assign(state.ui.foodFilters, sanitizeFoodFilters(readKey('foodFilters', null), cfg));
    state.ui.tab = sanitizeTab(readKey('tab', null));
    state.theme = ['light', 'dark'].includes(readKey('theme', 'auto')) ? readKey('theme', 'auto') : 'auto';
    applyTheme();
    writeKey('format', FORMAT_VERSION);
    for (const k of USER_KEYS) watch(() => state.user[k], (v) => writeKey(k, v), { deep: true });
    watch(() => state.day, (v) => writeKey('day', v), { deep: true });
    watch(() => state.plan, (v) => writeKey('plan', v), { deep: true });
    watch(() => state.ui.filters, (v) => writeKey('filters', v), { deep: true });
    watch(() => state.ui.foodFilters, (v) => writeKey('foodFilters', v), { deep: true });
    watch(() => state.ui.tab, (v) => writeKey('tab', v));
    watch(() => state.theme, (v) => { writeKey('theme', v); applyTheme(); });
    state.ready = true;
  } catch (e) {
    state.error = `Impossible de charger les données (${e.message}). Ouvre le site via GitHub Pages ou un serveur local (voir le README).`;
  }
}

export { cleanNum };
