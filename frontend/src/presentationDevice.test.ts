import { describe, expect, it } from "vitest";

import { isMobileOrTabletDevice, isTabletDevice } from "./presentationDevice";

describe("presentation device behavior", () => {
  it("opens an output window on a desktop", () => {
    expect(isMobileOrTabletDevice({ userAgent: "Mozilla/5.0 (X11; Linux x86_64)", maxTouchPoints: 0 })).toBe(false);
  });

  it("uses TV-only mode on Android tablets", () => {
    expect(isMobileOrTabletDevice({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel Tablet)", maxTouchPoints: 10 })).toBe(true);
  });

  it("recognizes iPads that request the desktop website", () => {
    expect(isMobileOrTabletDevice({ userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", maxTouchPoints: 5 })).toBe(true);
  });

  it("distinguishes tablets from phones using the shortest screen side", () => {
    const android = { userAgent: "Mozilla/5.0 (Linux; Android 14)", maxTouchPoints: 10 };

    expect(isTabletDevice(android, { width: 800, height: 1280 })).toBe(true);
    expect(isTabletDevice(android, { width: 412, height: 915 })).toBe(false);
  });

  it("recognizes touch-enabled iPads as tablets", () => {
    const ipad = { userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)", maxTouchPoints: 5 };

    expect(isTabletDevice(ipad, { width: 1024, height: 1366 })).toBe(true);
  });
});
