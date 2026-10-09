// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { updateSong, type Song } from "../api";
import { createEmptyChordChart, parseChordChart, serializeChordChart } from "../chordSheet";
import { SongEditorDialog } from "./SongEditorDialog";

vi.mock("../api", () => ({ createSong: vi.fn(), updateSong: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("lets the user untick transposition and save a corrected key with the same chords", async () => {
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
    const checkbox = container.querySelector<HTMLInputElement>('.musician-transpose-option input[type="checkbox"]')!;
    expect(checkbox.checked).toBe(true);
    act(() => checkbox.click());
    expect(checkbox.checked).toBe(false);
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
