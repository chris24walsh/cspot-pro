import type { SundaySchoolLesson } from "./api";

const EXPLICIT_LESSON_ITEM_FIELDS = ["bible_story", "crafts", "songs", "games", "source_notes"] as const;

export function explicitSundaySchoolItemCount(lesson: SundaySchoolLesson | null | undefined) {
  if (!lesson) return 0;
  return EXPLICIT_LESSON_ITEM_FIELDS.filter((field) => lesson[field].trim()).length;
}
