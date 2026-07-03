export type ChordDisplayMode = "absolute" | "capo";
export type ChordDetailMode = "advanced" | "simple";
export type KeyAnchorMode = "absolute" | "capo";
export const LEADING_CHORD_ANCHORS = 3;
export const TRAILING_CHORD_ANCHORS = 5;
export const MUSICAL_KEYS = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"] as const;

export interface ChordAnnotation {
  id: string;
  lineIndex: number;
  anchorIndex: number;
  chord: string;
}

export interface ChordChartDocument {
  version: 2;
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

const SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX = new Map<string, number>([
  ...SHARP_NOTES.map((note, index) => [note, index] as const),
  ...FLAT_NOTES.map((note, index) => [note, index] as const),
]);

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function makeId(lineIndex: number, wordIndex: number, chord: string) {
  return `${lineIndex}-${wordIndex}-${slug(chord)}-${Math.random().toString(36).slice(2, 7)}`;
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

export function createEmptyChordChart(): ChordChartDocument {
  return {
    version: 2,
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

export function parseChordChart(raw: string | null): ParsedChordChart {
  if (!raw?.trim()) {
    return { document: createEmptyChordChart(), legacyText: null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChordChartDocument> & { version?: number };
    const parsedVersion = Number(parsed?.version ?? 0);
    if (parsed && (parsedVersion === 1 || parsedVersion === 2) && Array.isArray(parsed.annotations)) {
      return {
        document: {
          version: 2,
          capo: Math.max(0, Math.trunc(parsed.capo ?? 0)),
          absoluteKey: normalizeKeySignature(parsed.absoluteKey),
          capoKey: normalizeKeySignature(parsed.capoKey),
          keyAnchor: parsed.keyAnchor === "absolute" ? "absolute" : "capo",
          annotations: parsed.annotations
            .map((annotation) => ({
              id:
                annotation.id ||
                makeId(
                  annotation.lineIndex ?? 0,
                  (annotation as Partial<ChordAnnotation> & { wordIndex?: number }).anchorIndex ??
                    (annotation as Partial<ChordAnnotation> & { wordIndex?: number }).wordIndex ??
                    0,
                  annotation.chord ?? "chord",
                ),
              lineIndex: Math.max(0, Math.trunc(annotation.lineIndex ?? 0)),
              anchorIndex: Math.max(
                0,
                Math.trunc(
                  (annotation as Partial<ChordAnnotation> & { wordIndex?: number }).anchorIndex ??
                    (annotation as Partial<ChordAnnotation> & { wordIndex?: number }).wordIndex ??
                    0,
                ),
              ),
              chord: String(annotation.chord ?? "").trim(),
            }))
            .filter((annotation) => annotation.chord),
        },
        legacyText: null,
      };
    }
  } catch {
    // fall through to ChordPro / legacy parsing
  }

  const chordPro = parseChordProToAnnotations(raw);
  if (chordPro.annotations.length) {
    return { document: chordPro, legacyText: null };
  }

  return { document: createEmptyChordChart(), legacyText: raw };
}

function parseChordProToAnnotations(raw: string): ChordChartDocument {
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
      annotations.push({
        id: makeId(lineIndex, anchorIndex, chord),
        lineIndex,
        anchorIndex,
        chord,
      });
      anchorIndex += followingText.length;
    }
  });

  return {
    version: 2,
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
      version: 2,
      capo: document.capo,
      absoluteKey: document.absoluteKey,
      capoKey: document.capoKey,
      keyAnchor: document.keyAnchor,
      annotations: [...document.annotations].sort(
        (left, right) => left.lineIndex - right.lineIndex || left.anchorIndex - right.anchorIndex || left.chord.localeCompare(right.chord),
      ),
    },
    null,
    2,
  );
}

export function upsertChordAnnotation(
  document: ChordChartDocument,
  input: { chord: string; id?: string | null; lineIndex: number; anchorIndex: number },
) {
  const next: ChordAnnotation = {
    id: input.id || makeId(input.lineIndex, input.anchorIndex, input.chord),
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
  const line = lines[annotation.lineIndex] ?? "";
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
