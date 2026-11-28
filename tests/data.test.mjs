import test from 'node:test';
import assert from 'node:assert/strict';
import { validateData } from '../scripts/validate-data.mjs';
import { world } from './helpers.mjs';

const clone = (x) => structuredClone(x);

test('validation : les données du projet sont valides', async () => {
  const w = await world();
  const { errors } = validateData({ foods: w.foods, internal: w.internal ? { schemaVersion: 1, ingredients: w.internal } : w.internal, meals: w.meals && { schemaVersion: 1, meals: w.meals.map((m) => m.def) }, days: w.days, config: w.config });
  assert.deepEqual(errors, []);
});

test('validation : détecte doublons, références cassées, totaux stockés et champs inconnus', async () => {
  const w = await world();
  const base = () => ({ foods: clone(w.foods), internal: { schemaVersion: 1, ingredients: clone(w.internal) }, meals: { schemaVersion: 1, meals: w.meals.map((m) => clone(m.def)) }, days: clone(w.days), config: clone(w.config) });
  const has = (d, re) => validateData(d).errors.some((e) => re.test(e));

  let d = base(); d.foods.foods[1].id = d.foods.foods[0].id; d.foods.foods[1].name = d.foods.foods[0].name;
  assert.ok(has(d, /en double/));
  d = base(); d.meals.meals[0].items.push(['aliment-fantome', 10]);
  assert.ok(has(d, /aliment-fantome/));
  d = base(); d.meals.meals[0].kcal = 500;
  assert.ok(has(d, /total stocké interdit/));
  d = base(); d.meals.meals[0].category = 'Brunch';
  assert.ok(has(d, /catégorie/));
  d = base(); d.meals.meals[0].contexts = ['Jour de fête'];
  assert.ok(has(d, /contexte/));
  d = base(); d.days.days[0].items.push(['repas-fantome', 1]);
  assert.ok(has(d, /repas-fantome/));
  d = base(); d.days.days[1].dayType = d.days.days[0].dayType;
  assert.ok(has(d, /type de journée « repos » : 2 journées types/), 'deux journées types pour un même type de journée');
  assert.ok(has(d, /type de journée « courte » : aucune journée type/), 'un type de journée sans journée type');
  d = base(); d.foods.foods[0].season = 'printemps';
  assert.ok(has(d, /saison/));
  d = base(); d.foods.foods[0].name = 'Œufs, durs';
  assert.ok(has(d, /virgule/));
  d = base(); d.meals.meals[0].internal = [['i-inconnu', 5]];
  assert.ok(has(d, /i-inconnu/));
  d = base(); d.foods.foods[0].per100.kcal = -3;
  assert.ok(has(d, /per100\.kcal/));
  d = base(); d.config.density['Dîner'] = { lightMax: 800, moderateMax: 500 };
  assert.ok(has(d, /densité/));
});

test('confidentialité : tout champ de profil personnel dans data/ fait échouer la validation', async () => {
  const w = await world();
  const base = () => ({ foods: clone(w.foods), internal: { schemaVersion: 1, ingredients: clone(w.internal) }, meals: { schemaVersion: 1, meals: w.meals.map((m) => clone(m.def)) }, days: clone(w.days), config: clone(w.config) });
  for (const key of ['age', 'taille', 'poids', 'weightKg', 'heightCm', 'sex', 'bmr', 'restingKcal', 'weightMax']) {
    const d = base();
    d.config.calc[key] = 1;
    assert.ok(validateData(d).errors.some((e) => /profil personnel/.test(e)), key);
    const d2 = base();
    d2.foods.foods[0][key] = 1;
    assert.ok(validateData(d2).errors.some((e) => /profil personnel/.test(e)), `foods.${key}`);
  }
  assert.deepEqual(validateData(base()).errors, [], 'les coefficients génériques (perKg, perCm…) ne sont pas des données personnelles');
});

test('couverture : au moins 8 repas par catégorie, tous les contextes et tous les aliments utilisés', async () => {
  const w = await world();
  for (const c of w.config.categories) assert.ok(w.meals.filter((m) => m.category === c).length >= 8, c);
  for (const c of w.config.contexts) assert.ok(w.meals.some((m) => m.contexts.includes(c)), `contexte ${c}`);
  const used = new Set(w.meals.flatMap((m) => m.lines.map((l) => l.id)));
  const unused = [...w.foodIdx.keys()].filter((id) => !used.has(id));
  assert.deepEqual(unused, [], 'aliments jamais utilisés');
  for (const t of w.config.manualTags) assert.ok(w.meals.some((m) => m.manualTags.includes(t)), `tag ${t}`);
  assert.ok(w.meals.some((m) => m.seasons.includes('ete')) && w.meals.some((m) => m.seasons.includes('automne-hiver')));
  for (const level of ['leger', 'modere', 'dense']) assert.ok(w.meals.some((m) => m.density.id === level), level);
});

test('journées types : une par type de journée, semaine type de 7 jours', async () => {
  const w = await world();
  for (const t of w.config.dayTypes) assert.ok(w.days.days.some((d) => d.dayType === t.id), t.id);
  assert.equal(w.days.week.length, 7);
  const dayIds = new Set(w.days.days.map((d) => d.id));
  for (const x of w.days.week) assert.ok(dayIds.has(x.day));
});

// ------------------------------------------------------------------ règles alimentaires
test('règle : légumineuses chaque jour (hors cheat meal), saumon au moins une fois par semaine', async () => {
  const w = await world();
  const lines = (d) => d.items.flatMap(([id]) => w.mealIdx.get(id).lines);
  for (const d of w.days.days) {
    if (d.dayType === 'cheat') continue;
    assert.ok(lines(d).some((l) => l.food?.type === 'Légumineuses'), `légumineuses : ${d.id}`);
  }
  const dayIdx = new Map(w.days.days.map((d) => [d.id, d]));
  assert.ok(w.days.week.some((x) => lines(dayIdx.get(x.day)).some((l) => l.id === 'saumon')), 'saumon dans la semaine type');
});

test('règle : abats limités (au plus un repas d\'abats par journée type) et cuisson à cœur mentionnée', async () => {
  const w = await world();
  const abats = ['foie-porc', 'foie-boeuf', 'coeur-boeuf', 'rognons-porc'];
  for (const d of w.days.days) {
    const n = d.items.filter(([id]) => w.mealIdx.get(id).lines.some((l) => abats.includes(l.id))).length;
    assert.ok(n <= 1, d.id);
  }
  for (const m of w.meals.filter((x) => x.lines.some((l) => abats.includes(l.id)))) {
    assert.ok(m.manualTags.includes('Abats'), m.id);
    if (/foie|rognon/i.test(m.name)) assert.match(m.prep, /cœur/, m.id);
  }
});

test('règle : cacao sucré en récupération uniquement, cacao non sucré en repas uniquement', async () => {
  const w = await world();
  for (const m of w.meals) {
    if (m.lines.some((l) => l.id === 'cacao-sucre')) assert.equal(m.category, 'Récupération', m.id);
    if (m.lines.some((l) => l.id === 'cacao-non-sucre')) assert.notEqual(m.category, 'Récupération', m.id);
  }
  for (const id of ['rec-lait-cacao-250', 'rec-lait-cacao-500']) {
    const m = w.mealIdx.get(id);
    assert.ok(m.contexts.every((c) => ['Sortie moyenne', 'Sortie longue', 'Post-effort'].includes(c)), `${id} : lait + cacao uniquement après une sortie moyenne ou longue`);
  }
  const q = (id) => w.mealIdx.get(id).lines.map((l) => [l.id, l.qty]);
  assert.deepEqual(q('rec-lait-cacao-250'), [['lait-demi-ecreme', 250], ['cacao-sucre', 10]]);
  assert.deepEqual(q('rec-lait-cacao-500'), [['lait-demi-ecreme', 500], ['cacao-sucre', 20]]);
});

test('règle : pas d\'huile d\'olive au déjeuner, poulet pesé cru, fromage blanc 0 % (pas de skyr)', async () => {
  const w = await world();
  for (const m of w.meals.filter((x) => x.category === 'Déjeuner')) assert.ok(!m.lines.some((l) => l.id === 'huile-olive'), m.id);
  assert.equal(w.foodIdx.get('filet-poulet').state, 'cru');
  assert.equal(w.foodIdx.get('saute-dinde').state, 'cru');
  assert.ok(![...w.foodIdx.values()].some((f) => /skyr/i.test(f.name)));
});

test('règle : petits-déjeuners avant sortie longue digestes (peu de fibres)', async () => {
  const w = await world();
  const pdl = w.meals.filter((m) => m.contexts.includes('Petit-déjeuner de sortie longue'));
  assert.ok(pdl.length >= 5);
  for (const m of pdl) {
    assert.ok(m.totals.fiber <= 6, `${m.id} : ${m.totals.fiber.toFixed(1)} g de fibres`);
    assert.ok(m.tags.includes('OK avant effort'), m.id);
    assert.ok(!m.lines.some((l) => ['all-bran', 'muesli-fruits-rouges', 'muesli-chocolat', 'muesli-fruits-secs'].includes(l.id)), m.id);
  }
});

test('règle : stratégie glucidique pendant l\'effort (40 à 60 g/h, environ 2/3 solide, 1/3 isotonique)', async () => {
  const w = await world();
  const cases = { 'eff-1h-40g': 1, 'eff-1h30-50g': 1.5, 'eff-2h-50g': 2, 'eff-3h-50g': 3, 'eff-4h-55g': 4, 'eff-5h-60g': 5 };
  for (const [id, hours] of Object.entries(cases)) {
    const m = w.mealIdx.get(id);
    const perHour = m.totals.carbs / hours;
    assert.ok(perHour >= 37 && perHour <= 62, `${id} : ${perHour.toFixed(0)} g/h`);
    const iso = m.lines.filter((l) => l.id === 'poudre-isotonique').reduce((s, l) => s + l.macros.carbs, 0);
    const share = iso / m.totals.carbs;
    assert.ok(share > 0.25 && share < 0.45, `${id} : isotonique ${(share * 100).toFixed(0)} % des glucides`);
  }
});

test('règle : vocabulaire des sorties (courte, moyenne, longue uniquement)', async () => {
  const w = await world();
  const text = JSON.stringify([w.meals.map((m) => m.def), w.days, w.config]);
  assert.ok(!/sortie (légère|facile|intense|très longue|moyenne-longue|modérée|normale)/i.test(text));
  assert.deepEqual(w.config.outings.map((o) => o.label), ['Sortie courte', 'Sortie moyenne', 'Sortie longue']);
  assert.deepEqual(w.config.outings.map((o) => [o.minKcal, o.maxKcal]), [[0, 749], [750, 1499], [1500, null]]);
});

test('règle : aucun aliment exclu (olives, huiles de noix ou de colza, framboises, vinaigre, herbes, légumes d\'hiver non listés)', async () => {
  const w = await world();
  const banned = /olive(?!s? \(conserve|\b.*sardine)|huile de (noix|colza)|framboise|vinaigre|basilic|persil|ciboulette|coriandre|thym|origan|oignon|échalote|\bail\b|chou|brocoli|épinard|poivron|batavia|salade verte/i;
  const allowed = new Set(['oignon', 'chou-fleur']); // ajoutés explicitement au recueil (cahier des charges du lot 1) : seuls exceptions à la liste d'exclusion
  for (const f of w.foodIdx.values()) {
    if (/huile d'olive|sardines à l'huile d'olive/i.test(f.name) || allowed.has(f.id)) continue;
    assert.ok(!banned.test(f.name), f.name);
  }
  for (const m of w.meals) {
    const text = `${m.prep} ${m.variant}`.replace(/huile d'olive|l'huile d'olive/gi, '');
    const uses = (id) => m.lines.some((l) => l.id === id); // « oignon » n'est toléré dans le texte que si le repas utilise l'aliment Oignon
    assert.ok(!/vinaigre|framboise|basilic|persil|ciboulette|coriandre|thym|origan|échalote|\bail\b|brocoli|épinard|poivron|olives\b/i.test(text), `${m.id} : ${text}`);
    if (!uses('oignon')) assert.ok(!/oignon/i.test(text), `${m.id} : ${text}`);
  }
});

test('règle : les repas du recueil n\'utilisent que les aliments de la liste', async () => {
  const w = await world();
  for (const m of w.meals) for (const l of m.lines) assert.ok(!l.missing, `${m.id} → ${l.missingId}`);
});

test('règle : repas au blender (tag « Blender », mixage dans la préparation, lait écrémé par défaut, jamais pendant l\'effort)', async () => {
  const w = await world();
  const blender = w.meals.filter((m) => m.manualTags.includes('Blender'));
  assert.ok(blender.length >= 20, 'au moins une vingtaine de repas au blender');
  for (const c of ['Petit-déjeuner', 'Collation', 'Récupération', 'Dîner']) assert.ok(blender.some((m) => m.category === c), `repas au blender : ${c}`);
  assert.ok(blender.some((m) => m.contexts.includes('Petit-déjeuner de sortie longue')), 'au moins un petit-déjeuner de sortie longue au blender');
  for (const m of blender) {
    assert.match(m.prep, /mix/i, `${m.id} : la préparation doit mentionner le mixage`);
    assert.notEqual(m.category, "Pendant l'effort", m.id);
    assert.notEqual(m.category, 'Repas plaisir', m.id);
    assert.ok(!m.lines.some((l) => l.id === 'lait-demi-ecreme'), `${m.id} : lait écrémé par défaut dans les recettes au blender`);
    if (m.category === 'Dîner') assert.ok(m.manualTags.includes('Chaud'), `${m.id} : soupes et purées au dîner, servies chaudes`);
  }
  // le déjeuner reste une salade froide : aucune recette au blender à ce créneau
  assert.ok(!blender.some((m) => m.category === 'Déjeuner'));
});

test('validation : bloc planner.tune (obligatoire, bornes, seuils, types, poids, plafond)', async () => {
  const w = await world();
  const base = () => ({ foods: clone(w.foods), internal: { schemaVersion: 1, ingredients: clone(w.internal) }, meals: { schemaVersion: 1, meals: w.meals.map((m) => clone(m.def)) }, days: clone(w.days), config: clone(w.config) });
  const errorsOf = (mut) => { const d = base(); mut(d.config.planner.tune); return validateData(d).errors.filter((e) => e.includes('planner.tune')); };
  const bad = (mut, re) => assert.ok(errorsOf(mut).some((e) => re.test(e)), `${re} : ${JSON.stringify(errorsOf(mut))}`);
  assert.deepEqual(errorsOf(() => {}), []);
  const absent = base(); delete absent.config.planner.tune;
  assert.ok(validateData(absent).errors.some((e) => /planner\.tune : bloc .* manquant/.test(e)), 'bloc absent');
  bad((t) => { t.enabled = 'oui'; }, /enabled : booléen/);
  bad((t) => { t.maxTweaks = 6; }, /maxTweaks : entier entre 1 et 5/);
  bad((t) => { t.maxTweaks = 0; }, /maxTweaks/);
  bad((t) => { t.maxIterations = 0; }, /maxIterations/);
  bad((t) => { t.bounds.min = 1.2; }, /bounds/);
  bad((t) => { t.bounds.max = 0.9; }, /bounds/);
  bad((t) => { t.major.min = 0.4; }, /major/);
  bad((t) => { t.major.max = 2.5; }, /major/);
  bad((t) => { t.major.min = 1.1; }, /major/);
  bad((t) => { t.types['Légumes'].max = 2.5; }, /types\.Légumes/);
  bad((t) => { t.types['Légumes'].min = 0.3; }, /types\.Légumes/);
  bad((t) => { t.types['Légumes'].step = 0; }, /types\.Légumes\.step/);
  bad((t) => { t.types['Légumes'].step = -5; }, /step/);
  bad((t) => { t.types['Gâteaux'] = { min: 0.8, max: 1.2, step: 10 }; }, /type d'aliment « Gâteaux » inconnu/);
  bad((t) => { t.types = {}; }, /types : au moins un type/);
  bad((t) => { t.excludeCategories = ['Brunch']; }, /catégorie « Brunch » inconnue/);
  bad((t) => { t.excludeCategories = 'Repas plaisir'; }, /excludeCategories/);
  bad((t) => { t.weights.kcal = -1; }, /weights\.kcal/);
  bad((t) => { t.weights.protein = 0; }, /weights\.protein : nombre strictement positif/);
  bad((t) => { delete t.weights.reg; }, /weights\.reg/);
  bad((t) => { delete t.weights; }, /weights/);
  // règle morte : avertissement, pas erreur
  const dead = base();
  dead.config.foodTypes.push('Gâteaux');
  dead.config.planner.tune.types['Gâteaux'] = { min: 0.8, max: 1.2, step: 10 };
  const r = validateData(dead);
  assert.ok(!r.errors.some((e) => e.includes('Gâteaux')));
  assert.ok(r.warnings.some((e) => e.includes('Gâteaux') && e.includes('planner.tune')));
});

test('validation : chaque type de planner.tune.types est porté par un aliment d\'un repas du recueil (données réelles)', async () => {
  const w = await world();
  const { warnings } = validateData({ foods: w.foods, internal: { schemaVersion: 1, ingredients: w.internal }, meals: { schemaVersion: 1, meals: w.meals.map((m) => m.def) }, days: w.days, config: w.config });
  assert.deepEqual(warnings.filter((e) => e.includes('planner.tune')), []);
  assert.deepEqual(Object.keys(w.config.planner.tune.types).filter((t) => !w.config.foodTypes.includes(t)), []);
});
