#!/usr/bin/env node
// scripts/validate-data.mjs
// Validation des fichiers de data/. Code de sortie 1 s'il y a au moins une erreur ;
// les avertissements (écart kcal/macros d'un aliment, par exemple) ne sont jamais bloquants.
// Utilisé par la CI (npm run validate) et par tests/data.test.mjs.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { kcalWarning } from '../src/calc.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MACROS = ['kcal', 'protein', 'carbs', 'fat', 'fiber'];
const STORED_TOTAL_KEYS = ['kcal', 'protein', 'carbs', 'fat', 'fiber', 'totals', 'total', 'macros'];
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Aucune donnée personnelle ne doit apparaître dans data/ (dépôt public) : champs de profil interdits.
const PERSONAL_KEYS = [
  'age', 'âge', 'ans', 'taille', 'height', 'heightcm', 'poids', 'weight', 'weightkg', 'weightmin', 'weightmax', 'weightminkg', 'weightmaxkg',
  'sexe', 'sex', 'genre', 'imc', 'bmi', 'bmr', 'metabolisme', 'métabolisme', 'tdee', 'profil', 'profile', 'resting', 'restingkcal', 'longactivekcal',
].map((k) => k.toLowerCase());

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const dup = (list) => list.filter((x, i) => list.indexOf(x) !== i);

function scanKeys(value, path, out) {
  if (Array.isArray(value)) value.forEach((v, i) => scanKeys(v, `${path}[${i}]`, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (PERSONAL_KEYS.includes(k.toLowerCase())) out.push(`${path}.${k} : champ de profil personnel interdit dans le dépôt`);
      scanKeys(v, `${path}.${k}`, out);
    }
  }
}

/** @returns {{errors:string[], warnings:string[]}} */
export function validateData({ foods, internal, meals, days, config }) {
  const errors = [];
  const warnings = [];
  const err = (m) => errors.push(m);

  // --- schemaVersion et absence de données personnelles
  for (const [name, d] of Object.entries({ foods, 'internal-ingredients': internal, meals, days, config })) {
    if (d?.schemaVersion !== 1) err(`${name}.json : schemaVersion absent ou différent de 1`);
    scanKeys(d, name, errors);
  }

  // --- config
  const cats = config.categories ?? [];
  const ctxs = config.contexts ?? [];
  const mtags = config.manualTags ?? [];
  const ftypes = config.foodTypes ?? [];
  const seasonIds = (config.seasons ?? []).map((s) => s.id);
  const dayTypes = config.dayTypes ?? [];
  for (const [label, list] of Object.entries({ categories: cats, contexts: ctxs, manualTags: mtags, foodTypes: ftypes })) {
    if (!list.length) err(`config : liste « ${label} » vide`);
    for (const v of list) if (/,/.test(v)) err(`config : « ${v} » contient une virgule (séparateur des colonnes à choix multiples de Notion)`);
    for (const v of dup(list)) err(`config : « ${v} » en double dans « ${label} »`);
  }
  for (const c of cats) {
    const t = config.density?.[c];
    if (!t || !isNum(t.lightMax) || !isNum(t.moderateMax) || t.lightMax >= t.moderateMax) err(`config : seuils de densité invalides pour « ${c} »`);
  }
  if ((config.densityLevels ?? []).length !== 3) err('config : densityLevels doit contenir 3 niveaux');
  for (const d of dayTypes) {
    if (!ctxs.includes(d.context)) err(`config : journée type « ${d.id} » : contexte « ${d.context} » inconnu`);
    if (d.outing && !(config.outings ?? []).some((o) => o.id === d.outing)) err(`config : journée type « ${d.id} » : sortie « ${d.outing} » inconnue`);
    if (!isNum(d.kcalFactor) || d.kcalFactor <= 0 || !isNum(d.fatPerKg) || d.fatPerKg <= 0) err(`config : journée type « ${d.id} » : coefficients invalides`);
  }
  for (const v of dup(dayTypes.map((d) => d.id))) err(`config : journée type « ${v} » en double`);
  const outs = config.outings ?? [];
  outs.forEach((o, i) => { if (i > 0 && outs[i - 1].maxKcal + 1 !== o.minKcal) err(`config : les plages de sorties ne sont pas contiguës (${o.id})`); });

  // --- ingrédients internes
  const internalIds = new Set();
  for (const i of internal.ingredients ?? []) {
    if (!SLUG.test(i.id) || !i.id.startsWith('i-')) err(`ingrédient interne « ${i.id} » : identifiant invalide (préfixe i- attendu)`);
    if (internalIds.has(i.id)) err(`ingrédient interne « ${i.id} » en double`);
    internalIds.add(i.id);
    for (const k of MACROS) if (!isNum(i.per100?.[k]) || i.per100[k] < 0) err(`ingrédient interne « ${i.id} » : ${k} invalide`);
  }

  // --- aliments
  const foodList = foods.foods ?? [];
  const foodIds = new Set(foodList.map((f) => f.id));
  const names = new Set();
  for (const f of foodList) {
    const where = `aliment « ${f.id} »`;
    if (!SLUG.test(f.id)) err(`${where} : identifiant invalide (slug attendu)`);
    if (typeof f.name !== 'string' || !f.name.trim()) err(`${where} : nom manquant`);
    else {
      if (/,/.test(f.name)) err(`${where} : le nom contient une virgule (séparateur de l'export Notion)`);
      const k = f.name.trim().toLowerCase();
      if (names.has(k)) err(`${where} : nom « ${f.name} » en double`);
      names.add(k);
    }
    if (!ftypes.includes(f.type)) err(`${where} : type « ${f.type} » absent de config.foodTypes`);
    if (f.season !== undefined && !seasonIds.includes(f.season)) err(`${where} : saison « ${f.season} » inconnue`);
    if (f.unit !== undefined && !['g', 'ml'].includes(f.unit)) err(`${where} : unité « ${f.unit} » invalide`);
    if (f.portion !== undefined && (!f.portion.label || !isNum(f.portion.g) || f.portion.g <= 0)) err(`${where} : portion usuelle invalide`);
    for (const k of STORED_TOTAL_KEYS) if (k in f) err(`${where} : champ « ${k} » interdit (valeurs pour 100 g dans per100)`);
    if (f.coef !== undefined) {
      if (!isNum(f.coef) || f.coef <= 0 || f.coef > 6) err(`${where} : coefficient cuit/cru invalide`);
      if (f.state !== 'cru' && f.state !== 'cuit') err(`${where} : un aliment ⇄ doit avoir l'état de référence « cru » ou « cuit »`);
      if (f.weigh !== undefined && f.weigh !== 'cru' && f.weigh !== 'cuit') err(`${where} : état de pesée invalide`);
    }
    if (Array.isArray(f.recipe)) {
      for (const [id, g] of f.recipe) {
        if (!internalIds.has(id) && !foodIds.has(id)) err(`${where} : ingrédient de recette « ${id} » inconnu`);
        if (!isNum(g) || g <= 0) err(`${where} : quantité invalide pour « ${id} »`);
      }
    } else {
      for (const k of MACROS) if (!isNum(f.per100?.[k]) || f.per100[k] < 0) err(`${where} : per100.${k} invalide`);
      const w = kcalWarning(f.per100 ?? {}, config, f);
      if (w) warnings.push(`${where} : kcal (${f.per100.kcal}) à ${Math.round(w.rel * 100)} % de l'attendu d'après les macros (${w.expected})`);
    }
  }
  for (const i of internal.ingredients ?? []) {
    const w = kcalWarning(i.per100, config, i);
    if (w) warnings.push(`ingrédient interne « ${i.id} » : kcal à ${Math.round(w.rel * 100)} % de l'attendu d'après les macros`);
  }

  // --- repas
  const mealList = meals.meals ?? [];
  const mealIds = new Set();
  const mealNames = new Set();
  for (const m of mealList) {
    const where = `repas « ${m.id} »`;
    if (!SLUG.test(m.id)) err(`${where} : identifiant invalide`);
    if (mealIds.has(m.id)) err(`${where} : identifiant en double`);
    mealIds.add(m.id);
    const nk = String(m.name ?? '').trim().toLowerCase();
    if (!nk) err(`${where} : nom manquant`);
    if (mealNames.has(nk)) err(`${where} : nom « ${m.name} » en double`);
    mealNames.add(nk);
    if (!cats.includes(m.category)) err(`${where} : catégorie « ${m.category} » inconnue`);
    if (!Array.isArray(m.contexts) || !m.contexts.length) err(`${where} : au moins un contexte attendu`);
    for (const c of m.contexts ?? []) if (!ctxs.includes(c)) err(`${where} : contexte « ${c} » inconnu`);
    for (const t of m.tags ?? []) if (!mtags.includes(t)) err(`${where} : tag manuel « ${t} » inconnu`);
    for (const k of STORED_TOTAL_KEYS) if (k in m) err(`${where} : total stocké interdit (« ${k} ») : tout est calculé à la volée`);
    if (m.time !== undefined && (!isNum(m.time) || m.time < 0)) err(`${where} : temps invalide`);
    if (typeof m.prep !== 'string' || !m.prep.trim()) err(`${where} : préparation manquante`);
    if (typeof m.variant !== 'string' || !m.variant.trim()) err(`${where} : variante manquante`);
    if (m.cheat) {
      for (const k of MACROS) if (!isNum(m.cheat[k]) || m.cheat[k] < 0) err(`${where} : bloc cheat meal, ${k} invalide`);
      if (m.items?.length || m.internal?.length) err(`${where} : un cheat meal est un bloc unique, sans aliments de la table`);
    } else if (!m.items?.length && !m.internal?.length) err(`${where} : aucun aliment`);
    for (const [id, g] of m.items ?? []) {
      if (!foodIds.has(id)) err(`${where} : aliment « ${id} » inconnu`);
      if (!isNum(g) || g <= 0) err(`${where} : quantité invalide pour « ${id} »`);
    }
    for (const [id, g] of m.internal ?? []) {
      if (!internalIds.has(id)) err(`${where} : ingrédient interne « ${id} » inconnu`);
      if (!isNum(g) || g <= 0) err(`${where} : quantité invalide pour « ${id} »`);
    }
  }

  // --- journées types
  const dayList = days.days ?? [];
  const dayIds = new Set();
  for (const d of dayList) {
    const where = `journée « ${d.id} »`;
    if (dayIds.has(d.id)) err(`${where} : identifiant en double`);
    dayIds.add(d.id);
    if (!dayTypes.some((t) => t.id === d.dayType)) err(`${where} : type de journée « ${d.dayType} » inconnu`);
    if (!d.items?.length) err(`${where} : aucun repas`);
    for (const [id, factor] of d.items ?? []) {
      if (!mealIds.has(id)) err(`${where} : repas « ${id} » inconnu`);
      if (!isNum(factor) || factor <= 0 || factor > 3) err(`${where} : facteur de portion invalide pour « ${id} »`);
    }
  }
  if (!Array.isArray(days.week) || days.week.length !== 7) err('days.json : la semaine type doit contenir 7 jours');
  for (const w of days.week ?? []) if (!dayIds.has(w.day)) err(`semaine type : journée « ${w.day} » inconnue`);

  return { errors, warnings };
}

export async function loadData(root = ROOT) {
  const read = async (n) => JSON.parse(await readFile(join(root, 'data', `${n}.json`), 'utf8'));
  const [foods, internal, meals, days, config] = await Promise.all(['foods', 'internal-ingredients', 'meals', 'days', 'config'].map(read));
  return { foods, internal, meals, days, config };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const data = await loadData();
    const { errors, warnings } = validateData(data);
    for (const w of warnings) console.warn(`⚠ ${w}`);
    for (const e of errors) console.error(`✗ ${e}`);
    console.log(`${data.foods.foods.length} aliments, ${data.meals.meals.length} repas, ${data.days.days.length} journées types : ${errors.length} erreur(s), ${warnings.length} avertissement(s).`);
    process.exit(errors.length ? 1 : 0);
  } catch (e) {
    console.error(`✗ Impossible de lire les données : ${e.message}`);
    process.exit(1);
  }
}
