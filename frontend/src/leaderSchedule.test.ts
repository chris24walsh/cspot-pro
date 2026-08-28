import { describe, expect, it } from "vitest";

import {
  buildMonthlyLeaderSchedule,
  calendarDatesAround,
  effectiveLeaderIdForDate,
  sundayDatesAround,
  sundayDatesForMonth,
  unavailabilityForRole,
} from "./leaderSchedule";
import { suggestedFrequencyForInterval } from "./components/ServingFrequencyInput";

describe("Sunday leader rotation", () => {
  it("infers assignment frequency windows from the role interval", () => {
    expect(suggestedFrequencyForInterval("weekly")).toEqual({ count: 1, period: "month" });
    expect(suggestedFrequencyForInterval("biweekly")).toEqual({ count: 1, period: "quarter" });
    expect(suggestedFrequencyForInterval("triweekly")).toEqual({ count: 1, period: "quarter" });
    expect(suggestedFrequencyForInterval("monthly")).toEqual({ count: 1, period: "year" });
  });
  it("applies unavailability only to its selected roles", () => {
    const ranges = [
      { starts_on: "2026-09-01", ends_on: "2026-09-02", role_keys: null },
      { starts_on: "2026-09-03", ends_on: "2026-09-04", role_keys: ["worship"] },
      { starts_on: "2026-09-05", ends_on: "2026-09-06", role_keys: ["sunday_school"] },
    ];
    expect(unavailabilityForRole(ranges, "worship")).toEqual(ranges.slice(0, 2));
    expect(unavailabilityForRole(ranges, "sunday_school")).toEqual([ranges[0], ranges[2]]);
  });
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

  it("builds complete months for the continuous all-days timeline", () => {
    const dates = calendarDatesAround("2026-08-20", 1, 1);
    expect(dates[0]).toBe("2026-07-01");
    expect(dates[dates.length - 1]).toBe("2026-09-30");
    expect(dates).toHaveLength(92);
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
        { id: "tablet", name: "Tablet", maxSundaysPerMonth: null, rotationMode: "manual" },
        { id: "leader", name: "Worship Leader", maxSundaysPerMonth: null },
      ],
      new Map(),
    );
    expect([...schedule.values()]).not.toContain("tablet");
  });

  it("keeps disabled leaders out of automatic rotation", () => {
    const schedule = buildMonthlyLeaderSchedule(
      "2026-08",
      [
        { id: "disabled", name: "Disabled", maxSundaysPerMonth: null, rotationMode: "disabled" },
        { id: "leader", name: "Leader", maxSundaysPerMonth: null },
      ],
      new Map(),
    );
    expect([...schedule.values()]).not.toContain("disabled");
  });

  it("skips dates a volunteer has marked unavailable", () => {
    const schedule = buildMonthlyLeaderSchedule(
      "2026-08",
      [
        { id: "a", name: "Alex", maxSundaysPerMonth: null, unavailable: [{ starts_on: "2026-08-20", ends_on: "2026-08-25" }] },
        { id: "b", name: "Beth", maxSundaysPerMonth: null },
      ],
      new Map(),
    );
    expect(schedule.get("2026-08-23")).not.toBe("a");
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

  it("uses stored history but never recalculates an unassigned past date", () => {
    const leaders = [{ id: "a", name: "Alex", maxSundaysPerMonth: null }];
    expect(effectiveLeaderIdForDate("2026-08-09", leaders, new Map(), "2026-08-20")).toBeNull();
    expect(
      effectiveLeaderIdForDate(
        "2026-08-09",
        leaders,
        new Map([["2026-08-09", "a"]]),
        "2026-08-20",
      ),
    ).toBe("a");
    expect(effectiveLeaderIdForDate("2026-08-23", leaders, new Map(), "2026-08-20")).toBe("a");
  });
});
