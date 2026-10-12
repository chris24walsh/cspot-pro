// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { createRhythmPreset, getRhythmPresets } from "../api";
import type { RhythmPreset, SongRhythm } from "../songRhythm";
import { SongRhythmEditor } from "./SongRhythmEditor";

vi.mock("../api", () => ({ getRhythmPresets: vi.fn(), createRhythmPreset: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let shared: RhythmPreset[];
beforeEach(() => {
  shared = [];
  vi.mocked(getRhythmPresets).mockImplementation(async () => [...shared]);
  vi.mocked(createRhythmPreset).mockImplementation(async (payload) => {
    const saved = { ...payload, id: String(shared.length + 1) }; shared.push(saved); return saved;
  });
});

it("names and saves a 7/8 meter and strum, then applies the shared strum to another song", async () => {
  let current: SongRhythm | null = null;
  function Harness() {
    const [value, setValue] = useState<SongRhythm | null>(null);
    current = value;
    return <SongRhythmEditor value={value} canEdit onChange={setValue} lyrics={"[V1]\nVerse words\n[C]\nChorus words"} sequence="V1 C" />;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  const select = (label: string, value: string) => act(() => {
    const element = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    element.value = value; element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const input = (label: string, value: string) => act(() => {
    const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`)!;
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<Harness key="first-song" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Song rhythm"]')!.click());
    select("Song meter", "custom"); select("Beats per bar", "7"); select("Meter beat unit", "8");
    input("Shared meter name", "Seven");
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save meter to library")!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Strum 1,"]')!.click());
    input("Shared strum name", "Seven groove");
    await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Save strum to library")!.click());
    expect(shared.map((entry) => entry.kind)).toEqual(["meter", "strum"]);
    expect(shared[1]).toMatchObject({ name: "Seven groove", numerator: 7, denominator: 8, subdivision: 1 });
    await act(async () => root.render(<Harness key="other-song" />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Song rhythm"]')!.click());
    select("Common strumming pattern", "strum:2");
    expect(current).toMatchObject({ numerator: 7, denominator: 8, patterns: [{ name: "Seven groove", strokes: ["D", "-", "-", "-", "-", "-", "-"] }] });
    select("Bar chart part", "V1"); input("Chord bar chart", "C | G *2");
    expect((current as SongRhythm | null)?.arrangements).toEqual([{ section: "V1", chart: "C | G *2" }]);
    expect(container.querySelectorAll(".rhythm-bar-preview > span")).toHaveLength(3);
  } finally { act(() => root.unmount()); vi.resetAllMocks(); }
});
