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

it('holds a repeated section in one frame through every bar and repetition', () => {
  const points = [{ bar: 0, y: 400 }, { bar: 2, y: 650 }, { bar: 4, y: 400 }, { bar: 6, y: 650 }, { bar: 8, y: 400 }, { bar: 10, y: 650 }, { bar: 12, y: 1000 }];
  const region = { top: 350, bottom: 700 };
  const targets = [0, 1.5, 3.9, 4, 6, 7.9, 8, 10, 11.99].map(position => playbackScrollTarget(points, position, position % 4 < 2 ? 400 : 650, 600, region));
  expect(targets).toEqual(Array(targets.length).fill(225));
  expect(playbackScrollTarget(points, 12, 1000, 600)).toBeGreaterThan(225);
});

it('holds the top of an oversized repeat and keeps the active line low before returning', () => {
  const points = [{ bar: 0, y: 400 }, { bar: 4, y: 1300 }];
  const start = { top: 350, bottom: 1500, activeBottom: 420 };
  const end = { ...start, activeBottom: 1300 };
  const first = playbackScrollTarget(points, 0, 400, 600, start);
  const last = playbackScrollTarget(points, 3, 1280, 600, end);
  expect(first).toBe(290);
  expect(last).toBe(760);
  expect(end.activeBottom - last).toBe(540); // bottom of the active line stays at 90% of the viewport
  expect(last).toBeLessThan(playbackScrollTarget(points, 3, 1280, 600));
  expect(playbackScrollTarget(points, 4, 400, 600, start)).toBe(first);
  expect(playbackScrollTarget(points, 0, 100, 600, { top: 0, bottom: 200 })).toBe(0);
});
