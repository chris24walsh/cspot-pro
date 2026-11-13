// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import type { WorshipMusicTimingRead } from '../api';
import { useSharedMusicTiming } from './useSharedMusicTiming';

const api = vi.hoisted(() => ({ command: vi.fn(), get: vi.fn(), heartbeat: vi.fn() }));
vi.mock('../api', () => ({
  commandWorshipMusicTiming: api.command,
  getWorshipMusicTiming: api.get,
  heartbeatWorshipMusicTiming: api.heartbeat,
}));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stopped: WorshipMusicTimingRead = {
  plan_id: 'plan', revision: 4, session_id: null, status: 'stopped', timing: null, pending: null, command_id: null,
  server_now: 10_000, owner: { owner_id: null, last_seen_at: null, connected: false },
};
const running = (revision: number, timing: NonNullable<WorshipMusicTimingRead['timing']>): WorshipMusicTimingRead => ({
  ...stopped, revision, session_id: 'session', status: 'running', timing,
  owner: { owner_id: timing.owner_id, last_seen_at: 10_000, connected: true },
});

beforeEach(() => { vi.clearAllMocks(); api.get.mockResolvedValue(stopped); });

it('starts with the current revision, then reseats the destination through a command', async () => {
  let clock!: ReturnType<typeof useSharedMusicTiming>;
  function Harness() { clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', enabled: true, canReseat: true, canAdminStop: false, follow: false }); return null; }
  const root = createRoot(document.createElement('div'));
  api.command.mockImplementation(async (_plan: string, command: { action: string; timing: NonNullable<WorshipMusicTimingRead['timing']> }) => running(command.action === 'start' ? 5 : 6, command.timing));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => clock.setLocalTiming({ startIndex: 2, position: 0.1, barDurationMs: 2000, totalBars: 8 }));
    expect(api.command).toHaveBeenLastCalledWith('plan', expect.objectContaining({ action: 'start', expected_revision: 4, timing: expect.objectContaining({ song_id: 'song', plan_item_id: 'item' }) }));
    await act(async () => clock.requestReseat({ owner_id: '', active: true, song_id: 'song-2', plan_item_id: 'item-2', start_index: 0, first_bar_stop: 0, position: 0, bar_duration_ms: 2000, bar_durations_ms: null, total_bars: 5, updated_at: 0 }));
    expect(api.command).toHaveBeenLastCalledWith('plan', expect.objectContaining({ action: 'reseat', expected_revision: 5, timing: expect.objectContaining({ song_id: 'song-2', plan_item_id: 'item-2' }) }));
    expect(api.heartbeat).not.toHaveBeenCalledWith('plan', expect.objectContaining({ timeline: expect.anything() }));
  } finally { act(() => root.unmount()); }
});

it('keeps musicians from issuing shared clock changes', async () => {
  let clock!: ReturnType<typeof useSharedMusicTiming>;
  function Harness() { clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', enabled: true, canReseat: false, canAdminStop: false, follow: false }); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Harness />));
    await act(async () => clock.setLocalTiming({ startIndex: 0, position: 0, barDurationMs: 2000, totalBars: 4 }));
    clock.stopShared();
    expect(api.command).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});

it('delivers an authoritative scheduled reseat to its audio owner and an admin stop invalidates it', async () => {
  const timing = { owner_id: 'owner-device', active: true, song_id: 'song', plan_item_id: 'item', start_index: 2, first_bar_stop: 0, position: 0, bar_duration_ms: 1000, bar_durations_ms: [1000, 1000], total_bars: 2, updated_at: 20_000 };
  const scheduled: WorshipMusicTimingRead = {
    ...stopped, revision: 5, session_id: 'session', status: 'running', timing,
    pending: { timing: { ...timing, song_id: 'next-song', plan_item_id: 'next-item', start_index: 4 }, effective_at: 12_000, command_id: 'reseat-1' },
    owner: { owner_id: 'owner-device', last_seen_at: 10_000, connected: true }, server_now: 10_000, command_id: 'reseat-1',
  };
  api.get.mockResolvedValue(scheduled);
  api.command.mockResolvedValue({ ...stopped, revision: 6, command_id: 'stop-1' });
  const ownerStopped = vi.fn();
  let clock!: ReturnType<typeof useSharedMusicTiming>;
  function Owner() {
    clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', enabled: true, canReseat: true, canAdminStop: true, follow: false, clientId: 'owner-device', onOwnerStop: ownerStopped });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Owner />));
    expect(clock.ownerReseat).toMatchObject({ commandId: 'reseat-1', revision: 5, timing: { song_id: 'next-song', start_index: 4 } });
    expect(clock.ownerReseat!.effectiveAt).toBeGreaterThan(performance.now());
    expect(clock.ownerStopRevision).toBe(0);
    await act(async () => clock.stopShared());
    expect(api.command).toHaveBeenLastCalledWith('plan', expect.objectContaining({ action: 'stop', expected_revision: 5 }));
    expect(api.command.mock.calls[api.command.mock.calls.length - 1]?.[1]).not.toHaveProperty('owner_id');
    expect(clock.ownerReseat).toBeNull();
    expect(clock.ownerStopRevision).toBe(1);
    expect(ownerStopped).toHaveBeenCalledOnce();
    await act(async () => clock.setLocalTiming({ startIndex: 0, position: 0.1, barDurationMs: 2000, totalBars: 4 }));
    expect(api.command).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); }
});

it('preserves a past server effective time for an owner that receives the reseat late', async () => {
  const timing = { owner_id: 'owner-device', active: true, song_id: 'song', plan_item_id: 'item', start_index: 2, first_bar_stop: 0, position: 0, bar_duration_ms: 1000, bar_durations_ms: null, total_bars: 8, updated_at: 9_000 };
  api.get.mockResolvedValue({
    ...stopped, revision: 5, session_id: 'session', status: 'running', timing,
    pending: { timing: { ...timing, plan_item_id: 'late-item' }, effective_at: 9_000, command_id: 'late-reseat' },
    owner: { owner_id: 'owner-device', last_seen_at: 11_000, connected: true }, server_now: 11_000,
  });
  let clock!: ReturnType<typeof useSharedMusicTiming>;
  function Owner() {
    clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', enabled: true, canReseat: true, canAdminStop: false, follow: false, clientId: 'owner-device' });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Owner />));
    expect(clock.ownerReseat).toMatchObject({ commandId: 'late-reseat', timing: { plan_item_id: 'late-item' } });
    expect(clock.ownerReseat!.effectiveAt).toBeLessThan(performance.now());
  } finally { act(() => root.unmount()); }
});
