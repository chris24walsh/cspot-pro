import { describe, expect, it } from "vitest";

import { defaultPlanningDate, nextSundayDate } from "./planningDates";

describe("planning date defaults", () => {
  const wednesday = new Date(2026, 8, 2, 9, 0, 0);

  it("defaults to the next Sunday when no earlier plan exists", () => {
    expect(defaultPlanningDate([], wednesday)).toBe("2026-09-06");
    expect(defaultPlanningDate(["2026-09-13"], wednesday)).toBe("2026-09-06");
  });

  it("uses an earlier upcoming plan", () => {
    expect(defaultPlanningDate(["2026-09-05", "2026-09-13"], wednesday)).toBe("2026-09-05");
  });

  it("treats today as the next Sunday when today is Sunday", () => {
    expect(nextSundayDate(new Date(2026, 8, 6, 9, 0, 0))).toBe("2026-09-06");
  });
});
