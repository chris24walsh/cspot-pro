import { describe, expect, it } from "vitest";
import { resizeStrumPattern, STRUM_PRESETS, strumCounts, strumPatternForSection, type SongRhythm } from "./songRhythm";

describe("song rhythm", () => {
  it("keeps every preset to one complete bar", () => {
    for (const preset of STRUM_PRESETS) {
      expect(preset.strokes).toHaveLength(preset.numerator * preset.subdivision);
    }
  });

  it("counts compound meter as groups of three eighth notes", () => {
    const rhythm: SongRhythm = { numerator: 6, denominator: 8, patterns: [], notes: "" };
    expect(strumCounts(rhythm, { section: "Default", subdivision: 1, strokes: ["D", "-", "U", "D", "-", "U"] }))
      .toEqual(["1", "&", "a", "2", "&", "a"]);
  });

  it("preserves on-beat strokes when adding subdivisions and changing meter", () => {
    const doubled = resizeStrumPattern({ section: "Default", subdivision: 1, strokes: ["D", "X", "D", "U"] }, 3, 2);
    expect(doubled.strokes).toEqual(["D", "-", "X", "-", "D", "-"]);
    expect(resizeStrumPattern(doubled, 4, 1).strokes).toEqual(["D", "X", "D", "-"]);
  });

  it("uses section overrides and falls back to the whole-song pattern", () => {
    const rhythm: SongRhythm = { numerator: 3, denominator: 4, notes: "", patterns: [
      { section: "Default", subdivision: 1, strokes: ["D", "D", "D"] },
      { section: "Chorus", subdivision: 1, strokes: ["D", "X", "U"] },
    ] };
    expect(strumPatternForSection(rhythm, "C2")?.section).toBe("Chorus");
    expect(strumPatternForSection(rhythm, "[Chorus]" )?.section).toBe("Chorus");
    expect(strumPatternForSection(rhythm, "V1")?.section).toBe("Default");
    expect(strumPatternForSection(rhythm, "Closing")?.section).toBe("Default");
    expect(strumPatternForSection({ ...rhythm, patterns: rhythm.patterns.slice(1) }, "V1")).toBeUndefined();
  });
});

it('counts each bar separately and preserves the second bar when changing grids or meter', () => {
  const pattern = { section: 'Default' as const, bars: 2 as const, subdivision: 1 as const, strokes: ['D', '-', 'U', '-', 'X', '-', 'D', '-'] as ('D' | 'U' | 'X' | '-')[] };
  expect(strumCounts({ numerator: 4, denominator: 4, patterns: [], notes: '' }, pattern)).toEqual(['1', '2', '3', '4', '1', '2', '3', '4']);
  expect(resizeStrumPattern(pattern, 3).strokes).toEqual(['D', '-', 'U', 'X', '-', 'D']);
  expect(resizeStrumPattern(pattern, 4, 2).strokes[8]).toBe('X');
});

it('counts four subdivisions per beat without changing the pattern length', () => {
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, notes: '', patterns: [{ section: 'Default', subdivision: 4, strokes: Array(16).fill('D') }] };
  expect(strumCounts(rhythm, rhythm.patterns[0])).toEqual(['1', 'e', '&', 'a', '2', 'e', '&', 'a', '3', 'e', '&', 'a', '4', 'e', '&', 'a']);
});
