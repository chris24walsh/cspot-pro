// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildPracticePerformance, chordMidiNotes, PracticeAudioPlayer } from "./musicPractice";
import type { SongRhythm } from "./songRhythm";

const instances: FakeAudioContext[] = [];
class FakeAudioContext {
  currentTime = 0;
  state = "running";
  destination = {};
  frequencies: number[] = [];
  constructor() { instances.push(this); }
  resume = vi.fn(async () => {});
  close = vi.fn(async () => { this.state = "closed"; });
  createGain() {
    return { gain: { value: 1, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
  }
  createOscillator() {
    return { type: "", frequency: { setValueAtTime: (frequency: number) => this.frequencies.push(frequency) }, connect: vi.fn(), disconnect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
  }
}
const rhythm: SongRhythm = { numerator: 4, denominator: 4, bpm: 120, notes: "", patterns: [{ section: "Default", subdivision: 1, strokes: ["U", "D", "-", "X"] }], arrangements: [{ section: "Default", chart: "C" }] };
let player: PracticeAudioPlayer;
beforeEach(() => { instances.length = 0; vi.useFakeTimers(); vi.stubGlobal("AudioContext", FakeAudioContext); player = new PracticeAudioPlayer(); });
afterEach(() => { player.stop(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("schedules upstrokes from high to low, then ends and closes the audio context", async () => {
  const performance = buildPracticePerformance(rhythm, { mode: "song" });
  const ended = vi.fn();
  await player.play(performance, false, vi.fn(), ended);
  expect(instances[0].frequencies).toEqual(chordMidiNotes("C").reverse().map((pitch) => 440 * 2 ** ((pitch - 69) / 12)));
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
