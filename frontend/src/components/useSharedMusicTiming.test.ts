import { expect, it } from 'vitest';
import { remoteMusicPosition } from './useSharedMusicTiming';
import type { WorshipMusicTimingRead } from '../api';
const snapshot: WorshipMusicTimingRead = { server_now: 1_000_500, timing: {
  owner_id: 'host', active: true, song_id: 'song', plan_item_id: 'item', start_index: 3, position: 0.25,
  bar_duration_ms: 2000, total_bars: 5, updated_at: 1_000_000,
} };
it('animates between polls using server elapsed time and a local monotonic clock', () => {
  expect(remoteMusicPosition(snapshot, 200, 700, 100)).toBeCloseTo(0.775);
  // Local wall-clock/timezone differences are irrelevant; only monotonic elapsed time is used.
  expect(remoteMusicPosition(snapshot, 900_200, 900_700, 100)).toBeCloseTo(0.775);
});
it('clears stopped, completed and disconnected timing', () => {
  expect(remoteMusicPosition({ ...snapshot, timing: null }, 0, 0)).toBeNull();
  expect(remoteMusicPosition(snapshot, 0, 12000)).toBeNull();
  expect(remoteMusicPosition({ ...snapshot, timing: { ...snapshot.timing!, position: 4.95 } }, 0, 0)).toBeNull();
});

it('crosses short and long bars using their individual durations', () => {
  const mixed = { ...snapshot, server_now: 1_000_000, timing: { ...snapshot.timing!, position: 0.75, bar_durations_ms: [2000, 1000, 3000, 2000, 2000] } };
  expect(remoteMusicPosition(mixed, 0, 1000)).toBeCloseTo(1.5);
  expect(remoteMusicPosition(mixed, 0, 2250)).toBeCloseTo(2.25);
});
