import { describe, expect, it } from "vitest";

import { calendarWeekBounds, extendCalendarDays, groupCalendarDays, visibleCalendarDays } from "./CalendarPopup";

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

  it("keeps the complete calendar available", () => {
    expect(visibleCalendarDays(days, "all", [])).toEqual(days);
  });

  it("groups continuous dates beneath their month", () => {
    expect(groupCalendarDays(days).map((group) => ({
      dates: group.days.map((day) => day.date),
      key: group.key,
    }))).toEqual([
      { key: "2026-07", dates: ["2026-07-26"] },
      { key: "2026-08", dates: ["2026-08-02", "2026-08-03", "2026-08-09"] },
    ]);
  });

  it("extends all-day and Sunday timelines in either direction", () => {
    const allDays = extendCalendarDays([{ date: "2026-08-01" }], 1, 1, false);
    expect(allDays).toHaveLength(367);
    expect(allDays[0].date).toBe("2026-01-30");
    expect(allDays[allDays.length - 1].date).toBe("2027-01-31");

    const sundays = extendCalendarDays([{ date: "2026-08-02" }], 1, 1, true);
    expect(sundays).toHaveLength(53);
    expect(new Date(`${sundays[0].date}T12:00:00`).getDay()).toBe(0);
    expect(new Date(`${sundays[sundays.length - 1].date}T12:00:00`).getDay()).toBe(0);
  });

  it("finds the complete Sunday-to-Saturday week around a selection", () => {
    expect(calendarWeekBounds("2026-08-21")).toEqual({ start: "2026-08-16", end: "2026-08-22" });
    expect(calendarWeekBounds("2026-08-16")).toEqual({ start: "2026-08-16", end: "2026-08-22" });
  });
});
