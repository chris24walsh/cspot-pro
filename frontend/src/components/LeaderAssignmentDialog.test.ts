import { describe, expect, it } from "vitest";

import { nearbyUpcomingSundays } from "./LeaderAssignmentDialog";

describe("nearbyUpcomingSundays", () => {
  it("never offers historical Sundays as swap targets", () => {
    const dates = nearbyUpcomingSundays("2026-08-30", "2026-08-20");
    expect(dates).not.toContain("2026-08-16");
    expect(dates.every((date) => date >= "2026-08-20")).toBe(true);
    expect(dates).toHaveLength(8);
  });
});
