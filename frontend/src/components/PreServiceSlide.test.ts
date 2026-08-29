import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PreServiceSlide, preServicePhaseAt } from "./PreServiceSlide";

describe("pre-service timing", () => {
  const serviceDate = new Date(2026, 7, 30, 10, 30).toISOString();

  it("shows the montage from 10:30 and the countdown only from 10:55", () => {
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 29, 59).getTime())).toBe("waiting");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 30).getTime())).toBe("montage");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 54, 59).getTime())).toBe("montage");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 10, 55).getTime())).toBe("countdown");
    expect(preServicePhaseAt(serviceDate, new Date(2026, 7, 30, 11, 0).getTime())).toBe("complete");
  });

  it("asks people to be seated after the countdown until the service starts", () => {
    const now = new Date(2026, 7, 30, 11, 0).getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const scheduled = renderToStaticMarkup(createElement(PreServiceSlide, {
      backgroundImageUrl: "background.jpg",
      imageUrls: ["welcome.jpg"],
      serviceDate,
    }));
    const simulated = renderToStaticMarkup(createElement(PreServiceSlide, {
      backgroundImageUrl: "background.jpg",
      imageUrls: ["welcome.jpg"],
      phase: "countdown",
      phaseStartedAt: now - 300_000,
      serviceDate,
    }));

    expect(scheduled).toContain("Please be seated");
    expect(simulated).toContain("Please be seated");
    expect(simulated).toContain('class="pre-service-seated-message"');
    expect(simulated).not.toContain("0:00");
    vi.restoreAllMocks();
  });
});
