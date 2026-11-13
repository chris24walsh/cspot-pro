// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { WorshipMusicTiming, WorshipMusicTimingCommand, WorshipMusicTimingRead } from '../api';
import { useSharedMusicTiming } from './useSharedMusicTiming';

const api = vi.hoisted(() => ({ command: vi.fn(), get: vi.fn(), heartbeat: vi.fn() }));
vi.mock('../api', () => ({ commandWorshipMusicTiming: api.command, getWorshipMusicTiming: api.get, heartbeatWorshipMusicTiming: api.heartbeat }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialTiming: WorshipMusicTiming = {
  owner_id: 'device-0', active: true, song_id: 'song', plan_item_id: 'old-item', start_index: 0,
  first_bar_stop: 0, position: 0, bar_duration_ms: 1000, bar_durations_ms: [1000, 1000], total_bars: 8, updated_at: 10_000,
};
let service: WorshipMusicTimingRead;
let readCount: number;
let heldReads: Array<{ value: WorshipMusicTimingRead; resolve: (value: WorshipMusicTimingRead) => void }>;
let delayedReadCalls: Set<number>;
let heldOwnerUpdate: ((value: WorshipMusicTimingRead) => void) | null;
let heldOwnerUpdateValue: WorshipMusicTimingRead | null;
function copy(value: WorshipMusicTimingRead): WorshipMusicTimingRead { return structuredClone(value); }
function stopSnapshot(commandId: string): WorshipMusicTimingRead {
  return { ...service, revision: service.revision + 1, session_id: null, status: 'stopped', timing: null, pending: null,
    command_id: commandId, server_now: 12_000, owner: { owner_id: null, last_seen_at: null, connected: false } };
}

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

it('keeps five hook clients revision-safe through a delayed reader, owner race, pending reseat, and admin stop', async () => {
  vi.useFakeTimers();
  service = {
    plan_id: 'plan', revision: 1, session_id: 'session', status: 'running', timing: initialTiming,
    pending: null, command_id: null, server_now: 10_000,
    owner: { owner_id: 'device-0', last_seen_at: 10_000, connected: true },
  };
  readCount = 0; heldReads = []; delayedReadCalls = new Set(); heldOwnerUpdate = null; heldOwnerUpdateValue = null;
  api.get.mockImplementation(() => {
    readCount += 1;
    const value = copy(service);
    if (delayedReadCalls.has(readCount)) {
      return new Promise(resolve => heldReads.push({ value, resolve }));
    }
    return Promise.resolve(value);
  });
  api.heartbeat.mockImplementation(async () => copy(service));
  api.command.mockImplementation(async (_plan: string, command: WorshipMusicTimingCommand) => {
    if (command.action === 'stop') {
      service = stopSnapshot(command.command_id);
      return copy(service);
    }
    if (command.action === 'reseat' && command.timing?.plan_item_id === 'late-owner-destination') {
      heldOwnerUpdateValue = copy(service);
      return new Promise(resolve => { heldOwnerUpdate = resolve; });
    }
    service = {
      ...service, revision: service.revision + 1, command_id: command.command_id,
      pending: { timing: { ...command.timing!, updated_at: 12_000 }, effective_at: 12_000, command_id: command.command_id },
      server_now: 11_000,
    };
    return copy(service);
  });

  const clients: Record<string, ReturnType<typeof useSharedMusicTiming>> = {};
  function Client({ id }: { id: string }) {
    clients[id] = useSharedMusicTiming({
      planId: 'plan', songId: 'song', itemId: 'old-item', enabled: false,
      canReseat: id === 'leader' || id === 'device-0', canAdminStop: id === 'admin',
      follow: true, clientId: id === 'device-0' ? 'device-0' : id,
    });
    return null;
  }
  const root = createRoot(document.createElement('div'));
  const ids = ['device-0', 'leader', 'reader-2', 'admin', 'slow-reader'];
  const destination = (planItemId: string): WorshipMusicTiming => ({
    ...initialTiming, owner_id: 'device-0', plan_item_id: planItemId, start_index: 3, position: 0, updated_at: 0,
  });
  try {
    await act(async () => root.render(<>{ids.map(id => <Client id={id} key={id} />)}</>));
    expect(readCount).toBe(5);

    await act(async () => { await clients.leader.requestReseat(destination('new-item')); });
    expect(service.revision).toBe(2);
    expect(service.pending?.command_id).toBeTruthy();
    expect(service.owner.owner_id).toBe('device-0');
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(clients['reader-2'].remote?.timing.plan_item_id).toBe('old-item');
    service.server_now = 12_000;
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    for (const id of ['leader', 'reader-2', 'admin', 'slow-reader']) {
      expect(clients[id].remote?.timing.plan_item_id, id).toBe('new-item');
    }
    expect(clients['device-0'].ownerReseat?.timing.plan_item_id).toBe('new-item');

    delayedReadCalls.add(readCount + 1);
    delayedReadCalls.add(readCount + 5);
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(heldReads).toHaveLength(2);
    let ownerUpdate!: Promise<unknown>;
    await act(async () => {
      ownerUpdate = clients['device-0'].requestReseat(destination('late-owner-destination'));
      await Promise.resolve();
    });
    expect(heldOwnerUpdate).toBeTypeOf('function');

    act(() => clients.admin.stopShared());
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(service.status).toBe('stopped');
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(clients['device-0'].clockStatus).toBe('stopped');
    expect(clients['device-0'].ownerStopRevision).toBe(1);

    await act(async () => {
      heldOwnerUpdate!(heldOwnerUpdateValue!);
      heldReads[0].resolve(heldReads[0].value);
      heldReads[1].resolve(heldReads[1].value);
      await ownerUpdate;
    });
    expect(clients['device-0'].clockStatus).toBe('stopped');
    expect(clients['device-0'].ownerReseat).toBeNull();
    const commandCount = api.command.mock.calls.length;
    act(() => clients['device-0'].setLocalTiming({ startIndex: 0, position: 0, barDurationMs: 1000, totalBars: 8 }));
    expect(api.command).toHaveBeenCalledTimes(commandCount);

    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(clients['slow-reader'].clockStatus).toBe('stopped');
    expect(clients['device-0'].ownerStopRevision).toBe(1);
  } finally { act(() => root.unmount()); }
});
