import { describe, expect, it } from "vitest";

import { groupCalendarDays, visibleCalendarDays } from "./CalendarPopup";

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
});
