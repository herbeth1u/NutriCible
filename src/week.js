// src/week.js — bilan hebdomadaire en MAINTIEN : budget calorique de chaque jour et facteur de portion conseillé.
// Fonctions pures. Les journées types sont dimensionnées pour un adulte moyen générique (aucune donnée personnelle
// dans le dépôt) : c'est ce calcul, fait dans le navigateur à partir du profil, qui les ramène au maintien.

import { fitFactor, scale, sum, weekReport } from './calc.js';

/**
 * Répartit le budget de la semaine : somme des budgets = somme des dépenses (maintien).
 * - une journée « fixe » (cheat meal : bloc unique non ajustable) garde ses kcal ;
 * - les autres se partagent le reste au prorata de leur cible (dépense × coefficient du type de journée) ;
 * - jamais moins de `floor` × la dépense du jour (pas de restriction excessive) : si le plancher s'applique,
 *   le reste est redistribué sur les autres jours.
 * @param {{expenditure:number, target:number, fixed:boolean, fixedKcal:number}[]} rows
 * @returns {number[]} budget kcal de chaque jour
 */
export function weekBudget(rows, { floor = 0.9 } = {}) {
  const expenditure = rows.reduce((s, r) => s + r.expenditure, 0);
  const budget = rows.map((r) => (r.fixed ? r.fixedKcal : 0));
  const locked = new Set(rows.map((r, i) => (r.fixed ? i : -1)).filter((i) => i >= 0));
  for (let pass = 0; pass < rows.length; pass += 1) {
    const open = rows.map((_, i) => i).filter((i) => !locked.has(i));
    if (!open.length) break;
    const lockedKcal = [...locked].reduce((s, i) => s + budget[i], 0);
    const scaleTo = (expenditure - lockedKcal) / open.reduce((s, i) => s + rows[i].target, 0);
    let bound = false;
    for (const i of open) {
      const min = floor * rows[i].expenditure;
      const b = rows[i].target * scaleTo;
      if (b < min) { budget[i] = min; locked.add(i); bound = true; } else budget[i] = b;
    }
    if (!bound) break;
  }
  return budget;
}

/**
 * Bilan hebdomadaire d'une semaine type avec facteurs de portion conseillés (par pas de `step`).
 * Sans cibles (profil incomplet) : mêmes lignes, sans budget ni facteur.
 */
export function weekBalance(week, days, mealIdx, targets, dayTypes, { floor = 0.9, step = 0.05 } = {}) {
  const base = weekReport(week, days, mealIdx, targets, dayTypes);
  if (!targets) {
    return { ...base, rows: base.rows.map((r) => ({ ...r, budget: null, fit: 1, fixed: false, adjusted: r.totals })), adjusted: base.total, budgetTotal: null, adjustedBalance: null };
  }
  const input = base.rows.map((r) => ({ expenditure: r.target.expenditure, target: r.target.kcal, fixed: r.day.dayType === 'cheat', fixedKcal: r.totals.kcal }));
  const budget = weekBudget(input, { floor });
  const rows = base.rows.map((r, i) => {
    const fixed = input[i].fixed;
    const fit = fixed ? 1 : fitFactor(r.totals.kcal, budget[i], step);
    return { ...r, budget: budget[i], fit, fixed, adjusted: scale(r.totals, fit) };
  });
  const adjusted = sum(rows.map((r) => r.adjusted));
  return { ...base, rows, adjusted, budgetTotal: budget.reduce((a, b) => a + b, 0), adjustedBalance: adjusted.kcal - base.expenditure };
}
