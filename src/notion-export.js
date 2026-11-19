// src/notion-export.js
// Génération à la volée du CSV pour l'import Notion, à partir des repas résolus (donc toujours à jour).
// INVARIANT : les noms de colonnes et les valeurs (catégories, contextes, tags, densités) restent
// strictement identiques d'un export à l'autre, sinon « Merge with CSV » de Notion crée des doublons.
// Le nom d'un repas est la clé stable. Le profil n'est jamais exporté.

import { roundKcal, roundG, isConvertible } from './calc.js';

export const CSV_COLUMNS = [
  'Nom', 'Origine', 'Catégorie', 'Contextes', 'Densité', 'Kcal',
  'Protéines (g)', 'Glucides (g)', 'Lipides (g)', 'Fibres (g)',
  'Aliments principaux', 'Tags', 'Temps (min)', 'Ingrédients', 'Préparation et variante',
];

export const BOM = '\uFEFF';

/** Échappement CSV : guillemets doublés, retours à la ligne autorisés entre guillemets. */
export function csvEscape(v) {
  const s = String(v ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const ELIDE = /^([aeiouyàâäéèêëîïôöùûüœæ]|h(uile|uit))/i;
const SHOWN_STATES = ['cru', 'cuit', 'égoutté'];

/** « de pâtes », « d'huile d'olive » : élision et minuscule initiale (sauf noms propres : keepCase). */
export function withDe(name, keepCase) {
  const n = keepCase ? name : name.charAt(0).toLowerCase() + name.slice(1);
  return (ELIDE.test(n) ? "d'" : 'de ') + n;
}

const qtyText = (g) => String(Math.round(g * 100) / 100).replace('.', ',');

/** « 120 g de filet de poulet entier (cru) » ; astérisque pour les valeurs estimées. */
export function ingredientLine(line) {
  const f = line.food;
  const name = f ? f.name : line.id;
  const unit = f?.unit === 'ml' ? 'ml' : 'g';
  const state = f && (isConvertible(f) || SHOWN_STATES.includes(f.state)) ? ` (${f.state})` : '';
  return `${qtyText(line.qty)} ${unit} ${withDe(name, f?.keepCase)}${state}${f?.estimated ? '*' : ''}`;
}

export function mealRow(m) {
  const t = m.totals;
  const prep = [m.prep && `Préparation : ${m.prep}`, m.variant && `Variante : ${m.variant}`].filter(Boolean).join('\n');
  const ingredients = m.cheat
    ? 'Bloc fixe de composition libre (type buffet), macros estimées*'
    : m.lines.map(ingredientLine).join('\n');
  return [
    m.name,
    m.origin === 'perso' ? 'Perso' : 'Recueil',
    m.category,
    m.contexts.join(', '),
    `${m.density.emoji} ${m.density.label}`,
    roundKcal(t.kcal), roundG(t.protein), roundG(t.carbs), roundG(t.fat), roundG(t.fiber),
    m.mainFoods.join(', '),
    m.tags.join(', '),
    m.time ?? '',
    ingredients,
    prep,
  ];
}

/**
 * @param {Array} meals repas résolus (resolveMeal)
 * @returns {{csv:string, text:string, rows:Array, excluded:string[]}} csv commence par un BOM UTF-8
 */
export function buildCsv(meals, { includePerso = true } = {}) {
  const excluded = [];
  const rows = [];
  for (const m of meals) {
    if (m.origin === 'perso' && !includePerso) continue;
    if (m.incomplete) { excluded.push(m.name); continue; }
    rows.push(mealRow(m));
  }
  const text = [CSV_COLUMNS, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n') + '\r\n';
  return { csv: BOM + text, text, rows, excluded };
}

export function csvFileName(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `nutricible-notion-${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}.csv`;
}
