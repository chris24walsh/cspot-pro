// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { SongRhythm } from "../songRhythm";
import { SongRhythmDisplay } from "./SongRhythmDisplay";

vi.mock("../api", () => ({ getRhythmPresets: vi.fn(async () => []), createRhythmPreset: vi.fn(), updateRhythmPreset: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows the current section pattern and opens counts and notes in a bounded reference panel", async () => {
  const rhythm: SongRhythm = { numerator: 6, denominator: 8, notes: "Accent beats 1 and 2", patterns: [
    { section: "Default", subdivision: 1, strokes: ["D", "-", "U", "D", "-", "U"] },
    { section: "Chorus", subdivision: 1, strokes: ["D", "U", "U", "D", "U", "U"] },
  ] };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(<SongRhythmDisplay rhythm={rhythm} section="C2" />));
    expect(container.textContent).toContain("↓ ↑ ↑ ↓ ↑ ↑");
    expect(document.querySelector('[aria-label="Edit song rhythm"]')).toBeNull();
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Show song rhythm"]')!;
    act(() => trigger.click());
    const panel = document.querySelector<HTMLElement>('[aria-label="Song rhythm reference"]')!;
    expect(panel.textContent).toContain("Accent beats 1 and 2");
    expect(Array.from(panel.querySelectorAll(".song-strum-cell > span:first-child")).slice(0, 6).map((node) => node.textContent))
      .toEqual(["1", "&", "a", "2", "&", "a"]);
    expect(Number.parseFloat(panel.style.left) + Number.parseFloat(panel.style.width)).toBeLessThanOrEqual(window.innerWidth);
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.querySelector('[aria-label="Song rhythm reference"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    await act(async () => root.render(<SongRhythmDisplay rhythm={rhythm} section="V1" />));
    expect(container.textContent).toContain("↓ – ↑ ↓ – ↑");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});


it("requires Edit before changing strums, cancels drafts, and saves explicitly", async () => {
  const initial: SongRhythm = { numerator: 4, denominator: 4, notes: '', patterns: [{ section: 'Default', subdivision: 1, strokes: ['D', '-', 'U', '-'] }] };
  const save = vi.fn(async (_value: SongRhythm | null) => {});
  function Harness() {
    const [rhythm, setRhythm] = useState<SongRhythm | null>(initial);
    return <SongRhythmDisplay rhythm={rhythm} onSaveRhythm={async value => { await save(value); setRhythm(value); }} />;
  }
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<Harness />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Show song rhythm"]')!.click());
    expect(document.querySelector('[aria-label^="Strum 1,"]')).toBeNull();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Edit song rhythm"]')!.click());
    const saveButton = () => document.querySelector<HTMLButtonElement>('[aria-label="Save song rhythm"]')!;
    expect(saveButton().disabled).toBe(true);
    expect(document.querySelector('[aria-label="Song meter"]')).toBeNull();
    expect(document.querySelector('[aria-label="Download practice MIDI"]')).toBeNull();
    expect(document.querySelector('[aria-label="Listen to selected part chords and strum"]')).toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label^="Strum 1,"]')!.click());
    expect(saveButton().disabled).toBe(false);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Edit song rhythm"]')!.click());
    expect(save).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Edit song rhythm"]')!.click());
    expect(document.querySelector('[aria-label^="Strum 1,"]')?.textContent).toBe('↓');
    act(() => document.querySelector<HTMLButtonElement>('[aria-label^="Strum 1,"]')!.click());
    save.mockRejectedValueOnce(new Error("Save failed"));
    await act(async () => saveButton().click());
    expect(document.querySelector('[aria-label="Song rhythm reference"]')?.textContent).toContain("Save failed");
    expect(document.querySelector('[aria-label^="Strum 1,"]')?.textContent).toBe("↑");
    await act(async () => saveButton().click());
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[0][0]?.patterns[0].strokes[0]).toBe('U');
    expect(document.querySelector('[aria-label^="Strum 1,"]')).toBeNull();
    expect(document.querySelector('[aria-label="Song rhythm reference"]')?.textContent).toContain('Rhythm saved.');
  } finally { act(() => root.unmount()); }
});
