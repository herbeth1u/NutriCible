import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilters } from '../src/calc.js';
import * as C from '../src/calc.js';
import * as P from '../src/planner.js';
import { clampFactor, clampOwn, effectiveFactor, emptyDay, itemsFromPlanDay, sanitizeDay, withGlobal, withMeal, withOwn, withoutOwn } from '../src/day.js';
import { tweakedMeal, tweakLimits } from '../src/tweaks.js';
import { TAB_IDS, activeFilterCount, sanitizeFilters, sanitizeFoodFilters, sanitizeTab } from '../src/prefs.js';
import { FICTIVE, FICTIVE_F, near, plannerCtx, tuneCtx, world } from './helpers.mjs';

const TYPES = ['repos', 'courte', 'moyenne', 'longue'];

// ------------------------------------------------------------------ « Ma journée » : facteur global et facteurs propres
test('facteur effectif : le facteur propre l\'emporte, sinon base × global', () => {
  assert.equal(effectiveFactor({ meal: 'a', base: 1 }, 1.25), 1.25);
  assert.equal(effectiveFactor({ meal: 'a', base: 0.75 }, 1.2), 0.9);
  assert.equal(effectiveFactor({ meal: 'a', base: 1, own: 1.5 }, 0.5), 1.5);
  assert.equal(effectiveFactor({ meal: 'a', base: 1 }), 1);
});

test('« le dernier changement l\'emporte » : le curseur global annule les facteurs propres, un facteur propre ne concerne que son repas', () => {
  let day = { ...emptyDay(), items: [{ meal: 'a', base: 1 }, { meal: 'b', base: 1 }, { meal: 'c', base: 0.75 }] };
  const eff = (d) => d.items.map((it) => effectiveFactor(it, d.global));
  day = withOwn(day, 1, 1.5);
  assert.deepEqual(eff(day), [1, 1.5, 0.75]);
  day = withGlobal(day, 1.2); // le global est le dernier changé : tout est remis sur ce facteur
  assert.deepEqual(eff(day), [1.2, 1.2, 0.9]);
  assert.ok(day.items.every((it) => !('own' in it)));
  day = withOwn(day, 0, 2); // puis un repas est réglé : il garde son facteur
  assert.deepEqual(eff(day), [2, 1.2, 0.9]);
  day = withoutOwn(day, 0);
  assert.deepEqual(eff(day), [1.2, 1.2, 0.9]);
});

test('facteurs : bornes du curseur global (0,5 à 2) et du facteur propre (0,1 à 5), arrondi au centième', () => {
  assert.equal(clampFactor(0.2), 0.5);
  assert.equal(clampFactor(3), 2);
  assert.equal(clampFactor(1.234), 1.23);
  assert.equal(clampOwn(0.01), 0.1);
  assert.equal(clampOwn(9), 5);
});

test('« Ma journée » : relecture d\'une journée enregistrée (ancien format migré, valeurs invalides écartées)', () => {
  const legacy = { dayType: 'courte', items: [{ meal: 'a', factor: 1.25 }, { meal: 'b', factor: -1 }, { meal: 3, factor: 1 }, null] };
  assert.deepEqual(sanitizeDay(legacy, TYPES), { dayType: 'courte', global: 1, items: [{ meal: 'a', base: 1.25 }] });
  const cur = { dayType: 'moyenne', global: 1.15, items: [{ meal: 'a', base: 1, own: 1.5 }, { meal: 'b', base: 0.75, own: 'x' }] };
  assert.deepEqual(sanitizeDay(cur, TYPES), { dayType: 'moyenne', global: 1.15, items: [{ meal: 'a', base: 1, own: 1.5 }, { meal: 'b', base: 0.75 }] });
  assert.deepEqual(sanitizeDay({ dayType: 'inconnu', global: 9, items: 'non' }, TYPES), { dayType: 'repos', global: 2, items: [] });
  assert.deepEqual(sanitizeDay('n\'importe quoi', TYPES), emptyDay());
  assert.deepEqual(sanitizeDay(JSON.parse(JSON.stringify(cur)), TYPES), sanitizeDay(cur, TYPES));
});

// ------------------------------------------------------------------ filtres et préférences enregistrés
test('filtres : relecture sûre (valeurs inconnues retirées, nombres et tris validés)', async () => {
  const w = await world();
  const ctx = { config: w.config, foodIds: [...w.foodIdx.keys()] };
  const dirty = {
    q: 'oeufs', categories: ['Dîner', 'Brunch', 3], contexts: ['Sortie courte', 'Jour de fête'], foods: ['saumon', 'aliment-supprimé'],
    foodTypes: ['Légumes', 'Gâteaux'], densities: ['leger', 'enorme'], tags: ['Abats', 'Saisonnier', 'Inconnu'], origins: ['Perso', 'Autre'],
    kcalMin: 300, kcalMax: -5, proteinMin: '40', carbsMin: null, fiberMax: 8, timeMax: 20, sort: 'prix', dir: 5,
  };
  const f = sanitizeFilters(dirty, ctx);
  assert.deepEqual(f.categories, ['Dîner']);
  assert.deepEqual(f.contexts, ['Sortie courte']);
  assert.deepEqual(f.foods, ['saumon']);
  assert.deepEqual(f.foodTypes, ['Légumes']);
  assert.deepEqual(f.densities, ['leger']);
  assert.deepEqual(f.tags, ['Abats', 'Saisonnier']);
  assert.deepEqual(f.origins, ['Perso']);
  assert.equal(f.kcalMin, 300);
  assert.equal(f.kcalMax, null);
  assert.equal(f.proteinMin, null);
  assert.equal(f.fiberMax, 8);
  assert.equal(f.sort, 'name');
  assert.equal(f.dir, 1);
  assert.equal(f.q, 'oeufs');
  assert.deepEqual(sanitizeFilters('n\'importe quoi', ctx), defaultFilters());
  assert.deepEqual(sanitizeFilters(null, ctx), defaultFilters());
});

test('filtres : aller-retour JSON sans perte et nombre de filtres actifs', async () => {
  const w = await world();
  const ctx = { config: w.config, foodIds: [...w.foodIdx.keys()] };
  assert.equal(activeFilterCount(defaultFilters()), 0);
  const f = { ...defaultFilters(), q: ' oeufs ', categories: ['Dîner', 'Déjeuner'], tags: ['Abats'], kcalMax: 600, timeMax: 15, sort: 'kcal', dir: -1 };
  assert.equal(activeFilterCount(f), 5, 'recherche + 2 groupes + 2 curseurs ; le tri ne compte pas');
  assert.deepEqual(sanitizeFilters(JSON.parse(JSON.stringify(f)), ctx), f);
  assert.equal(activeFilterCount({ ...defaultFilters(), q: '   ' }), 0);
});

test('filtres des aliments et onglet actif : relecture sûre', async () => {
  const { config } = await world();
  const f = sanitizeFoodFilters({ q: 'ban', types: ['Fruits et fruits secs', 'Autre'], seasons: ['ete', 'none', 'hiver'], origins: ['Perso', 'Modifié', 'x'], usage: 'unused', sort: 'usage', dir: -1 }, config);
  assert.deepEqual(f, { q: 'ban', types: ['Fruits et fruits secs'], seasons: ['ete', 'none'], origins: ['Perso', 'Modifié'], usage: 'unused', sort: 'usage', dir: -1 });
  assert.deepEqual(sanitizeFoodFilters(undefined, config), { q: '', types: [], seasons: [], origins: [], usage: '', sort: 'name', dir: 1 });
  assert.equal(sanitizeFoodFilters({ sort: 'x', usage: 'y' }, config).sort, 'name');
  for (const t of TAB_IDS) assert.equal(sanitizeTab(t), t);
  assert.equal(sanitizeTab('inconnu'), 'meals');
  assert.equal(sanitizeTab('days'), 'meals'); // onglet « Journées types » supprimé : un onglet enregistré par une ancienne version retombe sur Repas
  assert.ok(!TAB_IDS.includes('days'));
  assert.equal(sanitizeTab(undefined), 'meals');
});

// ------------------------------------------------------------------ « Ma journée » : retouches de quantités
test('retouches de « Ma journée » : valides conservées, invalides et doublons écartés, plafond de 5 lignes sur la journée, clé absente quand vide', () => {
  const it = (meal, tweaks) => ({ meal, base: 1, tweaks });
  const raw = { dayType: 'courte', global: 1, items: [
    it('a', [[0, 'x', 120.456], [0, 'x', 99], [1, 'y', 80], [-1, 'x', 5], [1.5, 'x', 5], [2, '', 5], [3, 'x', 0], [4, 'x', NaN], [5, 'x', '9'], [6, 'x', 20000], 'z', [7, 'x']]),
    it('b', [[0, 'x', 10], [1, 'x', 11], [2, 'x', 12], [3, 'x', 13]]),
    it('c', [[0, 'x', 10]]),
    it('d', []),
    { meal: 'e', base: 1 },
  ] };
  const d = sanitizeDay(raw, TYPES);
  assert.deepEqual(d.items[0].tweaks, [[0, 'x', 120.46], [1, 'y', 80]]);
  assert.deepEqual(d.items[1].tweaks, [[0, 'x', 10], [1, 'x', 11], [2, 'x', 12]], 'au plus 5 lignes sur toute la journée');
  assert.ok(!('tweaks' in d.items[2]), '6ᵉ ligne écartée');
  assert.ok(!('tweaks' in d.items[3]), 'jamais []');
  assert.ok(!('tweaks' in d.items[4]));
  assert.deepEqual(sanitizeDay(JSON.parse(JSON.stringify(d)), TYPES), d, 'idempotence');
  assert.equal(sanitizeDay(raw, TYPES, { maxTweaks: 2 }).items.flatMap((x) => x.tweaks ?? []).length, 2);
  assert.equal(sanitizeDay(raw, TYPES, { maxTweaks: undefined }).items.flatMap((x) => x.tweaks ?? []).length, 5, 'plafond de 5 par défaut');
  assert.deepEqual(sanitizeDay({ dayType: 'courte', items: [{ meal: 'a', base: 1, tweaks: 'non' }] }, TYPES).items, [{ meal: 'a', base: 1 }]);
});

test('retouches de « Ma journée » : withMeal supprime les retouches de l\'item ; withGlobal, withOwn et withoutOwn les conservent', () => {
  const day = { ...emptyDay(), items: [{ meal: 'a', base: 1, tweaks: [[0, 'x', 120]] }, { meal: 'b', base: 1, tweaks: [[1, 'y', 80]] }] };
  const swapped = withMeal(day, 0, 'c');
  assert.deepEqual(swapped.items[0], { meal: 'c', base: 1 });
  assert.deepEqual(swapped.items[1], day.items[1]);
  assert.deepEqual(withMeal({ ...day, items: [{ meal: 'a', base: 1, own: 1.5, tweaks: [[0, 'x', 1]] }] }, 0, 'c').items[0], { meal: 'c', base: 1, own: 1.5 }, 'le facteur propre est gardé');
  assert.deepEqual(withGlobal(day, 1.2).items.map((it) => it.tweaks), [[[0, 'x', 120]], [[1, 'y', 80]]]);
  assert.deepEqual(withOwn(day, 0, 1.5).items[0].tweaks, [[0, 'x', 120]]);
  assert.deepEqual(withoutOwn(withOwn(day, 0, 1.5), 0).items[0].tweaks, [[0, 'x', 120]]);
});

test('« Ajouter à Ma journée » : itemsFromPlanDay reprend les retouches valides et les totaux de Ma journée sont ceux du planning (à 1e-9), avec ou sans retouche', async () => {
  const w = await world();
  const limits = tweakLimits(w.config);
  let withTweaks = 0;
  let without = 0;
  for (const profile of [FICTIVE, FICTIVE_F]) {
    const ctx = tuneCtx(plannerCtx(w, profile), true);
    for (const seed of [1, 7920, 15839, 23758]) {
      for (const c of [ctx, tuneCtx(ctx, false)]) {
        const plan = P.generateWeek(c, { seed });
        const view = P.viewPlan(c, plan);
        view.days.forEach((d, i) => {
          const items = itemsFromPlanDay(d);
          assert.equal(items.length, d.items.filter((it) => it.meal && !it.meal.incomplete).length, 'repas retirés non ajoutés');
          items.forEach((row, k) => { assert.equal(row[1], 1); assert.equal(row.length === 3, !!d.items[k].tweaks?.length, 'troisième élément seulement si retouché'); });
          // même lecture que le store : repas retouché par les retouches de l'item, facteur du jour en facteur global
          const mine = { ...emptyDay(), global: d.factor, items: items.map(([meal, base, tweaks]) => ({ meal, base, ...(tweaks ? { tweaks } : {}) })) };
          const totals = C.dayTotals(mine.items.map((it) => ({ meal: it.meal, factor: effectiveFactor(it, mine.global), resolved: it.tweaks ? tweakedMeal(c.mealIdx.get(it.meal), it.tweaks, limits) : undefined })), c.mealIdx).totals;
          for (const k of C.MACRO_KEYS) near(assert, totals[k], d.adjusted[k], 1e-9);
          if (items.some((r) => r.length === 3)) withTweaks += 1; else without += 1;
          // sans la retouche dans l'item, on retrouverait la recette : les totaux ne coïncideraient plus
          if (items.some((r) => r.length === 3) && d.factor !== 0) {
            const plain = C.dayTotals(mine.items.map((it) => ({ meal: it.meal, factor: effectiveFactor(it, mine.global) })), c.mealIdx).totals;
            assert.ok(Math.abs(plain.kcal - d.adjusted.kcal) > 1e-6);
          }
        });
      }
    }
  }
  assert.ok(withTweaks > 10 && without > 10, `${withTweaks} jours retouchés, ${without} sans retouche`);
});

test('« Ma journée » : replaceInDay (withMeal) supprime les retouches de l\'item remplacé', () => {
  const day = { ...emptyDay(), items: [{ meal: 'a', base: 1, own: 1.2, tweaks: [[0, 'x', 120]] }] };
  const next = withMeal(day, 0, 'variante');
  assert.equal(next.items[0].meal, 'variante');
  assert.ok(!('tweaks' in next.items[0]));
  assert.equal(day.items[0].tweaks.length, 1, 'l\'original n\'est pas modifié');
});
