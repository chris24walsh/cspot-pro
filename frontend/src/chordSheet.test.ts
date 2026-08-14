import { describe, expect, it } from "vitest";

import { cappedCapoForKeys, clearChordAnnotations, createEmptyChordChart, normalizeKeySignature, setChordChartAbsoluteKey, wrapChordEditorLine } from "./chordSheet";

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
      annotations: [{ id: "one", lineIndex: 0, anchorIndex: 0, chord: "C" }],
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
        { id: "one", lineIndex: 0, anchorIndex: 2, chord: "D" },
        { id: "two", lineIndex: 1, anchorIndex: 4, chord: "G" },
      ],
    };

    expect(clearChordAnnotations(chart)).toEqual({ ...chart, annotations: [] });
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
