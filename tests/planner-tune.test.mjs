import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import * as P from '../src/planner.js';
import { tweakLevel, tweakLimits } from '../src/tweaks.js';
import { FICTIVE, FICTIVE_F, near, plannerCtx, tuneCtx, world } from './helpers.mjs';

const PROFILES = {
  homme: FICTIVE,
  femme: FICTIVE_F,
  léger: { ...FICTIVE_F, weightKg: 52, heightCm: 160 },
  lourd: { ...FICTIVE, weightKg: 95, heightCm: 190, age: 25 },
};
const SEEDS = Array.from({ length: 30 }, (_, i) => i * 7919 + 1);
const stripTweaks = (plan) => ({ ...plan, days: plan.days.map(({ tweaks, ...d }) => d) });

/** Un jour retouché de la semaine, avec le planning, ou null. */
function tweakedDay(ctx, seeds = SEEDS) {
  for (const seed of seeds) {
    const plan = P.generateWeek(ctx, { seed });
    const i = plan.days.findIndex((d) => d.tweaks?.length);
    if (i >= 0) return { plan, i, seed };
  }
  return null;
}

// ------------------------------------------------------------------ tirage intact et interrupteur
test('tirage intact : mêmes repas et mêmes repas retirés avec et sans retouche (30 graines × 4 profils)', async () => {
  const w = await world();
  for (const [name, profile] of Object.entries(PROFILES)) {
    const on = tuneCtx(plannerCtx(w, profile), true);
    const off = tuneCtx(on, false);
    for (const seed of SEEDS) {
      const a = P.generateWeek(on, { seed });
      const b = P.generateWeek(off, { seed });
      assert.deepEqual(a.days.map((d) => [d.meals, d.removed, d.seed, d.adjust, d.dayType]), b.days.map((d) => [d.meals, d.removed, d.seed, d.adjust, d.dayType]), `${name}, graine ${seed}`);
      assert.deepEqual(stripTweaks(a), b, `${name}, graine ${seed} : seule la clé tweaks diffère`);
    }
  }
});

test('interrupteur : enabled faux ou bloc absent = planning d\'avant, aucune clé tweaks, vue sans retouche', async () => {
  const w = await world();
  const on = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  for (const enabled of [false, null]) {
    const ctx = tuneCtx(on, enabled);
    for (const seed of SEEDS.slice(0, 6)) {
      const plan = P.generateWeek(ctx, { seed });
      assert.ok(plan.days.every((d) => !('tweaks' in d)), `enabled=${enabled}`);
      assert.equal(JSON.stringify(plan), JSON.stringify(stripTweaks(P.generateWeek(on, { seed }))));
      const view = P.viewPlan(ctx, plan);
      assert.ok(view.days.every((d) => d.items.every((it) => !it.tweaks && it.meal === ctx.mealIdx.get(it.id))));
    }
  }
  assert.equal(P.tuneOpts(tuneCtx(on, false).config), null);
  assert.equal(P.tuneOpts(tuneCtx(on, null).config), null);
  assert.ok(P.tuneOpts(on.config));
});

test('interrupteur : un planning déjà retouché reste lu retouché quand enabled passe à faux (le calcul s\'arrête, rien n\'est réécrit)', async () => {
  const w = await world();
  const on = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  const { plan, i } = tweakedDay(on);
  const off = tuneCtx(on, false);
  assert.deepEqual(P.viewPlan(off, plan), P.viewPlan(on, plan));
  assert.ok(P.viewPlan(off, plan).days[i].items.some((it) => it.tweaks));
  // enabled faux : régénérer un jour efface ses retouches et n'en recalcule pas
  const next = P.regenerateDay(off, plan, i, { seed: 5 });
  assert.ok(!('tweaks' in next.days[i]));
});

// ------------------------------------------------------------------ bornes
test('bornes : au plus 5 lignes par jour, rapports dans bounds et dans la plage de leur type, jamais de retouche interdite', async () => {
  const w = await world();
  let seen = 0;
  for (const [name, profile] of Object.entries(PROFILES)) {
    const ctx = tuneCtx(plannerCtx(w, profile), true);
    const t = tweakLimits(ctx.config);
    for (const seed of SEEDS) {
      const plan = P.generateWeek(ctx, { seed });
      for (const d of plan.days) {
        const tweaks = d.tweaks ?? [];
        assert.ok(tweaks.length <= t.maxTweaks, `${name}, ${seed}, ${d.label} : ${tweaks.length} lignes`);
        const keys = tweaks.map(([s, id, l]) => `${s}|${id}|${l}`);
        assert.equal(new Set(keys).size, keys.length, 'une ligne une seule fois');
        for (const [slot, id, line, foodId, grams] of tweaks) {
          const meal = ctx.mealIdx.get(id);
          const l = meal.lines[line];
          assert.ok(d.meals.some(([s, m]) => s === slot && m === id), 'repas du jour');
          assert.equal(l.kind, 'food');
          assert.equal(l.id, foodId);
          const r = grams / l.qty;
          const rule = t.types[l.food.type];
          assert.ok(rule, `type ${l.food.type} retouchable`);
          assert.ok(r >= rule.min - 1e-9 && r <= rule.max + 1e-9, `r ${r} dans la plage du type`);
          assert.ok(r >= rule.min && rule.min >= t.bounds.min && rule.max <= t.bounds.max);
          assert.notEqual(tweakLevel(r, t), 'forbidden');
          assert.ok(Math.abs(r - 1) > 1e-9, 'jamais une ligne à sa quantité de base');
          assert.equal(grams, Math.round(grams * 100) / 100);
          assert.ok(!t.excludeCategories.includes(meal.category), `catégorie ${meal.category}`);
          assert.ok(!meal.cheat);
          seen += 1;
        }
      }
    }
  }
  assert.ok(seen > 500, `${seen} retouches vérifiées`);
});

test('bornes : aucune retouche sur un jour fixe, sans profil, ni sur une catégorie exclue ; aucune ligne interne', async () => {
  const w = await world();
  const noProfile = tuneCtx(plannerCtx(w, null), true);
  for (const seed of SEEDS.slice(0, 10)) {
    const plan = P.generateWeek(noProfile, { seed });
    assert.ok(plan.days.every((d) => !('tweaks' in d)), 'sans profil : aucune retouche');
    assert.deepEqual(P.viewPlan(noProfile, plan), P.viewPlan(tuneCtx(noProfile, false), plan));
  }
  const ctx = tuneCtx(plannerCtx(w, FICTIVE), true);
  for (const seed of SEEDS.slice(0, 10)) {
    const plan = P.generateWeek(ctx, { seed });
    plan.days.forEach((d) => { if (P.isFixedType(ctx.config, d.dayType)) assert.ok(!('tweaks' in d), 'jour fixe'); });
  }
  // tuneDay lui-même : repas exclus, cheat, incomplet, ligne interne
  const dt = ctx.config.dayTypes.find((x) => x.id === 'repos');
  const budget = 2200;
  const excluded = w.meals.filter((m) => ctx.config.planner.tune.excludeCategories.includes(m.category) && !m.cheat && !m.incomplete).slice(0, 4);
  assert.ok(excluded.length);
  assert.deepEqual(P.tuneDay(ctx, dt, excluded.map((meal) => ({ slot: meal.category, meal })), budget), []);
  const cheat = w.meals.find((m) => m.cheat);
  assert.deepEqual(P.tuneDay(ctx, dt, [{ slot: 'Repas plaisir', meal: cheat }, { slot: 'x', meal: null }], budget), []);
  const withInternal = w.meals.filter((m) => !m.cheat && m.lines.some((l) => l.kind === 'internal') && !ctx.config.planner.tune.excludeCategories.includes(m.category)).slice(0, 6);
  const out = P.tuneDay(ctx, dt, withInternal.map((meal) => ({ slot: meal.category, meal })), 3000);
  for (const [, id, line] of out) assert.equal(ctx.mealIdx.get(id).lines[line].kind, 'food');
  // sorties immédiates : pas de budget, jour fixe, désactivée
  const some = w.meals.filter((m) => !m.cheat && !m.incomplete && !ctx.config.planner.tune.excludeCategories.includes(m.category)).slice(0, 4).map((meal) => ({ slot: meal.category, meal }));
  assert.ok(P.tuneDay(ctx, dt, some, 1800).length > 0, 'cas témoin : un jour sous-dimensionné est retouché');
  assert.deepEqual(P.tuneDay(ctx, dt, some, null), []);
  assert.deepEqual(P.tuneDay(ctx, ctx.config.dayTypes.find((x) => x.id === 'cheat'), some, 1800), []);
  assert.deepEqual(P.tuneDay(tuneCtx(ctx, false), dt, some, 1800), []);
});

test('déterminisme : deux générations donnent les mêmes retouches ; tuneDay est pure (aucune modification des repas)', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  for (const seed of SEEDS.slice(0, 8)) assert.deepEqual(P.generateWeek(ctx, { seed }), P.generateWeek(ctx, { seed }));
  const dt = ctx.config.dayTypes.find((x) => x.id === 'repos');
  const meals = w.meals.filter((m) => !m.cheat && !m.incomplete && !ctx.config.planner.tune.excludeCategories.includes(m.category)).slice(0, 4);
  const items = meals.map((meal) => ({ slot: meal.category, meal }));
  const before = JSON.stringify(items);
  const a = P.tuneDay(ctx, dt, items, 1900);
  assert.equal(JSON.stringify(items), before);
  assert.deepEqual(P.tuneDay(ctx, dt, items, 1900), a);
});

// ------------------------------------------------------------------ opérations sur le planning
test('indépendance des jours : regenerateDay et setDayType laissent intacts meals et tweaks des autres jours', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE), true);
  for (const seed of SEEDS.slice(0, 5)) {
    const plan = P.generateWeek(ctx, { seed });
    for (const i of [0, 3, 5]) {
      const snap = JSON.stringify(plan);
      const regen = P.regenerateDay(ctx, plan, i, { seed: 99 + i });
      assert.equal(JSON.stringify(plan), snap, 'le planning d\'origine n\'est pas modifié');
      plan.days.forEach((d, j) => { if (j !== i) assert.deepEqual(regen.days[j], d, `jour ${j}`); });
      const changed = P.setDayType(ctx, plan, i, plan.days[i].dayType === 'repos' ? 'courte' : 'repos', { seed: 7 });
      plan.days.forEach((d, j) => { if (j !== i) assert.deepEqual(changed.days[j], d, `jour ${j}`); });
    }
  }
});

test('régénération : les retouches du jour sont recalculées de zéro pour le nouveau tirage', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  const { plan, i } = tweakedDay(ctx);
  const regen = P.regenerateDay(ctx, plan, i, { seed: 4242 });
  const day = regen.days[i];
  for (const [slot, id] of (day.tweaks ?? []).map((t) => t.slice(0, 2))) assert.ok(day.meals.some(([s, m]) => s === slot && m === id), 'les retouches portent sur les nouveaux repas');
  const again = P.regenerateDay(ctx, plan, i, { seed: 4242 });
  assert.deepEqual(again.days[i], day, 'même graine, mêmes repas, mêmes retouches');
});

test('retrait puis rétablissement : facteur de départ et quantités des autres repas inchangés, vue identique après rétablissement', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  let checked = 0;
  for (const seed of SEEDS.slice(0, 12)) {
    const plan = P.generateWeek(ctx, { seed });
    const before = P.viewPlan(ctx, plan);
    plan.days.forEach((d, i) => {
      if (!d.tweaks?.length) return;
      const [slot, id] = d.tweaks[0];
      const k = d.meals.findIndex(([s, m]) => s === slot && m === id);
      const next = P.removeMealAt(plan, i, k);
      assert.deepEqual(next.days[i].tweaks, d.tweaks, 'les retouches du repas retiré sont conservées');
      const after = P.viewPlan(ctx, next);
      assert.equal(after.days[i].base, before.days[i].base, 'facteur de départ');
      assert.equal(after.days[i].factor, before.days[i].factor);
      before.days[i].items.forEach((it, j) => { if (j !== k) assert.deepEqual(after.days[i].items[j > k ? j - 1 : j].meal.lines, it.meal.lines, 'quantités des autres repas'); });
      assert.ok(after.days[i].removedItems[0].tweaks, 'le repas retiré reste retouché');
      assert.deepEqual(P.viewPlan(ctx, P.restoreMealAt(ctx, next, i, 0)), before);
      checked += 1;
    });
  }
  assert.ok(checked >= 8, `${checked} retraits vérifiés`);
});

test('remplacement : les retouches de l\'ancien repas disparaissent, celles des autres restent, le nouveau repas n\'a aucun champ tweaks', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  let checked = 0;
  for (const seed of SEEDS) {
    const plan = P.generateWeek(ctx, { seed });
    plan.days.forEach((d, i) => {
      if ((d.tweaks ?? []).length < 2) return;
      const [slot, id] = d.tweaks[0];
      const k = d.meals.findIndex(([s, m]) => s === slot && m === id);
      const others = d.tweaks.filter(([s, m]) => !(s === slot && m === id));
      if (!others.length) return;
      const candidate = ctx.meals.find((m) => !m.incomplete && m.category === slot && !d.meals.some(([, mid]) => mid === m.id));
      const viaIndex = P.replacePlanMealAt(plan, i, k, candidate.id);
      const viaId = P.replacePlanMeal(plan, i, id, candidate.id);
      for (const next of [viaIndex, viaId]) {
        assert.deepEqual(next.days[i].tweaks, others);
        const item = P.viewPlan(ctx, next).days[i].items[k];
        assert.equal(item.id, candidate.id);
        assert.ok(!('tweaks' in item), 'le nouveau repas n\'a aucun champ tweaks');
        assert.equal(item.meal, candidate);
      }
      checked += 1;
    });
  }
  assert.ok(checked >= 3, `${checked} remplacements vérifiés`);
  // dernier repas retouché remplacé : la clé disparaît
  const one = tweakedDay(ctx);
  const d = one.plan.days[one.i];
  const only = d.tweaks.filter(([s, m]) => s === d.tweaks[0][0] && m === d.tweaks[0][1]);
  const single = { ...one.plan, days: one.plan.days.map((x, j) => (j === one.i ? { ...x, tweaks: only } : x)) };
  const k = d.meals.findIndex(([s, m]) => s === only[0][0] && m === only[0][1]);
  const cand = ctx.meals.find((m) => !m.incomplete && m.category === only[0][0] && !d.meals.some(([, mid]) => mid === m.id));
  assert.ok(!('tweaks' in P.replacePlanMealAt(single, one.i, k, cand.id).days[one.i]));
});

test('annulation : clonePlan copie les retouches en profondeur (aucune référence partagée)', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  const { plan, i } = tweakedDay(ctx);
  const k = 0;
  const next = P.removeMealAt(plan, i, k);
  assert.notEqual(next.days[i].tweaks, plan.days[i].tweaks);
  next.days[i].tweaks[0][4] = 1;
  assert.notEqual(plan.days[i].tweaks[0][4], 1, 'modifier la copie ne touche pas l\'original');
});

test('liste de courses : un aliment retouché cumule les quantités retouchées × facteur du jour', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE), true);
  let checked = 0;
  for (const seed of SEEDS.slice(0, 10)) {
    const plan = P.generateWeek(ctx, { seed });
    const view = P.viewPlan(ctx, plan);
    const expected = new Map();
    for (const d of view.days) for (const it of d.items) for (const l of it.meal?.lines ?? []) {
      if (l.missing || !l.food) continue;
      let q = l.qty * d.factor;
      if (l.kind === 'food' && C.isConvertible(l.food)) q = C.convertQty(l.food, q, l.food.state, 'cru');
      expected.set(l.id, (expected.get(l.id) ?? 0) + q);
    }
    for (const g of view.shopping.groups) for (const e of g.items) near(assert, e.qty, expected.get(e.id), 1e-6);
    for (const id of new Set(plan.days.flatMap((d) => (d.tweaks ?? []).map((t) => t[3])))) {
      const shop = view.shopping.groups.flatMap((g) => g.items).find((e) => e.id === id);
      assert.ok(shop, `${id} dans la liste de courses`);
      let recipeQty = 0; // ce que donnerait la recette de base, sans retouche
      for (const d of view.days) for (const it of d.items) for (const l of ctx.mealIdx.get(it.id)?.lines ?? []) {
        if (l.id !== id) continue;
        recipeQty += l.food && C.isConvertible(l.food) ? C.convertQty(l.food, l.qty * d.factor, l.food.state, 'cru') : l.qty * d.factor;
      }
      if (Math.abs(shop.qty - recipeQty) > 1e-6) checked += 1; // la liste suit bien les quantités retouchées, pas la recette
    }
  }
  assert.ok(checked > 10, `${checked} aliments dont la quantité d'achat suit la retouche`);
});

test('règles : règles dures, variété, légumineuses et avertissements de règles identiques avec et sans retouche', async () => {
  const w = await world();
  for (const [name, profile] of Object.entries(PROFILES)) {
    const on = tuneCtx(plannerCtx(w, profile), true);
    const off = tuneCtx(on, false);
    for (const seed of SEEDS.slice(0, 12)) {
      const plan = P.generateWeek(on, { seed });
      const a = P.viewPlan(on, plan);
      const b = P.viewPlan(off, stripTweaks(plan));
      const rules = (v) => v.warnings.filter((x) => x.code !== 'kcal-gap').map((x) => `${x.day}|${x.code}|${x.level}`).sort();
      assert.deepEqual(rules(a), rules(b), `${name}, ${seed}`);
      assert.deepEqual(a.week.legumes, b.week.legumes);
      a.days.forEach((d, i) => assert.deepEqual(d.items.map((it) => [it.slot, it.id]), b.days[i].items.map((it) => [it.slot, it.id])));
    }
  }
});

// ------------------------------------------------------------------ garde-fou statistique
test('garde-fou : sur 40 graines (femme fictive), plus de jours avec protéines dans la fourchette et moins de jours à facteur ≤ 0,8 avec la retouche', async () => {
  const w = await world();
  const on = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  const off = tuneCtx(on, false);
  const share = (ctx) => {
    let days = 0; let prot = 0; let low = 0;
    for (let s = 0; s < 40; s += 1) {
      for (const d of P.viewPlan(ctx, P.generateWeek(ctx, { seed: s * 7919 + 1 })).days) {
        if (d.fixed) continue;
        days += 1;
        if (d.adjusted.protein >= d.target.protein.min - 1e-9 && d.adjusted.protein <= d.target.protein.max + 1e-9) prot += 1;
        if (d.factor <= 0.8 + 1e-9) low += 1;
      }
    }
    return { prot: (100 * prot) / days, low: (100 * low) / days };
  };
  const a = share(on);
  const b = share(off);
  assert.ok(a.prot >= b.prot + 10, `protéines : ${a.prot.toFixed(1)} % contre ${b.prot.toFixed(1)} %`);
  assert.ok(a.low < b.low, `facteur ≤ 0,8 : ${a.low.toFixed(1)} % contre ${b.low.toFixed(1)} %`);
});

// ------------------------------------------------------------------ lecture
test('sanitizePlan : retouches mal formées, doublons et 6ᵉ ligne écartés ; clé absente quand vide ; idempotence', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE), true);
  const plan = P.generateWeek(ctx, { seed: 3 });
  const base = stripTweaks(plan);
  assert.equal(JSON.stringify(P.sanitizePlan(JSON.parse(JSON.stringify(base)))), JSON.stringify(base), 'un planning sans tweaks ressort identique octet pour octet');
  const day = base.days[0];
  const [slot, id] = day.meals[0];
  const good = (n) => [slot, id, n, 'x', 10 + n];
  const raw = JSON.parse(JSON.stringify(base));
  raw.days[0].tweaks = [
    good(0), good(0), [slot, id, 1, 'x', 12.3456], [slot, id, -1, 'x', 5], [slot, id, 1.5, 'x', 5], [slot, id, 2, '', 5], ['', id, 3, 'x', 5], [slot, '', 3, 'x', 5],
    [slot, id, 4, 'x', 0], [slot, id, 4, 'x', -3], [slot, id, 4, 'x', 10001], [slot, id, 4, 'x', NaN], [slot, id, 4, 'x', '20'], [slot, id, 4, 'x'], [slot, id, 4, 'x', 5, 'trop'],
    ['Autre créneau', id, 5, 'x', 5], [slot, 'repas-absent', 5, 'x', 5], 'texte', null, 7,
    good(6), good(7), good(8), good(9), good(10), good(11),
  ];
  const clean = P.sanitizePlan(raw, { maxTweaks: 5 });
  assert.deepEqual(clean.days[0].tweaks, [good(0), [slot, id, 1, 'x', 12.35], good(6), good(7), good(8)], 'doublon, mal formées et 6ᵉ ligne écartés, grammes arrondis à 0,01');
  assert.deepEqual(P.sanitizePlan(JSON.parse(JSON.stringify(clean)), { maxTweaks: 5 }), clean, 'idempotence');
  assert.equal(P.sanitizePlan(raw, { maxTweaks: 2 }).days[0].tweaks.length, 2);
  assert.equal(P.sanitizePlan(raw).days[0].tweaks.length, 5, 'maxTweaks vaut 5 par défaut');
  const none = JSON.parse(JSON.stringify(base));
  none.days[0].tweaks = [['Autre créneau', id, 5, 'x', 5]];
  assert.ok(!('tweaks' in P.sanitizePlan(none).days[0]), 'clé absente quand il ne reste rien');
  none.days[0].tweaks = [];
  assert.ok(!('tweaks' in P.sanitizePlan(none).days[0]), 'jamais []');
  none.days[0].tweaks = 'x';
  assert.ok(!('tweaks' in P.sanitizePlan(none).days[0]));
  // une retouche ne survit pas à son repas ; un repas retiré garde les siennes
  const removed = JSON.parse(JSON.stringify(base));
  removed.days[0].removed = [[slot, id]];
  removed.days[0].meals = removed.days[0].meals.slice(1);
  removed.days[0].tweaks = [good(0)];
  assert.deepEqual(P.sanitizePlan(removed).days[0].tweaks, [good(0)]);
  removed.days[0].removed = [];
  assert.ok(!('tweaks' in P.sanitizePlan(removed).days[0]));
});

test('sanitizePlan : un planning généré avec retouches se relit à l\'identique (JSON), un planning sans retouche donne la même vue qu\'avant', async () => {
  const w = await world();
  const on = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  for (const seed of SEEDS.slice(0, 10)) {
    const plan = P.generateWeek(on, { seed });
    assert.deepEqual(P.sanitizePlan(JSON.parse(JSON.stringify(plan)), { dayTypeIds: on.config.dayTypes.map((t) => t.id), adjust: on.config.planner.adjust, maxTweaks: 5 }), plan);
    const old = stripTweaks(plan);
    assert.deepEqual(P.viewPlan(tuneCtx(on, false), old), P.viewPlan(on, old), 'planning sans tweaks : même vue avec ou sans le réglage');
    for (const d of P.viewPlan(on, old).days) for (const it of d.items) assert.equal(it.meal, on.mealIdx.get(it.id));
  }
});

test('viewPlan : une retouche hors bornes, d\'un autre aliment, d\'un repas cheat ou d\'une ligne interne est ignorée sans erreur', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  const { plan, i } = tweakedDay(ctx);
  const day = plan.days[i];
  const [slot, id, line, foodId, grams] = day.tweaks[0];
  const l = ctx.mealIdx.get(id).lines[line];
  const view = (tweaks) => P.viewPlan(ctx, { ...plan, days: plan.days.map((d, j) => (j === i ? { ...d, tweaks } : d)) });
  const bare = P.viewPlan(ctx, stripTweaks(plan));
  for (const bad of [[[slot, id, line, foodId, l.qty * 2.01]], [[slot, id, line, foodId, l.qty * 0.49]], [[slot, id, line, 'autre-aliment', grams]], [[slot, id, 99, foodId, grams]], [[slot, id, line, foodId, 'x']]]) {
    assert.deepEqual(view(bad).days[i], bare.days[i], JSON.stringify(bad));
  }
  const edge = view([[slot, id, line, foodId, l.qty * 2]]);
  assert.equal(edge.days[i].items.find((it) => it.id === id && it.slot === slot).tweaks[0].level, 'major');
  const v = view(day.tweaks);
  for (const it of v.days[i].items) if (it.tweaks) for (const t of it.tweaks) assert.ok(Math.abs(t.ratio - 1) > 1e-9);
});

test('viewPlan : le facteur de portion se calcule sur les repas retouchés ; aucun total, facteur ni niveau n\'est stocké', async () => {
  const w = await world();
  const ctx = tuneCtx(plannerCtx(w, FICTIVE_F), true);
  const { plan, i } = tweakedDay(ctx);
  const d = P.viewPlan(ctx, plan).days[i];
  const recipeKcal = d.items.reduce((s, it) => s + ctx.mealIdx.get(it.id).totals.kcal, 0);
  assert.ok(Math.abs(d.totals.kcal - recipeKcal) > 1e-6, 'les totaux suivent les repas retouchés');
  assert.equal(d.base, C.fitFactor(d.basis.kcal, d.budget, ctx.config.planner.step));
  assert.deepEqual(Object.keys(plan.days[i]).sort(), ['adjust', 'dayType', 'label', 'meals', 'removed', 'seed', 'tweaks'], 'le jour ne stocke que des choix');
  for (const t of plan.days[i].tweaks) assert.deepEqual(t.map((v) => typeof v), ['string', 'string', 'number', 'string', 'number']);
});
