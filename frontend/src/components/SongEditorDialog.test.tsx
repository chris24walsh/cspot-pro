// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { updateSong, type Song } from "../api";
import { createEmptyChordChart, parseChordChart, serializeChordChart } from "../chordSheet";
import { SongEditorDialog } from "./SongEditorDialog";

vi.mock("../api", () => ({ createSong: vi.fn(), updateSong: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("lets the user toggle off transposition and save a corrected key with the same chords", async () => {
  const chart = {
    ...createEmptyChordChart(), absoluteKey: "C",
    annotations: [{ id: "one", section: "V1", lineIndex: 0, anchorIndex: 3, chord: "D" }],
  };
  const song = { id: "song", title: "Test song", lyrics: "[V1]\nTest lyrics", sequence: "V1", chords: serializeChordChart(chart) } as Song;
  vi.mocked(updateSong).mockImplementation(async (_id, payload) => ({ ...song, ...payload }));
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SongEditorDialog song={song} canEdit onClose={() => {}} onSaved={() => {}} />));
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Chords")!.click());
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Transpose chords when changing key"]')!;
    expect(toggle.closest(".musician-key-row")).not.toBeNull();
    expect(toggle.closest(".song-editor-tab-toolbar")?.querySelector(".tab-row")).not.toBeNull();
    expect(toggle.closest(".musician-tools")).toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    const key = container.querySelector<HTMLSelectElement>(".musician-key-field select")!;
    act(() => { key.value = "D"; key.dispatchEvent(new Event("change", { bubbles: true })); });
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Save song"]')!.click());
    expect(updateSong).toHaveBeenCalledOnce();
    const saved = parseChordChart(vi.mocked(updateSong).mock.calls[0][1].chords ?? null).document;
    expect(saved.absoluteKey).toBe("D");
    expect(saved.annotations).toEqual(chart.annotations);
  } finally {
    act(() => root.unmount());
    vi.resetAllMocks();
  }
});

it("saves meter, a customized preset and a chorus variation, then reloads them", async () => {
  const song = { id: "rhythm-song", title: "Rhythm song", lyrics: "[V1]\nTest lyrics", sequence: "V1", chords: null } as Song;
  vi.mocked(updateSong).mockImplementation(async (_id, payload) => ({ ...song, ...payload }));
  const container = document.createElement("div");
  const root = createRoot(container);
  const select = (label: string, value: string) => act(() => {
    const element = container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;
    element.value = value;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });
  try {
    await act(async () => root.render(<SongEditorDialog song={song} canEdit onClose={() => {}} onSaved={() => {}} />));
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Chords")!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Song rhythm"]')!.click());
    select("Song meter", "4/4");
    select("Common strumming pattern", "four-common");
    act(() => container.querySelector<HTMLButtonElement>('[aria-label^="Strum 2,"]')!.click());
    select("Strumming section", "Chorus");
    select("Common strumming pattern", "four-alternating");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Save song"]')!.click());
    const payload = vi.mocked(updateSong).mock.calls[0][1];
    expect(payload.rhythm).toEqual({ numerator: 4, denominator: 4, notes: "", patterns: [
      { section: "Default", subdivision: 2, strokes: ["D", "D", "D", "U", "-", "U", "D", "U"] },
      { section: "Chorus", subdivision: 2, strokes: ["D", "U", "D", "U", "D", "U", "D", "U"] },
    ] });
    const saved = { ...song, ...payload };
    await act(async () => root.render(<SongEditorDialog song={saved} canEdit onClose={() => {}} onSaved={() => {}} />));
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Chords")!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Song rhythm"]')!.click());
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Song meter"]')!.value).toBe("4/4");
    select("Strumming section", "Chorus");
    expect(container.querySelector<HTMLSelectElement>('[aria-label="Common strumming pattern"]')!.value).toBe("four-alternating");
  } finally {
    act(() => root.unmount());
    vi.resetAllMocks();
  }
});
