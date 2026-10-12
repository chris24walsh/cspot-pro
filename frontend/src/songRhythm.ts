export type StrumStroke = "D" | "U" | "-" | "X";
export type StrumSection = "Default" | "Verse" | "Chorus" | "Bridge";
export interface StrumPattern {
  section: StrumSection;
  subdivision: 1 | 2;
  strokes: StrumStroke[];
}
export interface SongRhythm {
  numerator: number;
  denominator: 2 | 4 | 8 | 16;
  patterns: StrumPattern[];
  notes: string;
}

export const STRUM_SECTIONS: StrumSection[] = ["Default", "Verse", "Chorus", "Bridge"];
export const STROKE_SYMBOLS: Record<StrumStroke, string> = { D: "↓", U: "↑", "-": "–", X: "×" };
export const STROKE_NAMES: Record<StrumStroke, string> = { D: "Downstroke", U: "Upstroke", "-": "Rest", X: "Muted stroke" };
export const STROKE_CYCLE: StrumStroke[] = ["-", "D", "U", "X"];

export const STRUM_PRESETS: Array<{
  id: string; name: string; numerator: number; denominator: SongRhythm["denominator"];
  subdivision: 1 | 2; strokes: StrumStroke[];
}> = [
  { id: "four-down", name: "Steady downstrokes", numerator: 4, denominator: 4, subdivision: 1, strokes: ["D", "D", "D", "D"] },
  { id: "four-alternating", name: "Straight down-up", numerator: 4, denominator: 4, subdivision: 2, strokes: ["D", "U", "D", "U", "D", "U", "D", "U"] },
  { id: "four-common", name: "Down, down-up, up-down-up", numerator: 4, denominator: 4, subdivision: 2, strokes: ["D", "-", "D", "U", "-", "U", "D", "U"] },
  { id: "four-sparse", name: "Down, down, down, down-up", numerator: 4, denominator: 4, subdivision: 2, strokes: ["D", "-", "D", "-", "D", "-", "D", "U"] },
  { id: "four-muted", name: "Muted backbeat", numerator: 4, denominator: 4, subdivision: 2, strokes: ["D", "-", "X", "U", "D", "-", "X", "U"] },
  { id: "three-down", name: "Waltz downstrokes", numerator: 3, denominator: 4, subdivision: 1, strokes: ["D", "D", "D"] },
  { id: "three-flowing", name: "Flowing waltz", numerator: 3, denominator: 4, subdivision: 2, strokes: ["D", "-", "D", "U", "D", "U"] },
  { id: "six-gentle", name: "Gentle 6/8", numerator: 6, denominator: 8, subdivision: 1, strokes: ["D", "-", "U", "D", "-", "U"] },
  { id: "six-flowing", name: "Flowing 6/8", numerator: 6, denominator: 8, subdivision: 1, strokes: ["D", "U", "U", "D", "U", "U"] },
  { id: "two-march", name: "March down-up", numerator: 2, denominator: 4, subdivision: 2, strokes: ["D", "U", "D", "U"] },
  { id: "twelve-flowing", name: "Flowing 12/8", numerator: 12, denominator: 8, subdivision: 1, strokes: ["D", "U", "U", "D", "U", "U", "D", "U", "U", "D", "U", "U"] },
];

export function strumCounts(rhythm: SongRhythm, pattern: StrumPattern): string[] {
  const compound = rhythm.denominator === 8 && rhythm.numerator % 3 === 0 && pattern.subdivision === 1;
  return pattern.strokes.map((_, index) => {
    if (compound) return index % 3 === 0 ? String(index / 3 + 1) : index % 3 === 1 ? "&" : "a";
    return index % pattern.subdivision === 0 ? String(index / pattern.subdivision + 1) : "&";
  });
}

export function resizeStrumPattern(pattern: StrumPattern, numerator: number, subdivision = pattern.subdivision): StrumPattern {
  return {
    ...pattern, subdivision,
    strokes: Array.from({ length: numerator * subdivision }, (_, index) => {
      const oldIndex = index * pattern.subdivision / subdivision;
      return Number.isInteger(oldIndex) ? pattern.strokes[oldIndex] ?? "-" : "-";
    }),
  };
}

export function strumPatternForSection(rhythm: SongRhythm, section?: string | null): StrumPattern | undefined {
  const normalized = section?.replace(/[\[\]]/g, "").trim() ?? "";
  const kind: StrumSection | undefined = /^(V\d*\b|Verse\b)/i.test(normalized) ? "Verse"
    : /^(C\d*\b|Chorus\b)/i.test(normalized) ? "Chorus"
    : /^(B\d*\b|Bridge\b)/i.test(normalized) ? "Bridge" : undefined;
  return rhythm.patterns.find((pattern) => pattern.section === kind)
    ?? rhythm.patterns.find((pattern) => pattern.section === "Default");
}
