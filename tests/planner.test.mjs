import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../scripts/validate-data.mjs';
import * as C from '../src/calc.js';
import * as P from '../src/planner.js';
import { clampFactor } from '../src/day.js';
import { effectiveWeek } from '../src/week.js';
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
/** Repas à légumineuses d'un planning lu par viewPlan : nombre total et nombre de jours distincts. */
const legumes = (view, config) => {
  const perDay = view.days.map((d) => d.items.filter((it) => it.meal && P.isLegume(it.meal, config)).length);
  return { meals: perDay.reduce((a, b) => a + b, 0), days: perDay.filter((n) => n > 0).length };
};

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
      // légumineuses : au moins minLegumeMeals repas, sur autant de jours distincts ; saumon au moins une fois, abats au plus une fois
      for (const d of view.days) assert.equal(d.fixed, d.dayType.id === 'cheat', where);
      const lg = legumes(view, w.config);
      assert.ok(lg.meals >= w.config.planner.rules.minLegumeMeals, `${where} : ${lg.meals} repas à légumineuses`);
      assert.ok(lg.days >= w.config.planner.rules.minLegumeMeals, `${where} : légumineuses sur ${lg.days} jours seulement`);
      assert.deepEqual(view.week.legumes, { count: lg.meals, min: w.config.planner.rules.minLegumeMeals }, where);
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

test('regenerateDay : le minimum de repas à légumineuses reste tenu pour chaque jour regénéré, cheat meal compris', async () => {
  const w = await world();
  const min = w.config.planner.rules.minLegumeMeals;
  for (const profile of [FICTIVE, null]) {
    const ctx = plannerCtx(w, profile);
    for (const seed of SEEDS.slice(0, 20)) {
      const plan = P.generateWeek(ctx, { seed });
      for (let i = 0; i < plan.days.length; i += 1) {
        for (const k of [0, 1]) {
          const view = P.viewPlan(ctx, P.regenerateDay(ctx, plan, i, { seed: seed + 31 * k + i }));
          assert.ok(legumes(view, w.config).meals >= min, `graine ${seed}, jour ${i}`);
          assert.ok(!codes(view).includes('legume'), `graine ${seed}, jour ${i}`);
        }
      }
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

test('setDayType : jamais d\'autre jour modifié ; vers un jour ordinaire le minimum de légumineuses est tenu, vers un cheat meal seul l\'avertissement signale un manque', async () => {
  const w = await world();
  const min = w.config.planner.rules.minLegumeMeals;
  for (const profile of [FICTIVE, null]) {
    const ctx = plannerCtx(w, profile);
    for (const seed of SEEDS.slice(0, 15)) {
      const plan = P.generateWeek(ctx, { seed });
      for (let i = 0; i < plan.days.length; i += 1) {
        const others = (p) => p.days.filter((_, j) => j !== i);
        if (plan.days[i].dayType !== 'cheat') {
          const cheat = P.setDayType(ctx, plan, i, 'cheat', { seed });
          const view = P.viewPlan(ctx, cheat);
          assert.deepEqual(others(cheat), others(plan), `graine ${seed}, jour ${i} → cheat : les autres jours ne bougent pas`);
          const count = legumes(view, w.config).meals;
          assert.equal(codes(view).includes('legume'), count < min, `graine ${seed}, jour ${i} → cheat : avertissement si et seulement si sous le minimum`);
        }
        const longue = P.setDayType(ctx, plan, i, 'longue', { seed: seed + 1 });
        if (longue === plan) continue;
        assert.deepEqual(others(longue), others(plan), `graine ${seed}, jour ${i} → longue : les autres jours ne bougent pas`);
        assert.ok(legumes(P.viewPlan(ctx, longue), w.config).meals >= min, `graine ${seed}, jour ${i} → longue`);
      }
    }
  }
});

test('regenerateDay : le jour tiré reçoit directement la légumineuse qui manque à la semaine, sans toucher aux autres jours', async () => {
  const w = await world();
  const min = w.config.planner.rules.minLegumeMeals;
  // la plupart des déjeuners du recueil contiennent une légumineuse : on neutralise celles au-delà des huit premières pour qu'il existe des alternatives
  let n = 0;
  const meals = w.meals.map((m) => (P.isLegume(m, w.config) && (n += 1) > 8
    ? { ...m, lines: m.lines.map((l) => (l.food?.type === w.config.planner.rules.legumeType ? { ...l, food: { ...l.food, type: w.config.foodTypes.find((t) => t !== w.config.planner.rules.legumeType) } } : l)) }
    : m));
  const ctx = plannerCtx(w, FICTIVE, { meals });
  const plan = P.generateWeek(ctx, { seed: 4 });
  const isLeg = (id) => P.isLegume(ctx.mealIdx.get(id), w.config);
  // retire les légumineuses d'un jour (repas remplacés par des repas sans légumineuse du même créneau) ; faux si impossible
  const strip = (copy, i) => {
    const accepted = P.contextsFor(w.config, P.dayTypeOf(w.config, copy.days[i].dayType));
    copy.days[i].meals = copy.days[i].meals.map(([slot, id]) => {
      if (!isLeg(id)) return [slot, id];
      const swap = ctx.meals.find((m) => m.category === slot && !m.cheat && !P.isLegume(m, w.config) && m.contexts.some((c) => accepted.includes(c)));
      return swap ? [slot, swap.id] : [slot, id];
    });
    return !copy.days[i].meals.some(([, id]) => isLeg(id));
  };
  const withLegume = plan.days.map((d, i) => i).filter((i) => plan.days[i].dayType !== 'cheat' && plan.days[i].meals.some(([, id]) => isLeg(id)));
  let done = 0;
  for (const target of withLegume) {
    // la semaine de départ n'a que `min - 2` repas à légumineuses hors du jour tiré : le jour tiré doit en recevoir une, seul
    const thin = JSON.parse(JSON.stringify(plan));
    if (!strip(thin, target)) continue;
    for (const j of withLegume.filter((x) => x !== target)) if (P.viewPlan(ctx, thin).week.legumes.count > min - 2) strip(thin, j);
    if (P.viewPlan(ctx, thin).week.legumes.count !== min - 2) continue;
    const next = P.regenerateDay(ctx, thin, target, { seed: 12 });
    assert.deepEqual(next.days.filter((_, j) => j !== target), thin.days.filter((_, j) => j !== target), `jour ${target} : les autres jours ne bougent pas`);
    assert.ok(next.days[target].meals.some(([, id]) => isLeg(id)), `jour ${target} : le jour regénéré contient directement une légumineuse`);
    done += 1;
  }
  assert.ok(done > 0, 'au moins un cas de test construit');
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

test('contrainte impossible : sans légumineuses → un seul avertissement, de semaine (pas un par jour)', async () => {
  const w = await world();
  const meals = w.meals.filter((m) => !P.isLegume(m, w.config));
  const ctx = plannerCtx(w, FICTIVE, { meals });
  const view = P.viewPlan(ctx, P.generateWeek(ctx, { seed: 6 }));
  const legume = view.warnings.filter((x) => x.code === 'legume');
  assert.equal(legume.length, 1);
  assert.equal(legume[0].day, null);
  assert.deepEqual(view.week.legumes, { count: 0, min: 4 });
  assert.match(legume[0].text, /Aucun repas avec légumineuses cette semaine \(minimum 4\)/);
});

test('légumineuses : sous le minimum, un seul avertissement de semaine qui donne le nombre de repas', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 6 });
  const idx = new Map(w.meals.map((m) => [m.id, m]));
  const other = w.meals.filter((m) => !P.isLegume(m, w.config));
  // retire les repas à légumineuses d'un planning en les remplaçant par un repas sans légumineuse de la même catégorie, sauf trois d'entre eux
  let kept = 0;
  const thin = JSON.parse(JSON.stringify(plan));
  for (const d of thin.days) d.meals = d.meals.map(([slot, id]) => {
    if (!P.isLegume(idx.get(id), w.config) || (kept < 3 && (kept += 1))) return [slot, id];
    return [slot, other.find((m) => m.category === slot && !m.cheat)?.id ?? id];
  });
  const view = P.viewPlan(ctx, thin);
  assert.equal(view.week.legumes.count, 3);
  const legume = view.warnings.filter((x) => x.code === 'legume');
  assert.equal(legume.length, 1);
  assert.equal(legume[0].text, 'Seulement 3 repas avec légumineuses cette semaine (minimum 4).');
});

test('légumineuses : minLegumeMeals est lu dans la config (0 : aucune exigence ni avertissement ; 2 : deux jours suffisent)', async () => {
  const w = await world();
  const meals = w.meals.filter((m) => !P.isLegume(m, w.config));
  const none = plannerCtx(w, FICTIVE, { meals });
  const cfg = (n) => ({ ...w.config, planner: { ...w.config.planner, rules: { ...w.config.planner.rules, minLegumeMeals: n } } });
  const zero = { ...none, config: cfg(0) };
  assert.ok(!codes(P.viewPlan(zero, P.generateWeek(zero, { seed: 6 }))).includes('legume'));
  const two = { ...plannerCtx(w, FICTIVE), config: cfg(2) };
  for (const seed of SEEDS.slice(0, 20)) {
    const view = P.viewPlan(two, P.generateWeek(two, { seed }));
    const lg = legumes(view, w.config);
    assert.ok(lg.meals >= 2 && lg.days >= 2, `graine ${seed}`);
    assert.deepEqual(view.week.legumes, { count: lg.meals, min: 2 });
  }
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
    { factor: 1, items: [{ slot: 'Dîner', id: 'a', meal: mk('a', [['riz-complet', 260], ['kiwi', 100]]) }] },
    { factor: 1.5, items: [{ slot: 'Dîner', id: 'b', meal: mk('b', [['riz-complet', 130], ['kiwi', 40]], [['i-farine-t150', 100]]) }] },
  ];
  const s = P.shoppingList(ctx, days);
  const all = Object.fromEntries(s.groups.flatMap((g) => g.items).map((e) => [e.id, e]));
  near(assert, all['riz-complet'].qty, (260 + 130 * 1.5) / rice.coef, 1e-9);
  assert.equal(all['riz-complet'].state, 'cru');
  near(assert, all.kiwi.qty, 100 + 40 * 1.5, 1e-9);
  assert.equal(all.kiwi.state, null);
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
  assert.deepEqual(dirty, { v: 1, seed: 0, adjust: 1, days: [{ label: 'Lundi', dayType: 'courte', seed: 0, adjust: 1, meals: [['Dîner', 'a'], ['Déjeuner', 'd']], removed: [] }] });
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

test('semaine type personnalisée : le planificateur l\'utilise pour une nouvelle génération, un planning existant ne change pas', async () => {
  const w = await world();
  const dayIds = w.days.days.map((d) => d.id);
  const mine = ['j-longue', 'j-repos', 'j-moyenne', 'j-courte', 'j-dimanche', 'j-veille-longue', 'j-cheat'];
  const custom = effectiveWeek(w.days.week, mine, dayIds);
  const base = plannerCtx(w);
  const ctx = { ...base, week: P.weekTypes(custom, w.days.days) };
  assert.deepEqual(P.weekTypes(custom, w.days.days).map((x) => x.dayType), ['longue', 'repos', 'moyenne', 'courte', 'dimanche', 'veille-longue', 'cheat']);
  assert.deepEqual(P.weekTypes(custom, w.days.days).map((x) => x.label), base.week.map((x) => x.label), 'mêmes libellés de jours');
  const existing = P.generateWeek(base, { seed: 11 });
  const snap = JSON.stringify(existing);
  const fresh = P.generateWeek(ctx, { seed: 11 });
  assert.deepEqual(fresh.days.map((d) => d.dayType), ['longue', 'repos', 'moyenne', 'courte', 'dimanche', 'veille-longue', 'cheat']);
  assert.deepEqual(existing.days.map((d) => d.dayType), base.week.map((x) => x.dayType), 'le planning existant garde ses types');
  assert.equal(JSON.stringify(existing), snap, 'le planning existant n\'est pas modifié');
  // le bouton « Semaine type » du planificateur compare au contexte : ni identique à l'ancienne semaine, ni à la nouvelle
  const sameAsTemplate = (c, plan) => plan.days.every((d, i) => d.dayType === c.week[i].dayType);
  assert.equal(sameAsTemplate(base, existing), true);
  assert.equal(sameAsTemplate(ctx, existing), false);
  assert.equal(sameAsTemplate(ctx, fresh), true);
  // règles tenues sur la semaine personnalisée (jour fixe compris), avec et sans profil
  for (const profile of [FICTIVE, null]) {
    const c = { ...plannerCtx(w, profile), week: ctx.week };
    const view = P.viewPlan(c, P.generateWeek(c, { seed: 5 }));
    assert.equal(view.days.length, 7);
    assert.ok(view.week.legumes.count >= w.config.planner.rules.minLegumeMeals, 'légumineuses');
    if (profile) near(assert, view.week.budgetTotal, view.week.expenditure, 1e-6);
  }
});

// ------------------------------------------------------------------ lot D : ajustements de portions et retrait de repas
const r2 = (n) => Math.round(n * 100) / 100;
/** Le même planning avec un ajustement de semaine et des ajustements de jours (`days` : { indice: valeur }). */
const withAdjust = (plan, week, days = {}) => ({ ...plan, adjust: week, days: plan.days.map((d, i) => ({ ...d, adjust: days[i] ?? d.adjust })) });
const allDays = (plan, v) => Object.fromEntries(plan.days.map((_, i) => [i, v]));
const shopMass = (view) => view.shopping.groups.flatMap((g) => g.items).reduce((s, e) => s + e.qty, 0);

test('modèle du planning : generateWeek et sanitizePlan produisent la même forme (adjust ×1, removed vide, graines internes)', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 4 });
  assert.equal(plan.v, 1);
  assert.equal(P.PLAN_VERSION, 1);
  assert.equal(plan.adjust, 1);
  for (const d of plan.days) { assert.equal(d.adjust, 1); assert.deepEqual(d.removed, []); assert.ok(Number.isInteger(d.seed)); }
  const opts = { dayTypeIds: w.config.dayTypes.map((t) => t.id), adjust: w.config.planner.adjust };
  assert.deepEqual(P.sanitizePlan(JSON.parse(JSON.stringify(plan)), opts), plan);
  const view = P.viewPlan(ctx, plan);
  assert.equal(view.week.adjust, 1);
  assert.ok(!('seed' in view), 'la graine n\'est plus exposée à l\'interface');
  for (const d of view.days) { assert.equal(d.mult, 1); assert.equal(d.base, d.factor); assert.ok(!('goal' in d)); assert.deepEqual(d.removedItems, []); }
});

test('sanitizePlan : anciennes formes, valeurs hors plage (bornées par config.planner.adjust), removed invalide', async () => {
  const w = await world();
  const opts = { dayTypeIds: w.config.dayTypes.map((t) => t.id), adjust: w.config.planner.adjust };
  const old = { v: 1, seed: 5, days: [{ label: 'Lundi', dayType: 'courte', seed: 7, meals: [['Dîner', 'a']] }] };
  assert.deepEqual(P.sanitizePlan(old, opts), { v: 1, seed: 5, adjust: 1, days: [{ label: 'Lundi', dayType: 'courte', seed: 7, adjust: 1, meals: [['Dîner', 'a']], removed: [] }] });
  const day = (o) => ({ label: 'Lundi', dayType: 'courte', seed: 1, meals: [], ...o });
  const wild = P.sanitizePlan({ adjust: 9, days: [day({ adjust: 0.1 }), day({ adjust: 9 }), day({ adjust: 'x' }), day({ adjust: -2 }), day({ adjust: NaN }), day({ adjust: 1.234 })] }, opts);
  assert.equal(wild.adjust, w.config.planner.adjust.week.max);
  assert.deepEqual(wild.days.map((d) => d.adjust), [w.config.planner.adjust.day.min, w.config.planner.adjust.day.max, 1, 1, 1, 1.23]);
  assert.equal(P.sanitizePlan({ adjust: 0.1, days: [day()] }, opts).adjust, w.config.planner.adjust.week.min);
  assert.equal(P.sanitizePlan({ adjust: 0.9, days: [day()] }, opts).adjust, 0.9);
  assert.equal(P.sanitizePlan({ adjust: 'non', days: [day()] }, opts).adjust, 1);
  // sans la config (lecture d'une sauvegarde avant le chargement) : seuls les nombres positifs sont gardés, la plage est revalidée ensuite
  assert.equal(P.sanitizePlan({ adjust: 9, days: [day({ adjust: -1 })] }).adjust, 9);
  assert.equal(P.sanitizePlan({ adjust: 9, days: [day({ adjust: -1 })] }).days[0].adjust, 1);
  const bad = P.sanitizePlan({ days: [day({ removed: [['Dîner', 'a'], ['Dîner'], [1, 'b'], 'c', null, ['Déjeuner', 'd', 'x']] }), day({ removed: 'non' }), day({})] }, opts);
  assert.deepEqual(bad.days.map((d) => d.removed), [[['Dîner', 'a'], ['Déjeuner', 'd']], [], []]);
});

test('persistance : un planning ajusté avec des repas retirés est identique après relecture (stockage du navigateur)', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const opts = { dayTypeIds: w.config.dayTypes.map((t) => t.id), adjust: w.config.planner.adjust };
  let plan = withAdjust(P.generateWeek(ctx, { seed: 8 }), 0.93, { 0: 1.27, 3: 0.64, 5: 1.5 });
  plan = P.removeMealAt(P.removeMealAt(P.removeMealAt(plan, 0, 1), 3, 0), 5, 2);
  assert.equal(plan.days[0].removed.length, 1);
  const reread = P.sanitizePlan(JSON.parse(JSON.stringify(plan)), opts);
  assert.deepEqual(reread, plan);
  assert.deepEqual(P.viewPlan(ctx, reread), P.viewPlan(ctx, plan), 'même lecture : semaine, ajustements et repas retirés identiques');
});

test('retrait : facteur et budgets inchangés, apports baissés du repas × facteur, absent du bilan et des courses, aucun écart signalé, rétablir revient à l\'état initial', async () => {
  const w = await world();
  for (const profile of [FICTIVE, FICTIVE_F, null]) {
    const ctx = plannerCtx(w, profile);
    for (const seed of SEEDS.slice(0, 8)) {
      const plan = P.generateWeek(ctx, { seed });
      const snap = JSON.stringify(plan);
      const before = P.viewPlan(ctx, plan);
      for (const i of [0, 2, 3, 5]) { // 2 : jour du cheat meal
        const k = Math.min(1, plan.days[i].meals.length - 1);
        const [slot, id] = plan.days[i].meals[k];
        const kcal = ctx.mealIdx.get(id).totals.kcal;
        const next = P.removeMealAt(plan, i, k);
        const after = P.viewPlan(ctx, next);
        const where = `${profile ? 'profil' : 'sans profil'}, graine ${seed}, jour ${i}`;
        const b = before.days[i];
        const a = after.days[i];
        assert.equal(JSON.stringify(plan), snap, `${where} : planning d'origine inchangé`);
        assert.deepEqual(next.days[i].removed, [[slot, id]], where);
        assert.equal(next.days[i].meals.length, plan.days[i].meals.length - 1, where);
        // le facteur est celui d'avant (il se calcule sur `basis`) ; le total du jour baisse du repas retiré
        assert.equal(a.factor, b.factor, `${where} : facteur`);
        near(assert, a.basis.kcal, b.totals.kcal, 1e-9);
        near(assert, a.totals.kcal, b.totals.kcal - kcal, 1e-6);
        near(assert, a.adjusted.kcal, b.adjusted.kcal - kcal * b.factor, 1e-6);
        // les autres jours et leurs budgets ne bougent pas
        after.days.forEach((d, j) => { near(assert, d.budget ?? 0, before.days[j].budget ?? 0, 1e-6); if (j !== i) assert.deepEqual(d.items, before.days[j].items, `${where} : jour ${j}`); });
        // absent du jour, du bilan, de la liste de courses et de « Ma journée » (items chargés dans « Ma journée » = d.items)
        assert.ok(!a.items.some((it) => it.slot === slot && it.id === id), where);
        near(assert, after.week.total.kcal, before.week.total.kcal - kcal * b.factor, 1e-6);
        assert.ok(shopMass(after) < shopMass(before) || a.fixed, `${where} : liste de courses`);
        // aucun avertissement d'écart ni de créneau vide pour ce jour (le créneau retiré n'est pas « vide »)
        assert.deepEqual(after.warnings.filter((x) => x.day === a.label && ['kcal-gap', 'empty-slot'].includes(x.code)), [], where);
        if (!a.fixed) {
          const bare = P.viewPlan(ctx, { ...next, days: next.days.map((d, j) => (j === i ? { ...d, removed: [] } : d)) });
          assert.ok(bare.warnings.some((x) => x.day === a.label && x.code === 'empty-slot'), `${where} : sans « removed », le créneau serait vide`);
        }
        // rétablir : retour à l'état initial
        assert.deepEqual(P.restoreMealAt(ctx, next, i, 0), plan, `${where} : rétablir`);
        assert.deepEqual(P.viewPlan(ctx, P.restoreMealAt(ctx, next, i, 0)), before, `${where} : lecture après rétablissement`);
      }
    }
  }
});

test('retrait : plusieurs repas, dernier repas d\'un jour, rétablissement dans l\'ordre des créneaux, indices inconnus', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 6 });
  const n = plan.days[3].meals.length;
  let cur = plan;
  for (let k = 0; k < n; k += 1) cur = P.removeMealAt(cur, 3, 0);
  const view = P.viewPlan(ctx, cur);
  assert.deepEqual(cur.days[3].meals, []);
  assert.equal(cur.days[3].removed.length, n);
  assert.equal(view.days[3].items.length, 0);
  assert.equal(view.days[3].totals.kcal, 0);
  assert.equal(view.days[3].adjusted.kcal, 0);
  assert.equal(view.days[3].factor, P.viewPlan(ctx, plan).days[3].factor, 'dernier repas retiré : facteur inchangé');
  assert.deepEqual(view.warnings.filter((x) => x.day === view.days[3].label && ['kcal-gap', 'empty-slot'].includes(x.code)), []);
  // rétablis dans le désordre (le dernier retiré d'abord) : l'ordre des créneaux du type de journée est retrouvé
  let back = cur;
  for (let k = 0; k < n; k += 1) back = P.restoreMealAt(ctx, back, 3, back.days[3].removed.length - 1);
  assert.deepEqual(back, plan);
  // repas du milieu retiré puis rétabli : il retrouve sa place
  const mid = P.removeMealAt(P.removeMealAt(plan, 3, 1), 3, 1);
  assert.deepEqual(P.restoreMealAt(ctx, P.restoreMealAt(ctx, mid, 3, 1), 3, 0), plan);
  assert.equal(P.removeMealAt(plan, 3, 99), plan);
  assert.equal(P.removeMealAt(plan, 99, 0), plan);
  assert.equal(P.restoreMealAt(ctx, plan, 3, 0), plan);
  assert.equal(P.restoreMealAt(ctx, plan, 99, 0), plan);
});

test('retrait : le repas du cheat meal retiré ne déplace pas les budgets des autres jours ; repas supprimé depuis (introuvable) ignoré dans la base', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: 14 });
  const cheat = plan.days.findIndex((d) => d.dayType === 'cheat');
  const before = P.viewPlan(ctx, plan);
  const after = P.viewPlan(ctx, P.removeMealAt(plan, cheat, 0));
  after.days.forEach((d, j) => near(assert, d.budget, before.days[j].budget, 1e-6));
  near(assert, after.week.budgetTotal, before.week.budgetTotal, 1e-6);
  assert.equal(after.days[cheat].factor, 1);
  // un repas retiré qui n'existe plus : ignoré dans `basis`, affiché comme introuvable, sans exception
  const i = 0;
  const [, id] = plan.days[i].meals[1];
  const removed = P.removeMealAt(plan, i, 1);
  const gone = { ...ctx, mealIdx: new Map([...ctx.mealIdx].filter(([k]) => k !== id)), meals: ctx.meals.filter((m) => m.id !== id) };
  const v = P.viewPlan(gone, removed);
  assert.equal(v.days[i].removedItems[0].meal, null);
  near(assert, v.days[i].basis.kcal, v.days[i].totals.kcal, 1e-9);
});

test('curseurs : factor = r2(base × semaine × jour) borné à [0,5 ; 2], jour fixe inchangé, d.factor invariant par clampFactor, écart toujours par rapport au budget', async () => {
  const w = await world();
  const ctx = plannerCtx(w, FICTIVE);
  for (const seed of SEEDS.slice(0, 10)) {
    const plan = P.generateWeek(ctx, { seed });
    const ref = P.viewPlan(ctx, plan);
    for (const [wk, dk] of [[0.9, 1.1], [1.25, 2], [0.75, 0.5], [1, 1.37], [1.1, 1]]) {
      const view = P.viewPlan(ctx, withAdjust(plan, wk, allDays(plan, dk)));
      const where = `graine ${seed}, semaine ×${wk}, jour ×${dk}`;
      assert.equal(view.week.adjust, wk);
      for (const d of view.days) {
        const r = ref.days[d.index];
        assert.equal(clampFactor(d.factor), d.factor, `${where} : ${d.label} invariant par clampFactor`);
        assert.ok(d.factor >= 0.5 && d.factor <= 2, where);
        if (d.fixed) {
          assert.equal(d.factor, 1, where);
          assert.equal(d.mult, 1, where);
          near(assert, d.adjusted.kcal, r.adjusted.kcal, 1e-9);
          near(assert, d.delta, r.delta, 1e-9);
          continue;
        }
        near(assert, d.base, r.base, 1e-12);
        near(assert, d.mult, wk * dk, 1e-12);
        near(assert, d.factor, Math.min(2, Math.max(0.5, r2(d.base * wk * dk))), 1e-12);
        assert.ok(!('goal' in d), 'plus de cible ajustée');
        near(assert, d.delta, d.adjusted.kcal - d.budget, 1e-9);
        near(assert, d.adjusted.kcal, d.totals.kcal * d.factor, 1e-6);
      }
    }
  }
});

test('curseurs : sans profil, le facteur ne vient que des ajustements ; sans budget ni écart', async () => {
  const w = await world();
  const ctx = plannerCtx(w, null);
  const plan = P.generateWeek(ctx, { seed: 3 });
  const view = P.viewPlan(ctx, withAdjust(plan, 0.9, allDays(plan, 1.1)));
  for (const d of view.days) {
    assert.equal(d.base, 1);
    assert.equal(d.delta, null);
    assert.equal(d.factor, d.fixed ? 1 : r2(0.9 * 1.1));
  }
  assert.equal(P.realignedDayAdjust(ctx, withAdjust(plan, 0.9, { 0: 1.3 }), 0), 1.3, 'sans budget : l\'ajustement actuel est rendu');
});

test('curseur de la semaine : le solde de la semaine est proportionnel au curseur, le jour du cheat meal est exclu', async () => {
  const w = await world();
  const ctx = plannerCtx(w, FICTIVE);
  let checked = 0;
  for (const seed of SEEDS.slice(0, 12)) {
    const plan = P.generateWeek(ctx, { seed });
    const ref = P.viewPlan(ctx, plan);
    const open = ref.days.filter((d) => !d.fixed);
    const fixedKcal = ref.days.filter((d) => d.fixed).reduce((s, d) => s + d.adjusted.kcal, 0);
    const openKcal = open.reduce((s, d) => s + d.adjusted.kcal, 0);
    for (const wk of [0.8, 0.9, 1.1, 1.2]) {
      const view = P.viewPlan(ctx, withAdjust(plan, wk));
      if (view.days.some((d) => !d.fixed && (d.factor === 0.5 || d.factor === 2))) continue; // facteur borné : plus proportionnel
      const tol = 0.005 * open.reduce((s, d) => s + d.totals.kcal, 0) + 1; // facteur arrondi au centième
      near(assert, view.week.total.kcal, fixedKcal + wk * openKcal, tol);
      near(assert, view.week.balance, ref.week.balance + (wk - 1) * openKcal, tol);
      for (const d of view.days.filter((x) => x.fixed)) near(assert, d.adjusted.kcal, ref.days[d.index].adjusted.kcal, 1e-9);
      checked += 1;
    }
  }
  assert.ok(checked > 20, `${checked} cas vérifiés`);
});

test('curseurs : kcal-gap se compare au budget et n\'est pas émis quand l\'écart est voulu (curseur ≠ ×1)', async () => {
  const w = await world();
  const ctx = plannerCtx(w, FICTIVE);
  let checked = 0;
  for (const seed of SEEDS.slice(0, 12)) {
    const plan = P.generateWeek(ctx, { seed });
    const view = P.viewPlan(ctx, withAdjust(plan, 1.2));
    if (view.days.some((d) => !d.fixed && (d.factor === 0.5 || d.factor === 2))) continue;
    for (const d of view.days.filter((x) => !x.fixed)) {
      assert.ok(Math.abs(d.delta) > w.config.planner.gapWarning * d.budget, `${d.label} : l'écart au budget dépasse le seuil`);
    }
    assert.ok(!codes(view).includes('kcal-gap'), `graine ${seed}`);
    checked += 1;
  }
  assert.ok(checked > 5);
});

test('curseurs : un ajustement hors d\'atteinte (facteur borné) reste signalé comme budget hors de portée', async () => {
  const w = await world();
  const ctx = plannerCtx(w, FICTIVE);
  const plan = P.generateWeek(ctx, { seed: 2 });
  const view = P.viewPlan(ctx, withAdjust(plan, 1.25, allDays(plan, 2)));
  for (const d of view.days.filter((x) => !x.fixed)) assert.ok(d.factor <= 2);
  assert.ok(view.days.some((d) => !d.fixed && d.factor === 2));
  assert.ok(codes(view).includes('kcal-gap'));
});

test('« Réaligner sur la cible » : après un retrait, l\'ajustement du jour ramène les apports sur la cible de maintien, quel que soit le curseur de la semaine', async () => {
  const w = await world();
  const ctx = plannerCtx(w, FICTIVE);
  let checked = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    for (const wk of [1, 0.9]) {
      const plan = withAdjust(P.generateWeek(ctx, { seed }), wk);
      for (const i of [0, 1, 3, 4, 5]) {
        const day = plan.days[i];
        const k = day.meals.map(([, id]) => ctx.mealIdx.get(id).totals.kcal).reduce((m, v, j, a) => (v < a[m] ? j : m), 0); // le repas le plus léger
        const removed = P.removeMealAt(plan, i, k);
        const adj = P.realignedDayAdjust(ctx, removed, i);
        assert.ok(adj >= w.config.planner.adjust.day.min && adj <= w.config.planner.adjust.day.max);
        const d = P.viewPlan(ctx, withAdjust(removed, wk, { [i]: adj })).days[i];
        if (d.factor === 0.5 || d.factor === 2 || adj === 2) continue; // borné : la cible n'est pas atteignable
        near(assert, d.adjusted.kcal, d.budget, 0.011 * d.budget);
        near(assert, d.delta, 0, 0.011 * d.budget);
        checked += 1;
      }
    }
  }
  assert.ok(checked > 30, `${checked} cas vérifiés`);
  // jour fixe : rien à réaligner
  const plan = P.generateWeek(ctx, { seed: 1 });
  assert.equal(P.realignedDayAdjust(ctx, plan, plan.days.findIndex((d) => d.dayType === 'cheat')), 1);
});

test('conservation des ajustements (P5) : « Regénérer ce jour », changement de type, nouvelle génération, « Semaine type »', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const base = P.generateWeek(ctx, { seed: 31 });
  const mine = P.removeMealAt(P.removeMealAt(withAdjust(base, 0.9, { 0: 1.2, 1: 0.8, 3: 1.4 }), 0, 1), 3, 0);
  const snap = JSON.stringify(mine);
  // « Regénérer ce jour » : ajustements gardés (semaine et jour), repas retirés du jour vidés, les autres jours intacts (retraits compris)
  const reg = P.regenerateDay(ctx, mine, 0, { seed: 5 });
  assert.equal(reg.adjust, 0.9);
  assert.equal(reg.days[0].adjust, 1.2);
  assert.deepEqual(reg.days[0].removed, []);
  assert.deepEqual(reg.days.filter((_, j) => j !== 0), mine.days.filter((_, j) => j !== 0));
  assert.equal(reg.days[3].removed.length, 1);
  // changement de type : ajustement du jour remis à ×1 et retraits vidés ; celui de la semaine et des autres jours reste
  const other = w.config.dayTypes.find((t) => t.id !== mine.days[3].dayType && !P.isFixedType(w.config, t.id)).id;
  const typ = P.setDayType(ctx, mine, 3, other, { seed: 5 });
  assert.equal(typ.days[3].dayType, other);
  assert.equal(typ.days[3].adjust, 1);
  assert.deepEqual(typ.days[3].removed, []);
  assert.equal(typ.adjust, 0.9);
  assert.equal(typ.days[0].adjust, 1.2);
  assert.equal(typ.days[0].removed.length, 1);
  assert.equal(P.setDayType(ctx, mine, 3, mine.days[3].dayType), mine, 'même type : rien ne change (ajustement et retraits gardés)');
  // nouvelle génération : ajustement de la semaine et des jours dont le type n'a pas changé gardés, aucun repas retiré repris
  const types = mine.days.map((d) => d.dayType);
  const carried = P.carryAdjust(P.generateWeek(ctx, { seed: 99, dayTypes: types }), mine);
  assert.equal(carried.adjust, 0.9);
  assert.deepEqual(carried.days.map((d) => d.adjust), mine.days.map((d) => d.adjust));
  assert.ok(carried.days.every((d) => d.removed.length === 0));
  const changed = P.carryAdjust(P.generateWeek(ctx, { seed: 99, dayTypes: types.map((t, j) => (j === 1 ? other === t ? 'repos' : other : t)) }), mine);
  assert.equal(changed.days[1].adjust, 1, 'type changé : ajustement du jour à ×1');
  assert.equal(changed.days[0].adjust, 1.2);
  assert.equal(changed.adjust, 0.9);
  // « Semaine type » (reset) : la génération repart de ×1 partout et sans repas retiré
  const reset = P.generateWeek(ctx, { seed: 99 });
  assert.equal(reset.adjust, 1);
  assert.ok(reset.days.every((d) => d.adjust === 1 && d.removed.length === 0));
  assert.equal(P.carryAdjust(reset, null), reset);
  assert.equal(JSON.stringify(mine), snap, 'aucun planning passé en paramètre n\'est modifié');
});

test('curseurs : le planning se relit identique après sanitizePlan quelles que soient les valeurs enregistrées', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const opts = { dayTypeIds: w.config.dayTypes.map((t) => t.id), adjust: w.config.planner.adjust };
  const plan = withAdjust(P.generateWeek(ctx, { seed: 10 }), 1.07, { 1: 0.55, 4: 1.99 });
  const again = P.sanitizePlan(JSON.parse(JSON.stringify(plan)), opts);
  assert.deepEqual(again, plan);
  assert.deepEqual(P.clampAdjust(w.config, 'week', 3), 1.25);
  assert.deepEqual(P.clampAdjust(w.config, 'day', 0), 1);
  assert.deepEqual(P.clampAdjust(w.config, 'day', '1.234'), 1.23);
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
  assert.match(bad((p) => { delete p.adjust; }), /adjust : bloc/);
  assert.match(bad((p) => { p.adjust.week.min = 1.5; }), /adjust\.week/);
  assert.match(bad((p) => { p.adjust.day.max = 0.9; }), /adjust\.day/);
  assert.match(bad((p) => { p.adjust.step = 0; }), /adjust\.step/);
  const noBlock = structuredClone(w.config);
  delete noBlock.planner;
  assert.match(validateData({ foods: w.foods, internal: { schemaVersion: 1, ingredients: w.internal }, meals: { schemaVersion: 1, meals: w.meals.map((m) => m.def) }, days: w.days, config: noBlock }).errors.join('\n'), /bloc « planner » manquant/);
});
