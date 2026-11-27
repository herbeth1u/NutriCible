import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/calc.js';
import { FICTIVE, FICTIVE_F, near, world } from './helpers.mjs';

// ------------------------------------------------------------------ macros et arrondis
test('macros : scale, add, sum', () => {
  const a = { kcal: 100, protein: 10, carbs: 20, fat: 5, fiber: 2 };
  assert.deepEqual(C.scale(a, 2), { kcal: 200, protein: 20, carbs: 40, fat: 10, fiber: 4 });
  assert.deepEqual(C.add(a, a), C.scale(a, 2));
  assert.deepEqual(C.sum([a, a, a]), C.scale(a, 3));
  assert.deepEqual(C.sum([]), C.zero());
});

const flat = (s) => s.replace(/\s/g, ' '); // espaces insécables → espace

test("arrondis : kcal et macros à l'unité, quantités", () => {
  assert.equal(C.fmtInt(487.9), '488');
  assert.equal(C.fmtInt(487.4), '487');
  assert.equal(C.fmtInt(-0.4), '0');
  assert.equal(flat(C.fmtInt(1234.5)), '1 235');
  assert.equal(C.fmtKcal(487.9), C.fmtInt(487.9));
  assert.equal(C.fmtG(12.5), '13');
  assert.ok(Object.is(C.roundDisplay(-0.4), 0), 'jamais −0');
  assert.equal(C.roundDisplay(504.2), 504);
  assert.equal(C.fmtSigned(12.4), '+12');
  assert.equal(C.fmtSigned(-12.4), '-12');
  assert.equal(C.fmtSigned(0.3), '0');
  assert.equal(C.fmtSigned(-0.3), '0');
  assert.equal(flat(C.fmtSigned(1234.5)), '+1 235');
  assert.equal(C.roundKcal, undefined);
  assert.equal(C.roundG, undefined);
  assert.equal(C.fmtQty(0.4), '0,4');
  assert.equal(C.fmtQty(23.7), '24');
  assert.equal(C.fmtQty(120), '120');
});

test("calculs : jamais d'arrondi intermédiaire", async () => {
  const w = await world();
  const m = w.mealIdx.get('col-banane-beurre-cacahuetes');
  const expected = (120 * 94 + 15 * 610) / 100;
  near(assert, m.totals.kcal, expected);
});

// ------------------------------------------------------------------ cru / cuit
const pates = { id: 'p', name: 'Pâtes', state: 'cuit', coef: 2.4, per100: { kcal: 145, protein: 5.6, carbs: 27, fat: 1, fiber: 4.2 } };
const poulet = { id: 'c', name: 'Poulet', state: 'cru', coef: 0.75, per100: { kcal: 108, protein: 22.5, carbs: 0.1, fat: 1.8, fiber: 0 } };

test('cru/cuit : conversion des quantités dans les deux sens', () => {
  near(assert, C.convertQty(pates, 240, 'cuit', 'cru'), 100);
  near(assert, C.convertQty(pates, 100, 'cru', 'cuit'), 240);
  near(assert, C.convertQty(poulet, 100, 'cru', 'cuit'), 75);
  near(assert, C.convertQty(poulet, 75, 'cuit', 'cru'), 100);
  assert.equal(C.convertQty({ ...pates, coef: undefined }, 100, 'cuit', 'cru'), 100); // pas ⇄ : inchangé
});

test('cru/cuit : valeurs pour 100 g dérivées par le coefficient', () => {
  const raw = C.per100In(pates, 'cru');
  near(assert, raw.kcal, 145 * 2.4);
  assert.equal(C.per100In(pates, 'cuit'), pates.per100);
  const cooked = C.per100In(poulet, 'cuit');
  near(assert, cooked.protein, 22.5 / 0.75);
  // aller-retour : saisir dans l'autre état puis revenir à l'état de référence
  const back = C.per100ToRef(pates, 'cru', raw);
  near(assert, back.kcal, pates.per100.kcal);
  near(assert, back.fiber, pates.per100.fiber);
});

test('cru/cuit : les macros ne changent pas quel que soit l\'état affiché (tous les aliments ⇄)', async () => {
  const w = await world();
  let n = 0;
  for (const f of w.foodIdx.values()) {
    if (!f.convertible) continue;
    n += 1;
    const other = C.otherState(f.state);
    const qty = 137;
    const a = C.scale(f.per100, qty / 100);
    const b = C.scale(C.per100In(f, other), C.convertQty(f, qty, f.state, other) / 100);
    for (const k of C.MACRO_KEYS) near(assert, a[k], b[k], 1e-9);
  }
  assert.ok(n >= 15, `${n} aliments ⇄ attendus`);
});

test('cru/cuit : « surgelé » est le côté cru (aliment ⇄ dont l\'état de référence est surgelé)', async () => {
  const w = await world();
  const m = w.foodIdx.get('melange-mangue-ananas-surgele');
  assert.ok(m.convertible, 'mélange surgelé ⇄');
  assert.equal(m.state, 'surgelé');
  assert.equal(C.weighState(m), 'cru', 'pesé surgelé = côté cru');
  assert.equal(C.otherState('surgelé'), 'cuit');
  assert.equal(C.otherState('cuit'), 'cru');
  // surgelé → cuit : le poids est multiplié par coef ; surgelé ↔ cru : aucune conversion
  near(assert, C.convertQty(m, 100, 'surgelé', 'cuit'), 100 * m.coef);
  near(assert, C.convertQty(m, 100 * m.coef, 'cuit', 'surgelé'), 100);
  near(assert, C.convertQty(m, 100, 'surgelé', 'cru'), 100);
  assert.equal(C.per100In(m, 'cru'), m.per100);
  assert.equal(C.per100In(m, 'surgelé'), m.per100);
  // les valeurs pour 100 g cuit sont plus concentrées ; la portion garde les mêmes macros
  const cuit = C.per100In(m, 'cuit');
  near(assert, cuit.kcal, m.per100.kcal / m.coef);
  const a = C.scale(m.per100, 150 / 100);
  const b = C.scale(cuit, C.convertQty(m, 150, 'surgelé', 'cuit') / 100);
  for (const k of C.MACRO_KEYS) near(assert, a[k], b[k], 1e-9);
  const back = C.per100ToRef(m, 'cuit', cuit);
  for (const k of C.MACRO_KEYS) near(assert, back[k], m.per100[k], 1e-9);
  assert.equal(C.stateLabel(m, 'cru'), 'surgelé');
  assert.equal(C.stateLabel(m, 'cuit'), 'cuit');
  assert.equal(C.stateLabel(w.foodIdx.get('pomme'), 'cru'), 'cru');
  // les fruits surgelés existants (non ⇄) ne sont pas touchés
  assert.equal(w.foodIdx.get('fraises-surgelees').convertible, false);
  assert.equal(C.isConvertible({ state: 'surgelé', coef: 0.8 }), true);
  assert.equal(C.isConvertible({ state: 'surgelé' }), false);
  assert.equal(C.isConvertible({ state: 'égoutté', coef: 0.8 }), false);
});

test('cru/cuit : une modification utilisateur des valeurs garde coef, pesée et état surgelé', async () => {
  const w = await world({ edits: { 'melange-mangue-ananas-surgele': { per100: { kcal: 60, protein: 0.6, carbs: 12, fat: 0.5, fiber: 1.5 } }, pomme: { note: 'ma note' } } });
  const m = w.foodIdx.get('melange-mangue-ananas-surgele');
  assert.equal(m.per100.kcal, 60);
  assert.equal(m.state, 'surgelé');
  assert.equal(m.coef, 0.8);
  assert.equal(m.weigh, 'cru');
  assert.equal(m.convertible, true);
  const p = w.foodIdx.get('pomme');
  assert.equal(p.note, 'ma note');
  assert.ok(p.coef > 0 && p.season === 'automne-hiver' && p.portion.g === 150);
});

test('cru/cuit : un repas garde les mêmes totaux, ligne par ligne', async () => {
  const w = await world();
  const m = w.mealIdx.get('din-poulet-courgette-champignons');
  let total = C.zero();
  for (const l of m.lines) {
    const f = l.food;
    const state = f.convertible ? C.otherState(f.state) : f.state;
    const q = C.convertQty(f, l.qty, f.state, state);
    total = C.add(total, C.scale(C.per100In(f, state), q / 100));
  }
  for (const k of C.MACRO_KEYS) near(assert, total[k], m.totals[k], 1e-9);
});

test('Ma journée : portions et bascule cru/cuit, les totaux ne changent pas', async () => {
  const w = await world();
  const items = [{ meal: 'din-poulet-courgette-champignons', factor: 1.25 }, { meal: 'din-saumon-butternut-riz', factor: 0.75 }];
  const ref = C.dayTotals(items, w.mealIdx).totals;
  let total = C.zero();
  for (const it of items) {
    for (const l of w.mealIdx.get(it.meal).lines) {
      const f = l.food;
      const state = f.convertible ? C.otherState(f.state) : f.state; // état opposé affiché
      total = C.add(total, C.scale(C.per100In(f, state), C.convertQty(f, l.qty * it.factor, f.state, state) / 100));
    }
  }
  for (const k of C.MACRO_KEYS) near(assert, total[k], ref[k], 1e-9);
});

// ------------------------------------------------------------------ aliments composés
test('aliment composé : valeurs calculées depuis la recette (pain T150, confiture)', async () => {
  const w = await world();
  const pain = w.foodIdx.get('pain-complet-maison');
  assert.equal(pain.composed, true);
  const farine = w.internalIdx.get('i-farine-t150').per100;
  const levure = w.internalIdx.get('i-levure-seche').per100;
  const miel = w.foodIdx.get('miel').per100;
  near(assert, pain.per100.kcal, 0.65 * farine.kcal + 0.0075 * levure.kcal + 0.003 * miel.kcal, 1e-9);
  const conf = w.foodIdx.get('confiture-maison');
  near(assert, conf.per100.carbs, 30 + 0.7 * w.internalIdx.get('i-quetsche-mirabelle').per100.carbs, 1e-9);
});

test('aliment composé : une modification crée une surcharge réinitialisable', async () => {
  const w = await world();
  const calc = w.foodIdx.get('pain-complet-maison').per100;
  const over = await world({ edits: { 'pain-complet-maison': { per100: { kcal: 250, protein: 9, carbs: 45, fat: 2, fiber: 6 } } } });
  const f = over.foodIdx.get('pain-complet-maison');
  assert.equal(f.modified, true);
  assert.equal(f.per100.kcal, 250);
  assert.equal(f.calcPer100.kcal, calc.kcal);
  const reset = await world({ edits: {} });
  assert.equal(reset.foodIdx.get('pain-complet-maison').per100.kcal, calc.kcal);
});

test('ingrédients internes : absents de l\'index des aliments visibles', async () => {
  const w = await world();
  for (const id of w.foodIdx.keys()) assert.ok(!id.startsWith('i-'), id);
  const cheesecake = w.mealIdx.get('pla-cheesecake-allege');
  assert.ok(cheesecake.lines.some((l) => l.kind === 'internal'));
  assert.ok(!cheesecake.mainFoods.some((n) => /biscoff/i.test(n)), 'les ingrédients internes ne sont pas des aliments principaux');
});

// ------------------------------------------------------------------ modification d'un aliment : tout suit
test('modifier un aliment met à jour repas, densité et tags sans stockage de total', async () => {
  const before = await world();
  const after = await world({ edits: { banane: { per100: { kcal: 940, protein: 10, carbs: 205, fat: 2, fiber: 21 } } } });
  const id = 'pdj-bol-muesli-chocolat-banane';
  assert.ok(after.mealIdx.get(id).totals.kcal > before.mealIdx.get(id).totals.kcal + 800);
  assert.notEqual(after.mealIdx.get(id).density.id, before.mealIdx.get(id).density.id);
  assert.ok(after.mealIdx.get(id).tags.includes('Riche en fibres'));
  assert.equal(before.meals.length, after.meals.length);
});

test('foodImpact : liste les repas concernés, kcal avant/après et changements de densité', async () => {
  const w = await world();
  const edited = await world({ edits: { banane: { per100: { kcal: 188, protein: 2, carbs: 41, fat: 0.4, fiber: 4.2 } } } });
  const defs = w.meals.map((m) => m.def);
  const impact = C.foodImpact('banane', w.foodIdx, edited.foodIdx, defs, w.config, w.internal, {});
  assert.ok(impact.length >= 10);
  assert.ok(impact.every((i) => i.after > i.before));
  assert.ok(impact.some((i) => i.densityBefore.id !== i.densityAfter.id));
});

test('suppression : repas incomplet, puis remplacement par un autre aliment', async () => {
  const gone = await world({ deleted: ['banane'] });
  const m = gone.mealIdx.get('col-banane-beurre-cacahuetes');
  assert.equal(m.incomplete, true);
  assert.equal(m.lines.find((l) => l.missing).missingId, 'banane');
  const repl = await world({ deleted: ['banane'], repl: { 'col-banane-beurre-cacahuetes': { banane: 'kiwi' } } });
  const r = repl.mealIdx.get('col-banane-beurre-cacahuetes');
  assert.equal(r.incomplete, false);
  assert.ok(r.lines.some((l) => l.id === 'kiwi' && l.qty === 120), 'même quantité');
});

test('un repas perso est résolu par la même fonction que le recueil', async () => {
  const w = await world();
  const def = { ...w.mealIdx.get('din-saumon-butternut-riz').def };
  const a = C.resolveMeal({ ...def, origin: 'recueil' }, w.ctx);
  const b = C.resolveMeal({ ...def, origin: 'perso' }, w.ctx);
  assert.deepEqual(a.totals, b.totals);
  assert.deepEqual(a.tags, b.tags);
  assert.equal(a.density.id, b.density.id);
  assert.equal(b.origin, 'perso');
});

test('aucun total stocké dans les données (hors bloc cheat meal)', async () => {
  const w = await world();
  for (const m of w.meals) {
    for (const k of ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'totals']) assert.ok(!(k in m.def), `${m.id}.${k}`);
    if (m.cheat) assert.ok(m.cheat.kcal >= 2500);
  }
});

// ------------------------------------------------------------------ densité et tags
test('densité : seuils propres à chaque catégorie', async () => {
  const { config } = await world();
  assert.equal(C.densityOf(520, 'Collation', config).id, 'dense');
  assert.equal(C.densityOf(520, 'Déjeuner', config).id, 'modere');
  assert.equal(C.densityOf(520, 'Dîner', config).id, 'leger');
  assert.equal(C.densityOf(500, 'Déjeuner', config).id, 'leger');
  assert.equal(C.densityOf(500.4, 'Déjeuner', config).id, 'leger'); // comparé à la valeur affichée (500)
  assert.equal(C.densityOf(504, 'Déjeuner', config).id, 'modere'); // affichée : 504
  assert.equal(C.densityOf(506, 'Déjeuner', config).id, 'modere');
  assert.equal(C.densityOf(3000, 'Repas plaisir', config).emoji, '🔴');
  assert.equal(C.densityOf(100, 'Récupération', config).emoji, '🟢');
});

test('tags automatiques : OK avant effort, protéines, fibres, saisonnier', async () => {
  const { config } = await world();
  const t = (o, seasons = [], cat = 'Déjeuner') => C.autoTags({ kcal: 500, protein: 10, carbs: 50, fat: 10, fiber: 2, ...o }, seasons, cat, config);
  assert.deepEqual(t({}), ['OK avant effort']);
  assert.ok(t({ fiber: 6 }).includes('OK avant effort'));
  assert.ok(t({ fiber: 6.4 }).includes('OK avant effort')); // affichée « 6 »
  assert.ok(!t({ fiber: 6.5 }).includes('OK avant effort')); // affichée « 7 »
  assert.ok(!t({}, [], 'Récupération').includes('OK avant effort'));
  assert.ok(t({ protein: 25 }).includes('Riche en protéines'));
  assert.ok(t({ protein: 24.6 }).includes('Riche en protéines')); // affichée « 25 »
  assert.ok(!t({ protein: 24.4 }).includes('Riche en protéines')); // affichée « 24 »
  assert.ok(t({ fiber: 10 }).includes('Riche en fibres'));
  assert.ok(t({}, ['ete']).includes('Saisonnier (été)'));
  assert.ok(t({}, ['automne-hiver']).includes('Saisonnier (automne-hiver)'));
});

test('tag Saisonnier : calculé depuis les aliments à saison (recueil)', async () => {
  const w = await world();
  assert.ok(w.mealIdx.get('dej-ete-melon-poulet').tags.includes('Saisonnier (été)'));
  assert.ok(w.mealIdx.get('din-dinde-curry-potimarron').tags.includes('Saisonnier (automne-hiver)'));
  assert.ok(!w.mealIdx.get('dej-concombre-pois-chiches-thon').tags.some((x) => x.startsWith('Saisonnier')));
});

test('cheat meal : bloc unique aux macros stockées, sans tags automatiques', async () => {
  const w = await world();
  const c = w.mealIdx.get('pla-cheat-buffet');
  assert.equal(c.totals.kcal, 3000);
  assert.equal(c.lines.length, 0);
  assert.equal(c.autoTags.length, 0);
  assert.equal(c.density.id, 'dense');
  assert.equal(c.estimated, true);
});

test('avertissement kcal/macros : non bloquant, désactivable', async () => {
  const w = await world();
  assert.ok(C.kcalWarning({ kcal: 100, protein: 1, carbs: 6, fat: 0, fiber: 3 }, w.config, {}), 'étiquette incohérente signalée');
  assert.equal(C.kcalWarning(w.foodIdx.get('fruits-rouges-surgeles').per100, w.config, w.foodIdx.get('fruits-rouges-surgeles')), null, 'fruits rouges surgelés : kcal cohérentes avec les macros');
  assert.equal(C.kcalWarning(w.foodIdx.get('electrolytes').per100, w.config, w.foodIdx.get('electrolytes')), null);
  assert.equal(C.kcalWarning(w.foodIdx.get('banane').per100, w.config, w.foodIdx.get('banane')), null);
  assert.equal(C.kcalWarning({ kcal: 0, protein: 0, carbs: 0, fat: 0, fiber: 0 }, w.config), null);
});

// ------------------------------------------------------------------ profil et cibles (profils fictifs)
test('profil : vide par défaut, aucune cible tant qu\'il est incomplet', async () => {
  const { config } = await world();
  const p = C.emptyProfile();
  for (const v of Object.values(p)) assert.ok(v === null || v === '', 'aucune valeur pré-remplie');
  assert.equal(C.profileStatus(p).complete, false);
  assert.deepEqual(C.profileStatus(p).missing, ['poids', 'sexe', 'âge', 'taille']);
  assert.equal(C.targetFor(config.dayTypes[0], p, config), null);
  assert.ok(Object.values(C.allTargets(p, config)).every((t) => t === null));
  assert.deepEqual(C.profileStatus({ ...p, weightKg: 70, restingKcal: 1700 }), { complete: true, missing: [] });
});

test('Mifflin-St Jeor et dépense hors entraînement (profils fictifs)', async () => {
  const { config } = await world();
  const c = config.calc;
  assert.equal(C.bmr(FICTIVE, c), 10 * 75 + 6.25 * 180 - 5 * 30 + 5);
  assert.equal(C.bmr(FICTIVE_F, c), 10 * 60 + 6.25 * 165 - 5 * 40 - 161);
  near(assert, C.restKcal(FICTIVE, c), 1730 * 1.2);
  assert.equal(C.restKcal({ ...FICTIVE, restingKcal: 1900 }, c), 1900); // valeur Garmin : aucun facteur ajouté
});

test('calories actives de référence par type de sortie', async () => {
  const { config } = await world();
  assert.equal(C.activeKcal('courte', FICTIVE, config), 375);
  assert.equal(C.activeKcal('moyenne', FICTIVE, config), 1125);
  assert.equal(C.activeKcal('longue', FICTIVE, config), 1500);
  assert.equal(C.activeKcal('longue', { ...FICTIVE, longActiveKcal: 2000 }, config), 2000);
  assert.equal(C.activeKcal(null, FICTIVE, config), 0);
});

test('cibles par type de journée (profil fictif)', async () => {
  const { config } = await world();
  const by = Object.fromEntries(config.dayTypes.map((d) => [d.id, d]));
  const rest = C.targetFor(by.repos, FICTIVE, config);
  near(assert, rest.kcal, 2076);
  near(assert, rest.protein.min, 112.5);
  near(assert, rest.protein.max, 135);
  near(assert, rest.fat, 82.5);
  near(assert, rest.carbs, (2076 - 4 * 123.75 - 9 * 82.5) / 4);
  near(assert, C.targetFor(by['veille-longue'], FICTIVE, config).kcal, 2076 * 1.1);
  near(assert, C.targetFor(by.moyenne, FICTIVE, config).expenditure, 2076 + 1125);
  near(assert, C.targetFor(by.longue, { ...FICTIVE, longActiveKcal: 2000 }, config).expenditure, 2076 + 2000);
  near(assert, C.targetFor(by['lendemain-plaisir'], FICTIVE, config).kcal, (2076 + 375) * 0.92);
  const t = C.targetFor(by.courte, { ...FICTIVE, restingKcal: 1800 }, config);
  near(assert, t.rest, 1800);
  near(assert, t.expenditure, 1800 + 375);
  for (const d of config.dayTypes) assert.ok(C.targetFor(d, FICTIVE, config).carbs > 100, d.id);
});

test('ajustement à la cible : facteur global par pas de 1 % (ou du pas donné)', () => {
  assert.equal(C.fitFactor(2000, 2400), 1.2);
  assert.equal(C.fitFactor(2000, 2188), 1.09);
  assert.equal(C.fitFactor(2000, 2160), 1.08);
  assert.equal(C.fitFactor(2000, 2160, 0.05), 1.1);
  assert.equal(C.fitFactor(2000, 1000), 0.5);
  assert.equal(C.fitFactor(2000, 9000), 2);
  assert.equal(C.fitFactor(0, 2000), 1);
});

// ------------------------------------------------------------------ filtres, tri
test('filtres : ET entre groupes, OU au sein d\'un groupe', async () => {
  const { meals } = await world();
  const f = (o) => C.filterMeals(meals, { ...C.defaultFilters(), ...o });
  const cats = f({ categories: ['Dîner'] });
  assert.ok(cats.length >= 8 && cats.every((m) => m.category === 'Dîner'));
  const two = f({ categories: ['Dîner', 'Déjeuner'] });
  assert.equal(two.length, cats.length + f({ categories: ['Déjeuner'] }).length);
  const and = f({ categories: ['Dîner'], tags: ['Abats'] });
  assert.ok(and.length > 0 && and.length < cats.length && and.every((m) => m.tags.includes('Abats')));
  assert.equal(f({ categories: ['Collation'], tags: ['Abats'] }).length, 0);
  assert.ok(f({ foods: ['saumon'] }).every((m) => m.lines.some((l) => l.id === 'saumon')));
  assert.ok(f({ foods: ['saumon', 'colin'] }).length > f({ foods: ['saumon'] }).length);
  assert.ok(f({ foodTypes: ['Légumineuses'] }).every((m) => m.lines.some((l) => l.food?.type === 'Légumineuses')));
  assert.ok(f({ densities: ['leger'] }).every((m) => m.density.id === 'leger'));
  assert.ok(f({ origins: ['Perso'] }).length === 0);
  assert.ok(f({ contexts: ['Petit-déjeuner de sortie longue'] }).length >= 5);
  assert.ok(f({ tags: ['Saisonnier'] }).every((m) => m.seasons.length > 0));
  assert.ok(f({ tags: ['Saisonnier'] }).length >= 5);
});

test('filtres numériques : kcal, protéines, glucides, fibres, temps', async () => {
  const { meals } = await world();
  const f = (o) => C.filterMeals(meals, { ...C.defaultFilters(), ...o });
  assert.ok(f({ kcalMin: 500, kcalMax: 600 }).every((m) => C.roundDisplay(m.totals.kcal) >= 500 && C.roundDisplay(m.totals.kcal) <= 600));
  assert.ok(f({ proteinMin: 40 }).every((m) => C.roundDisplay(m.totals.protein) >= 40));
  assert.ok(f({ fiberMax: 6 }).every((m) => C.roundDisplay(m.totals.fiber) <= 6));
  assert.ok(f({ fiberMin: 15 }).every((m) => C.roundDisplay(m.totals.fiber) >= 15));
  assert.ok(f({ carbsMin: 80, carbsMax: 100 }).every((m) => C.roundDisplay(m.totals.carbs) >= 80 && C.roundDisplay(m.totals.carbs) <= 100));
  // la comparaison porte sur la valeur affichée : 504,4 kcal s'affiche « 504 », donc passe un filtre « min 504 » mais pas « min 505 »
  const probe = { id: 'probe', name: 'probe', category: 'Déjeuner', contexts: [], tags: [], lines: [], origin: 'Recueil', time: 0, density: { id: 'x' }, totals: { kcal: 504.4, protein: 24.6, carbs: 0, fat: 0, fiber: 6.4 } };
  const g = (o) => C.filterMeals([probe], { ...C.defaultFilters(), ...o }).length;
  assert.equal(g({ kcalMin: 504 }), 1);
  assert.equal(g({ kcalMin: 505 }), 0);
  assert.equal(g({ kcalMax: 504 }), 1);
  assert.equal(g({ proteinMin: 25 }), 1); // 24,6 → 25
  assert.equal(g({ fiberMax: 6 }), 1); // 6,4 → 6
  assert.ok(f({ timeMax: 5 }).every((m) => (m.time ?? 0) <= 5));
  assert.equal(f({ kcalMin: '', kcalMax: null }).length, meals.length);
});

test('recherche texte : nom, ingrédients, tags, sans accents ni casse', async () => {
  const { meals } = await world();
  const q = (s) => C.filterMeals(meals, { ...C.defaultFilters(), q: s });
  assert.ok(q('oeufs').length > 0 && q('ŒUFS').length === q('oeufs').length);
  assert.ok(q('cancoillotte').some((m) => m.lines.some((l) => l.id === 'cancoillotte')));
  assert.ok(q('abats').every((m) => m.tags.includes('Abats') || m.name.toLowerCase().includes('abats')));
  assert.ok(q('saumon concombre').every((m) => /saumon/i.test(m.name) || m.lines.some((l) => l.id === 'saumon')));
  assert.equal(q('zzzzzz').length, 0);
});

test('tri : par kcal croissant et décroissant, par nom', async () => {
  const { meals } = await world();
  const asc = C.sortMeals(meals, 'kcal', 1).map((m) => m.totals.kcal);
  assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  const desc = C.sortMeals(meals, 'protein', -1).map((m) => m.totals.protein);
  assert.deepEqual(desc, [...desc].sort((a, b) => b - a));
  const names = C.sortMeals(meals, 'name', 1).map((m) => m.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b, 'fr')));
});

// ------------------------------------------------------------------ journées types
test('journées types : totaux, repas incomplets ignorés, bilan hebdomadaire', async () => {
  const w = await world();
  for (const d of w.days.days) {
    const { totals, missing } = C.dayTotals(d.items.map(([meal, factor]) => ({ meal, factor })), w.mealIdx);
    assert.equal(missing.length, 0, d.id);
    assert.ok(totals.kcal > 1500, d.id);
  }
  const gone = await world({ deleted: ['banane'] });
  const r = C.dayTotals([{ meal: 'col-banane-beurre-cacahuetes', factor: 1 }, { meal: 'col-dattes-amandes', factor: 2 }], gone.mealIdx);
  assert.deepEqual(r.missing, ['col-banane-beurre-cacahuetes']);
  near(assert, r.totals.kcal, 2 * gone.mealIdx.get('col-dattes-amandes').totals.kcal);

  const noTargets = C.weekReport(w.days.week, w.days.days, w.mealIdx, null, w.config.dayTypes);
  assert.equal(noTargets.rows.length, 7);
  assert.equal(noTargets.balance, null);
  const targets = C.allTargets(FICTIVE, w.config);
  const rep = C.weekReport(w.days.week, w.days.days, w.mealIdx, targets, w.config.dayTypes);
  assert.ok(Number.isFinite(rep.balance));
  assert.ok(Math.abs(rep.balance) < 7 * 400, `bilan hebdomadaire proche de l'équilibre : ${Math.round(rep.balance)} kcal`);
  assert.ok(rep.rows.find((x) => x.day.id === 'j-cheat').delta > 0, 'le cheat meal dépasse la cible du jour');
});

test('textes à copier : repas et journée', async () => {
  const w = await world();
  const txt = C.mealToText(w.mealIdx.get('din-poulet-courgette-champignons'));
  assert.match(txt, /^Poulet poêlé courgette champignons et riz complet \(Dîner\) : \d+ kcal/);
  assert.match(txt, /- 180 g Filet de poulet entier \(cru\)/);
  assert.match(txt, /Préparation :/);
  assert.match(txt, /\* valeur estimée/);
  const m = w.mealIdx.get('col-dattes-amandes');
  const day = C.dayToText('Jour de repos', [{ meal: m, factor: 1.25 }], m.totals, null);
  assert.match(day, /×1,25/);
});
