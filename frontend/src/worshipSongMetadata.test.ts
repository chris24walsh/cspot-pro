import { describe, expect, it } from "vitest";

import { lastUsedLabel, worshipRoleLabel } from "./worshipSongMetadata";

describe("worship song metadata", () => {
  it("formats multiple song types for browsing", () => {
    expect(worshipRoleLabel("opener,middle")).toBe("Opening / Middle");
    expect(worshipRoleLabel("any")).toBe("Any slot");
  });

  it("uses concise last-used wording without zero days", () => {
    const now = Date.parse("2026-08-14T12:00:00Z");
    expect(lastUsedLabel("2026-08-14T08:00:00Z", now)).toBe("Used today");
    expect(lastUsedLabel("2026-08-02T12:00:00Z", now)).toBe("12d ago");
    expect(lastUsedLabel(null, now)).toBe("Never used");
  });
});
