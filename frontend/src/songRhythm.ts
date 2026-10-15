export type StrumStroke = "D" | "U" | "S" | "s" | "-" | "X";
export type StrumSection = "Default" | "Verse" | "Chorus" | "Bridge";
export interface StrumPattern {
  name?: string;
  bars?: 1 | 2;
  section: StrumSection;
  subdivision: 1 | 2 | 4;
  strokes: StrumStroke[];
}
export interface BarMarker {
  id: string;
  section: string | null;
  lineIndex: number;
  anchorIndex: number;
}
export interface SongRhythm {
  numerator: number;
  denominator: 2 | 4 | 8 | 16;
  patterns: StrumPattern[];
  notes: string;
  bpm?: number;
  intro_bars?: number;
  visual_beats?: number | null;
  markers?: BarMarker[];
  arrangements?: Array<{ section: string; chart: string }>;
}

export const STRUM_SECTIONS: StrumSection[] = ["Default", "Verse", "Chorus", "Bridge"];
export const STROKE_SYMBOLS: Record<StrumStroke, string> = { D: "↓", U: "↑", S: "⇣", s: "⇡", "-": "–", X: "×" };
export const STROKE_NAMES: Record<StrumStroke, string> = { D: "Downstroke", U: "Upstroke", S: "Soft downstroke", s: "Soft upstroke", "-": "Rest", X: "Muted stroke" };
export const STROKE_CYCLE: StrumStroke[] = ["-", "D", "U", "S", "s", "X"];

export const STRUM_PRESETS: Array<{
  id: string; name: string; numerator: number; denominator: SongRhythm["denominator"];
  subdivision: 1 | 2 | 4; strokes: StrumStroke[];
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
    index %= rhythm.numerator * pattern.subdivision;
    if (compound) return index % 3 === 0 ? String(index / 3 + 1) : index % 3 === 1 ? "&" : "a";
    if (pattern.subdivision === 4) return index % 4 === 0 ? String(index / 4 + 1) : ["", "e", "&", "a"][index % 4];
    return index % pattern.subdivision === 0 ? String(index / pattern.subdivision + 1) : "&";
  });
}

export function resizeStrumPattern(pattern: StrumPattern, numerator: number, subdivision = pattern.subdivision, bars: 1 | 2 = pattern.bars ?? 1): StrumPattern {
  return {
    ...pattern, subdivision, bars,
    strokes: Array.from({ length: numerator * subdivision * bars }, (_, index) => {
      const oldSlots = pattern.strokes.length / (pattern.bars ?? 1);
      const oldIndex = Math.floor(index / (numerator * subdivision)) * oldSlots + (index % (numerator * subdivision)) * pattern.subdivision / subdivision;
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


export interface RhythmPreset {
  id: string;
  kind: "meter" | "strum";
  name: string;
  numerator: number;
  denominator: SongRhythm["denominator"];
  subdivision: 1 | 2 | 4 | null;
  strokes: StrumStroke[] | null;
}

export function normalizeSongRhythm(rhythm: SongRhythm | null | undefined): SongRhythm | null {
  return rhythm ? {
    numerator: rhythm.numerator, denominator: rhythm.denominator,
    ...(rhythm.intro_bars !== undefined ? { intro_bars: rhythm.intro_bars } : {}),
    patterns: rhythm.patterns.map((pattern) => ({ name: pattern.name ?? "", section: pattern.section, bars: pattern.bars ?? 1, subdivision: pattern.subdivision, strokes: [...pattern.strokes] })),
    notes: rhythm.notes ?? "", bpm: rhythm.bpm ?? 90, visual_beats: rhythm.visual_beats ?? null,
    markers: (rhythm.markers ?? []).map((marker) => ({ id: marker.id, section: marker.section, lineIndex: marker.lineIndex, anchorIndex: marker.anchorIndex }))
      .sort((a, b) => (a.section ?? "").localeCompare(b.section ?? "") || a.lineIndex - b.lineIndex || a.anchorIndex - b.anchorIndex),
    arrangements: (rhythm.arrangements ?? []).map((entry) => ({ section: entry.section, chart: entry.chart })),
  } : null;
}

export function strumGridColumns(numerator: number, subdivision: number) {
  const slots = numerator * subdivision;
  return slots > 8 ? Math.ceil(slots / 2) : slots;
}
