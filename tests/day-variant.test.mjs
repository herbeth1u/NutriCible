import test from 'node:test';
import assert from 'node:assert/strict';
import { effectiveFactor, emptyDay, withMeal } from '../src/day.js';

test('variante : remplacer un repas de « Ma journée » garde son facteur de départ et son facteur propre', () => {
  let day = { ...emptyDay(), global: 1.2, items: [{ meal: 'a', base: 1 }, { meal: 'b', base: 0.75, own: 1.5 }, { meal: 'c', base: 1 }] };
  const before = JSON.stringify(day);
  day = withMeal(day, 1, 'b2');
  assert.deepEqual(day.items, [{ meal: 'a', base: 1 }, { meal: 'b2', base: 0.75, own: 1.5 }, { meal: 'c', base: 1 }]);
  assert.equal(effectiveFactor(day.items[1], day.global), 1.5);
  assert.equal(day.global, 1.2);
  assert.equal(JSON.stringify(withMeal(JSON.parse(before), 9, 'x')), before); // indice inconnu : rien ne change
});
