import { LEADING_CHORD_ANCHORS, TRAILING_CHORD_ANCHORS, lyricLines, resolveChordAnnotations, type ChordAnnotation } from './chordSheet';
import type { SongRhythm } from './songRhythm';
import { worshipSequenceBlocks } from './worshipText';

export interface LyricPosition { lineIndex: number; anchorIndex: number }
export interface LyricBar { section: string; start: LyricPosition; end: LyricPosition; stops: LyricPosition[] }
export interface LyricCursor extends LyricPosition { occurrence: number; pulse: number; barStartLine: number }
const compare = (a: LyricPosition, b: LyricPosition) => a.lineIndex - b.lineIndex || a.anchorIndex - b.anchorIndex;

// Positions remain source anchors, independent of wrapping, zoom, and overlay visibility.
export function lyricBarLayout(lyrics: string | null | undefined, rhythm: SongRhythm | null | undefined, annotations: ChordAnnotation[]): LyricBar[] {
  const lines = lyricLines(lyrics ?? null);
  const markers = resolveChordAnnotations(rhythm?.markers ?? [], lyrics ?? null);
  const chords = resolveChordAnnotations(annotations, lyrics ?? null);
  const bars: LyricBar[] = [];
  for (const section of new Set(markers.map(marker => marker.section))) {
    const boundaries = markers.filter(marker => marker.section === section).map(marker => ({ lineIndex: marker.absoluteLineIndex, anchorIndex: marker.anchorIndex })).sort(compare);
    const changes = chords.filter(chord => chord.section === section).map(chord => ({ lineIndex: chord.absoluteLineIndex, anchorIndex: chord.anchorIndex })).sort(compare);
    const first = changes[0];
    if (first && compare(first, boundaries[0]) < 0) boundaries.unshift(first);
    const lastLine = (() => { let end = boundaries[boundaries.length - 1].lineIndex; while (end + 1 < lines.length && !/^\[.*\]$/.test(lines[end + 1].trim())) end++; return end; })();
    const end = { lineIndex: lastLine, anchorIndex: LEADING_CHORD_ANCHORS + lines[lastLine].length + TRAILING_CHORD_ANCHORS - 1 };
    boundaries.forEach((start, index) => {
      const finish = boundaries[index + 1] ?? end;
      if (compare(start, finish) >= 0) return;
      const inside = changes.filter(change => compare(change, start) > 0 && compare(change, finish) < 0);
      bars.push({ section: section ?? 'Default', start, end: finish, stops: [start, ...inside, finish] });
    });
  }
  return bars;
}

function offsets(lyrics: string | null | undefined) {
  let offset = 0;
  return lyricLines(lyrics ?? null).map(line => { const result = offset; offset += line.length + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS; return result; });
}

// Musical time controls cursor speed, never the width of lyric characters.
// Chords and bars retain their source anchors even when placed inside a word.
export function lyricColumnWidths(_lyrics: string | null | undefined, _bars: LyricBar[], _lineIndex: number, _start: number, count: number): number[] {
  return Array.from({ length: count }, () => 1);
}

export function musicalSectionKey(section: string) {
  return section.replace(/verse/ig, 'V').replace(/pre[- ]?chorus/ig, 'P').replace(/chorus|refrain/ig, 'C').replace(/bridge/ig, 'B').replace(/intro/ig, 'I').replace(/outro/ig, 'O').replace(/ending/ig, 'E').replace(/tag/ig, 'T').replace(/\s/g, '').toUpperCase();
}

export function lyricPlaybackBars(lyrics: string | null | undefined, sequence: string | null | undefined, bars: LyricBar[]): Array<LyricBar & { occurrence: number; patternBar: number }> {
  return worshipSequenceBlocks(lyrics, sequence).flatMap((block, occurrence) => bars.filter(bar => musicalSectionKey(bar.section) === musicalSectionKey(block.label) || bar.section === 'Default' && !/^\[.*\]$/m.test(lyrics ?? '')).map((bar, patternBar) => ({ ...bar, occurrence, patternBar })));
}

export function lyricCursorAt(lyrics: string | null | undefined, bars: Array<LyricBar & { occurrence: number }>, barPosition: number, numerator: number, denominator: number): LyricCursor | null {
  if (barPosition < 0) return null;
  const bar = bars[Math.floor(barPosition)];
  if (!bar) return null;
  const starts = offsets(lyrics), lines = lyricLines(lyrics ?? null);
  const fraction = barPosition % 1, interval = fraction * (bar.stops.length - 1);
  const index = Math.min(Math.floor(interval), bar.stops.length - 2);
  const from = bar.stops[index], to = bar.stops[index + 1];
  const scalar = starts[from.lineIndex] + from.anchorIndex + (starts[to.lineIndex] + to.anchorIndex - starts[from.lineIndex] - from.anchorIndex) * (interval - index);
  let lineIndex = from.lineIndex;
  while (lineIndex < to.lineIndex && scalar >= starts[lineIndex] + lines[lineIndex].length + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS) lineIndex++;
  const pulses = denominator === 8 && numerator % 3 === 0 ? numerator / 3 : numerator;
  return { occurrence: bar.occurrence, barStartLine: bar.start.lineIndex, lineIndex, anchorIndex: scalar - starts[lineIndex], pulse: fraction * pulses % 1 };
}

export function wrapTimedLine(line: string, maxWidth: number, widths: number[]): Array<{ start: number; end: number; line: string }> {
  const segments: Array<{ start: number; end: number; line: string }> = [];
  let start = 0;
  while (start < line.length) {
    let end = start, width = 0;
    while (end < line.length && (end === start || width + (widths[end] ?? 1) <= maxWidth)) { width += widths[end] ?? 1; end++; }
    if (end < line.length) { const space = line.lastIndexOf(' ', end - 1); if (space >= start) end = space + 1; }
    segments.push({ start, end, line: line.slice(start, end) }); start = end;
  }
  return segments.length ? segments : [{ start: 0, end: 0, line: '' }];
}

export function timedPracticeBars(lyrics: string | null | undefined, bars: LyricBar[], annotations: ChordAnnotation[], numerator: number) {
  const resolved = resolveChordAnnotations(annotations, lyrics ?? null).sort((a, b) => a.absoluteLineIndex - b.absoluteLineIndex || a.anchorIndex - b.anchorIndex);
  let previousChord = "";
  return bars.map(bar => ({ section: bar.section, ...('patternBar' in bar ? { patternBar: bar.patternBar as number } : {}), chords: bar.stops.slice(0, -1).map((position, index, stops) => {
    const candidates = resolved.filter(chord => musicalSectionKey(chord.section ?? 'Default') === musicalSectionKey(bar.section));
    const chord = candidates.filter(chord => chord.absoluteLineIndex === position.lineIndex && chord.anchorIndex === position.anchorIndex).slice(-1)[0];
    previousChord = chord?.chord || previousChord;
    return { beat: 1 + index * numerator / stops.length, chord: previousChord };
  }) }));
}
