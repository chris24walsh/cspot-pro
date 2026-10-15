import { expect, it } from 'vitest';
import { introBarFills, visualBeat } from './BeatKeeper';
it('groups an eight-beat bar into four visual pulses without changing bar duration', () => {
  expect([0, 0.125, 0.25, 0.5, 0.75, 0.999, 1].map(position => visualBeat(position, 4))).toEqual([0, 0, 1, 2, 3, 3, 0]);
});
it('keeps count-in pulses moving left to right and leaves an idle display unhighlighted', () => {
  expect([-1, -0.75, -0.5, -0.25].map(position => visualBeat(position, 4))).toEqual([0, 1, 2, 3]);
  expect(visualBeat(null, 4)).toBeNull();
});

it('fills one half per bar of a two-bar intro', () => {
  expect(introBarFills(-2, 2)).toEqual([0, 0]);
  expect(introBarFills(-1.5, 2)).toEqual([0.5, 0]);
  expect(introBarFills(-1, 2)).toEqual([1, 0]);
  expect(introBarFills(-0.5, 2)).toEqual([1, 0.5]);
  expect(introBarFills(0, 2)).toEqual([1, 1]);
});
it('fills one quadrant per bar of a four-bar intro', () => {
  expect(introBarFills(-2.5, 4)).toEqual([1, 0.5, 0, 0]);
  expect(introBarFills(-0.25, 4)).toEqual([1, 1, 1, 0.75]);
});
