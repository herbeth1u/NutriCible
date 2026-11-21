import test from 'node:test';
import assert from 'node:assert/strict';
import { APP, FORMAT, backupFileName, emptyUser, mergeBackup, migrate, parseBackup, sanitizeUser, serialize } from '../src/backup.js';
import { FICTIVE } from './helpers.mjs';

const food = (id, name, kcal = 100) => ({ id, name, type: 'Autres', state: 'tel quel', unit: 'g', per100: { kcal, protein: 5, carbs: 10, fat: 2, fiber: 1 }, estimated: false });
const meal = (id, name, items = [['banane', 100]]) => ({ id, name, category: 'Collation', contexts: ['Jour de repos'], tags: [], time: 5, notes: '', prep: 'p', variant: 'v', items, internal: [] });
const user = (o = {}) => ({ ...emptyUser(), ...o });

test('sauvegarde : aller-retour sans perte (profil fictif, repas et aliments perso, modifications)', () => {
  const u = user({
    profile: { ...FICTIVE },
    foods: [food('perso-f1', 'Mon aliment')],
    meals: [meal('perso-m1', 'Mon repas', [['perso-f1', 50], ['banane', 100]])],
    foodEdits: { banane: { per100: { kcal: 100, protein: 1, carbs: 22, fat: 0.2, fiber: 2 }, note: 'modifié' } },
    deletedFoods: ['kiwi'],
    replacements: { 'col-fb-noix-miel': { noix: 'amandes' } },
  });
  const r = parseBackup(serialize(u, new Date('2026-11-20T10:00:00Z')));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, u);
  assert.equal(r.exportedAt, '2026-11-20T10:00:00.000Z');
});

test('sauvegarde : le fichier est identifié et nommé avec la date', () => {
  const f = JSON.parse(serialize(emptyUser()));
  assert.equal(f.app, APP);
  assert.equal(f.format, FORMAT);
  assert.equal(backupFileName(new Date(2026, 10, 5)), 'nutricible-sauvegarde-2026-11-05.json');
});

test('restauration : fichiers invalides refusés avec un message clair', () => {
  assert.match(parseBackup('pas du json').error, /JSON valide/);
  assert.match(parseBackup('{"app":"Autre","format":1,"data":{}}').error, /pas une sauvegarde NutriCible/);
  assert.match(parseBackup('[]').error, /pas une sauvegarde NutriCible/);
  assert.match(parseBackup(JSON.stringify({ app: APP, format: FORMAT + 1, data: {} })).error, /version plus récente/);
});

test('restauration : nettoyage des types et des clés inconnues', () => {
  const dirty = {
    profile: { sex: 'X', age: '30', heightCm: 180, weightKg: -1, pirate: true },
    meals: [meal('m', 'Ok'), { id: 'x' }, null, { ...meal('m2', 'Avec items'), items: [['banane', 'beaucoup'], ['kiwi', 50], [3, 4]] }],
    foods: [food('f', 'Ok'), { id: 'z' }, { ...food('f2', 'Neg'), per100: { kcal: -5, protein: 'a' } }],
    foodEdits: { banane: { name: 'B', hack: 1, per100: { kcal: 5 } }, kiwi: 'non' },
    deletedFoods: ['a', 3, null],
    replacements: { m: { a: 'b', c: 3 }, n: 'non' },
  };
  const u = sanitizeUser(dirty);
  assert.equal(u.profile.sex, '');
  assert.equal(u.profile.age, null);
  assert.equal(u.profile.heightCm, 180);
  assert.ok(!('pirate' in u.profile));
  assert.deepEqual(u.meals.map((m) => m.id), ['m', 'm2']);
  assert.deepEqual(u.meals[1].items, [['kiwi', 50]]);
  assert.deepEqual(u.foods.map((f) => f.id), ['f', 'f2']);
  assert.deepEqual(u.foods[1].per100, { kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 });
  assert.deepEqual(Object.keys(u.foodEdits), ['banane']);
  assert.ok(!('hack' in u.foodEdits.banane));
  assert.deepEqual(u.deletedFoods, ['a']);
  assert.deepEqual(u.replacements, { m: { a: 'b' } });
  assert.deepEqual(sanitizeUser('n\'importe quoi'), emptyUser());
});

test('migrations : un ancien format (0) est amené au format courant', () => {
  const old = { app: APP, data: { profile: {}, meals: [], foods: [] } };
  const data = migrate(old);
  assert.deepEqual(data.replacements, {});
  const r = parseBackup(JSON.stringify(old));
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, emptyUser());
});

test('fusion : tout remplacer', () => {
  const cur = user({ meals: [meal('a', 'A')] });
  const inc = user({ meals: [meal('b', 'B')] });
  const { user: out } = mergeBackup(cur, inc, 'replace-all');
  assert.deepEqual(out.meals.map((m) => m.id), ['b']);
});

test('fusion : conflits de nom — garder l\'existant, remplacer, ou renommer', () => {
  const cur = user({ meals: [meal('a', 'Mon repas', [['kiwi', 10]])], foods: [food('f1', 'Mon aliment', 100)] });
  const inc = user({ meals: [meal('b', 'mon REPAS', [['banane', 99]]), meal('c', 'Nouveau')], foods: [food('f9', 'Mon aliment', 200), food('f8', 'Autre', 50)] });

  const keep = mergeBackup(cur, inc, 'keep');
  assert.deepEqual(keep.user.meals.map((m) => m.name), ['Mon repas', 'Nouveau']);
  assert.deepEqual(keep.user.meals[0].items, [['kiwi', 10]]);
  assert.equal(keep.user.foods.find((f) => f.id === 'f1').per100.kcal, 100);
  assert.equal(keep.report.skippedMeals, 1);
  assert.equal(keep.report.addedMeals, 1);
  assert.equal(keep.report.skippedFoods, 1);

  const rep = mergeBackup(cur, inc, 'replace');
  assert.equal(rep.user.meals.length, 2);
  assert.deepEqual(rep.user.meals.find((m) => m.id === 'a').items, [['banane', 99]]);
  assert.equal(rep.user.foods.find((f) => f.id === 'f1').per100.kcal, 200);
  assert.equal(rep.report.replacedMeals, 1);

  const ren = mergeBackup(cur, inc, 'rename');
  assert.equal(ren.user.meals.length, 3);
  assert.ok(ren.user.meals.some((m) => m.name === 'mon REPAS (importé)'));
  assert.equal(new Set(ren.user.meals.map((m) => m.id)).size, 3);
  assert.equal(ren.user.foods.length, 3);
  assert.equal(ren.report.renamedMeals, 1);
  assert.equal(ren.report.renamedFoods, 1);
});

test('fusion : les repas importés suivent les aliments perso renommés ou fusionnés', () => {
  const cur = user({ foods: [food('f1', 'Mon aliment')] });
  const inc = user({ foods: [food('f9', 'Mon aliment')], meals: [meal('m', 'Repas', [['f9', 40]])] });
  assert.deepEqual(mergeBackup(cur, inc, 'keep').user.meals[0].items, [['f1', 40]]);
  const ren = mergeBackup(cur, inc, 'rename').user;
  const copy = ren.foods.find((f) => f.name === 'Mon aliment (importé)');
  assert.deepEqual(ren.meals[0].items, [[copy.id, 40]]);
});

test('fusion : un nom déjà pris par le recueil force le renommage', () => {
  const cur = user();
  const inc = user({ foods: [food('f', 'Banane')], meals: [meal('m', 'Porridge copieux banane chia et noix')] });
  const reserved = { foods: new Set(['banane']), meals: new Set(['porridge copieux banane chia et noix']) };
  const { user: out, report } = mergeBackup(cur, inc, 'keep', reserved);
  assert.equal(out.foods[0].name, 'Banane (importé)');
  assert.equal(out.meals[0].name, 'Porridge copieux banane chia et noix (importé)');
  assert.equal(report.renamedFoods, 1);
});

test('fusion : modifications, suppressions, remplacements et profil', () => {
  const cur = user({ profile: { ...FICTIVE, age: 31 }, foodEdits: { banane: { note: 'a' } }, deletedFoods: ['kiwi'], replacements: { m1: { a: 'b' } } });
  const inc = user({ profile: { ...FICTIVE, age: 40, weightMinKg: 70 }, foodEdits: { banane: { note: 'b' }, dattes: { note: 'c' } }, deletedFoods: ['kiwi', 'melon'], replacements: { m1: { a: 'z', c: 'd' } } });
  const keep = mergeBackup(cur, inc, 'keep').user;
  assert.equal(keep.foodEdits.banane.note, 'a');
  assert.equal(keep.foodEdits.dattes.note, 'c');
  assert.deepEqual(keep.deletedFoods.sort(), ['kiwi', 'melon']);
  assert.deepEqual(keep.replacements.m1, { a: 'b', c: 'd' });
  assert.equal(keep.profile.age, 31);
  assert.equal(keep.profile.weightMinKg, 70, 'les champs vides sont complétés');
  const rep = mergeBackup(cur, inc, 'replace').user;
  assert.equal(rep.foodEdits.banane.note, 'b');
  assert.deepEqual(rep.replacements.m1, { a: 'z', c: 'd' });
  assert.equal(rep.profile.age, 40);
});

test('fusion : ne modifie pas les objets passés en paramètre', () => {
  const cur = user({ meals: [meal('a', 'A')] });
  const inc = user({ meals: [meal('b', 'A')] });
  const snapshot = JSON.stringify([cur, inc]);
  mergeBackup(cur, inc, 'replace');
  mergeBackup(cur, inc, 'rename');
  assert.equal(JSON.stringify([cur, inc]), snapshot);
});
