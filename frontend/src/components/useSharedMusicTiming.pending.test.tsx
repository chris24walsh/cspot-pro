// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useSharedMusicTiming } from './useSharedMusicTiming';
import { updateWorshipMusicTiming, type WorshipMusicTimingRead } from '../api';
vi.mock('../api', () => ({ getWorshipMusicTiming: vi.fn(), updateWorshipMusicTiming: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('publishes a seek during a pending update without waiting for the next heartbeat', async () => {
  let finish!: (value: WorshipMusicTimingRead) => void;
  vi.mocked(updateWorshipMusicTiming).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValue({ timing: null, server_now: 0 });
  let clock!: ReturnType<typeof useSharedMusicTiming>;
  function Device() { clock = useSharedMusicTiming({ planId: 'plan', songId: 'song', itemId: 'item', share: true, follow: false }); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    await act(async () => root.render(<Device />));
    const timing = { position: 2, startIndex: 0, barDurationMs: 2000, totalBars: 10 };
    await act(async () => clock.setLocalTiming(timing));
    await act(async () => clock.setLocalTiming({ ...timing, position: 0 }));
    expect(updateWorshipMusicTiming).toHaveBeenCalledTimes(1);
    await act(async () => finish({ timing: null, server_now: 0 }));
    expect(updateWorshipMusicTiming).toHaveBeenCalledTimes(2);
    expect(vi.mocked(updateWorshipMusicTiming).mock.calls[1][1].position).toBe(0);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
