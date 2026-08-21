import { describe, expect, it } from "vitest";

import { nearbyUpcomingSundays, swappableUpcomingSundays } from "./LeaderAssignmentDialog";

describe("nearbyUpcomingSundays", () => {
  it("never offers historical Sundays as swap targets", () => {
    const dates = nearbyUpcomingSundays("2026-08-30", "2026-08-20");
    expect(dates).not.toContain("2026-08-16");
    expect(dates.every((date) => date >= "2026-08-20")).toBe(true);
    expect(dates).toHaveLength(8);
  });

  it("omits Sundays assigned to users who are never in rotation", () => {
    const assignments = new Map<string, string | null>([
      ["2026-08-23", "rotation-leader"],
      ["2026-08-30", "manual-only-leader"],
      ["2026-09-06", null],
    ]);
    expect(swappableUpcomingSundays(
      [...assignments.keys()],
      (date) => assignments.get(date) ?? null,
      (leaderId) => leaderId !== "manual-only-leader",
    )).toEqual(["2026-08-23", "2026-09-06"]);
  });
});
