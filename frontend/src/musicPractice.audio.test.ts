// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildPracticePerformance, chordMidiNotes, PracticeAudioPlayer } from "./musicPractice";
import type { SongRhythm } from "./songRhythm";

const instances: FakeAudioContext[] = [];
class FakeAudioContext {
  currentTime = 0;
  state = "running";
  destination = {};
  sampleRate = 44100;
  buffers: Float32Array[] = [];
  createBuffer(_channels: number, length: number) { return { copyToChannel: (samples: Float32Array) => { this.buffers.push(samples); }, length }; }
  decodeAudioData(_data: ArrayBuffer, resolve: (buffer: unknown) => void) { resolve({ duration: 8 }); }
  createBufferSource() { const context = this; return { buffer: null, playbackRate: { setValueAtTime: (rate: number) => context.frequencies.push(rate) }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null }; }
  frequencies: number[] = [];
  waveUses = 0;
  waves: number[][] = [];
  createPeriodicWave(_real: Float32Array, imaginary: Float32Array) { this.waves.push(Array.from(imaginary)); return {}; }
  constructor() { instances.push(this); }
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  createGain() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn(), cancelScheduledValues: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createOscillator() {
    return { type: "", setPeriodicWave: () => { this.waveUses += 1; }, frequency: { setValueAtTime: (frequency: number) => this.frequencies.push(frequency) }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  }
}
const rhythm: SongRhythm = { numerator: 4, denominator: 4, bpm: 120, notes: "", patterns: [{ section: "Default", subdivision: 1, strokes: ["U", "D", "-", "X"] }], arrangements: [{ section: "Default", chart: "C" }] };
let player: PracticeAudioPlayer;
beforeEach(() => { instances.length = 0; vi.useFakeTimers(); vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }))); vi.stubGlobal("AudioContext", FakeAudioContext); player = new PracticeAudioPlayer(); });
afterEach(() => { player.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("schedules upstrokes from high to low, then ends and closes the audio context", async () => {
  const performance = buildPracticePerformance(rhythm, { mode: "song" });
  const ended = vi.fn();
  await player.play(performance, false, vi.fn(), ended);
  expect(instances[0].frequencies).toHaveLength(chordMidiNotes("C").length);
  expect(instances[0].frequencies.every(rate => rate > 0.8 && rate < 1.3)).toBe(true);
  instances[0].currentTime = 2.2;
  vi.advanceTimersByTime(25);
  expect(ended).toHaveBeenCalledOnce();
  expect(instances[0].close).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it("stops the previous preview when another starts and clears loop timers on stop", async () => {
  const performance = buildPracticePerformance(rhythm, { mode: "song" });
  const firstEnded = vi.fn();
  await player.play(performance, true, vi.fn(), firstEnded);
  const second = new PracticeAudioPlayer();
  await second.play(performance, true, vi.fn(), vi.fn());
  expect(firstEnded).toHaveBeenCalledOnce();
  expect(instances[0].state).toBe("closed");
  second.stop();
  expect(instances[1].state).toBe("closed");
  expect(vi.getTimerCount()).toBe(0);
});

it('reports fractional progress from the audio clock, excluding the count-in', async () => {
  const music = buildPracticePerformance(rhythm, { mode: 'song', countIn: true, metronome: true, chords: false });
  expect(music.notes.every(note => note.channel === 9)).toBe(true);
  const position = vi.fn();
  await player.play(music, false, vi.fn(), vi.fn(), position);
  expect(position.mock.calls[0][0]).toBeLessThan(0);
  instances[0].currentTime = 2.08 + 0.5; // one 2-second bar of count-in + quarter-bar
  vi.advanceTimersByTime(25);
  expect(position.mock.calls[position.mock.calls.length - 1][0]).toBeCloseTo(0.25);
});

it('runs silent guidance without constructing an audio context and cleans up the clock', async () => {
  const { PracticeSilentPlayer } = await import('./musicPractice');
  const silent = new PracticeSilentPlayer();
  const music = buildPracticePerformance(rhythm, { mode: 'song', countIn: false, chords: false, metronome: false });
  const position = vi.fn(), ended = vi.fn();
  const now = vi.spyOn(performance, 'now').mockReturnValue(0);
  try {
    await silent.play(music, false, vi.fn(), ended, position);
    expect(instances).toHaveLength(0);
    now.mockReturnValue(580);
    vi.advanceTimersByTime(25);
    expect(position.mock.calls[position.mock.calls.length - 1][0]).toBeCloseTo(0.25);
    silent.stop();
    expect(ended).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  } finally { silent.stop(); now.mockRestore(); }
});

it('redirects playback on the next downbeat without closing or restarting its audio clock', async () => {
  const first = buildPracticePerformance(rhythm, { mode: 'song', countIn: true, metronome: true });
  const position = vi.fn(), commit = vi.fn();
  await player.play(first, false, vi.fn(), vi.fn());
  const context = instances[0];
  context.currentTime = 2.58; // half a second into the first musical bar
  const next = buildPracticePerformance(rhythm, { mode: 'song', countIn: false, metronome: true, bars: [{ section: 'Default', chords: [{ beat: 1, chord: 'G' }] }] });
  await player.queuePerformance(next, position, commit);
  context.currentTime = 4.0; vi.advanceTimersByTime(25);
  expect(commit).not.toHaveBeenCalled();
  context.currentTime = 4.08; vi.advanceTimersByTime(25);
  expect(commit).toHaveBeenCalledOnce();
  expect(position.mock.calls[0][0]).toBeCloseTo(0);
  expect(instances).toHaveLength(1);
  expect(context.close).not.toHaveBeenCalled();
  context.currentTime = 4.58; vi.advanceTimersByTime(25);
  expect(position.mock.calls[position.mock.calls.length - 1][0]).toBeCloseTo(0.25);
});
