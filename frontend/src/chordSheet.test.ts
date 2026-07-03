import { describe, expect, it } from "vitest";

import { cappedCapoForKeys, createEmptyChordChart, setChordChartAbsoluteKey } from "./chordSheet";

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
