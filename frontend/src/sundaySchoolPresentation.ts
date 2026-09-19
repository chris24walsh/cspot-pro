import type { SundaySchoolBoardItem, SundaySchoolDisplayState, SundaySchoolVerseGame } from "./api";

export const EMPTY_SCHOOL_DISPLAY: SundaySchoolDisplayState = {
  kind: "idle", element_id: "", title: "", detail: "", story_id: "", step: 0, blanked: false,
  last_week: { text: "", reference: "" }, this_week: { text: "", reference: "" },
};

export const EXAMPLE_VERSES: SundaySchoolVerseGame = {
  last_week: { text: "The LORD is my shepherd; I shall not want.", reference: "Psalm 23:1" },
  this_week: { text: "What time I am afraid, I will trust in thee.", reference: "Psalm 56:3" },
  translation: "KJV",
};

// Preserve existing lessons while folding the previous two element types into one.
export function combineVerseItems(items: SundaySchoolBoardItem[]): SundaySchoolBoardItem[] {
  const previous = items.find((item) => item.element_type === "challenge");
  const current = items.find((item) => item.element_type === "verse");
  let inserted = false;
  return items.flatMap((item) => {
    if (item.element_type !== "verse" && item.element_type !== "challenge") return [item];
    if (inserted) return [];
    inserted = true;
    return [{ ...item, element_type: "memory_verse", title: "Memory Verse Game", detail: "",
      verse_game: { last_week: { text: previous?.detail ?? "", reference: previous?.reference ?? "" },
        this_week: { text: current?.detail ?? "", reference: current?.reference ?? "" } } }];
  });
}

export function presentationForItem(item: SundaySchoolBoardItem): SundaySchoolDisplayState {
  const kind = item.element_type === "memory_verse" ? "verse" : item.element_type === "story" || item.story_id ? "story" : item.element_type === "songs" ? "song" : "text";
  return { ...EMPTY_SCHOOL_DISPLAY, ...(item.verse_game ?? {}), kind, element_id: item.id,
    title: item.title, detail: kind === "story" ? "" : item.detail ?? "", story_id: item.story_id ?? "" };
}

// Seven recall stages (0–6), then seven learning stages (7–13).
export function versePhase(step: number) {
  return { mode: step < 7 ? "recall" as const : "learn" as const, stage: step < 7 ? step : step - 7 };
}

export function verseNextLabel(step: number) {
  if (step === 5) return "Next: Bible reference";
  if (step === 6) return "Next: This Week's Verse";
  if (step < 5) return "Next: Hint";
  if (step === 12) return "Next: Hide reference";
  if (step === 13) return "Verse game complete";
  return "Next: Hide more words";
}

export function verseWords(text: string, step: number) {
  const { mode, stage } = versePhase(step);
  const tokens = text.match(/[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*|[^\p{L}\p{N}]+/gu) ?? [];
  const words = tokens.map((token, index) => ({ token, index })).filter(({ token }) => /^[\p{L}\p{N}]/u.test(token));
  // Index-based hash distributes useful hints without coupling repeated words.
  const order = words.map(({ index }, position) => ({ index, score: ((position + 1) * 2654435761) >>> 0 }))
    .sort((a, b) => a.score - b.score).map(({ index }) => index);
  const count = Math.ceil(words.length * Math.min(stage, 5) / 5);
  const chosen = new Set(order.slice(0, count));
  return tokens.map((token, index) => ({ text: token, word: /^[\p{L}\p{N}]/u.test(token),
    hidden: /^[\p{L}\p{N}]/u.test(token) && (mode === "recall" ? !chosen.has(index) : chosen.has(index)) }));
}
