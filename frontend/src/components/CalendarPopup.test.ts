import { describe, expect, it } from "vitest";

import { shiftCalendarMonth } from "./CalendarPopup";

describe("shiftCalendarMonth", () => {
  it("moves across year boundaries", () => {
    expect(shiftCalendarMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftCalendarMonth("2026-12", 1)).toBe("2027-01");
  });
});
