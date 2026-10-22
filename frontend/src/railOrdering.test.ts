import { expect, it } from 'vitest';
import { reorderRailItems } from './railOrdering';
const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
it.each([
  ['a', 'c', true, ['b', 'c', 'a', 'd']],
  ['d', 'b', false, ['a', 'd', 'b', 'c']],
  ['b', 'c', false, ['a', 'b', 'c', 'd']],
  ['a', 'a', true, ['a', 'b', 'c', 'd']],
  ['missing', 'b', true, ['a', 'b', 'c', 'd']],
])('moves %s relative to %s', (source, target, after, expected) => {
  expect(reorderRailItems(items, source, target, after).map((item) => item.id)).toEqual(expected);
});
