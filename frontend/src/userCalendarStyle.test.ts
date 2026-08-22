import { describe, expect, it } from "vitest";

import type { User } from "./api";
import { calendarColor, calendarMarkers } from "./userCalendarStyle";

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
  it("uses a single capital when there is no conflict", () => {
    expect(calendarMarkers([user("1", "Hanna")]).get("1")).toBe("H");
  });

  it("adds a lower-case differentiator when initials conflict", () => {
    const markers = calendarMarkers([user("1", "Hanna"), user("2", "Helen")]);
    expect(markers.get("1")).toMatch(/^H[a-z]$/);
    expect(markers.get("2")).toMatch(/^H[a-z]$/);
    expect(markers.get("1")).not.toBe(markers.get("2"));
  });

  it("uses an avatar instead of the assigned colour and initial", () => {
    const leader = user("1", "Hanna", "teacher-c", "🎤");
    expect(calendarMarkers([leader]).get("1")).toBe("🎤");
    expect(calendarColor(leader)).toBe("");
  });
});
