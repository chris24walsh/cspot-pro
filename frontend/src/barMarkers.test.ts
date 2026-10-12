import { expect, it } from "vitest";
import { placeBarMarker, removeBarMarker, rhythmWithBarMarkers } from "./barMarkers";
import type { ChordAnnotation } from "./chordSheet";

const chords: ChordAnnotation[] = [
  { id: "c", section: "V1", lineIndex: 0, anchorIndex: 3, chord: "C" },
  { id: "g", section: "V1", lineIndex: 0, anchorIndex: 10, chord: "G" },
  { id: "a", section: "V1", lineIndex: 1, anchorIndex: 3, chord: "Am" },
];

it("partitions chords into bars, moves markers without duplicating them, and clears derived charts on removal", () => {
  const first = placeBarMarker(null, chords, { section: "V1", lineIndex: 1, anchorIndex: 3 }, "bar-one");
  expect(first.arrangements).toEqual([{ section: "V1", chart: "C G | Am" }]);
  const moved = placeBarMarker(first, chords, { section: "V1", lineIndex: 0, anchorIndex: 10 }, "bar-one");
  expect(moved.markers).toHaveLength(1);
  expect(moved.arrangements).toEqual([{ section: "V1", chart: "C | G Am" }]);
  const removed = removeBarMarker(moved, chords, "bar-one");
  expect(removed.markers).toEqual([]);
  expect(removed.arrangements).toEqual([]);
});

it("retains manual charts in other parts and updates linked charts when chord symbols change", () => {
  const rhythm = placeBarMarker({ numerator: 6, denominator: 8, patterns: [], notes: "", arrangements: [{ section: "C", chart: "F | G" }] }, chords, { section: "V1", lineIndex: 0, anchorIndex: 10 }, "one");
  const updated = rhythmWithBarMarkers(rhythm, chords.map((chord) => chord.id === "c" ? { ...chord, chord: "D" } : chord));
  expect(updated?.arrangements).toEqual([{ section: "C", chart: "F | G" }, { section: "V1", chart: "D | G Am" }]);
  expect(updated?.numerator).toBe(6);
});
