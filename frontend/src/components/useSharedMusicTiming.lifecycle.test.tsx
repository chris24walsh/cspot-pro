// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSharedMusicTiming } from './useSharedMusicTiming';
import type { WorshipMusicTimingRead } from '../api';

const api = vi.hoisted(() => ({ command: vi.fn(), get: vi.fn(), heartbeat: vi.fn() }));
vi.mock('../api', () => ({ commandWorshipMusicTiming: api.command, getWorshipMusicTiming: api.get, heartbeatWorshipMusicTiming: api.heartbeat }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const stopped: WorshipMusicTimingRead = {
  plan_id: 'plan', revision: 0, session_id: null, status: 'stopped', timing: null, pending: null,
  command_id: null, server_now: 0, owner: { owner_id: null, last_seen_at: null, connected: false },
};

it('keeps unsynced playback private and cleans polling when an eligible device unmounts', async () => {
  vi.useFakeTimers();
  api.get.mockResolvedValue(stopped);
  api.command.mockResolvedValue(stopped);
  let clock!: ReturnType<typeof useSharedMusicTiming>;
  function Device({ enabled }: { enabled: boolean }) {
    clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', enabled, canReseat: true, canAdminStop: false, follow: false });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Device enabled={false} />));
    act(() => clock.setLocalTiming({ startIndex: 0, position: 0.1, barDurationMs: 2000, totalBars: 4 }));
    expect(api.command).not.toHaveBeenCalled();
    await act(async () => root.render(<Device enabled />));
    act(() => clock.setLocalTiming(null));
    act(() => clock.setLocalTiming({ startIndex: 0, position: 0.2, barDurationMs: 2000, totalBars: 4 }));
    await act(async () => Promise.resolve());
    expect(api.command).toHaveBeenCalledOnce();
    await act(async () => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    act(() => clock.setLocalTiming({ startIndex: 0, position: 0.3, barDurationMs: 2000, totalBars: 4 }));
    expect(api.command).toHaveBeenCalledOnce();
  } finally { vi.useRealTimers(); vi.clearAllMocks(); }
});
