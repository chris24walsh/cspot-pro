import { expect, it } from 'vitest';
import { playbackScrollTarget } from './playbackScroll';

it('keeps a steady pace through evenly spaced bars', () => {
  const points = Array.from({ length: 21 }, (_, bar) => ({ bar, y: 500 + bar * 100 }));
  const targets = [5, 6, 7, 8].map(position => playbackScrollTarget(points, position, 500 + position * 100, 600));
  expect(targets.slice(1).map((target, index) => target - targets[index])).toEqual([100, 100, 100]);
});
it('smooths held lines and dense changes while keeping the active lyrics in view', () => {
  const points = [{ bar: 0, y: 500 }, { bar: 4, y: 500 }, { bar: 5, y: 900 }, { bar: 8, y: 1200 }];
  const before = playbackScrollTarget(points, 3, 500, 600);
  const after = playbackScrollTarget(points, 3.5, 500, 600);
  expect(after).toBeGreaterThan(before);
  for (const activeY of [500, 900, 1200]) {
    const target = playbackScrollTarget(points, 4.5, activeY, 600);
    expect(activeY - target).toBeGreaterThanOrEqual(600 * 0.32);
    expect(activeY - target).toBeLessThanOrEqual(600 * 0.65);
  }
});
