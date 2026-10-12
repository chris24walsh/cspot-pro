// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { PracticePerformance } from "../musicPractice";
import type { SongRhythm } from "../songRhythm";
import { PracticeListenButton } from "./PracticeListenButton";

const audio = vi.hoisted(() => ({ play: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn() }));
vi.mock("../musicPractice", async (importOriginal) => ({ ...await importOriginal<typeof import("../musicPractice")>(), PracticeAudioPlayer: vi.fn(function () { return audio; }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("listens directly to the full arrangement in the selected live key and stops on key change", async () => {
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, notes: "", patterns: [], arrangements: [{ section: "Default", chart: "C | G" }] };
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<PracticeListenButton rhythm={rhythm} transpose={2} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Listen to song practice"]')!.click());
    const music = audio.play.mock.calls[0][0] as PracticePerformance;
    expect(music.bars).toHaveLength(2);
    expect(music.notes.filter((note) => note.channel === 0).map((note) => note.pitch)).toContain(54); // F# in D major
    expect(container.querySelector('[aria-label="Stop song practice"]')).not.toBeNull();
    await act(async () => root.render(<PracticeListenButton rhythm={rhythm} transpose={3} />));
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(container.querySelector('[aria-label="Listen to song practice"]')).not.toBeNull();
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
