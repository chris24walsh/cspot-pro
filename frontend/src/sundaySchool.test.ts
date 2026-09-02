import { describe, expect, it } from "vitest";

import type { SundaySchoolLesson } from "./api";
import { explicitSundaySchoolItemCount } from "./sundaySchool";

function lesson(overrides: Partial<SundaySchoolLesson> = {}): SundaySchoolLesson {
  return {
    bible_reference: "John 3:16",
    bible_story: "",
    board_items: [],
    crafts: "",
    created_at: "2026-09-01T00:00:00Z",
    games: "",
    id: "lesson-1",
    lesson_date: "2026-09-06",
    songs: "",
    source_notes: "",
    status: "draft",
    teacher_name: "Teacher",
    teacher_notes: "",
    theme: "God's love",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("explicitSundaySchoolItemCount", () => {
  it("counts added lesson content but ignores template and metadata fields", () => {
    expect(explicitSundaySchoolItemCount(lesson())).toBe(0);
    expect(explicitSundaySchoolItemCount(lesson({ bible_story: "Story", crafts: "Craft", teacher_notes: "Private note" }))).toBe(2);
  });

  it("counts flexible board items when present", () => {
    expect(explicitSundaySchoolItemCount(lesson({ board_items: [{ id: "one", kind: "content", title: "Welcome game" }] }))).toBe(1);
  });
});
