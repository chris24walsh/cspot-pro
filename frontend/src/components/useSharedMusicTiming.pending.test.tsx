// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSharedMusicTiming } from './useSharedMusicTiming';
import type { WorshipMusicTimingRead, WorshipMusicTimingCommand } from '../api';

const api = vi.hoisted(() => ({ command: vi.fn(), get: vi.fn(), heartbeat: vi.fn() }));
vi.mock('../api', () => ({ commandWorshipMusicTiming: api.command, getWorshipMusicTiming: api.get, heartbeatWorshipMusicTiming: api.heartbeat }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initial: WorshipMusicTimingRead = {
  plan_id: 'plan', revision: 1, session_id: 'session', status: 'running',
  timing: { owner_id: 'audio-owner', active: true, song_id: 'song', plan_item_id: 'item', start_index: 0, first_bar_stop: 0, position: 0.3, bar_duration_ms: 1000, bar_durations_ms: null, total_bars: 6, updated_at: 10_000 },
  pending: null, command_id: null, server_now: 10_000, owner: { owner_id: 'audio-owner', last_seen_at: 10_000, connected: true },
};

it('serializes competing manual reseats with fresh revisions so the newer destination supersedes', async () => {
  let finishFirst!: (value: WorshipMusicTimingRead & { command_id: string }) => void;
  api.get.mockResolvedValue(initial);
  api.command.mockImplementationOnce((_plan: string, _command: WorshipMusicTimingCommand) => new Promise(resolve => { finishFirst = resolve; }))
    .mockImplementation(async (_plan: string, command: WorshipMusicTimingCommand) => ({
      ...initial, revision: 3, timing: { ...initial.timing!, plan_item_id: command.timing!.plan_item_id, updated_at: 12_000 },
      pending: { timing: { ...command.timing!, updated_at: 12_000 }, effective_at: 12_000, command_id: command.command_id },
      command_id: command.command_id, server_now: 11_000,
    }));
  let clock!: ReturnType<typeof useSharedMusicTiming>;
  function Controller() {
    clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', enabled: false, canReseat: true, canAdminStop: false, follow: false, clientId: 'controller' });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Controller />));
    const make = (itemId: string) => ({ owner_id: 'audio-owner', active: true, song_id: 'song', plan_item_id: itemId, start_index: 1, first_bar_stop: 0, position: 0, bar_duration_ms: 1000, bar_durations_ms: null, total_bars: 4, updated_at: 0 });
    let first!: ReturnType<typeof clock.requestReseat>;
    let second!: ReturnType<typeof clock.requestReseat>;
    await act(async () => {
      first = clock.requestReseat(make('first-destination'));
      second = clock.requestReseat(make('newest-destination'));
      await Promise.resolve();
    });
    expect(api.command).toHaveBeenCalledOnce();
    await act(async () => finishFirst({
      ...initial, revision: 2, pending: { timing: make('first-destination'), effective_at: 11_000, command_id: 'first' },
      command_id: 'first', server_now: 10_500,
    }));
    await act(async () => { await first; await second; });
    expect(api.command).toHaveBeenCalledTimes(2);
    expect(api.command.mock.calls[1][1]).toMatchObject({
      action: 'reseat', expected_revision: 2, timing: { plan_item_id: 'newest-destination' },
    });
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
