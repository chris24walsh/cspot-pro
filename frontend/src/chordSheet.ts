export type ChordDisplayMode = "absolute" | "capo";
export type ChordDetailMode = "advanced" | "simple";

export interface ChordAnnotation {
  id: string;
  lineIndex: number;
  wordIndex: number;
  chord: string;
}

export interface ChordChartDocument {
  version: 1;
  capo: number;
  annotations: ChordAnnotation[];
}

export interface ParsedChordChart {
  document: ChordChartDocument;
  legacyText: string | null;
}

const SHARP_NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NOTES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NOTE_INDEX = new Map(
  [...SHARP_NOTES, ...FLAT_NOTES].map((note, index, source) => [note, source === SHARP_NOTES ? index : FLAT_NOTES.indexOf(note)]),
);

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
    version: 1,
    capo: 0,
    annotations: [],
  };
}

export function parseChordChart(raw: string | null): ParsedChordChart {
  if (!raw?.trim()) {
    return { document: createEmptyChordChart(), legacyText: null };
  }

  try {
    const parsed = JSON.parse(raw) as Partial<ChordChartDocument>;
    if (parsed && parsed.version === 1 && Array.isArray(parsed.annotations)) {
      return {
        document: {
          version: 1,
          capo: Math.max(0, Math.trunc(parsed.capo ?? 0)),
          annotations: parsed.annotations
            .map((annotation) => ({
              id: annotation.id || makeId(annotation.lineIndex ?? 0, annotation.wordIndex ?? 0, annotation.chord ?? "chord"),
              lineIndex: Math.max(0, Math.trunc(annotation.lineIndex ?? 0)),
              wordIndex: Math.max(0, Math.trunc(annotation.wordIndex ?? 0)),
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
    const wordRegex = /\[([^\]]+)\]([^\s[]*)/g;
    let wordIndex = 0;
    for (const match of line.matchAll(wordRegex)) {
      const chord = match[1]?.trim();
      if (!chord) {
        continue;
      }
      annotations.push({
        id: makeId(lineIndex, wordIndex, chord),
        lineIndex,
        wordIndex,
        chord,
      });
      wordIndex += 1;
    }
  });

  return {
    version: 1,
    capo: 0,
    annotations,
  };
}

export function serializeChordChart(document: ChordChartDocument, legacyText: string | null = null) {
  if (!document.annotations.length && document.capo === 0 && !legacyText) {
    return null;
  }

  if (!document.annotations.length && legacyText?.trim()) {
    return legacyText.trim();
  }

  return JSON.stringify(
    {
      version: 1,
      capo: document.capo,
      annotations: [...document.annotations].sort(
        (left, right) => left.lineIndex - right.lineIndex || left.wordIndex - right.wordIndex || left.chord.localeCompare(right.chord),
      ),
    },
    null,
    2,
  );
}

export function upsertChordAnnotation(
  document: ChordChartDocument,
  input: { chord: string; id?: string | null; lineIndex: number; wordIndex: number },
) {
  const next: ChordAnnotation = {
    id: input.id || makeId(input.lineIndex, input.wordIndex, input.chord),
    lineIndex: input.lineIndex,
    wordIndex: input.wordIndex,
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
    transpose: number;
    preferFlats?: boolean;
  },
) {
  const absolute = transposeChordSymbol(chord, options.transpose, {
    detailMode: options.detailMode,
    preferFlats: options.preferFlats,
  });

  if (options.displayMode === "absolute") {
    return absolute;
  }

  return transposeChordSymbol(chord, options.transpose - options.capo, {
    detailMode: options.detailMode,
    preferFlats: options.preferFlats,
  });
}

export function annotationLabel(annotation: ChordAnnotation, lyrics: string | null) {
  const lines = lyricLines(lyrics);
  const line = lines[annotation.lineIndex] ?? "";
  const words = wordsForLine(line);
  if (annotation.wordIndex <= 0) {
    return "line start";
  }
  if (annotation.wordIndex >= words.length) {
    return "line end";
  }
  return `before ${words[annotation.wordIndex] ?? `word ${annotation.wordIndex + 1}`}`;
}
