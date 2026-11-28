import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import * as P from '../src/planner.js';
import { clampFactor, FACTOR_MAX, FACTOR_MIN } from '../src/day.js';
import { FICTIVE, plannerCtx, world } from './helpers.mjs';

// Remplacement d'un seul repas du planificateur : replacePlanMealAt, swapCandidates, swapIssues (classement : tests/swap.test.mjs).
const SEED = 5; // lundi sortie courte, mardi veille de repas plaisir, mercredi cheat meal, jeudi lendemain de repas plaisir…
const codes = (issues) => issues.map((i) => i.code);
const idsOf = (list) => list.map((m) => m.id);
const slotIndex = (plan, di, slot) => plan.days[di].meals.findIndex(([s]) => s === slot);

// Semaine contenant un repas d'abats un jour ouvert autre que le mardi (jour 1). Le tirage dépend des données : on cherche la première graine
// (à partir de SEED) qui convient, au lieu de supposer que SEED en produit une. Renvoie { plan, day, index, id } du repas d'abats.
function weekWithOffal(w, ctx) {
  for (let seed = SEED; seed < SEED + 300; seed++) {
    const plan = P.generateWeek(ctx, { seed });
    for (let day = 0; day < plan.days.length; day++) {
      if (day === 1 || P.isFixedType(w.config, plan.days[day].dayType)) continue;
      const index = plan.days[day].meals.findIndex(([, id]) => P.isOffal(ctx.mealIdx.get(id), w.config));
      if (index >= 0) return { plan, day, index, id: plan.days[day].meals[index][1] };
    }
  }
  throw new Error('aucune semaine avec un repas d\'abats sur 300 graines');
}

// ------------------------------------------------------------------ replacePlanMealAt
test('replacePlanMealAt : garde le créneau, ne touche ni aux autres jours, ni aux repas retirés, ni aux ajustements, ni à l\'original', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  let plan = P.generateWeek(ctx, { seed: SEED });
  plan = P.removeMealAt(plan, 1, 2);
  plan = { ...plan, adjust: 1.1, days: plan.days.map((d, i) => (i === 1 ? { ...d, adjust: 1.2 } : d)) };
  const snap = JSON.stringify(plan);
  const [slot] = plan.days[1].meals[0];
  const next = P.replacePlanMealAt(plan, 1, 0, 'autre-repas');
  assert.equal(JSON.stringify(plan), snap, 'le planning d\'origine ne bouge pas');
  assert.deepEqual(next.days[1].meals[0], [slot, 'autre-repas']);
  assert.deepEqual(next.days[1].meals.slice(1), plan.days[1].meals.slice(1));
  assert.deepEqual(next.days[1].removed, plan.days[1].removed);
  assert.equal(next.days[1].adjust, 1.2);
  assert.equal(next.adjust, 1.1);
  next.days.forEach((d, i) => { if (i !== 1) assert.deepEqual(d, plan.days[i], `jour ${i} inchangé`); });
  assert.deepEqual({ ...next, days: [] }, { ...plan, days: [] });
});

test('replacePlanMealAt : par rang (deux fois le même repas dans un jour), sans effet si rang invalide ou même repas', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: SEED });
  const twice = { ...plan, days: plan.days.map((d, i) => (i === 0 ? { ...d, meals: [['Déjeuner', 'x'], ['Dîner', 'x']] } : d)) };
  assert.deepEqual(P.replacePlanMealAt(twice, 0, 1, 'y').days[0].meals, [['Déjeuner', 'x'], ['Dîner', 'y']]);
  assert.deepEqual(P.replacePlanMealAt(twice, 0, 0, 'y').days[0].meals, [['Déjeuner', 'y'], ['Dîner', 'x']]);
  assert.equal(P.replacePlanMealAt(plan, 0, 99, 'y'), plan);
  assert.equal(P.replacePlanMealAt(plan, 99, 0, 'y'), plan);
  assert.equal(P.replacePlanMealAt(plan, 0, 0, plan.days[0].meals[0][1]), plan);
});

// ------------------------------------------------------------------ swapCandidates
test('swapCandidates : jamais de lait + cacao un jour sans sortie moyenne ou longue', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: SEED });
  const lundi = plan.days[0];
  assert.equal(lundi.dayType, 'courte');
  const at = slotIndex(plan, 0, 'Récupération');
  const accepted = P.contextsFor(w.config, P.dayTypeOf(w.config, lundi.dayType));
  const milkCocoa = w.meals.filter((m) => P.hasMilkCocoa(m, w.config));
  // sans la règle, ces repas passeraient par leurs contextes : le test est donc bien celui de la règle
  assert.ok(milkCocoa.some((m) => m.category === 'Récupération' && m.contexts.some((c) => accepted.includes(c))));
  const cands = idsOf(P.swapCandidates(ctx, plan, 0, at));
  assert.ok(cands.length > 0);
  for (const m of milkCocoa) assert.ok(!cands.includes(m.id), `${m.name} proposé un jour de sortie courte`);
  // tous les jours de toutes les semaines : jamais proposé là où le type de journée ne l'autorise pas
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const p = P.generateWeek(ctx, { seed });
    p.days.forEach((d, di) => {
      if (P.milkCocoaAllowed(w.config, P.dayTypeOf(w.config, d.dayType))) return;
      d.meals.forEach((_, mi) => assert.ok(P.swapCandidates(ctx, p, di, mi).every((m) => !P.hasMilkCocoa(m, w.config)), `${d.label} : lait + cacao proposé`));
    });
  }
});

test('swapCandidates : jamais un second repas d\'abats ; le repas remplacé n\'est pas compté dans le quota', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const offal = (m) => P.isOffal(m, w.config);
  const { plan, day: offalDay, index: at } = weekWithOffal(w, ctx);
  // un autre dîner de la semaine : le quota est atteint, aucun repas d'abats (alors que leurs contextes conviendraient)
  const din = slotIndex(plan, 1, 'Dîner');
  assert.ok(w.meals.some((m) => offal(m) && m.contexts.some((c) => P.contextsFor(w.config, P.dayTypeOf(w.config, plan.days[1].dayType)).includes(c))));
  assert.deepEqual(P.swapCandidates(ctx, plan, 1, din).filter(offal), []);
  // le repas d'abats lui-même : on peut le remplacer par un autre repas d'abats (le sien ne compte pas)
  assert.ok(P.swapCandidates(ctx, plan, offalDay, at).some(offal));
  // jamais deux repas d'abats dans la semaine après un remplacement proposé
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const p = P.generateWeek(ctx, { seed });
    p.days.forEach((d, di) => d.meals.forEach((_, mi) => {
      for (const m of P.swapCandidates(ctx, p, di, mi)) {
        const after = P.replacePlanMealAt(p, di, mi, m.id);
        const n = after.days.flatMap((x) => x.meals).filter(([, id]) => offal(ctx.mealIdx.get(id))).length;
        assert.ok(n <= w.config.planner.rules.maxOffalPerWeek, `${d.label} : ${n} repas d'abats avec ${m.name}`);
      }
    }));
  }
});

test('swapCandidates : sur le jour fixe, seuls les blocs cheat meal ; aucun bloc cheat meal sur un jour ouvert', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: SEED });
  const cheatDay = plan.days.findIndex((d) => P.isFixedType(w.config, d.dayType));
  const cands = P.swapCandidates(ctx, plan, cheatDay, 0);
  const current = plan.days[cheatDay].meals[0][1];
  assert.deepEqual(idsOf(cands), w.meals.filter((m) => m.cheat && m.id !== current).map((m) => m.id));
  assert.ok(cands.every((m) => m.category === 'Repas plaisir' && m.cheat));
  // jour ouvert : aucun bloc cheat meal
  plan.days.forEach((d, di) => {
    if (di !== cheatDay) d.meals.forEach((_, mi) => assert.ok(P.swapCandidates(ctx, plan, di, mi).every((m) => !m.cheat)));
  });
});

test('swapCandidates : exclut seulement le repas actuel ; un repas déjà dans la semaine reste proposé (ingrédients déjà achetés) ; indices invalides : liste vide', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  let inWeek = 0;
  for (const seed of [SEED, 11, 12]) {
    const plan = P.generateWeek(ctx, { seed });
    const all = new Set(plan.days.flatMap((d) => d.meals.map(([, id]) => id)));
    plan.days.forEach((d, di) => d.meals.forEach(([, current], mi) => {
      const cands = P.swapCandidates(ctx, plan, di, mi);
      assert.ok(cands.every((m) => m.id !== current), `${d.label} : le repas actuel est proposé`);
      // un repas déjà dans la semaine (un autre jour, ou un autre créneau du jour) est proposé dès qu'il tient les règles : information seulement
      for (const id of all) {
        const m = ctx.mealIdx.get(id);
        if (id === current || m.incomplete) continue;
        const warned = P.swapIssues(ctx, plan, di, mi, m).some((i) => i.level === 'warn');
        assert.equal(cands.some((c) => c.id === id), !warned, `${d.label} : ${m.name}`);
      }
      inWeek += cands.filter((m) => all.has(m.id)).length;
    }));
  }
  assert.ok(inWeek > 0, 'au moins un repas déjà dans la semaine est proposé');
  const plan = P.generateWeek(ctx, { seed: SEED });
  assert.deepEqual(P.swapCandidates(ctx, plan, 0, 99), []);
  assert.deepEqual(P.swapCandidates(ctx, plan, 99, 0), []);
  // un repas retiré n'est pas compté comme « déjà dans la semaine » (le rétablir ensuite le ferait signaler comme répété)
  const removed = P.removeMealAt(plan, 0, 1);
  assert.ok(P.swapCandidates(ctx, removed, 0, 0).length > 0);
});

test('swapCandidates : ne modifie ni le planning ni le contexte', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const plan = P.generateWeek(ctx, { seed: SEED });
  const snap = JSON.stringify([plan, ctx.targets, ctx.week]);
  P.swapCandidates(ctx, plan, 0, 1);
  P.swapIssues(ctx, plan, 0, 1, w.meals[0]);
  assert.equal(JSON.stringify([plan, ctx.targets, ctx.week]), snap);
});

// ------------------------------------------------------------------ swapIssues
test('swapIssues : les bonnes pastilles (déjà dans la semaine, autre catégorie, contexte, lait + cacao, abats)', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  const { plan, id: rognons } = weekWithOffal(w, ctx);
  const mardiDinner = slotIndex(plan, 1, 'Dîner');
  const meal = (id) => ctx.mealIdx.get(id);
  // le repas d'abats de la semaine (un autre jour que le mardi) proposé le mardi : déjà dans la semaine et second repas d'abats
  assert.deepEqual(P.swapIssues(ctx, plan, 1, mardiDinner, meal(rognons)), [
    { code: 'used', label: 'déjà dans la semaine', level: 'info' }, // information : pas une règle
    { code: 'offal', label: '2e repas d\'abats', level: 'warn' },
  ]);
  // un déjeuner à la place d'un dîner : autre catégorie
  const dej = w.meals.find((m) => m.category === 'Déjeuner' && !plan.days.some((d) => d.meals.some(([, id]) => id === m.id)) && m.contexts.some((c) => P.contextsFor(w.config, P.dayTypeOf(w.config, 'veille-plaisir')).includes(c)));
  assert.deepEqual(P.swapIssues(ctx, plan, 1, mardiDinner, dej), [{ code: 'category', label: 'autre catégorie', level: 'warn' }]);
  // un repas plaisir (pizza) un jour de cheat meal : sa catégorie convient, pas son contexte
  const cheatDay = plan.days.findIndex((d) => P.isFixedType(w.config, d.dayType));
  assert.deepEqual(codes(P.swapIssues(ctx, plan, cheatDay, 0, meal('pla-pizza-margherita'))), ['context']);
  // lait + cacao un jour de sortie courte, à la place de la récupération
  const rec = slotIndex(plan, 0, 'Récupération');
  for (const m of w.meals.filter((x) => P.hasMilkCocoa(x, w.config))) {
    const c = codes(P.swapIssues(ctx, plan, 0, rec, m));
    assert.ok(c.includes('milk-cocoa'), m.name);
    assert.ok(!c.includes('category'), `${m.name} est bien une récupération`);
  }
  assert.deepEqual(P.swapIssues(ctx, plan, 0, rec, null), []);
  assert.deepEqual(P.swapIssues(ctx, plan, 0, 99, meal(rognons)), []);
});

test('swapIssues : le libellé du quota d\'abats suit config.planner.rules.maxOffalPerWeek', async () => {
  const w = await world();
  const offal = w.meals.filter((m) => P.isOffal(m, w.config));
  assert.ok(offal.length >= 3);
  const config = { ...w.config, planner: { ...w.config.planner, rules: { ...w.config.planner.rules, maxOffalPerWeek: 2 } } };
  const ctx = { ...plannerCtx(w), config };
  const plan = P.generateWeek(plannerCtx(w), { seed: SEED });
  const put = (p, di, mi, id) => P.replacePlanMealAt(p, di, mi, id);
  let p = put(plan, 0, slotIndex(plan, 0, 'Dîner'), offal[0].id);
  p = put(p, 1, slotIndex(p, 1, 'Dîner'), offal[1].id);
  const at = slotIndex(p, 3, 'Dîner');
  assert.deepEqual(P.swapIssues(ctx, p, 3, at, offal[2]).map((i) => i.label), ['3e repas d\'abats']);
  // un seul repas d'abats dans la semaine : le quota de 2 n'est pas atteint
  const one = put(plan, 0, slotIndex(plan, 0, 'Dîner'), offal[0].id);
  assert.deepEqual(codes(P.swapIssues(ctx, one, 3, slotIndex(one, 3, 'Dîner'), offal[2])), []);
});

test('swapCandidates et swapIssues disent la même chose : proposé ⇔ complet, pas le repas actuel, aucun avertissement (l\'information « déjà dans la semaine » n\'exclut pas)', async () => {
  const w = await world();
  const ctx = plannerCtx(w);
  for (const seed of [SEED, 11, 12]) {
    const plan = P.generateWeek(ctx, { seed });
    plan.days.forEach((d, di) => d.meals.forEach(([, current], mi) => {
      const expected = w.meals.filter((m) => !m.incomplete && m.id !== current && P.swapIssues(ctx, plan, di, mi, m).every((i) => i.level === 'info')).map((m) => m.id);
      assert.deepEqual(idsOf(P.swapCandidates(ctx, plan, di, mi)), expected, `${d.label}, graine ${seed}`);
    }));
  }
});

// ------------------------------------------------------------------ après un remplacement
test('après un remplacement, viewPlan reste cohérent : budget, facteur borné, apports, liste de courses, retraits et ajustements', async () => {
  const w = await world();
  const ctx = plannerCtx(w, FICTIVE);
  let plan = P.generateWeek(ctx, { seed: SEED });
  plan = P.removeMealAt(plan, 3, 4); // un repas retiré dans un autre jour
  plan = { ...plan, adjust: 1.1, days: plan.days.map((d, i) => (i === 0 ? { ...d, adjust: 1.2 } : d)) };
  const before = P.viewPlan(ctx, plan);
  const at = slotIndex(plan, 0, 'Déjeuner');
  const [to] = P.swapCandidates(ctx, plan, 0, at);
  const next = P.replacePlanMealAt(plan, 0, at, to.id);
  const after = P.viewPlan(ctx, next);
  const d = after.days[0];
  // le créneau et le repas
  assert.equal(d.items[at].slot, 'Déjeuner');
  assert.equal(d.items[at].id, to.id);
  assert.deepEqual(next.days.map((x) => x.removed), plan.days.map((x) => x.removed));
  assert.equal(after.week.adjust, 1.1);
  assert.equal(d.adjust, 1.2);
  // budgets : seuls les kcal du jour fixe les modifient, et le jour fixe n'a pas changé
  assert.deepEqual(after.days.map((x) => x.budget), before.days.map((x) => x.budget));
  // apports du jour = somme des repas × facteur ; facteur recalculé, arrondi au centième et borné
  assert.deepEqual(d.totals, C.sum(d.items.map((it) => it.meal.totals)));
  assert.equal(d.base, C.fitFactor(d.basis.kcal, d.budget, w.config.planner.step));
  assert.equal(d.factor, clampFactor(d.base * d.mult));
  assert.ok(d.factor >= FACTOR_MIN && d.factor <= FACTOR_MAX);
  assert.deepEqual(d.adjusted, C.scale(d.totals, d.factor));
  assert.equal(d.delta, d.adjusted.kcal - d.budget);
  // les autres jours : mêmes repas, mêmes facteurs
  after.days.forEach((x, i) => { if (i !== 0) { assert.deepEqual(x.items.map((it) => it.id), before.days[i].items.map((it) => it.id)); assert.equal(x.factor, before.days[i].factor); } });
  // liste de courses : les aliments du nouveau repas y sont, ceux de l'ancien repas qui ne servent plus ailleurs n'y sont plus
  const inList = (view) => new Set(view.shopping.groups.flatMap((g) => g.items.map((e) => e.id)));
  const foodsOf = (m) => m.lines.filter((l) => !l.missing && l.food).map((l) => l.id);
  const old = ctx.mealIdx.get(plan.days[0].meals[at][1]);
  const others = new Set(after.days.flatMap((x) => x.items.filter((it) => it.id !== to.id).flatMap((it) => (it.meal ? foodsOf(it.meal) : []))));
  for (const id of foodsOf(to)) assert.ok(inList(after).has(id), `${id} manque dans la liste de courses`);
  for (const id of foodsOf(old)) if (!others.has(id) && !foodsOf(to).includes(id)) assert.ok(!inList(after).has(id), `${id} reste dans la liste de courses`);
});

test('après un remplacement, un repas signalé donne l\'avertissement habituel de auditPlan', async () => {
  const w = await world();
  const ctx = plannerCtx(w, FICTIVE);
  const plan = P.generateWeek(ctx, { seed: SEED });
  const rec = slotIndex(plan, 0, 'Récupération');
  const milkCocoa = w.meals.find((m) => P.hasMilkCocoa(m, w.config) && m.category === 'Récupération');
  const view = P.viewPlan(ctx, P.replacePlanMealAt(plan, 0, rec, milkCocoa.id));
  assert.ok(view.warnings.some((x) => x.code === 'milk-cocoa' && x.day === plan.days[0].label));
  // un repas déjà présent ailleurs (2 fois, sous le plafond) : une répétition normale, aucune information ni avertissement
  const dejMardi = plan.days[1].meals[slotIndex(plan, 1, 'Déjeuner')][1];
  const rep = P.viewPlan(ctx, P.replacePlanMealAt(plan, 0, slotIndex(plan, 0, 'Déjeuner'), dejMardi));
  assert.ok(!rep.warnings.some((x) => x.code === 'repeat'), 'l\'information « repeat » n\'existe plus');
  assert.ok(!rep.warnings.some((x) => x.code === 'repeat-cap'));
  assert.ok(rep.warnings.filter((x) => x.level === 'warn').every((x) => P.viewPlan(ctx, plan).warnings.some((b) => b.code === x.code && b.day === x.day)), 'aucun avertissement nouveau');
  // une 3e occurrence dépasse le plafond : information « repeat-cap » (niveau `info`)
  const third = P.replacePlanMealAt(P.replacePlanMealAt(plan, 0, slotIndex(plan, 0, 'Déjeuner'), dejMardi), 3, slotIndex(plan, 3, 'Déjeuner'), dejMardi);
  const cap = P.viewPlan(ctx, third).warnings.filter((x) => x.code === 'repeat-cap');
  assert.equal(cap.length, 1);
  assert.equal(cap[0].level, 'info');
  assert.equal(cap[0].day, null);
  // un autre créneau : l'avertissement habituel « catégorie » apparaît dans le planning, au jour concerné
  const mardiDinner = slotIndex(plan, 1, 'Dîner');
  const dej = w.meals.find((m) => m.category === 'Déjeuner' && !plan.days.some((d) => d.meals.some(([, id]) => id === m.id)));
  const cat = P.viewPlan(ctx, P.replacePlanMealAt(plan, 1, mardiDinner, dej.id)).warnings.filter((x) => x.code === 'category');
  assert.equal(cat.length, 1);
  assert.equal(cat[0].level, 'warn');
  assert.equal(cat[0].day, plan.days[1].label);
  assert.match(cat[0].text, new RegExp(`« ${dej.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} » est un repas « Déjeuner » placé sur le créneau « Dîner »`));
  assert.ok(!P.viewPlan(ctx, plan).warnings.some((x) => x.code === 'category'), 'un tirage ne produit jamais cet avertissement');
  // un remplacement proposé ne crée aucun avertissement alimentaire nouveau (seule l'information « déjà dans la semaine » peut apparaître)
  const base = new Set(P.viewPlan(ctx, plan).warnings.map((x) => x.code + x.day));
  plan.days.forEach((d, di) => d.meals.forEach((_, mi) => {
    for (const cand of P.swapCandidates(ctx, plan, di, mi).slice(0, 6)) {
      for (const x of P.viewPlan(ctx, P.replacePlanMealAt(plan, di, mi, cand.id)).warnings) {
        if (['kcal-gap', 'floor'].includes(x.code)) continue; // l'écart de budget dépend des portions, pas d'une règle alimentaire
        if (x.level === 'info') { assert.equal(x.code, 'repeat-cap'); continue; }
        assert.ok(base.has(x.code + x.day), `${d.label} : avertissement « ${x.code} » après remplacement par ${cand.name}`);
      }
    }
  }));
});
