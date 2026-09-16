import { describe, expect, it } from "vitest";
import type { PlanType } from "./api";
import { shiftClock, templateServiceStart, welcomeLeadSeconds } from "./serviceTiming";

const type: PlanType = {
  id: "sunday", name: "Sunday Service", description: null, starts_at: "10:30", automation_start: "10:30",
  default_duration_minutes: 90, active: true, default_outline: [
    { item_type: "welcome_montage", title: "Montage", sequence: "10", comment: null, presentation_options: { auto_advance: true, auto_advance_seconds: 1500 } },
    { item_type: "welcome_countdown", title: "Final", sequence: "20", comment: null, presentation_options: { auto_advance: true, overlay_countdown_seconds: 300 } },
  ],
};

describe("service start scheduling", () => {
  it("derives the Welcome start from the two timed cues", () => {
    expect(welcomeLeadSeconds(type.default_outline)).toBe(1800);
    expect(shiftClock("11:00", -welcomeLeadSeconds(type.default_outline))).toBe("10:30");
    expect(templateServiceStart(type)).toBe("11:00");
    expect(templateServiceStart({ ...type, starts_at: "11:30" })).toBe("11:30");
  });
});
