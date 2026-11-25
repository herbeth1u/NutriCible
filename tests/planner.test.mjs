import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../scripts/validate-data.mjs';
import * as C from '../src/calc.js';
import * as P from '../src/planner.js';
import { FICTIVE, FICTIVE_F, near, plannerCtx, world } from './helpers.mjs';

const PROFILES = {
  homme: FICTIVE,
  femme: FICTIVE_F,
  léger: { ...FICTIVE_F, weightKg: 52, heightCm: 160 },
  lourd: { ...FICTIVE, weightKg: 95, heightCm: 190, age: 25 },
  'dépense saisie': { sex: '', age: null, heightCm: null, weightKg: 70, weightMinKg: null, weightMaxKg: null, restingKcal: 1650, longActiveKcal: 2200 },
  'sans profil': null,
};
const SEEDS = Array.from({ length: 60 }, (_, i) => i * 7919 + 1);
const ids = (plan) => plan.days.flatMap((d) => d.meals.map(([, id]) => id));
const codes = (view) => view.warnings.map((x) => x.code);

// ------------------------------------------------------------------ graine
test('graine : la même graine redonne exactement la même semaine, des graines différentes la font varier', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const a = P.generateWeek(ctx, { seed: 2026 });
  assert.deepEqual(P.generateWeek(ctx, { seed: 2026 }), a);
  assert.equal(a.seed, 2026);
  assert.equal(a.v, P.PLAN_VERSION);
  const variants = new Set(SEEDS.slice(0, 12).map((s) => JSON.stringify(P.generateWeek(ctx, { seed: s }).days.map((d) => d.meals))));
  assert.ok(variants.size >= 10, `${variants.size} semaines différentes sur 12 graines`);
});

test('graine : mulberry32 est déterministe et mixSeed mélange', () => {
  const a = P.mulberry32(5);
  const b = P.mulberry32(5);
  const xs = Array.from({ length: 5 }, a);
  assert.deepEqual(xs, Array.from({ length: 5 }, b));
  assert.ok(xs.every((x) => x >= 0 && x < 1));
  assert.notDeepEqual(xs, Array.from({ length: 5 }, P.mulberry32(6)));
  assert.notEqual(P.mixSeed(1, 2), P.mixSeed(2, 1));
  assert.equal(P.mixSeed(1, 2), P.mixSeed(1, 2));
});

test('le tirage ne modifie ni le contexte ni le planning passé en paramètre', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 3 });
  const snap = JSON.stringify([plan, ctx.targets, ctx.week]);
  P.regenerateDay(ctx, plan, 1, { seed: 9 });
  P.setDayType(ctx, plan, 0, 'repos', { seed: 9 });
  P.replacePlanMeal(plan, 0, plan.days[0].meals[0][1], 'autre');
  P.viewPlan(ctx, plan);
  assert.equal(JSON.stringify([plan, ctx.targets, ctx.week]), snap);
});

// ------------------------------------------------------------------ règles dures
test('règles dures : tenues pour 60 graines et tous les profils fictifs, sans aucun avertissement alimentaire', async () => {
  const w = await world();
  for (const [name, profile] of Object.entries(PROFILES)) {
    const ctx = plannerCtx(w, profile);
    for (const seed of SEEDS) {
      const plan = P.generateWeek(ctx, { seed });
      const view = P.viewPlan(ctx, plan);
      const where = `${name}, graine ${seed}`;
      // seul avertissement toléré : le plancher de 90 % (cheat meal trop copieux pour un petit gabarit), qui n'est pas une règle alimentaire
      assert.deepEqual(view.warnings.filter((x) => x.code !== 'floor'), [], where);
      assert.equal(plan.days.length, 7, where);
      // pas de répétition d'un repas dans la semaine
      assert.equal(new Set(ids(plan)).size, ids(plan).length, `${where} : répétition`);
      // légumineuses chaque jour (hors cheat meal), saumon au moins une fois, abats au plus une fois
      for (const d of view.days) {
        assert.equal(d.fixed, d.dayType.id === 'cheat', where);
        if (!d.fixed) assert.ok(d.items.some((it) => P.isLegume(it.meal, w.config)), `${where} : légumineuses ${d.label}`);
      }
      const all = view.days.flatMap((d) => d.items.map((it) => it.meal));
      assert.ok(all.some((m) => P.isSalmon(m, w.config)), `${where} : saumon`);
      assert.ok(all.filter((m) => P.isOffal(m, w.config)).length <= 1, `${where} : abats`);
      // lait + cacao seulement après une sortie moyenne ou longue
      for (const d of view.days) for (const it of d.items) {
        if (P.hasMilkCocoa(it.meal, w.config)) assert.ok(['moyenne', 'longue'].includes(d.dayType.outing), `${where} : lait + cacao le ${d.label}`);
      }
    }
  }
});

test('créneaux : un repas par créneau du type de journée, dans l\'ordre, avec la bonne catégorie et un contexte accepté', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 11 }));
  for (const d of view.days) {
    assert.deepEqual(d.items.map((it) => it.slot), P.slotsFor(w.config, d.dayType), d.label);
    for (const it of d.items) {
      assert.equal(it.meal.category, it.slot, d.label);
      assert.ok(it.meal.contexts.some((c) => P.contextsFor(w.config, d.dayType).includes(c)), `${d.label} : ${it.id}`);
    }
  }
  const byId = Object.fromEntries(view.days.map((d) => [d.dayType.id, d.items.map((it) => it.slot)]));
  assert.ok(!byId.dimanche.includes('Pendant l\'effort') && !byId.dimanche.includes('Récupération'), 'pas d\'effort ni de récupération un jour sans sortie');
  assert.ok(byId.longue.includes('Pendant l\'effort') && byId.longue.includes('Récupération'));
  assert.equal(byId.dimanche.filter((s) => s === 'Collation').length, 1, 'une seule collation');
  assert.deepEqual(byId.cheat, ['Repas plaisir']);
});

test('jour cheat meal : fixe (le repas d\'environ 3 000 kcal, facteur ×1), le reste du budget est réparti sur les autres jours', async () => {
  const w = await world();
  for (const profile of [FICTIVE, FICTIVE_F, PROFILES.léger]) {
    const ctx = plannerCtx(w, profile);
    const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 5 }));
    const cheat = view.days.find((d) => d.fixed);
    assert.equal(cheat.items.length, 1);
    assert.ok(cheat.items[0].meal.cheat);
    assert.equal(cheat.factor, 1);
    near(assert, cheat.adjusted.kcal, 3000, 1);
    near(assert, cheat.budget, cheat.adjusted.kcal, 1e-6);
    near(assert, cheat.delta, 0, 1e-6);
    for (const d of view.days.filter((x) => !x.fixed)) assert.ok(d.budget < d.target.expenditure * 1.0001 || d.budget >= d.target.expenditure * 0.9);
  }
});

// ------------------------------------------------------------------ budget et facteur
test('budget : somme des budgets = dépense de la semaine, jamais sous 90 % de la dépense d\'un jour, facteur dans [0,5 ; 2]', async () => {
  const w = await world();
  for (const [name, profile] of Object.entries(PROFILES).filter(([, p]) => p)) {
    const ctx = plannerCtx(w, profile);
    for (const seed of SEEDS.slice(0, 15)) {
      const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed }));
      // somme des budgets = dépense (maintien), sauf si le cheat meal est trop copieux : le plancher de 90 % s'applique alors à tous les autres jours
      const bound = view.week.budgetTotal > view.week.expenditure + 1e-6;
      if (!bound) near(assert, view.week.budgetTotal, view.week.expenditure, 1e-6);
      else {
        assert.ok(codes(view).includes('floor'), `${name} : plancher signalé`);
        for (const d of view.days.filter((x) => !x.fixed)) near(assert, d.budget, 0.9 * d.target.expenditure, 1e-6);
      }
      for (const d of view.days) {
        assert.ok(d.budget >= 0.9 * d.target.expenditure - 1e-9, `${name} ${d.label} : budget sous 90 % de la dépense`);
        assert.ok(d.factor >= 0.5 && d.factor <= 2, `${name} ${d.label} : facteur ${d.factor}`);
        if (d.fixed) continue;
        // le facteur est arrondi au pas de 1 % : l'écart au budget ne dépasse pas la moitié d'un pas (0,5 %) des repas du jour
        assert.ok(Math.abs(d.delta) <= (w.config.planner.step / 2) * d.totals.kcal + 1, `${name} ${d.label} : ${Math.round(d.adjusted.kcal)} kcal pour un budget de ${Math.round(d.budget)}`);
        near(assert, d.delta, d.adjusted.kcal - d.budget, 1e-9);
        near(assert, d.adjusted.kcal, d.totals.kcal * d.factor, 1e-6);
      }
      if (!bound) assert.ok(Math.abs(view.week.balance) < 0.03 * view.week.expenditure, `${name} : solde ${Math.round(view.week.balance)} kcal`);
      else assert.ok(view.week.balance > 0, `${name} : surplus`);
      assert.equal(view.week.status, Math.abs(view.week.balance) <= w.config.planner.balanceTolerance * view.week.expenditure ? 'maintien' : view.week.balance > 0 ? 'surplus' : 'déficit');
    }
  }
});

test('budget : le facteur du jour est un multiple du pas (1 %) ; le bilan additionne les jours ajustés', async () => {
  const w = await world();
  const ctx = plannerCtx(w, PROFILES.lourd);
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 8 }));
  assert.equal(w.config.planner.step, 0.01);
  for (const d of view.days) near(assert, Math.round(d.factor / 0.01) * 0.01, d.factor, 1e-9);
  const sumK = view.days.reduce((s, d) => s + d.adjusted.kcal, 0);
  near(assert, view.week.total.kcal, sumK, 1e-6);
  near(assert, view.week.average, sumK / 7, 1e-6);
  for (const k of C.MACRO_KEYS) near(assert, view.week.total[k], view.days.reduce((s, d) => s + d.adjusted[k], 0), 1e-6);
  near(assert, view.week.balance, sumK - view.week.expenditure, 1e-6);
});

test('sans profil : le planning se génère (repas choisis près de la journée type), sans budget, facteur ×1 ni solde', async () => {
  const w = await world();
  const ctx = plannerCtx(w, null);
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 4 }));
  assert.deepEqual(view.warnings, []);
  for (const d of view.days) { assert.equal(d.budget, null); assert.equal(d.delta, null); assert.equal(d.factor, 1); assert.equal(d.target, null); }
  assert.equal(view.week.balance, null);
  assert.equal(view.week.expenditure, null);
  assert.equal(view.week.status, null);
  for (const d of view.days.filter((x) => !x.fixed)) assert.ok(Math.abs(d.totals.kcal / ctx.reference[d.dayType.id] - 1) < 0.25, `${d.label} proche de la journée type`);
});

test('plusieurs tirages, le meilleur est gardé : un jour tiré est plus proche de son budget que la moyenne des tirages', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const single = { ...ctx, config: { ...w.config, planner: { ...w.config.planner, attempts: 1 } } };
  const gap = (c) => SEEDS.slice(0, 25).reduce((s, seed) => {
    const v = P.viewPlan(c, P.generateWeek(c, { seed }));
    return s + v.days.filter((d) => !d.fixed).reduce((a, d) => a + Math.abs(d.totals.kcal / d.budget - 1), 0);
  }, 0);
  assert.ok(gap(ctx) < 0.7 * gap(single), 'avec 60 tirages le facteur de portion nécessaire reste plus proche de ×1');
});

// ------------------------------------------------------------------ régénération et types de journée
test('regenerateDay : seul le jour change, les règles de la semaine restent tenues', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  for (const seed of SEEDS.slice(0, 20)) {
    const plan = P.generateWeek(ctx, { seed });
    for (const i of [0, 1, 3, 4, 5, 6]) {
      const next = P.regenerateDay(ctx, plan, i, { seed: seed + 100 + i });
      assert.deepEqual(next.days.filter((_, j) => j !== i), plan.days.filter((_, j) => j !== i), `jour ${i} : les autres ne bougent pas`);
      assert.equal(next.days[i].seed, seed + 100 + i);
      assert.equal(next.days[i].dayType, plan.days[i].dayType);
      assert.deepEqual(P.viewPlan(ctx, next).warnings, [], `graine ${seed}, jour ${i}`);
    }
  }
});

test('regenerateDay : reproductible avec une graine, graine suivante dérivée sinon, jour fixe : un autre cheat meal ou le même', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 77 });
  assert.deepEqual(P.regenerateDay(ctx, plan, 5, { seed: 1 }), P.regenerateDay(ctx, plan, 5, { seed: 1 }));
  const auto = P.regenerateDay(ctx, plan, 5);
  assert.equal(auto.days[5].seed, P.mixSeed(plan.days[5].seed, 1));
  assert.deepEqual(auto, P.regenerateDay(ctx, plan, 5));
  const cheat = P.regenerateDay(ctx, plan, 2, { seed: 3 });
  assert.equal(cheat.days[2].meals.length, 1);
  assert.equal(P.regenerateDay(ctx, plan, 99), plan, 'jour inconnu : rien ne change');
});

test('regenerateDay : le saumon de la semaine ne disparaît pas quand on regénère le seul jour qui en avait', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  let checked = 0;
  for (const seed of SEEDS) {
    const plan = P.generateWeek(ctx, { seed });
    const view = P.viewPlan(ctx, plan);
    const withSalmon = view.days.filter((d) => d.items.some((it) => P.isSalmon(it.meal, w.config)));
    if (withSalmon.length !== 1) continue;
    for (let k = 0; k < 4; k += 1) {
      const next = P.regenerateDay(ctx, plan, withSalmon[0].index, { seed: seed + k });
      assert.ok(!codes(P.viewPlan(ctx, next)).includes('salmon'), `graine ${seed}`);
    }
    checked += 1;
  }
  assert.ok(checked > 0, 'au moins un cas de saumon unique rencontré');
});

test('setDayType : le jour change de type et est regénéré, les autres gardent leurs repas, les budgets se rééquilibrent', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 21 });
  const next = P.setDayType(ctx, plan, 6, 'moyenne', { seed: 5 });
  assert.equal(next.days[6].dayType, 'moyenne');
  assert.deepEqual(next.days.slice(0, 6), plan.days.slice(0, 6));
  const view = P.viewPlan(ctx, next);
  assert.deepEqual(view.warnings, []);
  assert.deepEqual(view.days[6].items.map((it) => it.slot), P.slotsFor(w.config, view.days[6].dayType));
  near(assert, view.week.budgetTotal, view.week.expenditure, 1e-6);
  const before = P.viewPlan(ctx, plan);
  assert.notEqual(view.days[0].budget, before.days[0].budget, 'les budgets des autres jours changent');
  assert.equal(P.setDayType(ctx, plan, 6, 'dimanche'), plan, 'même type : rien ne change');
  assert.equal(P.setDayType(ctx, plan, 6, 'inconnu'), plan);
});

test('setDayType : un jour devient cheat meal (bloc fixe de 3 000 kcal) puis redevient un jour ordinaire', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 30 });
  const two = P.setDayType(ctx, plan, 0, 'cheat', { seed: 1 });
  let view = P.viewPlan(ctx, two);
  assert.equal(view.days.filter((d) => d.fixed).length, 2);
  assert.equal(view.days[0].items.length, 1);
  assert.notEqual(view.days[0].items[0].id, view.days[2].items[0].id, 'les deux cheat meals sont différents (aucune répétition)');
  assert.deepEqual(view.warnings, []);
  near(assert, view.week.budgetTotal, view.week.expenditure, 1e-6);
  const back = P.setDayType(ctx, two, 2, 'repos', { seed: 2 });
  view = P.viewPlan(ctx, back);
  assert.equal(view.days.filter((d) => d.fixed).length, 1);
  assert.deepEqual(view.warnings, []);
});

test('toute combinaison de types de journée donne un planning lisible : règles tenues ou avertissement, jamais d\'exception', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const types = w.config.dayTypes.map((t) => t.id);
  let seed = 1;
  for (let n = 0; n < 40; n += 1) {
    const dayTypes = Array.from({ length: 7 }, () => types[(seed = (seed * 1103515245 + 12345) >>> 0) % types.length]);
    const plan = P.generateWeek(ctx, { seed: n + 1, dayTypes });
    const view = P.viewPlan(ctx, plan);
    assert.deepEqual(plan.days.map((d) => d.dayType), dayTypes);
    for (const wn of view.warnings) assert.ok(['repeat', 'context', 'empty-slot', 'legume', 'salmon', 'kcal-gap', 'floor'].includes(wn.code), `${dayTypes} : ${wn.code}`);
    // les règles qui ne se relâchent jamais
    const all = view.days.flatMap((d) => d.items.map((it) => it.meal));
    assert.ok(all.filter((m) => P.isOffal(m, w.config)).length <= 1, 'abats');
    for (const d of view.days) for (const it of d.items) if (P.hasMilkCocoa(it.meal, w.config)) assert.ok(['moyenne', 'longue'].includes(d.dayType.outing));
  }
});

// ------------------------------------------------------------------ contraintes impossibles : avertissements
test('contrainte impossible : quatre jours de cheat meal pour deux repas → répétitions inévitables, signalées', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 2, dayTypes: ['cheat', 'cheat', 'repos', 'cheat', 'repos', 'cheat', 'dimanche'] }));
  const repeats = view.warnings.filter((x) => x.code === 'repeat');
  assert.ok(repeats.length >= 1, 'un cheat meal revient');
  assert.ok(repeats[0].text.includes('fois dans la semaine'));
  assert.equal(new Set(ids(P.generateWeek(ctx, { seed: 2, dayTypes: ['cheat', 'cheat', 'repos', 'cheat', 'repos', 'cheat', 'dimanche'] }))).size >= 2, true);
  assert.ok(view.days.every((d) => d.items.length === P.slotsFor(w.config, d.dayType).length), 'aucun jour vide : la répétition est préférée au créneau vide');
});

test('sept jours de sortie longue : assez de repas dans la cascade de contextes pour ne rien répéter', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 2, dayTypes: Array(7).fill('longue') }));
  assert.ok(!codes(view).includes('repeat'));
  assert.ok(view.days.every((d) => d.items.length === 6));
});

test('contrainte impossible : sans saumon dans le recueil → avertissement, le reste du planning est généré', async () => {
  const w = await world();
  const meals = w.meals.filter((m) => !P.isSalmon(m, w.config));
  const ctx = plannerCtx(w, FICTIVE, { meals });
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 6 }));
  assert.ok(codes(view).includes('salmon'));
  assert.equal(view.days.length, 7);
  assert.ok(view.days.every((d) => d.items.length === P.slotsFor(w.config, d.dayType).length));
});

test('contrainte impossible : sans légumineuses → avertissement chaque jour (hors cheat meal)', async () => {
  const w = await world();
  const meals = w.meals.filter((m) => !P.isLegume(m, w.config));
  const ctx = plannerCtx(w, FICTIVE, { meals });
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 6 }));
  assert.equal(view.warnings.filter((x) => x.code === 'legume').length, 6);
  assert.ok(view.warnings.filter((x) => x.code === 'legume').every((x) => x.day !== 'Mercredi'));
});

test('contrainte impossible : seuls des abats en dîner → un seul repas d\'abats, créneaux vides signalés', async () => {
  const w = await world();
  const meals = w.meals.filter((m) => m.category !== 'Dîner' || P.isOffal(m, w.config));
  const ctx = plannerCtx(w, FICTIVE, { meals });
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 6 }));
  assert.ok(view.days.flatMap((d) => d.items).filter((it) => P.isOffal(it.meal, w.config)).length <= 1);
  assert.ok(codes(view).includes('empty-slot'));
});

test('avertissements : repas introuvable ou incomplet, budget hors de portée', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 12 });
  const broken = JSON.parse(JSON.stringify(plan));
  broken.days[0].meals[0][1] = 'repas-supprime';
  assert.ok(codes(P.viewPlan(ctx, broken)).includes('missing-meal'));
  assert.ok(codes(P.viewPlan(ctx, broken)).includes('empty-slot') === false, 'le créneau garde sa ligne');
  const incomplete = { ...ctx, mealIdx: new Map(ctx.meals.map((m) => [m.id, m.id === plan.days[0].meals[0][1] ? { ...m, incomplete: true } : m])) };
  assert.ok(codes(P.viewPlan(incomplete, plan)).includes('incomplete'));
  // un jour réduit à un seul repas léger ne peut pas atteindre son budget même à ×2
  const tiny = JSON.parse(JSON.stringify(plan));
  tiny.days[6].meals = tiny.days[6].meals.slice(0, 1);
  const v = P.viewPlan(ctx, tiny);
  assert.ok(codes(v).includes('kcal-gap') || v.days[6].factor === 2);
});

// ------------------------------------------------------------------ remplacement d'un repas
test('replacePlanMeal : remplace un repas en gardant son créneau, sans toucher au reste', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 9 });
  const [slot, id] = plan.days[1].meals[2];
  const next = P.replacePlanMeal(plan, 1, id, 'nouveau');
  assert.deepEqual(next.days[1].meals[2], [slot, 'nouveau']);
  assert.deepEqual(next.days[0], plan.days[0]);
  assert.equal(plan.days[1].meals[2][1], id, 'planning d\'origine inchangé');
  assert.equal(P.replacePlanMeal(plan, 1, 'absent', 'x'), plan);
});

// ------------------------------------------------------------------ liste de courses
test('liste de courses : aliments dédoublonnés, quantités cumulées avec la portion du jour, regroupés par type', async () => {
  const w = await world();
  const ctx = plannerCtx(w, PROFILES.lourd);
  const plan = P.generateWeek(ctx, { seed: 14 });
  const view = P.viewPlan(ctx, plan);
  // calcul indépendant : cumul ligne par ligne
  const expected = new Map();
  for (const d of view.days) for (const it of d.items) for (const l of it.meal.lines) {
    if (!l.food) continue;
    const raw = l.qty * d.factor;
    expected.set(l.id, (expected.get(l.id) ?? 0) + (l.kind === 'food' && l.food.convertible ? C.convertQty(l.food, raw, l.food.state, 'cru') : raw));
  }
  const listed = view.shopping.groups.flatMap((g) => g.items);
  assert.equal(new Set(listed.map((e) => e.id)).size, listed.length, 'aucun doublon');
  assert.deepEqual(new Set(listed.map((e) => e.id)), new Set(expected.keys()));
  for (const e of listed) near(assert, e.qty, expected.get(e.id), 1e-6);
  // regroupement par type, dans l'ordre de config.foodTypes, aliments triés par nom
  const order = [...w.config.foodTypes, P.RECIPE_GROUP];
  const types = view.shopping.groups.map((g) => g.type);
  assert.deepEqual(types, [...types].sort((a, b) => order.indexOf(a) - order.indexOf(b)));
  for (const g of view.shopping.groups) {
    assert.ok(g.items.length > 0);
    assert.deepEqual(g.items.map((e) => e.name), [...g.items.map((e) => e.name)].sort((a, b) => a.localeCompare(b, 'fr')));
    for (const e of g.items) if (g.type !== P.RECIPE_GROUP) assert.equal(e.type, g.type);
  }
  assert.equal(view.shopping.cheat, true);
});

test('liste de courses : un aliment qui revient dans plusieurs repas est cumulé ; cru/cuit converti en cru ; ingrédients internes à part', async () => {
  const w = await world();
  const ctx = plannerCtx(w, null);
  const rice = w.foodIdx.get('riz-complet');
  const mk = (id, items, internal = []) => ({ ...w.meals[0], id, category: 'Dîner', cheat: null, incomplete: false, lines: [
    ...items.map(([fid, qty]) => ({ kind: 'food', id: fid, food: w.foodIdx.get(fid), qty, missing: false })),
    ...internal.map(([iid, qty]) => ({ kind: 'internal', id: iid, food: { id: iid, name: w.internalIdx.get(iid).name, unit: 'g', per100: C.normPer100(w.internalIdx.get(iid).per100), convertible: false }, qty, missing: false })),
  ] });
  const days = [
    { factor: 1, items: [{ slot: 'Dîner', id: 'a', meal: mk('a', [['riz-complet', 260], ['banane', 100]]) }] },
    { factor: 1.5, items: [{ slot: 'Dîner', id: 'b', meal: mk('b', [['riz-complet', 130], ['banane', 40]], [['i-farine-t150', 100]]) }] },
  ];
  const s = P.shoppingList(ctx, days);
  const all = Object.fromEntries(s.groups.flatMap((g) => g.items).map((e) => [e.id, e]));
  near(assert, all['riz-complet'].qty, (260 + 130 * 1.5) / rice.coef, 1e-9);
  assert.equal(all['riz-complet'].state, 'cru');
  near(assert, all.banane.qty, 100 + 40 * 1.5, 1e-9);
  assert.equal(all.banane.state, null);
  assert.equal(s.groups.at(-1).type, P.RECIPE_GROUP);
  assert.equal(s.groups.at(-1).items[0].id, 'i-farine-t150');
  assert.equal(s.cheat, false);
});

test('liste de courses : texte à copier (titre, types, « - quantité unité nom (cru) »), note sur le cheat meal', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 14 }));
  const text = P.shoppingToText(view.shopping);
  const lines = text.split('\n');
  assert.equal(lines[0], 'Liste de courses de la semaine');
  for (const g of view.shopping.groups) assert.ok(lines.includes(g.type), g.type);
  const e = view.shopping.groups[0].items[0];
  assert.ok(lines.includes(`- ${C.fmtQty(e.qty)} ${e.unit} ${e.name}${e.state ? ` (${e.state})` : ''}`));
  assert.ok(lines.every((l) => l === '' || l.startsWith('- ') || view.shopping.groups.some((g) => g.type === l) || l.startsWith('Liste') || l.startsWith('Le cheat meal')));
  assert.match(text, /Le cheat meal \(composition libre\) n'est pas compté\./);
  assert.equal(P.shoppingToText({ groups: [], cheat: false }, 'Courses'), 'Courses');
});

// ------------------------------------------------------------------ enregistrement
test('sanitizePlan : relecture sûre d\'un planning enregistré', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 5 });
  const ids7 = w.config.dayTypes.map((t) => t.id);
  assert.deepEqual(P.sanitizePlan(JSON.parse(JSON.stringify(plan)), { dayTypeIds: ids7 }), plan);
  assert.equal(P.sanitizePlan(null), null);
  assert.equal(P.sanitizePlan('texte'), null);
  assert.equal(P.sanitizePlan({ days: [] }), null);
  assert.equal(P.sanitizePlan({ days: Array(15).fill({ label: 'a', dayType: 'repos' }) }), null);
  assert.equal(P.sanitizePlan({ days: [{ label: 'Lundi', dayType: 'inconnu', meals: [] }] }, { dayTypeIds: ids7 }), null, 'type de journée inconnu');
  assert.equal(P.sanitizePlan({ days: [{ label: '', dayType: 'repos' }] }), null);
  const dirty = P.sanitizePlan({ seed: -3, pirate: 1, days: [{ label: 'Lundi', dayType: 'courte', seed: 'x', meals: [['Dîner', 'a'], ['Dîner'], [3, 'b'], 'c', null, ['Déjeuner', 'd', 'extra']] }] }, { dayTypeIds: ids7 });
  assert.deepEqual(dirty, { v: 1, seed: 0, days: [{ label: 'Lundi', dayType: 'courte', seed: 0, meals: [['Dîner', 'a'], ['Déjeuner', 'd']] }] });
});

test('semaine type et référence : types de journée de days.json, kcal de la journée type', async () => {
  const w = await world();
  const wt = P.weekTypes(w.days.week, w.days.days);
  assert.deepEqual(wt.map((x) => x.label), ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']);
  assert.equal(wt[2].dayType, 'cheat');
  const ref = P.referenceKcal(w.days.days, w.mealIdx);
  assert.deepEqual(Object.keys(ref).sort(), [...new Set(w.days.days.map((d) => d.dayType))].sort());
  assert.ok(ref.cheat > 2900 && ref.cheat < 3100);
});

// ------------------------------------------------------------------ données
test('config.planner : validée par validate-data (références, listes, nombres)', async () => {
  const w = await world();
  const ok = validateData({ foods: w.foods, internal: w.internal ? { schemaVersion: 1, ingredients: w.internal } : w.internal, meals: w.meals && { schemaVersion: 1, meals: w.meals.map((m) => m.def) }, days: w.days, config: w.config });
  assert.deepEqual(ok.errors, []);
  const bad = (mutate) => {
    const config = structuredClone(w.config);
    mutate(config.planner);
    return validateData({ foods: w.foods, internal: { schemaVersion: 1, ingredients: w.internal }, meals: { schemaVersion: 1, meals: w.meals.map((m) => m.def) }, days: w.days, config }).errors.join('\n');
  };
  assert.match(bad((p) => { p.slots.rest = ['Brunch']; }), /catégorie « Brunch » inconnue/);
  assert.match(bad((p) => { delete p.contexts.repos; }), /contextes manquants pour le type de journée « repos »/);
  assert.match(bad((p) => { p.contexts.repos = ['Jour de fête']; }), /contexte « Jour de fête » inconnu/);
  assert.match(bad((p) => { p.rules.salmonFoods = ['truite']; }), /aliment « truite » inconnu/);
  assert.match(bad((p) => { p.rules.offalTag = 'Frites'; }), /tag « Frites » inconnu/);
  assert.match(bad((p) => { p.rules.milkCocoa.outings = ['enorme']; }), /sortie « enorme » inconnue/);
  assert.match(bad((p) => { p.fixedDayTypes = ['x']; }), /type de journée « x » inconnu/);
  assert.match(bad((p) => { p.attempts = 0; }), /attempts/);
  assert.match(bad((p) => { p.floor = 1.5; }), /floor/);
  const noBlock = structuredClone(w.config);
  delete noBlock.planner;
  assert.match(validateData({ foods: w.foods, internal: { schemaVersion: 1, ingredients: w.internal }, meals: { schemaVersion: 1, meals: w.meals.map((m) => m.def) }, days: w.days, config: noBlock }).errors.join('\n'), /bloc « planner » manquant/);
});
