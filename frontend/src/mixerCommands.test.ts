import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MixerCommandQueue, type MixerCommand } from './mixerCommands';
const command = (path: string, value: number, sequence = 1): MixerCommand => ({
  path,
  value,
  sequence,
  confirm_phantom: false
});
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});
it('bounds mobile requests and sends only the newest values after a slow response', async () => {
  const release: Array<() => void> = [];
  const send = vi.fn((_commands: MixerCommand[]) => new Promise<void>(resolve => release.push(resolve)));
  const queue = new MixerCommandQueue(send, vi.fn());
  queue.enqueue(command('/ch/01/mix/fader', .1));
  await vi.advanceTimersByTimeAsync(35);
  for (let i = 2; i <= 9; i++) queue.enqueue(command('/ch/01/mix/fader', i / 10, i));
  queue.enqueue(command('/ch/02/mix/on', 0), true);
  await vi.advanceTimersByTimeAsync(2000);
  expect(send).toHaveBeenCalledTimes(1);
  release.shift()!();
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1][0]).toEqual([command('/ch/01/mix/fader', .9, 9), command('/ch/02/mix/on', 0)]);
  release.shift()!();
  await vi.advanceTimersByTimeAsync(0);
  expect(queue.outstanding('/ch/01/mix/fader')).toBe(false);
  queue.dispose();
});
it('never replays queued movements after leaving the mixer', async () => {
  let release!: () => void;
  const send = vi.fn((_commands: MixerCommand[]) => new Promise<void>(resolve => {
    release = resolve;
  }));
  const queue = new MixerCommandQueue(send, vi.fn());
  queue.enqueue(command('/ch/01/mix/fader', .1), true);
  queue.enqueue(command('/ch/01/mix/fader', .9));
  queue.dispose();
  release();
  await vi.advanceTimersByTimeAsync(0);
  expect(send).toHaveBeenCalledTimes(1);
});
it('limits batches and reports failed commands without an automatic replay', async () => {
  const failed = vi.fn();
  const send = vi.fn(async (_commands: MixerCommand[]) => {
    throw new Error('Network error');
  });
  const queue = new MixerCommandQueue(send, failed);
  for (let i = 1; i <= 40; i++) queue.enqueue(command('/parameter/' + i, .5));
  await vi.advanceTimersByTimeAsync(35);
  expect(send.mock.calls.map(([commands]) => commands.length)).toEqual([32, 8]);
  expect(failed).toHaveBeenCalledTimes(2);
  queue.dispose();
});
