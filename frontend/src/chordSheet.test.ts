import { describe, expect, it } from "vitest";

import { createEmptyChordChart, setChordChartAbsoluteKey } from "./chordSheet";

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
  });
});
