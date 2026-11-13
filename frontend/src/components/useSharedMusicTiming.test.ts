import { expect, it } from 'vitest';
import type { WorshipMusicTimingRead } from '../api';
import { remoteMusicPosition } from './useSharedMusicTiming';

const timing = {
  owner_id: 'host', active: true, song_id: 'song', plan_item_id: 'item',
  start_index: 3, first_bar_stop: 0.25, position: 0.25,
  bar_duration_ms: 2000, bar_durations_ms: null, total_bars: 5, updated_at: 1_000_000,
};
const snapshot: WorshipMusicTimingRead = {
  plan_id: 'plan', revision: 3, session_id: 'session', status: 'running',
  owner: { owner_id: 'host', last_seen_at: 1_000_000, connected: true },
  server_now: 1_000_500, timing, pending: null, command_id: null,
};

it('interpolates on a monotonic client clock independent of device wall time', () => {
  expect(remoteMusicPosition(snapshot, 200, 700, 100)).toBeCloseTo(0.775);
  expect(remoteMusicPosition(snapshot, 900_200, 900_700, 100)).toBeCloseTo(0.775);
});

it('keeps the previous clock until a scheduled reseat boundary, then adopts the destination', () => {
  const pending = { ...snapshot, pending: { timing: { ...timing, position: 0, start_index: 7 }, effective_at: 1_002_000, command_id: 'reseat' } };
  expect(remoteMusicPosition(pending, 0, 1499)).toBeCloseTo(1.2495);
  expect(remoteMusicPosition(pending, 0, 1500)).toBeCloseTo(0);
});

it('respects per-bar variable durations and stop tombstones', () => {
  const mixed = { ...snapshot, server_now: 1_000_000, timing: { ...timing, position: 0.75, bar_durations_ms: [2000, 1000, 3000, 2000, 2000] } };
  expect(remoteMusicPosition(mixed, 0, 1000)).toBeCloseTo(1.5);
  expect(remoteMusicPosition(mixed, 0, 2250)).toBeCloseTo(2.25);
  expect(remoteMusicPosition({ ...snapshot, status: 'stopped', timing: null, pending: null }, 0, 0)).toBeNull();
});
