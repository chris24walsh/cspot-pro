export type ChordDisplayMode = "absolute" | "capo";
export type ChordDetailMode = "advanced" | "simple";
export type KeyAnchorMode = "absolute" | "capo";
export const LEADING_CHORD_ANCHORS = 3;
export const TRAILING_CHORD_ANCHORS = 5;
export const MUSICAL_KEYS = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

export interface ChordAnnotation {
  id: string;
  section: string | null;
  lineIndex: number;
  anchorIndex: number;
  chord: string;
}

export interface ResolvedChordAnnotation extends ChordAnnotation {
  absoluteLineIndex: number;
}

export interface ChordChartDocument {
  version: 3;
  capo: number;
  absoluteKey: string | null;
  capoKey: string | null;
  keyAnchor: KeyAnchorMode;
  annotations: ChordAnnotation[];
}

export interface ParsedChordChart {
  document: ChordChartDocument;
  legacyText: string | null;
}

export interface ChordSymbolValidation {
  normalized: string;
  error: string | null;
}

export interface ChordEditorLineSegment {
  end: number;
  start: number;
}

export function wrapChordEditorLine(line: string, maxCharacters: number): ChordEditorLineSegment[] {
  if (!line.length) return [{ start: 0, end: 0 }];
  const limit = Math.max(1, Math.floor(maxCharacters));
  const segments: ChordEditorLineSegment[] = [];
  let start = 0;

  while (start < line.length) {
    let end = Math.min(start + limit, line.length);
    if (end < line.length) {
      const breakAt = line.lastIndexOf(" ", end);
      if (breakAt > start) end = breakAt + 1;
    }
    segments.push({ start, end });
    start = end;
  }

  return segments;
}

const SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX = new Map<string, number>([
  ...SHARP_NOTES.map((note, index) => [note, index] as const),
  ...FLAT_NOTES.map((note, index) => [note, index] as const),
]);

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function makeId(section: string | null, lineIndex: number, anchorIndex: number, chord: string) {
  return `${section ?? "root"}-${lineIndex}-${anchorIndex}-${slug(chord)}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeNote(note: string) {
  const normalized = note.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function transposeNote(note: string, semitones: number, preferFlats = false) {
  const normalized = normalizeNote(note);
  const index = NOTE_INDEX.get(normalized);
  if (index == null) {
    return note;
  }
  const target = (index + semitones + 120) % 12;
  return (preferFlats ? FLAT_NOTES : SHARP_NOTES)[target];
}

function simplifyChordSymbol(chord: string) {
  const slashIndex = chord.indexOf("/");
  const main = slashIndex >= 0 ? chord.slice(0, slashIndex) : chord;
  const bass = slashIndex >= 0 ? chord.slice(slashIndex + 1) : null;
  const match = main.match(/^([A-G](?:#|b)?)(m?)/);
  if (!match) {
    return chord;
  }
  const simplified = `${match[1]}${match[2] ?? ""}`;
  return bass ? `${simplified}/${bass}` : simplified;
}

export function transposeChordSymbol(
  chord: string,
  semitones: number,
  options: { detailMode?: ChordDetailMode; preferFlats?: boolean } = {},
) {
  const match = chord.match(/^([A-G](?:#|b)?)([^/]*)?(?:\/([A-G](?:#|b)?)(.*))?$/);
  if (!match) {
    return options.detailMode === "simple" ? simplifyChordSymbol(chord) : chord;
  }

  const [, root, quality = "", bassRoot, bassTail = ""] = match;
  const transposedRoot = transposeNote(root, semitones, options.preferFlats);
  const transposedBass = bassRoot ? transposeNote(bassRoot, semitones, options.preferFlats) : null;
  const advanced = `${transposedRoot}${quality}${transposedBass ? `/${transposedBass}${bassTail}` : ""}`;
  return options.detailMode === "simple" ? simplifyChordSymbol(advanced) : advanced;
}

function normalizeChordRoot(value: string, context = "root") {
  const trimmed = value.trim().replace(/♯/g, "#").replace(/♭/g, "b");
  const match = trimmed.match(/^([A-Ga-g])([#bB]?)(.*)$/);
  if (!match) {
    return {
      root: "",
      rest: trimmed,
      error: `Chord ${context} must start with A, B, C, D, E, F, or G.`,
    };
  }

  const [, rootLetter, accidental = "", rest = ""] = match;
  const normalizedAccidental = accidental === "B" ? "b" : accidental;
  return {
    root: `${rootLetter.toUpperCase()}${normalizedAccidental}`,
    rest,
    error: null,
  };
}

function normalizeChordQuality(value: string) {
  let suffix = value.trim().replace(/\s+/g, "");
  suffix = suffix.replace(/♯/g, "#").replace(/♭/g, "b").replace(/∆/g, "maj").replace(/°/g, "dim");
  suffix = suffix.replace(/-/g, "m");

  const upper = suffix.toUpperCase();
  if (upper.startsWith("MAJOR")) {
    suffix = `maj${suffix.slice(5)}`;
  } else if (upper.startsWith("MAJ")) {
    suffix = `maj${suffix.slice(3)}`;
  } else if (upper.startsWith("MINOR")) {
    suffix = `m${suffix.slice(5)}`;
  } else if (upper.startsWith("MIN")) {
    suffix = `m${suffix.slice(3)}`;
  } else if (upper.startsWith("M")) {
    suffix = `m${suffix.slice(1)}`;
  }

  suffix = suffix
    .replace(/MAJ/g, "maj")
    .replace(/Maj/g, "maj")
    .replace(/SUS/g, "sus")
    .replace(/Sus/g, "sus")
    .replace(/ADD/g, "add")
    .replace(/Add/g, "add")
    .replace(/DIM/g, "dim")
    .replace(/Dim/g, "dim")
    .replace(/AUG/g, "aug")
    .replace(/Aug/g, "aug");

  return suffix;
}

const CHORD_QUALITY_PATTERN =
  /^(?:|m|2|4|5|6|7|9|11|13|m6|m7|m9|m11|m13|maj|maj6|maj7|maj9|maj13|mmaj7|m\(maj7\)|sus|sus2|sus4|7sus|7sus2|7sus4|9sus|9sus4|add2|add4|add9|add11|dim|dim7|aug|\+|m7b5|ø|ø7)(?:\(?[#b](?:5|9|11|13)\)?)*$/;

export function validateChordSymbol(value: string): ChordSymbolValidation {
  const cleaned = value.trim().replace(/\s+/g, "");
  if (!cleaned) {
    return { normalized: "", error: "Enter a chord symbol first." };
  }

  const parts = cleaned.split("/");
  if (parts.length > 2) {
    return { normalized: cleaned, error: "Use only one slash bass note, for example C/E." };
  }

  const rootResult = normalizeChordRoot(parts[0]);
  if (rootResult.error) {
    return { normalized: cleaned, error: rootResult.error };
  }

  const suffix = normalizeChordQuality(rootResult.rest);
  const normalizedMain = `${rootResult.root}${suffix}`;
  if (!CHORD_QUALITY_PATTERN.test(suffix)) {
    return {
      normalized: normalizedMain,
      error: "That chord quality is not recognised yet. Try plain, m, 7, maj7, sus, add9, dim, aug, or a slash chord.",
    };
  }

  if (!parts[1]) {
    return { normalized: normalizedMain, error: null };
  }

  const bassResult = normalizeChordRoot(parts[1], "bass note");
  if (bassResult.error) {
    return { normalized: `${normalizedMain}/${parts[1]}`, error: bassResult.error };
  }
  if (bassResult.rest.trim()) {
    return { normalized: `${normalizedMain}/${bassResult.root}`, error: "Slash chords should end with a bass note, like C/E." };
  }

  return { normalized: `${normalizedMain}/${bassResult.root}`, error: null };
}

export function normalizeChordSymbolInput(value: string) {
  return value
    .replace(/[^A-Ga-g#bB/0-9A-Za-z()+.\-♯♭∆°ø]/g, "")
    .replace(/\s+/g, "");
}

export function wordsForLine(line: string) {
  return line
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean);
}

export function lyricLines(lyrics: string | null) {
  return (lyrics ?? "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
}

interface ChordLyricSection {
  key: string | null;
  lineIndexes: number[];
}

function normalizeChordSectionKey(value: string) {
  const label = value.trim().replace(/^\[|\]$/g, "").replace(/:$/, "");
  const compact = label.toLowerCase().replace(/[\s-]+/g, "");
  const match = compact.match(/^(v|verse|c|chorus|refrain|b|bridge|p|pc|prechorus|t|tag|e|ending|o|outro|i|intro)(\d+)?$/);
  if (!match) return label;

  const [, kind, number = ""] = match;
  const prefix =
    kind === "v" || kind === "verse"
      ? "V"
      : kind === "c" || kind === "chorus" || kind === "refrain"
        ? "C"
        : kind === "b" || kind === "bridge"
          ? "B"
          : kind === "p" || kind === "pc" || kind === "prechorus"
            ? "P"
            : kind === "t" || kind === "tag"
              ? "T"
              : kind === "e" || kind === "ending"
                ? "E"
                : kind === "o" || kind === "outro"
                  ? "O"
                  : "I";
  return `${prefix}${number}`;
}

function chordLyricSections(lyrics: string | null) {
  const sections: ChordLyricSection[] = [{ key: null, lineIndexes: [] }];
  let current = sections[0];

  lyricLines(lyrics).forEach((line, lineIndex) => {
    const sectionMatch = line.trim().match(/^\[([^\]]+)\]$/);
    if (sectionMatch?.[1]) {
      current = { key: normalizeChordSectionKey(sectionMatch[1]), lineIndexes: [] };
      sections.push(current);
      return;
    }
    current.lineIndexes.push(lineIndex);
  });

  return sections;
}

export function chordPositionForLine(lyrics: string | null, absoluteLineIndex: number) {
  for (const section of chordLyricSections(lyrics)) {
    const lineIndex = section.lineIndexes.indexOf(absoluteLineIndex);
    if (lineIndex >= 0) {
      return { section: section.key, lineIndex };
    }
  }
  return null;
}

export function resolveChordAnnotations(annotations: ChordAnnotation[], lyrics: string | null) {
  const sections = chordLyricSections(lyrics);
  return annotations.flatMap((annotation): ResolvedChordAnnotation[] => {
    const section = sections.find((candidate) => candidate.key === annotation.section);
    const absoluteLineIndex = section?.lineIndexes[annotation.lineIndex];
    if (absoluteLineIndex == null) return [];
    return [{ ...annotation, absoluteLineIndex }];
  });
}

function relativePositionForLegacyLine(lyrics: string | null, absoluteLineIndex: number) {
  return chordPositionForLine(lyrics, absoluteLineIndex) ?? { section: null, lineIndex: absoluteLineIndex };
}

export function createEmptyChordChart(): ChordChartDocument {
  return {
    version: 3,
    capo: 0,
    absoluteKey: null,
    capoKey: null,
    keyAnchor: "capo",
    annotations: [],
  };
}

export function normalizeKeySignature(key: string | null | undefined) {
  if (!key) {
    return null;
  }
  const normalized = normalizeNote(key);
  if (normalized === "Db") {
    return "C#";
  }
  return NOTE_INDEX.has(normalized) ? normalized : null;
}

export function semitoneDistance(fromKey: string, toKey: string) {
  const from = NOTE_INDEX.get(normalizeNote(fromKey));
  const to = NOTE_INDEX.get(normalizeNote(toKey));
  if (from == null || to == null) {
    return 0;
  }
  return (to - from + 120) % 12;
}

export function cappedCapoForKeys(shapeKey: string, targetKey: string, maximum = 5) {
  return Math.min(semitoneDistance(shapeKey, targetKey), maximum);
}

export function deriveCapoKey(absoluteKey: string, capo: number) {
  return transposeNote(absoluteKey, -capo, absoluteKey.includes("b"));
}

export function deriveAbsoluteKey(capoKey: string, capo: number) {
  return transposeNote(capoKey, capo, capoKey.includes("b"));
}

export function setChordChartAbsoluteKey(document: ChordChartDocument, value: string): ChordChartDocument {
  const absoluteKey = normalizeKeySignature(value);
  const next: ChordChartDocument = { ...document, absoluteKey, keyAnchor: "absolute" };
  if (absoluteKey && document.absoluteKey && absoluteKey !== document.absoluteKey) {
    next.annotations = transposeChordAnnotations(
      document.annotations,
      semitoneDistance(document.absoluteKey, absoluteKey),
      { preferFlats: absoluteKey.includes("b") },
    );
  }
  next.capoKey = absoluteKey && document.capo > 0 ? deriveCapoKey(absoluteKey, document.capo) : null;
  return next;
}

export function transposeChordAnnotations(
  annotations: ChordAnnotation[],
  semitones: number,
  options: { preferFlats?: boolean } = {},
) {
  if (semitones === 0) {
    return annotations;
  }

  return annotations.map((annotation) => ({
    ...annotation,
    chord: transposeChordSymbol(annotation.chord, semitones, {
      detailMode: "advanced",
      preferFlats: options.preferFlats,
    }),
  }));
}

export function parseChordChart(raw: string | null, lyrics: string | null = null): ParsedChordChart {
  if (!raw?.trim()) {
    return { document: createEmptyChordChart(), legacyText: null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChordChartDocument> & { version?: number };
    const parsedVersion = Number(parsed?.version ?? 0);
    if (parsed && (parsedVersion === 1 || parsedVersion === 2 || parsedVersion === 3) && Array.isArray(parsed.annotations)) {
      return {
        document: {
          version: 3,
          capo: Math.max(0, Math.trunc(parsed.capo ?? 0)),
          absoluteKey: normalizeKeySignature(parsed.absoluteKey),
          capoKey: normalizeKeySignature(parsed.capoKey),
          keyAnchor: parsed.keyAnchor === "absolute" ? "absolute" : "capo",
          annotations: parsed.annotations
            .map((annotation) => {
              const legacyAnnotation = annotation as Partial<ChordAnnotation> & { wordIndex?: number };
              const storedLineIndex = Math.max(0, Math.trunc(annotation.lineIndex ?? 0));
              const position = parsedVersion === 3
                ? {
                    section: typeof annotation.section === "string" ? normalizeChordSectionKey(annotation.section) : null,
                    lineIndex: storedLineIndex,
                  }
                : relativePositionForLegacyLine(lyrics, storedLineIndex);
              const anchorIndex = Math.max(
                0,
                Math.trunc(legacyAnnotation.anchorIndex ?? legacyAnnotation.wordIndex ?? 0),
              );
              const chord = String(annotation.chord ?? "").trim();
              return {
                id: annotation.id || makeId(position.section, position.lineIndex, anchorIndex, chord || "chord"),
                ...position,
                anchorIndex,
                chord,
              };
            })
            .filter((annotation) => annotation.chord),
        },
        legacyText: null,
      };
    }
  } catch {
    // fall through to ChordPro / legacy parsing
  }

  const chordPro = parseChordProToAnnotations(raw, lyrics);
  if (chordPro.annotations.length) {
    return { document: chordPro, legacyText: null };
  }

  return { document: createEmptyChordChart(), legacyText: raw };
}

function parseChordProToAnnotations(raw: string, lyrics: string | null): ChordChartDocument {
  const annotations: ChordAnnotation[] = [];
  const lines = raw.split(/\r?\n/);

  lines.forEach((line, lineIndex) => {
    const tokenRegex = /\[([^\]]+)\]([^\[]*)/g;
    let anchorIndex = 0;
    for (const match of line.matchAll(tokenRegex)) {
      const chord = match[1]?.trim();
      if (!chord) {
        continue;
      }
      const followingText = match[2] ?? "";
      const position = relativePositionForLegacyLine(lyrics, lineIndex);
      annotations.push({
        id: makeId(position.section, position.lineIndex, anchorIndex, chord),
        ...position,
        anchorIndex,
        chord,
      });
      anchorIndex += followingText.length;
    }
  });

  return {
    version: 3,
    capo: 0,
    absoluteKey: null,
    capoKey: null,
    keyAnchor: "capo",
    annotations,
  };
}

export function serializeChordChart(document: ChordChartDocument, legacyText: string | null = null) {
  if (
    !document.annotations.length &&
    document.capo === 0 &&
    !document.absoluteKey &&
    !document.capoKey &&
    document.keyAnchor === "capo" &&
    !legacyText
  ) {
    return null;
  }

  if (!document.annotations.length && legacyText?.trim()) {
    return legacyText.trim();
  }

  return JSON.stringify(
    {
      version: 3,
      capo: document.capo,
      absoluteKey: document.absoluteKey,
      capoKey: document.capoKey,
      keyAnchor: document.keyAnchor,
      annotations: [...document.annotations].sort(
        (left, right) =>
          (left.section ?? "").localeCompare(right.section ?? "") ||
          left.lineIndex - right.lineIndex ||
          left.anchorIndex - right.anchorIndex ||
          left.chord.localeCompare(right.chord),
      ),
    },
    null,
    2,
  );
}

export function upsertChordAnnotation(
  document: ChordChartDocument,
  input: { chord: string; id?: string | null; section: string | null; lineIndex: number; anchorIndex: number },
) {
  const next: ChordAnnotation = {
    id: input.id || makeId(input.section, input.lineIndex, input.anchorIndex, input.chord),
    section: input.section,
    lineIndex: input.lineIndex,
    anchorIndex: input.anchorIndex,
    chord: input.chord.trim(),
  };

  const existingIndex = document.annotations.findIndex((annotation) => annotation.id === next.id);
  if (existingIndex >= 0) {
    const annotations = [...document.annotations];
    annotations[existingIndex] = next;
    return { ...document, annotations };
  }

  return {
    ...document,
    annotations: [...document.annotations, next],
  };
}

export function removeChordAnnotation(document: ChordChartDocument, id: string) {
  return {
    ...document,
    annotations: document.annotations.filter((annotation) => annotation.id !== id),
  };
}

export function clearChordAnnotations(document: ChordChartDocument): ChordChartDocument {
  return { ...document, annotations: [] };
}

export function displayChord(
  chord: string,
  options: {
    capo: number;
    detailMode: ChordDetailMode;
    displayMode: ChordDisplayMode;
    preferFlats?: boolean;
  },
) {
  const absolute = transposeChordSymbol(chord, 0, {
    detailMode: options.detailMode,
    preferFlats: options.preferFlats,
  });

  if (options.displayMode === "absolute") {
    return absolute;
  }

  return transposeChordSymbol(chord, -options.capo, {
    detailMode: options.detailMode,
    preferFlats: options.preferFlats,
  });
}

export function annotationLabel(annotation: ChordAnnotation, lyrics: string | null) {
  const lines = lyricLines(lyrics);
  const resolved = resolveChordAnnotations([annotation], lyrics)[0];
  const line = lines[resolved?.absoluteLineIndex ?? -1] ?? "";
  const relativeIndex = annotation.anchorIndex - LEADING_CHORD_ANCHORS;
  const clippedIndex = Math.max(-LEADING_CHORD_ANCHORS, Math.min(relativeIndex, line.length + TRAILING_CHORD_ANCHORS));
  if (clippedIndex < 0) {
    return "line start";
  }
  if (clippedIndex >= line.length) {
    return "line end";
  }
  return `char ${clippedIndex + 1}`;
}
