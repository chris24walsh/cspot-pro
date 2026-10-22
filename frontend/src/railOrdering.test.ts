import { expect, it } from 'vitest';
import { railMovePosition } from './railOrdering';
const items = [
  { id: 'one', sequence: '10' }, { id: 'two', sequence: '20' }, { id: 'empty', sequence: '30' },
  { id: 'a', sequence: '10', parent_item_id: 'one' },
  { id: 'b', sequence: '20', parent_item_id: 'one' },
  { id: 'c', sequence: '10', parent_item_id: 'two' },
];
it('moves into a populated or empty section', () => {
  expect(railMovePosition(items, 'a', 'two', 'inside')).toEqual({ parent_item_id: 'two', after_item_id: 'c' });
  expect(railMovePosition(items, 'a', 'empty', 'inside')).toEqual({ parent_item_id: 'empty', after_item_id: null });
});
it('moves out of a section into the running order', () => {
  expect(railMovePosition(items, 'a', 'two', 'before')).toEqual({ parent_item_id: null, after_item_id: 'one' });
  expect(railMovePosition(items, 'a', 'two', 'after')).toEqual({ parent_item_id: null, after_item_id: 'two' });
});
it('moves between sections relative to another child', () => {
  expect(railMovePosition(items, 'a', 'c', 'before')).toEqual({ parent_item_id: 'two', after_item_id: null });
  expect(railMovePosition(items, 'a', 'c', 'after')).toEqual({ parent_item_id: 'two', after_item_id: 'c' });
});
it('reorders siblings and whole sections', () => {
  expect(railMovePosition(items, 'b', 'a', 'before')).toEqual({ parent_item_id: 'one', after_item_id: null });
  expect(railMovePosition(items, 'two', 'one', 'before')).toEqual({ parent_item_id: null, after_item_id: null });
});
it('rejects self drops, missing items, cycles, and deeper nesting', () => {
  expect(railMovePosition(items, 'a', 'a', 'inside')).toBeNull();
  expect(railMovePosition(items, 'missing', 'a', 'after')).toBeNull();
  expect(railMovePosition(items, 'one', 'b', 'after')).toBeNull();
  expect(railMovePosition(items, 'one', 'two', 'inside')).toBeNull();
  expect(railMovePosition(items, 'b', 'a', 'inside')).toBeNull();
});
