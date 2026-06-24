import { describe, expect, it } from "vitest";

import { isBroadcastStartingSoon } from "./broadcastTiming";

describe("isBroadcastStartingSoon", () => {
  const service = "2026-06-28T10:30:00Z";

  it("starts during the configured lead window", () => {
    expect(isBroadcastStartingSoon(service, new Date("2026-06-28T09:30:00Z").getTime(), 60)).toBe(true);
  });

  it("stays offline before the lead window", () => {
    expect(isBroadcastStartingSoon(service, new Date("2026-06-28T09:29:00Z").getTime(), 60)).toBe(false);
  });

  it("allows a short delayed-start grace period", () => {
    expect(isBroadcastStartingSoon(service, new Date("2026-06-28T10:45:00Z").getTime(), 60)).toBe(true);
    expect(isBroadcastStartingSoon(service, new Date("2026-06-28T11:01:00Z").getTime(), 60)).toBe(false);
  });
});
