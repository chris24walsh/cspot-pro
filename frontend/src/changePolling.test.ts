import { describe, expect, it } from "vitest";

import { durablePollingDelay } from "./changePolling";

describe("durable change polling", () => {
  it("slows background tabs without delaying active tabs", () => {
    expect(durablePollingDelay(0, false)).toBe(4000);
    expect(durablePollingDelay(0, true)).toBe(30000);
  });

  it("backs off failures and caps retry delay", () => {
    expect(durablePollingDelay(1, false)).toBe(8000);
    expect(durablePollingDelay(4, false)).toBe(60000);
    expect(durablePollingDelay(20, false)).toBe(60000);
  });
});
