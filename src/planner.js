// src/planner.js — planificateur de semaine : fonctions pures (aucun DOM, aucun Vue, aucun stockage).
//
// Une semaine planifiée (`plan`) ne stocke que des choix : la graine du tirage, et pour chaque jour son type, sa propre
// graine et ses repas `[créneau, identifiant de repas]`. Aucun total n'est stocké : budget, facteur de portion, écart,
// bilan, avertissements et liste de courses sont recalculés à la volée (`viewPlan`) depuis les repas, le profil et la config.
//
//   plan = { v: 1, seed, days: [{ label, dayType, seed, meals: [[créneau, idRepas], …] }] }
//
// Tirage : générateur pseudo-aléatoire à graine (mulberry32). Même graine + mêmes données = même semaine, ce qui permet
// de la reproduire et de la tester. Pour chaque jour, plusieurs tirages sont comparés et le meilleur est gardé ; le facteur
// de portion global (calc.fitFactor) ramène ensuite le jour à son budget. Toutes les règles et tous les seuils sont dans
// config.json (bloc `planner`), jamais en dur ici.
//
// Règles dures : légumineuses chaque jour (hors jour fixe), saumon au moins une fois, abats au plus une fois par semaine,
// lait + cacao sucré seulement les jours de sortie moyenne ou longue, aucun repas répété dans la semaine. Si une règle est
// impossible à tenir, le tirage la relâche (voir LEVELS) et `viewPlan` affiche l'avertissement correspondant.
//
// Le contexte `ctx` : { meals (repas résolus par calc.resolveMeal), mealIdx?, config, targets (calc.allTargets ou null),
// week (semaine type : [{ label, dayType }]), reference? ({ [typeDeJournée]: kcal }, pour choisir sans profil) }.

import { convertQty, fitFactor, fmtKcal, fmtNum, fmtQty, isConvertible, scale, sum, unitOf } from './calc.js';
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

/** Ce qui est déjà pris dans la semaine hors le jour `except` : repas, abats, saumon. */
function stateOf(ctx, plan, except) {
  const idx = mealIndex(ctx);
  const used = new Set();
  let offal = 0;
  let salmon = 0;
  plan.days.forEach((d, i) => {
    if (i === except) return;
    for (const [, id] of d.meals) {
      used.add(id);
      const m = idx.get(id);
      if (!m) continue;
      if (isOffal(m, ctx.config)) offal += 1;
      if (isSalmon(m, ctx.config)) salmon += 1;
    }
  });
  return { used, offal, salmon };
}

const baseFilter = (ctx, state) => ({ used: state.used, offalLeft: Math.max(0, ctx.config.planner.rules.maxOffalPerWeek - state.offal), repeat: false, anyContext: false });

/** Un jour peut-il accueillir un repas au saumon (contextes stricts, repas encore libres) ? */
function canSalmon(ctx, dt, state) {
  return slotsFor(ctx.config, dt).some((s) => poolFor(ctx, dt, s, baseFilter(ctx, state), (m) => isSalmon(m, ctx.config)).length > 0);
}

// ------------------------------------------------------------------ tirage d'un jour
// Du plus strict au plus souple : on ne relâche une règle que si la précédente est impossible à tenir.
// Les contextes se relâchent d'abord, puis la répétition, puis le saumon du jour, puis les légumineuses, puis un créneau peut rester vide.
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
 * Tire les repas d'un jour : `attempts` tirages comparés, le meilleur est gardé.
 * @returns {[string, string][]} couples [créneau, identifiant de repas], dans l'ordre des créneaux
 */
function drawDay(ctx, dt, seed, state, { budget = null, salmon = false } = {}) {
  const { config } = ctx;
  const slots = slotsFor(config, dt);
  const fixed = isFixedType(config, dt.id);
  const rng = mulberry32(seed);
  for (const lv of LEVELS) {
    const needs = lv.needs.filter((n) => (n === 'salmon' ? salmon : !fixed));
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
    const kcal = fixed ? d.meals.reduce((s, [, id]) => s + (idx.get(id)?.totals.kcal ?? 0), 0) : 0;
    return { expenditure: t.expenditure, target: t.kcal, fixed, fixedKcal: kcal > 0 ? kcal : t.kcal };
  });
  return weekBudget(rows, { floor: ctx.config.planner.floor });
}

// ------------------------------------------------------------------ génération
const clonePlan = (plan) => ({ ...plan, days: plan.days.map((d) => ({ ...d, meals: d.meals.map((m) => [...m]) })) });

/**
 * Génère une semaine. `dayTypes` : types de journée de chaque jour (par défaut ceux de la semaine type).
 * Ordre du tirage : jours fixes (cheat meal), jour du saumon, puis les autres du plus contraint au moins contraint.
 */
export function generateWeek(ctx, { seed = 1, dayTypes = null } = {}) {
  const { config } = ctx;
  const s = uint(seed);
  const plan = {
    v: PLAN_VERSION, seed: s,
    days: ctx.week.map((w, i) => ({ label: w.label, dayType: dayTypes?.[i] ?? w.dayType, seed: mixSeed(s, i + 1), meals: [] })),
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
  const tight = (i) => Math.min(...slotsFor(config, dts[i]).map((sl) => poolFor(ctx, dts[i], sl, baseFilter(ctx, none)).length));
  const order = [...open].sort((a, b) => (a === salmonDay ? -1 : b === salmonDay ? 1 : 0) || tight(a) - tight(b) || a - b);
  for (const i of order) {
    plan.days[i].meals = drawDay(ctx, dts[i], plan.days[i].seed, stateOf(ctx, plan, i), { budget: budgets?.[i] ?? null, salmon: i === salmonDay });
  }
  return plan;
}

/** Retire les repas d'un jour puis le retire au sort : même type de journée, graine propre au jour. */
function redrawDay(ctx, plan, index) {
  const day = plan.days[index];
  const dt = dayTypeOf(ctx.config, day.dayType);
  day.meals = [];
  const state = stateOf(ctx, plan, index);
  const fixed = isFixedType(ctx.config, day.dayType);
  const salmon = !fixed && state.salmon === 0 && canSalmon(ctx, dt, state); // le saumon de la semaine ne doit pas disparaître
  day.meals = drawDay(ctx, dt, day.seed, state, { budget: planBudgets(ctx, plan)?.[index] ?? null, salmon });
  return plan;
}

/** Regénère un jour (les autres ne bougent pas). Sans `seed`, la graine suivante est dérivée de celle du jour. */
export function regenerateDay(ctx, plan, index, { seed } = {}) {
  if (!plan.days[index]) return plan;
  const next = clonePlan(plan);
  next.days[index].seed = seed === undefined ? mixSeed(next.days[index].seed, 1) : uint(seed);
  return redrawDay(ctx, next, index);
}

/** Change le type d'un jour et le regénère : les budgets des autres jours changent, leurs repas non (leurs facteurs sont recalculés). */
export function setDayType(ctx, plan, index, dayTypeId, { seed } = {}) {
  if (!plan.days[index] || plan.days[index].dayType === dayTypeId || !dayTypeOf(ctx.config, dayTypeId)) return plan;
  const next = clonePlan(plan);
  next.days[index].dayType = dayTypeId;
  next.days[index].seed = seed === undefined ? mixSeed(next.days[index].seed, 2) : uint(seed);
  return redrawDay(ctx, next, index);
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
  const days = plan.days.map((d, i) => {
    const dt = dayTypeOf(config, d.dayType);
    const fixed = isFixedType(config, d.dayType);
    const items = d.meals.map(([slot, id]) => ({ slot, id, meal: idx.get(id) ?? null }));
    const totals = sum(items.filter((it) => it.meal && !it.meal.incomplete).map((it) => it.meal.totals));
    const budget = budgets ? budgets[i] : null;
    const factor = fixed || budget === null ? 1 : fitFactor(totals.kcal, budget, p.step);
    const adjusted = scale(totals, factor);
    return {
      index: i, label: d.label, dayType: dt, fixed, items, totals, factor, adjusted, budget,
      target: ctx.targets?.[d.dayType] ?? null, delta: budget === null ? null : adjusted.kcal - budget,
    };
  });
  const total = sum(days.map((d) => d.adjusted));
  const expenditure = ctx.targets ? days.reduce((s, d) => s + (d.target?.expenditure ?? 0), 0) : null;
  const balance = expenditure === null ? null : total.kcal - expenditure;
  const week = {
    total, average: total.kcal / (days.length || 1), expenditure, balance,
    budgetTotal: budgets ? budgets.reduce((a, b) => a + b, 0) : null,
    status: balance === null ? null : Math.abs(balance) <= p.balanceTolerance * expenditure ? 'maintien' : balance > 0 ? 'surplus' : 'déficit',
  };
  return { seed: plan.seed, days, week, warnings: auditPlan(ctx, days, week), shopping: shoppingList(ctx, days) };
}

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
    const have = new Set(d.items.map((it) => it.slot));
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
    if (!d.fixed && !d.items.some((it) => it.meal && isLegume(it.meal, config))) warn(where, 'legume', 'Aucune légumineuse ce jour-là.');
    if (!d.fixed && d.budget !== null && Math.abs(d.delta) > p.gapWarning * d.budget) {
      warn(where, 'kcal-gap', `Budget de ${fmtKcal(d.budget)} kcal hors de portée avec ces repas (portions limitées à ×${fmtNum(d.factor, 2)}) : écart de ${fmtKcal(d.delta)} kcal.`);
    }
  }
  for (const [id, labels] of seen) {
    if (labels.length > 1) warn(null, 'repeat', `« ${mealIndex(ctx).get(id)?.name ?? id} » revient ${labels.length} fois dans la semaine (${labels.join(', ')}).`);
  }
  if (week && week.budgetTotal !== null && week.budgetTotal > week.expenditure + 1) {
    warn(null, 'floor', `Le cheat meal est trop copieux pour tenir le maintien : le budget des autres jours est limité à ${fmtNum(p.floor * 100)} % de leur dépense, la semaine reste en surplus d'environ ${fmtKcal(week.budgetTotal - week.expenditure)} kcal.`);
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
 * @param {any} raw @param {{dayTypeIds?: string[]}} [opts]
 */
export function sanitizePlan(raw, { dayTypeIds } = {}) {
  if (!isObj(raw) || !Array.isArray(raw.days) || !raw.days.length || raw.days.length > 14) return null;
  const days = [];
  for (const d of raw.days) {
    if (!isObj(d) || typeof d.label !== 'string' || !d.label.trim() || typeof d.dayType !== 'string' || !d.dayType) return null;
    if (dayTypeIds && !dayTypeIds.includes(d.dayType)) return null;
    const meals = (Array.isArray(d.meals) ? d.meals : []).filter((m) => Array.isArray(m) && typeof m[0] === 'string' && typeof m[1] === 'string').map((m) => [m[0], m[1]]);
    days.push({ label: d.label.slice(0, 40), dayType: d.dayType, seed: uint(d.seed), meals });
  }
  return { v: PLAN_VERSION, seed: uint(raw.seed), days };
}
