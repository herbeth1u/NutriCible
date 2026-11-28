// src/calc.js
// Fonctions pures de NutriCible : aucune dépendance (ni DOM, ni stockage, ni Vue).
// Règle d'or : UNE SEULE fonction de calcul (resolveMeal) sert aux repas du recueil
// et aux repas perso. Aucun total n'est jamais stocké : tout est recalculé à la volée.

/**
 * @typedef {{kcal:number, protein:number, carbs:number, fat:number, fiber:number}} Macros
 * @typedef {'cru'|'cuit'} CookState
 * @typedef {Object} Food  aliment résolu (table + modifications + calcul des aliments composés)
 * @property {string} id  @property {string} name  @property {string} type
 * @property {string} state  état de référence : valeurs pour 100 g ET quantités des repas
 * @property {Macros} per100  valeurs pour 100 g dans l'état de référence
 * @property {number} [coef]  poids cuit / poids cru (aliments ⇄ uniquement)
 * @property {'recueil'|'perso'} origin
 * @typedef {Object} MealDef  repas tel que stocké : liste de couples [id d'aliment, quantité en g]
 */

export const MACRO_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];

export const zero = () => ({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
export const scale = (m, k) => ({ kcal: m.kcal * k, protein: m.protein * k, carbs: m.carbs * k, fat: m.fat * k, fiber: m.fiber * k });
export const add = (a, b) => ({ kcal: a.kcal + b.kcal, protein: a.protein + b.protein, carbs: a.carbs + b.carbs, fat: a.fat + b.fat, fiber: a.fiber + b.fiber });
export const sum = (list) => list.reduce(add, zero());
export const normPer100 = (p = {}) => ({ kcal: +p.kcal || 0, protein: +p.protein || 0, carbs: +p.carbs || 0, fat: +p.fat || 0, fiber: +p.fiber || 0 });

// ---------------------------------------------------------------- affichage
// Affichage arrondi à l'unité (kcal et macros), partout. Les calculs internes ne sont jamais arrondis.
/** Valeur affichée d'un nombre de kcal ou de g : arrondi à l'unité, jamais −0. Sert aussi aux comparaisons à un seuil. */
export const roundDisplay = (n) => Math.round(n) || 0;
export const fmtNum = (n, d = 0) => Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });
/** Seul formateur des kcal et des macros : entier, espace insécable des milliers. */
export const fmtInt = (n) => fmtNum(roundDisplay(n));
/** Écart signé : « +12 », « −12 », « 0 » sans signe. */
export const fmtSigned = (n) => { const r = roundDisplay(n); return `${r > 0 ? '+' : ''}${fmtInt(r)}`; };
/** Écart relatif signé d'un rapport : 1,4 → « +40 % » (signe « + » ou « − », espace insécable avant « % »). */
export const fmtPct = (ratio) => `${fmtSigned((ratio - 1) * 100)} %`;
export const fmtKcal = fmtInt;
export const fmtG = fmtInt;
/** Quantité : entière, sauf sous 5 g où l'on garde une décimale. */
export const fmtQty = (n) => (Math.abs(n) < 5 && n !== Math.round(n) ? fmtNum(Math.round(n * 10) / 10, 1) : fmtNum(Math.round(n)));
/** Pour 100 g : une décimale si nécessaire. */
export const fmtPer100 = (n) => fmtNum(Math.round(n * 10) / 10, Number.isInteger(Math.round(n * 10) / 10) ? 0 : 1);
export const unitOf = (food) => (food && food.unit === 'ml' ? 'ml' : 'g');

/** Recherche insensible à la casse, aux accents et aux ligatures (« œufs » = « oeufs »). */
export const normalize = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/œ/g, 'oe').replace(/æ/g, 'ae').trim();

// ---------------------------------------------------------------- cru / cuit
// coef = poids cuit ÷ poids cru (ou ÷ poids surgelé : « surgelé » est un état côté cru). Les nutriments d'une portion ne changent pas : seul le poids change.

/** États « côté cru » : « surgelé » (fruits surgelés) se pèse avant cuisson, donc il vaut « cru » pour la conversion. */
export const RAW_STATES = ['cru', 'surgelé'];
/** Côté de la paire cru/cuit auquel appartient un état : « cuit », ou « cru » pour tous les états côté cru. */
export const side = (s) => (s === 'cuit' ? 'cuit' : 'cru');

export const isConvertible = (f) => !!f && typeof f.coef === 'number' && f.coef > 0 && (f.state === 'cuit' || RAW_STATES.includes(f.state));
export const otherState = (s) => (side(s) === 'cru' ? 'cuit' : 'cru');
/** État de pesée habituel (« cru » ou « cuit » : c'est ce que les boutons d'affichage manipulent). */
export const weighState = (f) => (isConvertible(f) ? (f.weigh === 'cru' || f.weigh === 'cuit' ? f.weigh : side(f.state)) : f?.state);
/** Libellé d'un côté pour un aliment : « surgelé » remplace « cru » pour un aliment dont l'état de référence est surgelé. */
export const stateLabel = (f, s) => (side(s) === 'cru' && f?.state === 'surgelé' ? 'surgelé' : s);

/** Convertit une quantité (g) d'un état à l'autre. */
export function convertQty(food, qty, from, to) {
  if (!isConvertible(food) || side(from) === side(to)) return qty;
  return side(from) === 'cru' ? qty * food.coef : qty / food.coef;
}

/** Valeurs pour 100 g dans un état donné (dérivées de l'état de référence par le coefficient). */
export function per100In(food, state) {
  if (!isConvertible(food) || side(state) === side(food.state)) return food.per100;
  return food.state === 'cuit' ? scale(food.per100, food.coef) : scale(food.per100, 1 / food.coef);
}

/** Inverse de per100In : ramène des valeurs saisies dans `state` vers l'état de référence. */
export function per100ToRef(food, state, p) {
  if (!isConvertible(food) || side(state) === side(food.state)) return p;
  return food.state === 'cuit' ? scale(p, 1 / food.coef) : scale(p, food.coef);
}

// ---------------------------------------------------------------- aliments composés et index
/** Valeurs pour 100 g de produit fini = somme des ingrédients de la recette (recipe : [[id, g], ...]). */
export function recipePer100(recipe, lookup) {
  let m = zero();
  for (const [id, g] of recipe) {
    const p = lookup(id);
    if (p) m = add(m, scale(p, g / 100));
  }
  return m;
}

/**
 * Construit l'index des aliments visibles (Map id → aliment résolu).
 * - foods : aliments du recueil ; perso : aliments perso ; edits : modifications des aliments du recueil
 * - deleted : identifiants d'aliments du recueil supprimés
 * Un aliment composé calcule ses valeurs depuis sa recette ; une modification manuelle crée une surcharge
 * réinitialisable (retour au calcul = suppression de l'entrée dans edits).
 */
export function buildFoodIndex({ foods = [], internal = [], perso = [], edits = {}, deleted = [] }) {
  const internalIdx = new Map(internal.map((i) => [i.id, normPer100(i.per100)]));
  const del = new Set(deleted);
  const entries = [
    ...foods.filter((f) => !del.has(f.id)).map((def) => ({ def, origin: 'recueil' })),
    ...perso.map((def) => ({ def, origin: 'perso' })),
  ];
  const out = new Map();
  const resolve = (def, origin, calc) => {
    const e = origin === 'recueil' ? edits[def.id] : undefined;
    const modified = !!e && Object.keys(e).length > 0;
    const merged = { state: 'tel quel', unit: 'g', ...def, ...(modified ? e : {}) };
    delete merged.per100;
    const original = normPer100(calc ?? def.per100);
    const per100 = normPer100(modified && e.per100 ? e.per100 : original);
    const food = { ...merged, per100, original, calcPer100: calc ?? null, origin, composed: !!calc, modified };
    food.convertible = isConvertible(food);
    return food;
  };
  for (const { def, origin } of entries) if (!Array.isArray(def.recipe)) out.set(def.id, resolve(def, origin));
  for (const { def, origin } of entries) {
    if (!Array.isArray(def.recipe)) continue;
    const calc = recipePer100(def.recipe, (id) => internalIdx.get(id) ?? out.get(id)?.per100);
    out.set(def.id, resolve(def, origin, calc));
  }
  return out;
}

/** Avertissement non bloquant : les kcal s'écartent de plus de 15 % de ce que laissent attendre les macros. */
export function kcalWarning(per100, config, food) {
  if (food?.ignoreKcalWarning) return null;
  const k = config?.calc?.kcalPerGram ?? { protein: 4, carbs: 4, fat: 9, fiber: 2 };
  const expected = per100.protein * k.protein + per100.carbs * k.carbs + per100.fat * k.fat + per100.fiber * k.fiber;
  const diff = per100.kcal - expected;
  if (Math.abs(diff) <= 5) return null;
  const rel = Math.abs(diff) / Math.max(expected, 1);
  return rel > (config?.calc?.kcalWarningRatio ?? 0.15) ? { expected: Math.round(expected), diff: Math.round(diff), rel } : null;
}

// ---------------------------------------------------------------- repas
/** Densité 🟢/🟡/🔴 : seuils de kcal propres à chaque catégorie de repas. */
export function densityOf(kcal, category, config) {
  const t = config.density[category] ?? config.density['Dîner'];
  const k = roundDisplay(kcal);
  const idx = k <= t.lightMax ? 0 : k <= t.moderateMax ? 1 : 2;
  return { ...config.densityLevels[idx], index: idx };
}

/** Tags calculables (mêmes règles pour le recueil et les repas perso). */
export function autoTags(totals, seasons, category, config) {
  const r = config.autoTags;
  const tags = [];
  if ((!r.okBeforeEffort.categories || r.okBeforeEffort.categories.includes(category)) && roundDisplay(totals.fiber) <= r.okBeforeEffort.maxFiber) tags.push(r.okBeforeEffort.label);
  if (roundDisplay(totals.protein) >= r.highProtein.minProtein) tags.push(r.highProtein.label);
  if (roundDisplay(totals.fiber) >= r.highFiber.minFiber) tags.push(r.highFiber.label);
  for (const s of seasons) tags.push(`${r.seasonal.label} (${config.seasons.find((x) => x.id === s)?.label ?? s})`);
  return tags;
}

/**
 * Résout un repas : lignes, totaux, densité, tags.
 * @param {MealDef & {origin?:string}} def
 * @param {{foodIdx:Map<string,Food>, internalIdx:Map<string,any>, config:any, repl?:Object}} ctx
 */
export function resolveMeal(def, ctx) {
  const { foodIdx, internalIdx, config } = ctx;
  const rep = ctx.repl?.[def.id] ?? {};
  const lines = [];
  for (const [id0, g] of def.items ?? []) {
    const id = rep[id0] ?? id0;
    const food = foodIdx.get(id) ?? null;
    lines.push({ kind: 'food', id, food, qty: g, macros: food ? scale(food.per100, g / 100) : zero(), missing: !food, missingId: id0 });
  }
  for (const [id, g] of def.internal ?? []) {
    const ing = internalIdx.get(id);
    const food = ing ? { id, name: ing.name, per100: normPer100(ing.per100), estimated: true, unit: 'g', state: 'tel quel', internal: true, convertible: false } : null;
    lines.push({ kind: 'internal', id, food, qty: g, macros: food ? scale(food.per100, g / 100) : zero(), missing: !food, missingId: id });
  }
  const incomplete = lines.some((l) => l.missing);
  const totals = def.cheat ? normPer100(def.cheat) : sum(lines.map((l) => l.macros));
  const seasons = [...new Set(lines.filter((l) => l.kind === 'food' && l.food?.season).map((l) => l.food.season))];
  const category = def.category;
  const auto = def.cheat ? [] : autoTags(totals, seasons, category, config); // un cheat meal est un bloc estimé : pas de tags automatiques
  const manual = def.tags ?? [];
  const mainFoods = [...new Set(lines.filter((l) => l.kind === 'food' && l.food).map((l) => l.food.name))];
  return {
    id: def.id, name: def.name, category, origin: def.origin ?? 'recueil',
    contexts: def.contexts ?? [], manualTags: manual, time: def.time ?? null,
    prep: def.prep ?? '', variant: def.variant ?? '', notes: def.notes ?? '', cheat: def.cheat ?? null,
    lines, totals, incomplete, seasons, mainFoods,
    density: densityOf(totals.kcal, category, config),
    autoTags: auto, tags: [...auto, ...manual],
    estimated: !!def.cheat || lines.some((l) => l.food?.estimated),
    def,
  };
}

/**
 * Repas retouché : les lignes d'aliments dont l'index figure dans `qtyByLine` (Map ou objet index → grammes, avant facteur de
 * portion) prennent la nouvelle quantité, leurs macros sont recalculées comme dans `resolveMeal` (valeurs pour 100 g de l'aliment) et
 * `totals` est la même somme. Le reste (nom, catégorie, tags, densité, définition…) reste celui de la recette : une retouche ne
 * change pas le caractère du repas. Le résultat porte `tuned: true` et `tweaks: [{ line, foodId, base, qty }]` (pour l'affichage).
 * Sans aucune retouche applicable (quantité identique, ligne absente ou interne, aliment introuvable), le repas est rendu tel quel.
 * @param {ReturnType<typeof resolveMeal>} meal @param {Map<number, number>|Record<number, number>} qtyByLine
 */
export function withQuantities(meal, qtyByLine) {
  const entries = qtyByLine instanceof Map ? [...qtyByLine] : Object.entries(qtyByLine ?? {}).map(([i, q]) => [Number(i), q]);
  const byLine = new Map(entries);
  const tweaks = [];
  const lines = meal.lines.map((l, i) => {
    const q = byLine.get(i);
    if (meal.cheat || l.kind !== 'food' || l.missing || !l.food || !(q > 0) || q === l.qty) return l;
    tweaks.push({ line: i, foodId: l.id, base: l.qty, qty: q });
    return { ...l, qty: q, macros: scale(l.food.per100, q / 100) };
  });
  if (!tweaks.length) return meal;
  return { ...meal, lines, totals: sum(lines.map((l) => l.macros)), tuned: true, tweaks };
}

/** Impact d'une modification d'aliment : repas concernés, kcal avant → après, changements de densité. */
export function foodImpact(foodId, before, after, defs, config, internal, repl) {
  const mk = (idx) => ({ foodIdx: idx, internalIdx: new Map(internal.map((i) => [i.id, i])), config, repl });
  const out = [];
  for (const d of defs) {
    if (!(d.items ?? []).some(([id]) => (repl?.[d.id]?.[id] ?? id) === foodId)) continue;
    const a = resolveMeal(d, mk(before));
    const b = resolveMeal(d, mk(after));
    out.push({ id: d.id, name: d.name, before: a.totals.kcal, after: b.totals.kcal, densityBefore: a.density, densityAfter: b.density });
  }
  return out;
}

export const nameTaken = (name, names, exceptName) => {
  const n = normalize(name);
  return names.some((x) => normalize(x) === n && normalize(x) !== normalize(exceptName ?? '\u0000'));
};

// ---------------------------------------------------------------- recherche, filtres, tri
export const defaultFilters = () => ({
  q: '', categories: [], contexts: [], foods: [], foodTypes: [], densities: [], tags: [], origins: [],
  kcalMin: null, kcalMax: null, proteinMin: null, carbsMin: null, carbsMax: null, fiberMin: null, fiberMax: null, timeMax: null,
  sort: 'name', dir: 1,
});

const has = (v) => v !== null && v !== undefined && v !== '' && !Number.isNaN(Number(v));

/** Filtres combinables : ET entre groupes différents, OU au sein d'un même groupe. */
export function filterMeals(meals, f) {
  const words = normalize(f.q).split(/\s+/).filter(Boolean);
  return meals.filter((m) => {
    if (words.length) {
      const hay = normalize([m.name, ...m.lines.map((l) => l.food?.name), ...m.tags].join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    if (f.categories.length && !f.categories.includes(m.category)) return false;
    if (f.contexts.length && !m.contexts.some((c) => f.contexts.includes(c))) return false;
    if (f.foods.length && !m.lines.some((l) => l.kind === 'food' && f.foods.includes(l.id))) return false;
    if (f.foodTypes.length && !m.lines.some((l) => l.kind === 'food' && l.food && f.foodTypes.includes(l.food.type))) return false;
    if (f.densities.length && !f.densities.includes(m.density.id)) return false;
    if (f.tags.length && !f.tags.some((t) => m.tags.some((mt) => mt === t || mt.startsWith(`${t} (`)))) return false;
    if (f.origins.length && !f.origins.includes(m.origin)) return false;
    const t = m.totals;
    if (has(f.kcalMin) && roundDisplay(t.kcal) < +f.kcalMin) return false;
    if (has(f.kcalMax) && roundDisplay(t.kcal) > +f.kcalMax) return false;
    if (has(f.proteinMin) && roundDisplay(t.protein) < +f.proteinMin) return false;
    if (has(f.carbsMin) && roundDisplay(t.carbs) < +f.carbsMin) return false;
    if (has(f.carbsMax) && roundDisplay(t.carbs) > +f.carbsMax) return false;
    if (has(f.fiberMin) && roundDisplay(t.fiber) < +f.fiberMin) return false;
    if (has(f.fiberMax) && roundDisplay(t.fiber) > +f.fiberMax) return false;
    if (has(f.timeMax) && (m.time ?? 0) > +f.timeMax) return false;
    return true;
  });
}

const SORT_KEYS = { kcal: (m) => m.totals.kcal, protein: (m) => m.totals.protein, carbs: (m) => m.totals.carbs, fiber: (m) => m.totals.fiber, time: (m) => m.time ?? 0 };
export function sortMeals(meals, key = 'name', dir = 1) {
  const out = [...meals];
  if (key === 'name') out.sort((a, b) => a.name.localeCompare(b.name, 'fr') * dir);
  else out.sort((a, b) => (SORT_KEYS[key](a) - SORT_KEYS[key](b)) * dir || a.name.localeCompare(b.name, 'fr'));
  return out;
}

// ---------------------------------------------------------------- journées et semaine
/**
 * items : [{ meal: id, factor, resolved? }] → total des repas complets ; missing : repas introuvables ou incomplets.
 * `resolved` (facultatif) : le repas déjà résolu à utiliser, retouché par exemple (voir `withQuantities`) ; il passe avant l'index.
 */
export function dayTotals(items, mealIdx) {
  let totals = zero();
  const missing = [];
  for (const it of items) {
    const m = it.resolved ?? mealIdx.get(it.meal);
    if (!m || m.incomplete) { missing.push(it.meal); continue; }
    totals = add(totals, scale(m.totals, it.factor ?? 1));
  }
  return { totals, missing };
}

/** Facteur de portion global (par pas de `step`, 0,01 dans config.planner.step) pour atteindre la cible kcal. */
export function fitFactor(total, target, step = 0.01) {
  if (!(total > 0) || !(target > 0)) return 1;
  const f = Math.round(target / total / step) * step;
  return Math.min(2, Math.max(0.5, Math.round(f * 100) / 100));
}

/** Bilan hebdomadaire d'une semaine type : apports (journées types) contre dépenses (profil). */
export function weekReport(week, days, mealIdx, targets, dayTypes) {
  const dayIdx = new Map(days.map((d) => [d.id, d]));
  const rows = week.map((w) => {
    const day = dayIdx.get(w.day);
    const { totals } = dayTotals(day.items.map(([meal, factor]) => ({ meal, factor })), mealIdx);
    const target = targets?.[day.dayType] ?? null;
    return { label: w.label, day, dayType: dayTypes.find((d) => d.id === day.dayType), totals, target, delta: target ? totals.kcal - target.kcal : null };
  });
  const total = sum(rows.map((r) => r.totals));
  const known = rows.every((r) => r.target);
  const expenditure = known ? rows.reduce((s, r) => s + r.target.expenditure, 0) : null;
  return { rows, total, expenditure, balance: known ? total.kcal - expenditure : null, average: total.kcal / (rows.length || 1) };
}

// ---------------------------------------------------------------- profil et cibles
// Aucune valeur personnelle dans le projet : le profil est saisi dans l'interface et vide par défaut.
export const emptyProfile = () => ({ sex: '', age: null, heightCm: null, weightKg: null, weightMinKg: null, weightMaxKg: null, restingKcal: null, longActiveKcal: null });

const pos = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

export function profileStatus(p) {
  const missing = [];
  if (!pos(p.weightKg)) missing.push('poids');
  if (!pos(p.restingKcal)) {
    if (p.sex !== 'M' && p.sex !== 'F') missing.push('sexe');
    if (!pos(p.age)) missing.push('âge');
    if (!pos(p.heightCm)) missing.push('taille');
  }
  return { complete: missing.length === 0, missing };
}

/** Métabolisme de base, formule de Mifflin-St Jeor. */
export function bmr(p, calc) {
  const m = calc.mifflin;
  return m.perKg * p.weightKg + m.perCm * p.heightCm + m.perYear * p.age + (p.sex === 'M' ? m.male : m.female);
}

/** Dépense hors entraînement : valeur « au repos » Garmin si saisie (aucun facteur ajouté), sinon BMR × 1,2. */
export function restKcal(p, calc) {
  return pos(p.restingKcal) ? p.restingKcal : bmr(p, calc) * calc.activityFactor;
}

/** Calories actives de référence : milieu de la plage (sortie courte ou moyenne), valeur du profil (sortie longue). */
export function activeKcal(outingId, p, config) {
  if (!outingId) return 0;
  const o = config.outings.find((x) => x.id === outingId);
  if (!o) return 0;
  if (o.maxKcal === null) return pos(p.longActiveKcal) ? p.longActiveKcal : o.minKcal;
  return Math.round((o.minKcal + o.maxKcal) / 2);
}

/** Cible d'une journée type (null tant que le profil est incomplet). Glucides = complément calorique. */
export function targetFor(dayType, p, config) {
  if (!profileStatus(p).complete) return null;
  const c = config.calc;
  const rest = restKcal(p, c);
  const active = activeKcal(dayType.outing, p, config);
  const expenditure = rest + active;
  const kcal = expenditure * dayType.kcalFactor;
  const protein = { min: c.protein.minPerKg * p.weightKg, max: c.protein.maxPerKg * p.weightKg };
  protein.mid = (protein.min + protein.max) / 2;
  const fat = dayType.fatPerKg * p.weightKg;
  const carbs = Math.max(0, (kcal - protein.mid * 4 - fat * 9) / 4);
  return { rest, active, expenditure, kcal, factor: dayType.kcalFactor, protein, fat, carbs, carbsPerKg: carbs / p.weightKg, fiber: (c.fiberPer1000kcal * kcal) / 1000 };
}

export function allTargets(p, config) {
  const out = {};
  for (const d of config.dayTypes) out[d.id] = targetFor(d, p, config);
  return out;
}

// ---------------------------------------------------------------- textes à copier
const stateSuffix = (f) => (f && isConvertible(f) ? ` (${f.state})` : '');

export function mealToText(m) {
  const t = m.totals;
  const out = [`${m.name} (${m.category}) : ${fmtKcal(t.kcal)} kcal · P ${fmtG(t.protein)} g · G ${fmtG(t.carbs)} g · L ${fmtG(t.fat)} g · F ${fmtG(t.fiber)} g`];
  for (const l of m.lines) out.push(`- ${fmtQty(l.qty)} ${unitOf(l.food)} ${l.food ? l.food.name : l.id}${stateSuffix(l.food)}${l.food?.estimated ? '*' : ''}`);
  if (m.prep) out.push(`Préparation : ${m.prep}`);
  if (m.variant) out.push(`Variante : ${m.variant}`);
  if (m.lines.some((l) => l.food?.estimated) || m.cheat) out.push('* valeur estimée');
  return out.join('\n');
}

export function dayToText(label, rows, totals, target) {
  const out = [`Ma journée (${label})`];
  for (const r of rows) out.push(`- ${r.meal.name} ×${fmtNum(r.factor, r.factor % 1 ? 2 : 0)} : ${fmtKcal(r.meal.totals.kcal * r.factor)} kcal`);
  out.push(`Total : ${fmtKcal(totals.kcal)} kcal · P ${fmtG(totals.protein)} g · G ${fmtG(totals.carbs)} g · L ${fmtG(totals.fat)} g · F ${fmtG(totals.fiber)} g`);
  if (target) out.push(`Cible : ${fmtKcal(target.kcal)} kcal · P ${fmtG(target.protein.min)}–${fmtG(target.protein.max)} g`);
  return out.join('\n');
}
