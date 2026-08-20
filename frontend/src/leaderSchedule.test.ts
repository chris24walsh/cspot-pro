import { describe, expect, it } from "vitest";

import { buildMonthlyLeaderSchedule, sundayDatesAround, sundayDatesForMonth } from "./leaderSchedule";

describe("Sunday leader rotation", () => {
  it("returns only the Sundays in a month", () => {
    expect(sundayDatesForMonth("2026-08")).toEqual([
      "2026-08-02",
      "2026-08-09",
      "2026-08-16",
      "2026-08-23",
      "2026-08-30",
    ]);
  });

  it("builds a continuous multi-month Sunday timeline around a selected date", () => {
    const dates = sundayDatesAround("2026-08-20", 42, 10);
    expect(dates).toHaveLength(42);
    expect(dates[10]).toBe("2026-08-23");
    expect(dates[11]).toBe("2026-08-30");
    expect(new Date(`${dates[41]}T12:00:00`).getDay()).toBe(0);
  });

  it("round-robins leaders while respecting monthly limits", () => {
    const schedule = buildMonthlyLeaderSchedule(
      "2026-08",
      [
        { id: "a", name: "Alex", maxSundaysPerMonth: 1 },
        { id: "b", name: "Beth", maxSundaysPerMonth: 2 },
        { id: "c", name: "Chris", maxSundaysPerMonth: null },
      ],
      new Map(),
    );
    const assignments = [...schedule.values()];
    expect(assignments.filter((id) => id === "a")).toHaveLength(1);
    expect(assignments.filter((id) => id === "b")).toHaveLength(2);
    expect(assignments).toHaveLength(5);
  });

  it("keeps manual-only leaders out of automatic rotation", () => {
    const schedule = buildMonthlyLeaderSchedule(
      "2026-08",
      [
        { id: "tablet", name: "Tablet", maxSundaysPerMonth: 0 },
        { id: "leader", name: "Worship Leader", maxSundaysPerMonth: null },
      ],
      new Map(),
    );
    expect([...schedule.values()]).not.toContain("tablet");
  });

  it("reserves capacity for explicit assignments before filling gaps", () => {
    const schedule = buildMonthlyLeaderSchedule(
      "2026-08",
      [
        { id: "a", name: "Alex", maxSundaysPerMonth: 1 },
        { id: "b", name: "Beth", maxSundaysPerMonth: null },
      ],
      new Map([["2026-08-30", "a"]]),
    );
    expect(schedule.get("2026-08-30")).toBe("a");
    expect([...schedule.values()].filter((id) => id === "a")).toHaveLength(1);
  });
});
