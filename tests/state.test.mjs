import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultFilters } from '../src/calc.js';
import { clampFactor, clampOwn, effectiveFactor, emptyDay, sanitizeDay, withGlobal, withOwn, withoutOwn } from '../src/day.js';
import { TAB_IDS, activeFilterCount, sanitizeFilters, sanitizeFoodFilters, sanitizeTab } from '../src/prefs.js';
import { world } from './helpers.mjs';

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
  assert.equal(sanitizeTab(undefined), 'meals');
});
