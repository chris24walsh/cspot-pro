import { describe, expect, it } from "vitest";

import type { PlanItem } from "./api";
import { reorderedWorshipSequences } from "./worshipOrdering";

function item(id: string, sequence: string): PlanItem {
  return { id, sequence } as PlanItem;
}

describe("worship ordering", () => {
  it("moves the last song up and repairs duplicate stored sequences", () => {
    const updates = reorderedWorshipSequences(
      [item("first", "10.00"), item("middle", "20.00"), item("last", "20.00")],
      "last",
      -1,
    );

    expect(updates).toEqual([
      { id: "first", sequence: "10.00" },
      { id: "last", sequence: "20.00" },
      { id: "middle", sequence: "30.00" },
    ]);
  });

  it("does not move a song beyond either end of the set", () => {
    const items = [item("first", "10.00"), item("last", "20.00")];
    expect(reorderedWorshipSequences(items, "first", -1)).toBeNull();
    expect(reorderedWorshipSequences(items, "last", 1)).toBeNull();
  });
});
