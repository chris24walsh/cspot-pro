import { describe, expect, it } from "vitest";

import {
  cappedCapoForKeys,
  chordPositionForLine,
  clearChordAnnotations,
  createEmptyChordChart,
  normalizeKeySignature,
  parseChordChart,
  resolveChordAnnotations,
  serializeChordChart,
  setChordChartAbsoluteKey,
  wrapChordEditorLine,
} from "./chordSheet";

describe("normalizeKeySignature", () => {
  it("uses C# rather than Db in the chord editor", () => {
    expect(normalizeKeySignature("Db")).toBe("C#");
    expect(normalizeKeySignature("C#")).toBe("C#");
  });
});

describe("setChordChartAbsoluteKey", () => {
  it("permanently transposes stored chords without changing capo", () => {
    const chart = {
      ...createEmptyChordChart(),
      absoluteKey: "C",
      capo: 2,
      annotations: [{ id: "one", section: "V1", lineIndex: 0, anchorIndex: 0, chord: "C" }],
    };

    const changed = setChordChartAbsoluteKey(chart, "D");

    expect(changed.annotations[0]?.chord).toBe("D");
    expect(changed.capo).toBe(2);
    expect(changed.capoKey).toBe("C");
    expect(changed.absoluteKey).toBe("D");
  });
});

describe("cappedCapoForKeys", () => {
  it("clamps an exact upward capo to five instead of choosing capo zero", () => {
    expect(cappedCapoForKeys("G", "E")).toBe(5);
    expect(cappedCapoForKeys("C", "E")).toBe(4);
  });
});

describe("clearChordAnnotations", () => {
  it("removes every chord while retaining the song key and capo", () => {
    const chart = {
      ...createEmptyChordChart(),
      absoluteKey: "D",
      capo: 2,
      annotations: [
        { id: "one", section: "V1", lineIndex: 0, anchorIndex: 2, chord: "D" },
        { id: "two", section: "C", lineIndex: 1, anchorIndex: 4, chord: "G" },
      ],
    };

    expect(clearChordAnnotations(chart)).toEqual({ ...chart, annotations: [] });
  });
});

describe("section-relative chord annotations", () => {
  const originalLyrics = "[V1]\nFirst verse line\n\n[C]\nChorus line";

  it("stores a lyric-line offset within its section", () => {
    expect(chordPositionForLine(originalLyrics, 3)).toEqual({ section: "C", lineIndex: 0 });

    const chart = {
      ...createEmptyChordChart(),
      absoluteKey: "G",
      annotations: [{ id: "chorus-g", section: "C", lineIndex: 0, anchorIndex: 3, chord: "G" }],
    };
    const serialized = serializeChordChart(chart);

    expect(JSON.parse(serialized ?? "null")).toMatchObject({
      version: 3,
      annotations: [{ section: "C", lineIndex: 0, anchorIndex: 3, chord: "G" }],
    });
  });

  it("keeps later chords attached when sections and lines are inserted earlier", () => {
    const annotation = { id: "chorus-g", section: "C", lineIndex: 0, anchorIndex: 3, chord: "G" };
    const expandedLyrics = [
      "[V1]",
      "First verse line",
      "A previously missing line",
      "[V2]",
      "Another verse",
      "[T]",
      "A new tag",
      "[C]",
      "Chorus line",
    ].join("\n");

    expect(resolveChordAnnotations([annotation], originalLyrics)[0]?.absoluteLineIndex).toBe(3);
    expect(resolveChordAnnotations([annotation], expandedLyrics)[0]?.absoluteLineIndex).toBe(8);
  });

  it("migrates absolute version 2 positions using the current lyrics", () => {
    const legacy = JSON.stringify({
      version: 2,
      capo: 0,
      absoluteKey: "G",
      capoKey: null,
      keyAnchor: "absolute",
      annotations: [{ id: "legacy-g", lineIndex: 3, anchorIndex: 3, chord: "G" }],
    });

    expect(parseChordChart(legacy, originalLyrics).document.annotations[0]).toMatchObject({
      id: "legacy-g",
      section: "C",
      lineIndex: 0,
      anchorIndex: 3,
      chord: "G",
    });
  });
});

describe("wrapChordEditorLine", () => {
  it("wraps at word boundaries without changing character positions", () => {
    const line = "All the words on one original lyric line";
    const segments = wrapChordEditorLine(line, 14);

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.map(({ start, end }) => line.slice(start, end)).join("")).toBe(line);
    expect(segments[0]).toEqual({ start: 0, end: 14 });
    expect(segments[segments.length - 1]?.end).toBe(line.length);
  });
});
