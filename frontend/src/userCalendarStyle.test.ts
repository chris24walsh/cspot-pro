import { describe, expect, it } from "vitest";

import type { User } from "./api";
import { calendarColor, calendarColors, calendarMarkers, userInitials } from "./userCalendarStyle";

function user(id: string, name: string, color = "teacher-a", avatar: string | null = null): User {
  return {
    active: true,
    calendar_avatar: avatar,
    calendar_color: color,
    worship_max_sundays_per_month: null,
    sunday_school_max_sundays_per_month: null,
    email: `${id}@example.com`,
    username: `user-${id}`,
    email_confirmed: true,
    id,
    invite_pending: false,
    registration_pending: false,
    registration_requested_at: null,
    name,
    password_set: true,
    roles: [],
    start_page: null,
  };
}

describe("calendar user identity", () => {
  it("uses first and surname initials for a full name", () => {
    expect(calendarMarkers([user("1", "Hanna Baker")]).get("1")).toBe("HB");
  });

  it("handles single names and extra whitespace", () => {
    expect(userInitials("  Hanna  ")).toBe("H");
    expect(userInitials("Hanna Mary Baker")).toBe("HB");
  });

  it("ignores legacy avatar and colour choices", () => {
    const leader = user("1", "Hanna", "teacher-c", "🎤");
    expect(calendarMarkers([leader]).get("1")).toBe("H");
    expect(calendarColor(leader)).toMatch(/^teacher-[a-f]$/);
  });

  it("spreads users across every available shade before reusing one", () => {
    const colors = calendarColors(Array.from({ length: 6 }, (_, index) => user(String(index), `User ${index}`)));
    expect(new Set(colors.values())).toHaveLength(6);
  });
});
