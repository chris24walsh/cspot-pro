// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi, type Mock } from "vitest";
import { PracticeAudioPlayer, type PracticePerformance } from "../musicPractice";
import type { SongRhythm } from "../songRhythm";
import { RhythmPracticeControls } from "./RhythmPracticeControls";

const players = vi.hoisted(() => [] as Array<{ play: Mock<unknown[], Promise<void>>; stop: Mock<[], void> }>);
vi.mock("../musicPractice", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../musicPractice")>();
  return { ...actual, PracticeAudioPlayer: vi.fn(function () {
    const player = { play: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn(() => {}) }; players.push(player); return player;
  }) };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { players.length = 0; vi.restoreAllMocks(); vi.clearAllMocks(); });

it("starts combined playback from bar chords, stops on unmount, and downloads MIDI", async () => {
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, bpm: 100, patterns: [{ section: "Default", subdivision: 1, strokes: ["D", "D", "D", "D"] }], notes: "", arrangements: [{ section: "Default", chart: "C G | Am" }] };
  const container = document.createElement("div");
  const root = createRoot(container);
  const createUrl = vi.fn((_blob: Blob) => "blob:practice-midi");
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: createUrl });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  let filename = "";
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { filename = this.download; });
  try {
    await act(async () => root.render(<RhythmPracticeControls rhythm={rhythm} title="Test Song" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Listen to whole song chords and strum"]')!.click());
    expect(PracticeAudioPlayer).toHaveBeenCalledOnce();
    const performance = players[0].play.mock.calls[0][0] as PracticePerformance;
    expect(performance.bars[0].chords).toEqual([{ chord: "C", beat: 1 }, { chord: "G", beat: 3 }]);
    expect(performance.bars).toHaveLength(2);
    expect(performance.countInTicks).toBe(1920);
    expect(container.querySelector('[aria-label="Stop practice playback"]')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Download practice MIDI"]')!.click());
    expect(createUrl.mock.calls[0][0].type).toBe("audio/midi");
    expect(filename).toBe("Test-Song-song.mid");
    act(() => root.unmount());
    expect(players[0].stop).toHaveBeenCalledOnce();
  } finally { container.remove(); }
});
