import { describe, expect, it } from "vitest";

import { shiftCalendarMonth, visibleCalendarDays } from "./CalendarPopup";

describe("shiftCalendarMonth", () => {
  it("moves across year boundaries", () => {
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
  });
});

describe("visibleCalendarDays", () => {
  const days = [
    { date: "2026-07-26", muted: true },
    { date: "2026-08-02" },
    { date: "2026-08-03" },
    { date: "2026-08-09" },
  ];

  it("uses the supplied continuous Sunday timeline", () => {
    const sundayDays = [
      { date: "2026-07-26" },
      { date: "2026-08-02" },
      { date: "2026-08-09" },
      { date: "2026-08-16" },
    ];
    expect(visibleCalendarDays(days, "sundays", sundayDays)).toEqual(sundayDays);
  });

  it("falls back to Sundays in the selected month", () => {
    expect(visibleCalendarDays(days, "sundays").map((day) => day.date)).toEqual([
      "2026-08-02",
      "2026-08-09",
    ]);
  });

  it("keeps the complete calendar available", () => {
    expect(visibleCalendarDays(days, "all")).toEqual(days);
  });
});
