// src/planner.js — planificateur de semaine : fonctions pures (aucun DOM, aucun Vue, aucun stockage).
//
// Une semaine planifiée (`plan`) ne stocke que des choix : la graine du tirage, les ajustements de portions et, pour chaque
// jour, son type, sa propre graine, son ajustement, ses repas `[créneau, identifiant de repas]` et ses repas retirés.
// Aucun total n'est stocké : budget, facteur de portion, écart, bilan, avertissements et liste de courses sont recalculés
// à la volée (`viewPlan`) depuis les repas, le profil et la config.
//
//   plan = { v: 1, seed, adjust: 1,
//            days: [{ label, dayType, seed, adjust: 1, meals: [[créneau, idRepas], …], removed: [[créneau, idRepas], …] }] }
//
// Un repas retiré reste dans `removed` : il compte pour le facteur de portion et le budget du jour (`basis`), mais plus pour
// les apports, le bilan, la liste de courses ni « Ma journée » ; il peut être rétabli. `adjust` (semaine, jour) multiplie le
// facteur calculé par le planificateur ; il ne s'applique pas aux jours fixes (cheat meal).
//
// Tirage : générateur pseudo-aléatoire à graine (mulberry32). Même graine + mêmes données = même semaine, ce qui permet
// de la reproduire et de la tester ; la graine reste interne (jamais affichée). Pour chaque jour, plusieurs tirages sont
// comparés et le meilleur est gardé ; le facteur de portion (calc.fitFactor) ramène ensuite le jour à son budget. Toutes les
// règles et tous les seuils sont dans config.json (bloc `planner`), jamais en dur ici.
//
// Règles dures : au moins `minLegumeMeals` repas avec une légumineuse dans la semaine (placés sur autant de jours différents),
// saumon au moins une fois, abats au plus une fois par semaine, lait + cacao sucré seulement les jours de sortie moyenne ou
// longue, aucun repas répété dans la semaine. Si une règle est impossible à tenir, le tirage la relâche (voir LEVELS) et
// `viewPlan` affiche l'avertissement correspondant.
//
// Le contexte `ctx` : { meals (repas résolus par calc.resolveMeal), mealIdx?, config, targets (calc.allTargets ou null),
// week (semaine type : [{ label, dayType }]), reference? ({ [typeDeJournée]: kcal }, pour choisir sans profil) }.

import { add, convertQty, fitFactor, fmtKcal, fmtNum, fmtQty, isConvertible, scale, sum, unitOf } from './calc.js';
import { clampFactor, FACTOR_MAX, FACTOR_MIN } from './day.js';
import { weekBudget } from './week.js';

export const PLAN_VERSION = 1;
/** Groupe de la liste de courses pour les ingrédients internes des recettes (sans type d'aliment). */
export const RECIPE_GROUP = 'Ingrédients de recettes';

// ------------------------------------------------------------------ générateur à graine
const uint = (v) => (Number.isInteger(v) && v >= 0 && v <= 0xffffffff ? v : 0);

/** mulberry32 : générateur pseudo-aléatoire à graine, renvoie des flottants dans [0, 1[. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Mélange des entiers en une graine de 32 bits (graines dérivées : un jour, une régénération…). */
export function mixSeed(...parts) {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h = Math.imul(h ^ (p >>> 0), 0x01000193);
    h ^= h >>> 15;
    h = Math.imul(h, 0x2c1b3c6d);
    h ^= h >>> 12;
  }
  return h >>> 0;
}

const pickOne = (rng, list) => list[Math.floor(rng() * list.length)];
/** `n` éléments distincts tirés au hasard (mélange partiel de Fisher-Yates sur une copie). */
function sample(rng, list, n) {
  const a = [...list];
  const k = Math.min(n, a.length);
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(rng() * (a.length - i));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, k);
}

// ------------------------------------------------------------------ config et types de journée
const mealIndex = (ctx) => ctx.mealIdx ?? new Map(ctx.meals.map((m) => [m.id, m]));
export const dayTypeOf = (config, id) => config.dayTypes.find((t) => t.id === id) ?? null;
export const isFixedType = (config, id) => config.planner.fixedDayTypes.includes(id);
/** Créneaux d'un type de journée (catégories de repas, dans l'ordre de la journée). */
export const slotsFor = (config, dt) => config.planner.slots[dt.id] ?? config.planner.slots[dt.outing ? 'outing' : 'rest'];
/** Contextes acceptés pour un type de journée, du plus adapté au moins adapté (repli en cascade). */
export const contextsFor = (config, dt) => config.planner.contexts[dt.id] ?? [dt.context];

// ------------------------------------------------------------------ règles dures
const FLAGS = new WeakMap(); // config → (repas → drapeaux) : évite de reparcourir les lignes à chaque tirage
export function flagsOf(meal, config) {
  let byMeal = FLAGS.get(config);
  if (!byMeal) { byMeal = new WeakMap(); FLAGS.set(config, byMeal); }
  let f = byMeal.get(meal);
  if (!f) {
    const r = config.planner.rules;
    const foods = meal.lines.filter((l) => l.kind === 'food');
    f = {
      legume: foods.some((l) => l.food?.type === r.legumeType),
      salmon: foods.some((l) => r.salmonFoods.includes(l.id)),
      offal: meal.manualTags.includes(r.offalTag),
      milkCocoa: foods.some((l) => r.milkCocoa.milk.includes(l.id)) && foods.some((l) => r.milkCocoa.cocoa.includes(l.id)),
    };
    byMeal.set(meal, f);
  }
  return f;
}
export const isLegume = (m, config) => flagsOf(m, config).legume;
export const isSalmon = (m, config) => flagsOf(m, config).salmon;
export const isOffal = (m, config) => flagsOf(m, config).offal;
export const hasMilkCocoa = (m, config) => flagsOf(m, config).milkCocoa;
/** Lait + cacao sucré : seulement les jours de sortie moyenne ou longue. */
export const milkCocoaAllowed = (config, dt) => config.planner.rules.milkCocoa.outings.includes(dt.outing);

const NEEDS = { salmon: isSalmon, legume: isLegume };

// ------------------------------------------------------------------ candidats
/**
 * Candidats d'un créneau : repas complets de la catégorie, filtrés par les règles dures, puis par contexte en cascade
 * (premier contexte de la liste qui a au moins un candidat). `f` : { used, offalLeft, repeat, anyContext }.
 */
function poolFor(ctx, dt, slot, f, pred = null) {
  const { config } = ctx;
  const fixed = isFixedType(config, dt.id);
  const mcOk = milkCocoaAllowed(config, dt);
  const base = ctx.meals.filter((m) => !m.incomplete && m.category === slot && !!m.cheat === fixed
    && (mcOk || !hasMilkCocoa(m, config)) && (f.offalLeft > 0 || !isOffal(m, config)) && (!pred || pred(m)));
  const cascade = (list) => {
    for (const c of contextsFor(config, dt)) {
      const l = list.filter((m) => m.contexts.includes(c));
      if (l.length) return l;
    }
    return f.anyContext ? list : [];
  };
  const out = cascade(base.filter((m) => !f.used.has(m.id)));
  return !out.length && f.repeat ? cascade(base) : out;
}

/** Ce qui est déjà pris dans la semaine hors le jour `except` : repas, abats, saumon, repas à légumineuses. */
function stateOf(ctx, plan, except) {
  const idx = mealIndex(ctx);
  const used = new Set();
  let offal = 0;
  let salmon = 0;
  let legume = 0;
  plan.days.forEach((d, i) => {
    if (i === except) return;
    for (const [, id] of d.meals) {
      used.add(id);
      const m = idx.get(id);
      if (!m) continue;
      if (isOffal(m, ctx.config)) offal += 1;
      if (isSalmon(m, ctx.config)) salmon += 1;
      if (isLegume(m, ctx.config)) legume += 1;
    }
  });
  return { used, offal, salmon, legume };
}

const baseFilter = (ctx, state) => ({ used: state.used, offalLeft: Math.max(0, ctx.config.planner.rules.maxOffalPerWeek - state.offal), repeat: false, anyContext: false });

/** Un jour peut-il accueillir un repas au saumon (contextes stricts, repas encore libres) ? */
function canSalmon(ctx, dt, state) {
  return slotsFor(ctx.config, dt).some((s) => poolFor(ctx, dt, s, baseFilter(ctx, state), (m) => isSalmon(m, ctx.config)).length > 0);
}

/** Un jour peut-il accueillir un repas à légumineuses (contextes stricts, repas encore libres) ? */
function canLegume(ctx, dt, state) {
  return slotsFor(ctx.config, dt).some((s) => poolFor(ctx, dt, s, baseFilter(ctx, state), (m) => isLegume(m, ctx.config)).length > 0);
}

// ------------------------------------------------------------------ tirage d'un jour
// Du plus strict au plus souple : on ne relâche une règle que si la précédente est impossible à tenir.
// Les contextes se relâchent d'abord, puis la répétition, puis le saumon du jour, puis les légumineuses du jour (si le jour doit
// en contenir), puis un créneau peut rester vide.
const LEVELS = [
  { needs: ['salmon', 'legume'], anyContext: false, repeat: false },
  { needs: ['salmon', 'legume'], anyContext: true, repeat: false },
  { needs: ['salmon', 'legume'], anyContext: true, repeat: true },
  { needs: ['legume'], anyContext: true, repeat: true },
  { needs: [], anyContext: true, repeat: true, partial: true },
];

/** Un tirage : exigences d'abord (saumon, légumineuses), puis les autres créneaux. null si impossible à ce niveau. */
function attempt(ctx, dt, slots, rng, state, lv, needs) {
  const { config } = ctx;
  const picks = new Array(slots.length).fill(null);
  const taken = new Set();
  let offalLeft = Math.max(0, config.planner.rules.maxOffalPerWeek - state.offal);
  const filter = () => ({ used: new Set([...state.used, ...taken]), offalLeft, repeat: lv.repeat, anyContext: lv.anyContext });
  const take = (i, meal) => { picks[i] = meal; taken.add(meal.id); if (isOffal(meal, config)) offalLeft -= 1; };
  for (const n of needs) {
    const pred = (m) => NEEDS[n](m, config);
    if (picks.some((p) => p && pred(p))) continue; // déjà tenue par un repas tiré pour une autre exigence
    const options = [];
    slots.forEach((s, i) => {
      if (picks[i]) return;
      const pool = poolFor(ctx, dt, s, filter(), pred);
      if (pool.length) options.push([i, pool]);
    });
    if (!options.length) return null;
    const [i, pool] = pickOne(rng, options);
    take(i, pickOne(rng, pool));
  }
  for (let i = 0; i < slots.length; i += 1) {
    if (picks[i]) continue;
    const pool = poolFor(ctx, dt, slots[i], filter());
    if (!pool.length) { if (lv.partial) continue; return null; }
    take(i, pickOne(rng, pool));
  }
  return picks;
}

/** Plus le score est bas, mieux c'est : portion proche de ×1, protéines dans la fourchette, fibres vers la cible. */
function scoreDay(ctx, dt, picked, budget) {
  const total = sum(picked.map((m) => m.totals));
  const goal = budget ?? ctx.reference?.[dt.id] ?? null;
  if (!(goal > 0) || !(total.kcal > 0)) return 0;
  const p = ctx.config.planner;
  let s = Math.abs(total.kcal / goal - 1);
  const t = budget != null ? ctx.targets?.[dt.id] : null;
  if (t) {
    const adj = scale(total, fitFactor(total.kcal, budget, p.step));
    const prot = adj.protein < t.protein.min ? (t.protein.min - adj.protein) / t.protein.min : adj.protein > t.protein.max ? (adj.protein - t.protein.max) / t.protein.max : 0;
    s += p.score.protein * prot + p.score.fiber * Math.max(0, (t.fiber - adj.fiber) / t.fiber);
  }
  return s;
}

/**
 * Tire les repas d'un jour : `attempts` tirages comparés, le meilleur est gardé. `salmon` et `legume` : le jour doit contenir
 * un repas au saumon, un repas à légumineuses (jamais exigé un jour fixe).
 * @returns {[string, string][]} couples [créneau, identifiant de repas], dans l'ordre des créneaux
 */
function drawDay(ctx, dt, seed, state, { budget = null, salmon = false, legume = false } = {}) {
  const { config } = ctx;
  const slots = slotsFor(config, dt);
  const fixed = isFixedType(config, dt.id);
  const rng = mulberry32(seed);
  for (const lv of LEVELS) {
    const needs = lv.needs.filter((n) => (n === 'salmon' ? salmon : legume && !fixed));
    let best = null;
    for (let a = 0; a < (fixed ? 1 : config.planner.attempts); a += 1) {
      const picks = attempt(ctx, dt, slots, rng, state, lv, needs);
      if (!picks) continue;
      const score = scoreDay(ctx, dt, picks.filter(Boolean), budget);
      if (!best || score < best.score) best = { picks, score };
    }
    if (best) return best.picks.map((m, i) => (m ? [slots[i], m.id] : null)).filter(Boolean);
  }
  return [];
}

// ------------------------------------------------------------------ budgets
/**
 * Budget kcal de chaque jour (somme = dépense de la semaine : maintien). Un jour fixe garde ses kcal (cheat meal) ; les autres
 * se partagent le reste au prorata de leur cible, jamais sous `floor` × leur dépense. null sans profil complet.
 */
export function planBudgets(ctx, plan) {
  if (!ctx.targets) return null;
  const idx = mealIndex(ctx);
  const rows = plan.days.map((d) => {
    const t = ctx.targets[d.dayType];
    const fixed = isFixedType(ctx.config, d.dayType);
    // Jour fixe : ses kcal sont celles de tous ses repas, retirés compris (retirer le cheat meal ne déplace pas les autres budgets).
    const kcal = fixed ? [...d.meals, ...(d.removed ?? [])].reduce((s, [, id]) => s + (idx.get(id)?.totals.kcal ?? 0), 0) : 0;
    return { expenditure: t.expenditure, target: t.kcal, fixed, fixedKcal: kcal > 0 ? kcal : t.kcal };
  });
  return weekBudget(rows, { floor: ctx.config.planner.floor });
}

// ------------------------------------------------------------------ génération
const clonePlan = (plan) => ({ ...plan, days: plan.days.map((d) => ({ ...d, meals: d.meals.map((m) => [...m]), removed: (d.removed ?? []).map((m) => [...m]) })) });

// ------------------------------------------------------------------ ajustements de portions
const snap = (v, step) => Math.round(Math.round(v / step) * step * 1e6) / 1e6;
/** Borne un ajustement (`scope` : 'week' ou 'day') aux plages de `adjust` (config.planner.adjust), au pas près. */
export function clampAdjustWith(adjust, scope, v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 1;
  const { min, max } = adjust[scope];
  return Math.min(max, Math.max(min, snap(n, adjust.step)));
}
export const clampAdjust = (config, scope, v) => clampAdjustWith(config.planner.adjust, scope, v);

/**
 * Génère une semaine. `dayTypes` : types de journée de chaque jour (par défaut ceux de la semaine type).
 * Ordre du tirage : jours fixes (cheat meal), jour du saumon et jours à légumineuses (tirés d'abord, parmi les jours ouverts),
 * puis les autres du plus contraint au moins contraint.
 */
export function generateWeek(ctx, { seed = 1, dayTypes = null } = {}) {
  const { config } = ctx;
  const s = uint(seed);
  const plan = {
    v: PLAN_VERSION, seed: s, adjust: 1,
    days: ctx.week.map((w, i) => ({ label: w.label, dayType: dayTypes?.[i] ?? w.dayType, seed: mixSeed(s, i + 1), adjust: 1, meals: [], removed: [] })),
  };
  const dts = plan.days.map((d) => dayTypeOf(config, d.dayType));
  const none = { used: new Set(), offal: 0, salmon: 0 };
  const open = [];
  plan.days.forEach((d, i) => {
    if (isFixedType(config, d.dayType)) d.meals = drawDay(ctx, dts[i], d.seed, stateOf(ctx, plan, i));
    else open.push(i);
  });
  const budgets = planBudgets(ctx, plan);
  const rng = mulberry32(mixSeed(s, 0x5a1d));
  const salmonDays = open.filter((i) => canSalmon(ctx, dts[i], none));
  const salmonDay = salmonDays.length ? pickOne(rng, salmonDays) : -1;
  // Jours qui devront contenir une légumineuse : min(minLegumeMeals, jours ouverts), en préférant ceux qui peuvent en accueillir une.
  const legumeNeeded = Math.min(config.planner.rules.minLegumeMeals, open.length);
  const legumeRng = mulberry32(mixSeed(s, 0x1e90));
  const able = open.filter((i) => canLegume(ctx, dts[i], none));
  const legumeDays = new Set(sample(legumeRng, able, legumeNeeded));
  if (legumeDays.size < legumeNeeded) for (const i of sample(legumeRng, open.filter((i) => !legumeDays.has(i)), legumeNeeded - legumeDays.size)) legumeDays.add(i);
  const tight = (i) => Math.min(...slotsFor(config, dts[i]).map((sl) => poolFor(ctx, dts[i], sl, baseFilter(ctx, none)).length));
  const order = [...open].sort((a, b) => (a === salmonDay ? -1 : b === salmonDay ? 1 : 0) || tight(a) - tight(b) || a - b);
  for (const i of order) {
    plan.days[i].meals = drawDay(ctx, dts[i], plan.days[i].seed, stateOf(ctx, plan, i), { budget: budgets?.[i] ?? null, salmon: i === salmonDay, legume: legumeDays.has(i) });
  }
  return plan;
}

/**
 * Retire les repas d'un jour puis le retire au sort : même type de journée, graine propre au jour. Le jour doit contenir une
 * légumineuse si les autres jours en contiennent moins que le minimum de la semaine : le jour est tiré directement avec cette
 * exigence, jamais corrigé ensuite en modifiant un autre jour. Jour fixe (cheat meal) : pas d'exigence, seul l'avertissement de semaine signale le manque.
 */
function redrawDay(ctx, plan, index) {
  const day = plan.days[index];
  const dt = dayTypeOf(ctx.config, day.dayType);
  day.meals = [];
  day.removed = []; // un nouveau tirage repart de zéro : les repas retirés ne sont pas conservés
  const state = stateOf(ctx, plan, index);
  const fixed = isFixedType(ctx.config, day.dayType);
  const salmon = !fixed && state.salmon === 0 && canSalmon(ctx, dt, state); // le saumon de la semaine ne doit pas disparaître
  const legume = !fixed && state.legume < ctx.config.planner.rules.minLegumeMeals;
  day.meals = drawDay(ctx, dt, day.seed, state, { budget: planBudgets(ctx, plan)?.[index] ?? null, salmon, legume });
  return plan;
}

/**
 * Regénère un jour (les autres ne bougent pas). Sans `seed`, la graine suivante est dérivée de celle du jour.
 * L'ajustement du jour est conservé ; les repas retirés sont vidés.
 */
export function regenerateDay(ctx, plan, index, { seed } = {}) {
  if (!plan.days[index]) return plan;
  const next = clonePlan(plan);
  next.days[index].seed = seed === undefined ? mixSeed(next.days[index].seed, 1) : uint(seed);
  return redrawDay(ctx, next, index);
}

/**
 * Change le type d'un jour et le regénère : les budgets des autres jours changent, leurs repas non (leurs facteurs sont recalculés).
 * L'ajustement du jour repasse à ×1 et les repas retirés sont vidés.
 */
export function setDayType(ctx, plan, index, dayTypeId, { seed } = {}) {
  if (!plan.days[index] || plan.days[index].dayType === dayTypeId || !dayTypeOf(ctx.config, dayTypeId)) return plan;
  const next = clonePlan(plan);
  next.days[index].dayType = dayTypeId;
  next.days[index].adjust = 1;
  next.days[index].seed = seed === undefined ? mixSeed(next.days[index].seed, 2) : uint(seed);
  return redrawDay(ctx, next, index);
}

/**
 * Nouvelle semaine générée à la place de `previous` : garde l'ajustement de la semaine et celui des jours dont le type n'a pas
 * changé (les repas retirés ne sont jamais repris). Sans `previous`, `next` est rendu tel quel.
 */
export function carryAdjust(next, previous) {
  if (!previous) return next;
  const out = clonePlan(next);
  out.adjust = previous.adjust ?? 1;
  out.days.forEach((d, i) => { if (previous.days[i]?.dayType === d.dayType) d.adjust = previous.days[i].adjust ?? 1; });
  return out;
}

/** Retire le repas n° `mealIndex` d'un jour : il passe dans `removed` (il compte encore pour le facteur et le budget du jour). */
export function removeMealAt(plan, dayIndex, mealIndex) {
  if (!plan.days[dayIndex]?.meals[mealIndex]) return plan;
  const next = clonePlan(plan);
  const day = next.days[dayIndex];
  day.removed.push(day.meals.splice(mealIndex, 1)[0]);
  return next;
}

/** Rétablit le repas retiré n° `removedIndex` d'un jour, à sa place dans l'ordre des créneaux du type de journée. */
export function restoreMealAt(ctx, plan, dayIndex, removedIndex) {
  if (!plan.days[dayIndex]?.removed?.[removedIndex]) return plan;
  const next = clonePlan(plan);
  const day = next.days[dayIndex];
  const [entry] = day.removed.splice(removedIndex, 1);
  const dt = dayTypeOf(ctx.config, day.dayType);
  const order = dt ? slotsFor(ctx.config, dt) : [];
  const rank = (slot) => { const i = order.indexOf(slot); return i < 0 ? order.length : i; };
  const at = day.meals.findIndex(([slot]) => rank(slot) > rank(entry[0]));
  day.meals.splice(at < 0 ? day.meals.length : at, 0, entry);
  return next;
}

/**
 * Ajustement du jour qui ramène ses apports sur la cible de maintien `budget` (utile après un retrait ou un curseur) : le facteur
 * calculé `base` est celui d'avant le retrait, l'ajustement du jour compense donc les repas retirés et l'ajustement de la semaine.
 * Borné à la plage du jour.
 * Sans budget (pas de profil), jour fixe ou jour vide : l'ajustement actuel est rendu.
 */
export function realignedDayAdjust(ctx, plan, dayIndex) {
  const d = viewPlan(ctx, plan).days[dayIndex];
  if (!d || d.fixed || d.budget === null || !(d.totals.kcal > 0)) return plan.days[dayIndex]?.adjust ?? 1;
  return clampAdjust(ctx.config, 'day', d.budget / (d.totals.kcal * d.base * (plan.adjust ?? 1)));
}

/** Remplace un repas du planning (variante issue d'une substitution, par exemple) en gardant son créneau. */
export function replacePlanMeal(plan, index, fromMealId, toMealId) {
  const day = plan.days[index];
  const at = day?.meals.findIndex(([, id]) => id === fromMealId) ?? -1;
  if (at < 0) return plan;
  const next = clonePlan(plan);
  next.days[index].meals[at][1] = toMealId;
  return next;
}

// ------------------------------------------------------------------ lecture d'un planning (tout est dérivé)
/**
 * Semaine type avec le type de journée de chaque jour : [{ label, dayType }] (days.json : week + days).
 * @param {{label:string, day:string}[]} week @param {{id:string, dayType:string}[]} days
 */
export function weekTypes(week, days) {
  const idx = new Map(days.map((d) => [d.id, d]));
  return week.map((w) => ({ label: w.label, dayType: idx.get(w.day)?.dayType ?? 'repos' }));
}

/** kcal d'une journée type de chaque type (référence pour choisir quand le profil n'est pas renseigné : aucune donnée personnelle). */
export function referenceKcal(days, mealIdx) {
  const out = {};
  for (const d of days) {
    if (d.dayType in out) continue;
    out[d.dayType] = d.items.reduce((s, [id, f]) => s + (mealIdx.get(id)?.totals.kcal ?? 0) * f, 0);
  }
  return out;
}

/**
 * Lecture complète d'un planning : jours (repas résolus, totaux, facteur, budget, écart), bilan de la semaine,
 * avertissements et liste de courses. Rien n'est stocké.
 */
export function viewPlan(ctx, plan) {
  const { config } = ctx;
  const p = config.planner;
  const idx = mealIndex(ctx);
  const budgets = planBudgets(ctx, plan);
  const planAdjust = plan.adjust ?? 1;
  const macros = (list) => sum(list.filter((it) => it.meal && !it.meal.incomplete).map((it) => it.meal.totals));
  const days = plan.days.map((d, i) => {
    const dt = dayTypeOf(config, d.dayType);
    const fixed = isFixedType(config, d.dayType);
    const items = d.meals.map(([slot, id]) => ({ slot, id, meal: idx.get(id) ?? null }));
    const removedItems = (d.removed ?? []).map(([slot, id]) => ({ slot, id, meal: idx.get(id) ?? null }));
    const totals = macros(items); // apports : repas présents seulement
    const basis = add(totals, macros(removedItems)); // base du facteur : repas retirés encore existants compris
    const budget = budgets ? budgets[i] : null;
    const base = fixed || budget === null ? 1 : fitFactor(basis.kcal, budget, p.step);
    const dayAdjust = d.adjust ?? 1;
    const mult = fixed ? 1 : planAdjust * dayAdjust;
    // Même arrondi (0,01) et mêmes bornes que « Ma journée » (day.js) : « Ajouter à Ma journée » retrouve exactement ce facteur.
    const factor = fixed ? 1 : clampFactor(base * mult);
    const adjusted = scale(totals, factor);
    return {
      index: i, label: d.label, dayType: dt, fixed, items, removedItems, totals, basis, base, adjust: dayAdjust, mult, factor, adjusted, budget,
      target: ctx.targets?.[d.dayType] ?? null, delta: budget === null ? null : adjusted.kcal - budget, // toujours par rapport à la cible de maintien
    };
  });
  const total = sum(days.map((d) => d.adjusted));
  const expenditure = ctx.targets ? days.reduce((s, d) => s + (d.target?.expenditure ?? 0), 0) : null;
  const balance = expenditure === null ? null : total.kcal - expenditure;
  const week = {
    total, average: total.kcal / (days.length || 1), expenditure, balance, adjust: planAdjust,
    legumes: { count: legumeCount(ctx, days), min: p.rules.minLegumeMeals },
    budgetTotal: budgets ? budgets.reduce((a, b) => a + b, 0) : null,
    status: balance === null ? null : Math.abs(balance) <= p.balanceTolerance * expenditure ? 'maintien' : balance > 0 ? 'surplus' : 'déficit',
  };
  return { days, week, warnings: auditPlan(ctx, days, week), shopping: shoppingList(ctx, days) };
}

/** Nombre de repas à légumineuses de la semaine (jours lus par `viewPlan`). */
const legumeCount = (ctx, days) => days.reduce((n, d) => n + d.items.filter((it) => it.meal && isLegume(it.meal, ctx.config)).length, 0);

/** Avertissements : règles non tenues, repas introuvables, budget hors de portée. Dérivés du planning, jamais stockés. */
export function auditPlan(ctx, days, week = null) {
  const { config } = ctx;
  const p = config.planner;
  const out = [];
  const warn = (day, code, text) => out.push({ day, code, text });
  const seen = new Map(); // id → jours où le repas apparaît
  let salmon = 0;
  let offal = 0;
  for (const d of days) {
    const where = d.label;
    const accepted = contextsFor(config, d.dayType);
    const have = new Set([...d.items, ...d.removedItems].map((it) => it.slot)); // un créneau retiré volontairement n'est pas « vide »
    for (const slot of slotsFor(config, d.dayType)) if (!have.has(slot)) warn(where, 'empty-slot', `Aucun repas disponible pour le créneau « ${slot} ».`);
    for (const it of d.items) {
      if (!it.meal) { warn(where, 'missing-meal', `Un repas du planning n'existe plus (« ${it.id} ») : regénère ce jour.`); continue; }
      if (it.meal.incomplete) warn(where, 'incomplete', `« ${it.meal.name} » est incomplet (aliment supprimé) : regénère ce jour.`);
      seen.set(it.id, [...(seen.get(it.id) ?? []), d.label]);
      if (isSalmon(it.meal, config)) salmon += 1;
      if (isOffal(it.meal, config)) offal += 1;
      if (!it.meal.contexts.some((c) => accepted.includes(c))) warn(where, 'context', `« ${it.meal.name} » ne correspond pas au contexte « ${d.dayType.label} ».`);
      if (hasMilkCocoa(it.meal, config) && !milkCocoaAllowed(config, d.dayType)) warn(where, 'milk-cocoa', `« ${it.meal.name} » : lait et cacao sucré sont réservés aux jours de sortie moyenne ou longue.`);
    }
    // L'écart se compare à la cible de maintien ; pas d'avertissement quand l'écart est voulu (repas retiré, curseur ≠ ×1),
    // sauf si le facteur est bloqué à une borne de portion : l'écart est alors subi.
    const voluntary = d.removedItems.length > 0 || (d.mult !== 1 && d.factor > FACTOR_MIN && d.factor < FACTOR_MAX);
    if (!d.fixed && d.budget !== null && !voluntary && Math.abs(d.delta) > p.gapWarning * d.budget) {
      warn(where, 'kcal-gap', `Budget de ${fmtKcal(d.budget)} kcal hors de portée avec ces repas (portions limitées à ×${fmtNum(d.factor, 2)}) : écart de ${fmtKcal(d.delta)} kcal.`);
    }
  }
  for (const [id, labels] of seen) {
    if (labels.length > 1) warn(null, 'repeat', `« ${mealIndex(ctx).get(id)?.name ?? id} » revient ${labels.length} fois dans la semaine (${labels.join(', ')}).`);
  }
  if (week && week.budgetTotal !== null && week.budgetTotal > week.expenditure + 1) {
    warn(null, 'floor', `Le cheat meal est trop copieux pour tenir le maintien : le budget des autres jours est limité à ${fmtNum(p.floor * 100)} % de leur dépense, la semaine reste en surplus d'environ ${fmtKcal(week.budgetTotal - week.expenditure)} kcal.`);
  }
  const legumes = legumeCount(ctx, days);
  if (legumes < p.rules.minLegumeMeals) {
    warn(null, 'legume', legumes ? `Seulement ${legumes} repas avec légumineuses cette semaine (minimum ${p.rules.minLegumeMeals}).` : `Aucun repas avec légumineuses cette semaine (minimum ${p.rules.minLegumeMeals}).`);
  }
  if (!salmon) warn(null, 'salmon', 'Aucun repas au saumon cette semaine : aucun n\'est possible avec ces types de journée.');
  if (offal > p.rules.maxOffalPerWeek) warn(null, 'offal', `${offal} repas d'abats cette semaine (maximum ${p.rules.maxOffalPerWeek}).`);
  return out;
}

// ------------------------------------------------------------------ liste de courses
/**
 * Liste de courses : aliments dédoublonnés, quantités cumulées (portion du jour comprise), regroupés par type d'aliment.
 * Les aliments ⇄ sont comptés crus (on achète cru). Les ingrédients internes des recettes forment leur propre groupe.
 * `cheat` : la semaine contient un cheat meal, bloc de composition libre qui n'entre pas dans la liste.
 */
export function shoppingList(ctx, days) {
  const map = new Map();
  let cheat = false;
  for (const d of days) {
    for (const it of d.items) {
      if (!it.meal || it.meal.incomplete) continue;
      if (it.meal.cheat) cheat = true;
      for (const l of it.meal.lines) {
        if (l.missing || !l.food) continue;
        let qty = l.qty * d.factor;
        let state = null;
        if (l.kind === 'food' && isConvertible(l.food)) { qty = convertQty(l.food, qty, l.food.state, 'cru'); state = 'cru'; }
        const e = map.get(l.id) ?? { id: l.id, name: l.food.name, type: l.kind === 'internal' ? RECIPE_GROUP : l.food.type, unit: unitOf(l.food), qty: 0, state };
        e.qty += qty;
        map.set(l.id, e);
      }
    }
  }
  const order = [...ctx.config.foodTypes, RECIPE_GROUP];
  const rank = (t) => { const i = order.indexOf(t); return i < 0 ? order.length : i; };
  const groups = [];
  for (const e of map.values()) {
    let g = groups.find((x) => x.type === e.type);
    if (!g) { g = { type: e.type, items: [] }; groups.push(g); }
    g.items.push(e);
  }
  groups.sort((a, b) => rank(a.type) - rank(b.type));
  for (const g of groups) g.items.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  return { groups, cheat };
}

/** Texte à copier : un titre par type d'aliment, une ligne par aliment (« - 380 g Pâtes complètes (cru) »). */
export function shoppingToText(shopping, title = 'Liste de courses de la semaine') {
  const out = [title];
  for (const g of shopping.groups) {
    out.push('', g.type);
    for (const e of g.items) out.push(`- ${fmtQty(e.qty)} ${e.unit} ${e.name}${e.state ? ` (${e.state})` : ''}`);
  }
  if (shopping.cheat) out.push('', 'Le cheat meal (composition libre) n\'est pas compté.');
  return out.join('\n');
}

// ------------------------------------------------------------------ lecture d'un planning enregistré
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Relit un planning enregistré (stockage du navigateur ou sauvegarde JSON) : types, listes et graines revalidés ; null si
 * la structure est inutilisable. Les repas sont gardés tels quels : un repas supprimé depuis est signalé par `viewPlan`.
 * Un planning enregistré sans `adjust` ni `removed` (ancienne forme) se relit avec `adjust: 1` et `removed: []`.
 * `adjust` (config.planner.adjust) borne les ajustements aux plages de la config ; sans lui (lecture d'une sauvegarde avant le
 * chargement de la config), seuls les nombres strictement positifs sont gardés et la plage est revalidée au chargement.
 * @param {any} raw @param {{dayTypeIds?: string[], adjust?: object}} [opts]
 */
export function sanitizePlan(raw, { dayTypeIds, adjust } = {}) {
  if (!isObj(raw) || !Array.isArray(raw.days) || !raw.days.length || raw.days.length > 14) return null;
  const adj = (v, scope) => (Number.isFinite(v) && v > 0 ? (adjust ? clampAdjustWith(adjust, scope, v) : v) : 1);
  const mealPairs = (list) => (Array.isArray(list) ? list : []).filter((m) => Array.isArray(m) && typeof m[0] === 'string' && typeof m[1] === 'string').map((m) => [m[0], m[1]]);
  const days = [];
  for (const d of raw.days) {
    if (!isObj(d) || typeof d.label !== 'string' || !d.label.trim() || typeof d.dayType !== 'string' || !d.dayType) return null;
    if (dayTypeIds && !dayTypeIds.includes(d.dayType)) return null;
    days.push({ label: d.label.slice(0, 40), dayType: d.dayType, seed: uint(d.seed), adjust: adj(d.adjust, 'day'), meals: mealPairs(d.meals), removed: mealPairs(d.removed) });
  }
  return { v: PLAN_VERSION, seed: uint(raw.seed), adjust: adj(raw.adjust, 'week'), days };
}
