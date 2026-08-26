import { describe, expect, it } from "vitest";

import { preServicePhaseAt } from "./PreServiceSlide";

describe("pre-service timing", () => {
  const serviceDate = new Date(2026, 7, 30, 10, 30).toISOString();

  it("shows the montage from 10:30 and the countdown only from 10:55", () => {
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 29, 59).getTime())).toBe("waiting");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 30).getTime())).toBe("montage");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 54, 59).getTime())).toBe("montage");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 55).getTime())).toBe("countdown");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 11, 0).getTime())).toBe("complete");
  });
});
