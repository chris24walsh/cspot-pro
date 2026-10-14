// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";
import { getRhythmPresets, updateSong, type Song } from "../api";
import { createEmptyChordChart, parseChordChart, serializeChordChart } from "../chordSheet";
import { SongEditorDialog } from "./SongEditorDialog";

vi.mock("../api", () => ({ createSong: vi.fn(), updateSong: vi.fn(), getRhythmPresets: vi.fn(async () => []), createRhythmPreset: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => vi.mocked(getRhythmPresets).mockResolvedValue([]));

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
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Chord tools"]')!.click());
    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Transpose chords when changing key"]')!;
    expect(toggle.closest(".song-chord-menu-key")).not.toBeNull();
    expect(document.querySelector('[aria-label="Chord tools options"]')).not.toBeNull();
    expect(toggle.closest(".musician-tools")).toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    const key = document.querySelector<HTMLSelectElement>(".musician-key-field select")!;
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
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Save song"]')!.disabled).toBe(true);
    const payload = vi.mocked(updateSong).mock.calls[0][1];
    expect(payload.rhythm).toEqual({ numerator: 4, denominator: 4, notes: "", bpm: 90, visual_beats: null, markers: [], arrangements: [], patterns: [
      { name: "Down, down-up, up-down-up", bars: 1, section: "Default", subdivision: 2, strokes: ["D", "D", "D", "U", "-", "U", "D", "U"] },
      { name: "Straight down-up", bars: 1, section: "Chorus", subdivision: 2, strokes: ["D", "U", "D", "U", "D", "U", "D", "U"] },
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

it("places and drags bar boundaries in the lyric grid without opening a chord editor", async () => {
  const chart = { ...createEmptyChordChart(), absoluteKey: "C", annotations: [{ id: "one", section: "V1", lineIndex: 0, anchorIndex: 3, chord: "C" }] };
  const song = { id: "bar-song", title: "Bar song", lyrics: "[V1]\nTest lyrics", sequence: "V1", chords: serializeChordChart(chart) } as Song;
  vi.mocked(updateSong).mockImplementation(async (_id, payload) => ({ ...song, ...payload }));
  const container = document.createElement("div"); const root = createRoot(container);
  try {
    await act(async () => root.render(<SongEditorDialog song={song} canEdit onClose={() => {}} onSaved={() => {}} />));
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Chords")!.click());
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Switch between chord and bar editing"]')!;
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    const slotCount = container.querySelectorAll(".musician-slot").length;
    act(() => toggle.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add bar at line 2, position 3"]')!.click());
    expect(container.querySelector(".musician-slot-editor")).toBeNull();
    expect(container.querySelectorAll(".musician-slot.has-bar")).toHaveLength(1);
    const start = new Event("dragstart", { bubbles: true });
    Object.defineProperty(start, "dataTransfer", { value: { setData: vi.fn() } });
    act(() => container.querySelector<HTMLButtonElement>(".musician-slot.has-bar")!.dispatchEvent(start));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add bar at line 2, position 8"]')!.dispatchEvent(new Event("drop", { bubbles: true })));
    expect(container.querySelector('[aria-label="Remove bar at line 2, position 8"]')).not.toBeNull();
    expect(container.querySelectorAll(".musician-slot.has-bar")).toHaveLength(1);
    act(() => toggle.click());
    expect(container.querySelectorAll(".musician-slot")).toHaveLength(slotCount);
    act(() => container.querySelector<HTMLButtonElement>(".musician-slot.has-chord")!.click());
    expect(container.querySelector<HTMLInputElement>(".musician-slot-editor input")!.value).toBe("C");
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Save song"]')!.click());
    expect(vi.mocked(updateSong).mock.calls[0][1].rhythm?.markers).toEqual([expect.objectContaining({ section: "V1", lineIndex: 0, anchorIndex: 8 })]);
    expect(vi.mocked(updateSong).mock.calls[0][1].rhythm?.arrangements).toEqual([{ section: "V1", chart: "C | C" }]);
    expect(parseChordChart(vi.mocked(updateSong).mock.calls[0][1].chords ?? null).document.annotations).toEqual(chart.annotations);
    const saved = { ...song, ...vi.mocked(updateSong).mock.calls[0][1] };
    await act(async () => root.render(<SongEditorDialog song={saved} canEdit onClose={() => {}} onSaved={() => {}} />));
    act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Chords")!.click());
    expect(container.querySelectorAll(".musician-slot.has-bar")).toHaveLength(1);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Save song"]')!.disabled).toBe(true);

  } finally { act(() => root.unmount()); vi.resetAllMocks(); }
});

it("adds missing bars at chords and moves a paired chord/bar together", async () => {
  const chart = { ...createEmptyChordChart(), absoluteKey: "C", annotations: [{ id: "one", section: "V1", lineIndex: 0, anchorIndex: 3, chord: "C" }, { id: "two", section: "V1", lineIndex: 0, anchorIndex: 8, chord: "G" }] };
  const song = { id: "paired", title: "Paired", lyrics: "[V1]\nTest lyrics", sequence: "V1", chords: serializeChordChart(chart), rhythm: { numerator: 4, denominator: 4, patterns: [], notes: "", markers: [{ id: "existing", section: "V1", lineIndex: 0, anchorIndex: 3 }] } } as unknown as Song;
  vi.mocked(updateSong).mockImplementation(async (_id, payload) => ({ ...song, ...payload }));
  const container = document.createElement("div"), root = createRoot(container);
  try {
    await act(async () => root.render(<SongEditorDialog song={song} canEdit onClose={() => {}} onSaved={() => {}} />));
    act(() => Array.from(container.querySelectorAll("button")).find(button => button.textContent === "Chords")!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Chord tools"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Add bars at all chords"]')!.click());
    expect(container.querySelectorAll('.musician-slot.has-bar')).toHaveLength(2);
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Switch between chord and bar editing"]')!;
    act(() => toggle.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })));
    expect(toggle.textContent).toBe('Both');
    const start = new Event('dragstart', { bubbles: true });
    Object.defineProperty(start, 'dataTransfer', { value: { setData: vi.fn() } });
    act(() => container.querySelector<HTMLButtonElement>('.musician-slot.has-chord.has-bar')!.dispatchEvent(start));
    const over = new Event('dragover', { bubbles: true, cancelable: true });
    Object.defineProperty(over, 'dataTransfer', { value: { dropEffect: '' } });
    act(() => container.querySelectorAll<HTMLButtonElement>('.musician-slot')[5].dispatchEvent(over));
    expect(container.querySelector('.musician-slot.is-drop-target')).toBe(container.querySelectorAll('.musician-slot')[5]);
    expect(container.querySelector('.musician-char.is-drop-target')?.textContent).toBe('s');
    expect(container.querySelector<HTMLElement>('.musician-drop-column')?.style.gridColumn).toBe('6');
    act(() => container.querySelectorAll<HTMLButtonElement>('.musician-slot')[5].dispatchEvent(new Event('drop', { bubbles: true })));
    expect(container.querySelector('.musician-drop-column')).toBeNull();
    expect(container.querySelector('.is-drop-target')).toBeNull();
    act(() => toggle.click());
    expect(toggle.textContent).toBe('Chords');
    await act(async () => {
      toggle.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      await new Promise(resolve => setTimeout(resolve, 550));
    });
    act(() => { toggle.dispatchEvent(new MouseEvent('pointerup', { bubbles: true })); toggle.click(); });
    expect(toggle.textContent).toBe('Both');
    act(() => toggle.click());
    expect(toggle.textContent).toBe('Chords');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Save song"]')!.click());
    const payload = vi.mocked(updateSong).mock.calls[0][1];
    expect(payload.rhythm?.markers).toHaveLength(2);
    expect(payload.rhythm?.markers).toContainEqual(expect.objectContaining({ id: 'existing', anchorIndex: 5 }));
    expect(parseChordChart(payload.chords ?? null).document.annotations).toContainEqual(expect.objectContaining({ id: 'one', anchorIndex: 5 }));
  } finally { act(() => root.unmount()); vi.resetAllMocks(); }
});
