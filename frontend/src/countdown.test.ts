import { describe, expect, it } from "vitest";
import { countdownDeadline, countdownRemaining } from "./countdown";

describe("countdown timing", () => {
  it("counts to a clock time on the service date regardless of slide selection", () => {
    const serviceDate = "2026-09-20T09:00:00";
    const deadline = countdownDeadline(serviceDate, "11:00")!;
    expect(countdownRemaining(300, deadline - 300_000, "11:00", serviceDate, deadline - 90_000)).toBe(90);
    expect(countdownRemaining(300, deadline - 10_000, "11:00", serviceDate, deadline + 1000)).toBe(0);
  });

  it("keeps the original duration start after leaving and returning", () => {
    const startAt = 1_000_000;
    expect(countdownRemaining(300, startAt, undefined, "", startAt + 120_000)).toBe(180);
    expect(countdownRemaining(300, startAt, undefined, "", startAt + 180_000)).toBe(120);
  });
});
