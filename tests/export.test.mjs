import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import { BOM, CSV_COLUMNS, buildCsv, csvEscape, csvFileName, ingredientLine, withDe } from '../src/notion-export.js';
import { world } from './helpers.mjs';

/** Mini-parseur CSV (RFC 4180) : guillemets doublés, retours à la ligne entre guillemets. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false; } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\r') { /* ignoré */ } else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  return rows;
}

test('CSV : colonnes exactes et dans l\'ordre attendu', () => {
  assert.deepEqual(CSV_COLUMNS, ['Nom', 'Origine', 'Catégorie', 'Contextes', 'Densité', 'Kcal', 'Protéines (g)', 'Glucides (g)', 'Lipides (g)', 'Fibres (g)', 'Aliments principaux', 'Tags', 'Temps (min)', 'Ingrédients', 'Préparation et variante']);
});

test('CSV : BOM UTF-8, même nombre de colonnes sur chaque ligne, accents et emojis intacts', async () => {
  const w = await world();
  const { csv, rows, excluded } = buildCsv(w.meals);
  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.ok(csv.startsWith(BOM + 'Nom,Origine,'));
  const parsed = parseCsv(csv.slice(1));
  assert.equal(parsed.length, w.meals.length + 1);
  for (const r of parsed) assert.equal(r.length, CSV_COLUMNS.length);
  assert.equal(rows.length, w.meals.length);
  assert.deepEqual(excluded, []);
  assert.match(csv, /🟢 Léger/);
  assert.match(csv, /🟡 Modéré/);
  assert.match(csv, /🔴 Dense/);
  assert.match(csv, /Œufs brouillés pain complet et kiwi/);
  assert.match(csv, /À emporter/);
  assert.ok(csv.includes('\r\n'));
});

test('CSV : valeurs stables (catégories, contextes, tags, densités appartiennent aux listes)', async () => {
  const w = await world();
  const parsed = parseCsv(buildCsv(w.meals).text).slice(1);
  const manual = w.config.manualTags;
  const autos = Object.values(w.config.autoTags).map((t) => t.label);
  for (const r of parsed) {
    assert.ok(w.config.categories.includes(r[2]), r[2]);
    for (const c of r[3].split(', ')) assert.ok(w.config.contexts.includes(c), c);
    assert.ok(w.config.densityLevels.some((l) => `${l.emoji} ${l.label}` === r[4]), r[4]);
    for (const t of r[11].split(', ').filter(Boolean)) assert.ok(manual.includes(t) || autos.some((a) => t === a || t.startsWith(`${a} (`)), t);
    assert.ok(['Recueil', 'Perso'].includes(r[1]));
    for (const k of [5, 6, 7, 8, 9]) assert.ok(/^\d+$/.test(r[k]), `colonne ${k} : ${r[k]}`);
  }
  assert.equal(new Set(parsed.map((r) => r[0])).size, parsed.length, 'le nom est la clé stable : unique');
});

test("CSV : kcal et macros arrondies à l'unité (entiers), cohérentes avec le calcul unique", async () => {
  const w = await world();
  const parsed = parseCsv(buildCsv(w.meals).text).slice(1);
  for (const r of parsed) {
    const m = w.mealIdx.get(w.meals.find((x) => x.name === r[0]).id);
    assert.equal(Number(r[5]), C.roundDisplay(m.totals.kcal));
    assert.equal(Number(r[6]), C.roundDisplay(m.totals.protein));
    assert.equal(Number(r[7]), C.roundDisplay(m.totals.carbs));
    assert.equal(Number(r[8]), C.roundDisplay(m.totals.fat));
    assert.equal(Number(r[9]), C.roundDisplay(m.totals.fiber));
    for (const k of [5, 6, 7, 8, 9]) assert.match(r[k], /^\d+$/, `colonne ${k} : entier sans séparateur décimal`);
  }
});

test('CSV : « Aliments principaux » sans ingrédients internes, ingrédients exacts avec état et astérisque', async () => {
  const w = await world();
  const parsed = parseCsv(buildCsv(w.meals).text).slice(1);
  const pizza = parsed.find((r) => r[0].startsWith('Pizza maison allégée margherita'));
  assert.ok(!/farine|levure/i.test(pizza[10]));
  assert.match(pizza[13], /100 g de farine de blé T150\*/);
  const poulet = parsed.find((r) => r[0].startsWith('Poulet poêlé courgette'));
  assert.ok(poulet[13].split('\n').includes('180 g de filet de poulet entier (cru)*'));
  assert.ok(poulet[13].split('\n').includes("10 g d'huile d'olive*"));
  assert.ok(poulet[13].split('\n').includes('300 ml de thé bio froid et jus de citron'));
  assert.match(poulet[14], /^Préparation : .*\nVariante : /s);
  assert.match(parsed.find((r) => r[0].startsWith('Cheat meal buffet'))[13], /macros estimées/);
});

test('CSV : échappement (guillemets doublés, retours à la ligne, virgules) et ligne par ingrédient', () => {
  assert.equal(csvEscape('simple'), 'simple');
  assert.equal(csvEscape('a,b'), '"a,b"');
  assert.equal(csvEscape('dit "oui"'), '"dit ""oui"""');
  assert.equal(csvEscape('l1\nl2'), '"l1\nl2"');
  const meal = {
    name: 'Test "guillemets", virgule', origin: 'perso', category: 'Dîner', contexts: ['Sortie courte', 'Jour de repos'],
    density: { emoji: '🟡', label: 'Modéré' }, totals: { kcal: 604, protein: 30.4, carbs: 50.5, fat: 10, fiber: 4 },
    mainFoods: ['A', 'B'], tags: ['Chaud'], time: null, prep: 'Étape 1.\nÉtape 2.', variant: 'Autre.', lines: [], cheat: null,
  };
  const { text } = buildCsv([meal]);
  const rows = parseCsv(text);
  assert.equal(rows[1][0], 'Test "guillemets", virgule');
  assert.equal(rows[1][1], 'Perso');
  assert.equal(rows[1][3], 'Sortie courte, Jour de repos');
  assert.equal(rows[1][5], '604');
  assert.equal(rows[1][6], '30');
  assert.equal(rows[1][7], '51');
  assert.equal(rows[1][12], '');
  assert.equal(rows[1][14], 'Préparation : Étape 1.\nÉtape 2.\nVariante : Autre.');
  assert.equal(rows[1].length, CSV_COLUMNS.length);
});

test('CSV : repas perso optionnels, repas incomplets exclus et listés', async () => {
  const w = await world({ deleted: ['banane'] });
  const perso = { ...w.mealIdx.get('col-dattes-amandes').def, id: 'perso-1', name: 'Mon repas', origin: 'perso' };
  const mine = C.resolveMeal(perso, w.ctx);
  const all = [...w.meals, mine];
  const withPerso = buildCsv(all, { includePerso: true });
  const without = buildCsv(all, { includePerso: false });
  assert.ok(withPerso.text.includes('\nMon repas,Perso,'));
  assert.ok(!without.text.includes('Mon repas'));
  assert.ok(withPerso.excluded.length > 5);
  assert.ok(withPerso.excluded.includes('Banane et beurre de cacahuètes'));
  assert.ok(!withPerso.text.includes('\nBanane et beurre de cacahuètes,'));
  assert.equal(parseCsv(withPerso.text).length, all.length - withPerso.excluded.length + 1);
});

test('CSV : le profil et les données personnelles ne sont jamais exportés', async () => {
  const w = await world();
  const { csv } = buildCsv(w.meals);
  assert.ok(!/restingKcal|weightKg|heightCm|longActiveKcal|Mifflin/i.test(csv));
});

test('CSV : nom de fichier daté, élision française', () => {
  assert.equal(csvFileName(new Date(2026, 10, 5)), 'nutricible-notion-2026-11-05.csv');
  assert.equal(withDe('Huile d\'olive'), "d'huile d'olive");
  assert.equal(withDe('Œufs'), "d'œufs");
  assert.equal(withDe('Haricots rouges'), 'de haricots rouges');
  assert.equal(withDe('All-Bran Fibres Plus', true), "d'All-Bran Fibres Plus");
  assert.equal(withDe('Saint-Nectaire', true), 'de Saint-Nectaire');
  assert.equal(ingredientLine({ qty: 0.4, food: { name: 'Vanille', estimated: true, unit: 'g', state: 'tel quel' } }), '0,4 g de vanille*');
});
