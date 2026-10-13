// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSharedMusicTiming } from './useSharedMusicTiming';
import { updateWorshipMusicTiming } from '../api';
import type { MusicTimingProgress } from './LyricMusicControls';
vi.mock('../api', () => ({ getWorshipMusicTiming: vi.fn(), updateWorshipMusicTiming: vi.fn(async (_plan, timing) => ({ timing: timing.active ? timing : null, server_now: 0 })) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('publishes only when opted in, uses bounded heartbeats, and releases on stop and unmount', async () => {
  vi.useFakeTimers();
  let localTiming: (timing: MusicTimingProgress | null) => void = () => {};
  function Harness({ share }: { share: boolean }) {
    const clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', share, follow: false });
    localTiming = clock.setLocalTiming;
    return null;
  }
  const container = document.createElement('div'), root = createRoot(container);
  const timing = { startIndex: 3, position: 0.2, barDurationMs: 2000, totalBars: 5 };
  try {
    await act(async () => root.render(<Harness share={false} />));
    act(() => localTiming(timing));
    expect(updateWorshipMusicTiming).not.toHaveBeenCalled();
    await act(async () => root.render(<Harness share />));
    expect(updateWorshipMusicTiming).toHaveBeenCalledOnce();
    expect(vi.mocked(updateWorshipMusicTiming).mock.calls[0][1]).toMatchObject({ active: true, start_index: 3, position: 0.2 });
    act(() => { for (let frame = 0; frame < 30; frame++) localTiming({ ...timing, position: frame / 100 }); });
    expect(updateWorshipMusicTiming).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTime(2000));
    expect(updateWorshipMusicTiming).toHaveBeenCalledTimes(2);
    await act(async () => localTiming(null));
    expect(vi.mocked(updateWorshipMusicTiming).mock.calls[2][1].active).toBe(false);
    await act(async () => localTiming(timing));
    expect(vi.mocked(updateWorshipMusicTiming).mock.calls[3][1].active).toBe(true);
    await act(async () => root.unmount());
    expect(vi.mocked(updateWorshipMusicTiming).mock.calls[4][1].active).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); vi.clearAllMocks(); }
});
