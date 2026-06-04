# Song Print Handout Schema

## Source Corpus

The reference handouts are in Google Drive under `Individual songs handouts`.
The newer folder scanned was `1o9RIy6dCYz3YryrcWXpIGEjJCX7kPCvM`.

Corpus shape from 102 usable `.docx` files:

- Page size: A4 for all documents.
- Margins: `0.5in` on all sides for 99 of 102 documents.
- Columns: 53 one-column sheets, 49 two-column sheets.
- Column gap: usually `0.5in`.
- Lyric sheets: mostly theme/Calibri-like font at 16-24pt, with body commonly 16pt, 18pt, or 20pt.
- Chorded sheets: rare in the handout folder; the clear examples use one column, Courier New, about 13pt, with chord lines above lyric lines.
- Existing sheets often place title and key together, either as `Title (Key: G)` or `Title` followed by `Key:`.
- Multi-song sheets use the same page template and rely on columns plus separators, not separate pages.

The current cspot print chord chart in `SongManager` is not a good match for these handouts. It renders per-character/word flex blocks in a temporary browser window, which does not preserve the simple page shape of the Drive sheets and will be hard to keep visually aligned with unchorded lyric sheets.

## Product Goal

Every song in the cspot library should be printable as:

- **Lyrics sheet**: same handout shape as the Drive corpus, no chords.
- **Chorded lyrics sheet**: same handout shape, with chord annotation lines added above lyric lines.

The two outputs should share the same print layout model. Chorded output should differ only by enabling chord rendering and switching to a monospaced chord-friendly body mode when needed.

## Proposed Data Model

Keep the canonical song text in `songs.lyrics` and chord annotations in `songs.chords`.
Add print-specific metadata as optional structured data rather than baking layout into lyric text.

Recommended column on `songs`:

```ts
print_profile: SongPrintProfile | null
```

Recommended TypeScript/Pydantic shape:

```ts
interface SongPrintProfile {
  version: 1;
  format: "musician-handout";
  page?: PrintPageSettings;
  header?: PrintHeaderSettings;
  body?: PrintBodySettings;
  flow?: PrintFlowSettings;
  repeats?: PrintRepeatSettings;
  notes?: string | null;
}

interface PrintPageSettings {
  size: "a4";
  orientation: "portrait";
  marginInches: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

interface PrintHeaderSettings {
  titleOverride?: string | null;
  subtitle?: string | null;
  showAuthor: boolean;
  showKey: boolean;
  keyText?: string | null;
  titleStyle: "plain" | "centered" | "compact";
}

interface PrintBodySettings {
  fontFamily: "system" | "serif" | "monospace";
  lyricFontPt: number;
  chordFontPt: number;
  sectionLabelStyle: "hidden" | "plain" | "bracketed" | "bold";
  chorusEmphasis: "none" | "bold";
  lineSpacing: "compact" | "normal";
}

interface PrintFlowSettings {
  columns: "auto" | 1 | 2;
  columnGapInches: number;
  fitToPages: 1 | 2 | "auto";
  sectionBreakSpacing: "compact" | "normal";
  songBreak: "separator" | "page" | "none";
}

interface PrintRepeatSettings {
  mode: "expanded" | "references";
  referenceStyle: "ellipsis" | "repeat-note";
}
```

## Default Profile

Most songs should not need custom metadata. Use these defaults:

```json
{
  "version": 1,
  "format": "musician-handout",
  "page": {
    "size": "a4",
    "orientation": "portrait",
    "marginInches": { "top": 0.5, "right": 0.5, "bottom": 0.5, "left": 0.5 }
  },
  "header": {
    "showAuthor": false,
    "showKey": true,
    "titleStyle": "plain"
  },
  "body": {
    "fontFamily": "system",
    "lyricFontPt": 16,
    "chordFontPt": 13,
    "sectionLabelStyle": "plain",
    "chorusEmphasis": "none",
    "lineSpacing": "normal"
  },
  "flow": {
    "columns": "auto",
    "columnGapInches": 0.5,
    "fitToPages": 1,
    "sectionBreakSpacing": "compact",
    "songBreak": "separator"
  },
  "repeats": {
    "mode": "references",
    "referenceStyle": "ellipsis"
  }
}
```

## Print Document Model

At render time, build a normalized document from canonical song data:

```ts
interface SongPrintDocument {
  title: string;
  author?: string | null;
  key?: string | null;
  profile: SongPrintProfile;
  sections: SongPrintSection[];
}

interface SongPrintSection {
  id: string;
  label: string;
  role: "verse" | "chorus" | "prechorus" | "bridge" | "tag" | "other";
  repeatReference: boolean;
  lines: SongPrintLine[];
}

interface SongPrintLine {
  text: string;
  chords?: SongPrintChord[];
}

interface SongPrintChord {
  symbol: string;
  charIndex: number;
}
```

This separates:

- canonical lyrics storage
- chord annotations
- print layout preferences
- generated printable output

## Rendering Rules

1. Parse `songs.lyrics` into labelled sections using the existing worship text parser.
2. Use `songs.sequence` to determine printed order.
3. Collapse repeated full sections into references by default:
   - unchorded: `Chorus ...`
   - chorded: same reference, unless the repeated section has different chord voicing.
4. Choose column count automatically:
   - one column for chorded/monospace charts
   - one column for short lyric sheets
   - two columns when lyric body exceeds a simple line-count threshold
5. Use A4 portrait, 0.5in margins, and 0.5in column gap.
6. Header should be compact:
   - `Title`
   - optional `Key: G`
   - author only when explicitly present or useful.
7. Chorded and unchorded views should call the same print component:
   - `showChords = false` for lyric sheets
   - `showChords = true` for chorded sheets.

## Implementation Notes

- Prefer an in-app print route or modal print surface over writing a temporary browser window by string concatenation.
- Add two song config buttons:
  - `Print Lyrics`
  - `Print Chorded Lyrics`
- Replace the current `printChordChart()` implementation with the shared print renderer.
- Keep print CSS isolated with `@media print` and fixed A4 page variables.
- Do not store generated HTML. Store only `print_profile` overrides and regenerate from song lyrics/chords.
- Multi-song handouts can later reuse the same document model with an array of songs, but the first implementation should focus on one printable song at a time.

