import { describe, expect, it } from "vitest";

import { formatNavigatorDate } from "./DateNavigator";

describe("formatNavigatorDate", () => {
  it("uses the shared compact date format", () => {
    expect(formatNavigatorDate("2026-06-21")).toBe("21 Jun 26");
  });

  it("handles ISO timestamps without changing the format", () => {
    expect(formatNavigatorDate("2026-06-21T10:30:00Z")).toBe("21 Jun 26");
  });
});
