import { LEADING_CHORD_ANCHORS, TRAILING_CHORD_ANCHORS, lyricLines, resolveChordAnnotations, type ChordAnnotation } from './chordSheet';
import { chordBeats } from './barMarkers';
import { effectiveBarRhythms, type BarRhythmChange, type SongRhythm } from './songRhythm';
import { worshipSequenceBlocks } from './worshipText';

export interface LyricPosition { lineIndex: number; anchorIndex: number }
export interface LyricBar { patternBar?: number; rhythm?: BarRhythmChange; beats?: number[]; beatEnd?: number; section: string; start: LyricPosition; end: LyricPosition; stops: LyricPosition[] }
export interface LyricCursor extends LyricPosition { occurrence: number; pulse: number; barStartLine: number }
const compare = (a: LyricPosition, b: LyricPosition) => a.lineIndex - b.lineIndex || a.anchorIndex - b.anchorIndex;

// Positions remain source anchors, independent of wrapping, zoom, and overlay visibility.
export function lyricBarLayout(lyrics: string | null | undefined, rhythm: SongRhythm | null | undefined, annotations: ChordAnnotation[]): LyricBar[] {
  const lines = lyricLines(lyrics ?? null);
  const markers = resolveChordAnnotations(rhythm?.markers ?? [], lyrics ?? null);
  const chords = resolveChordAnnotations(annotations, lyrics ?? null);
  const bars: LyricBar[] = [];
  const sourceMarkers = [...markers].sort((a, b) => a.absoluteLineIndex - b.absoluteLineIndex || a.anchorIndex - b.anchorIndex);
  const settings = effectiveBarRhythms(rhythm ?? { numerator: 4, denominator: 4, patterns: [], notes: "" }, sourceMarkers);

  for (const section of new Set([...markers].sort((a, b) => a.absoluteLineIndex - b.absoluteLineIndex || a.anchorIndex - b.anchorIndex).map(marker => marker.section))) {
    const boundaries = markers.filter(marker => marker.section === section).map(marker => ({ lineIndex: marker.absoluteLineIndex, anchorIndex: marker.anchorIndex })).sort(compare);
    const changes = chords.filter(chord => chord.section === section).map(chord => ({ lineIndex: chord.absoluteLineIndex, anchorIndex: chord.anchorIndex, beat: chord.beat })).sort(compare);
    const first = changes[0];
    if (first && compare(first, boundaries[0]) < 0) boundaries.unshift(first);
    const lastLine = (() => { let end = boundaries[boundaries.length - 1].lineIndex; while (end + 1 < lines.length && !/^\[.*\]$/.test(lines[end + 1].trim())) end++; return end; })();
    const end = { lineIndex: lastLine, anchorIndex: LEADING_CHORD_ANCHORS + lines[lastLine].length + TRAILING_CHORD_ANCHORS - 1 };
    boundaries.forEach((start, index) => {
      const finish = boundaries[index + 1] ?? end;
      if (compare(start, finish) >= 0) return;
      const inside = changes.filter(change => compare(change, start) > 0 && compare(change, finish) < 0);
      const firstChord = changes.find(change => compare(change, start) === 0);
      const markerIndex = sourceMarkers.findIndex(marker => marker.absoluteLineIndex === start.lineIndex && marker.anchorIndex === start.anchorIndex);
      // An implicit opening bar inherits the last continuing source change.
      const prior = sourceMarkers.map((marker, i) => ({ marker, i })).filter(({ marker }) => compare({ lineIndex: marker.absoluteLineIndex, anchorIndex: marker.anchorIndex }, start) < 0 && marker.rhythm?.scope === "continue").pop();
      const effective = markerIndex >= 0 ? settings[markerIndex] : prior ? settings[prior.i] : { numerator: rhythm?.numerator ?? 4, denominator: rhythm?.denominator ?? 4, scope: "continue" as const };
      const activeChangeIndex = markerIndex >= 0 && sourceMarkers[markerIndex].rhythm ? markerIndex : prior?.i;
      const patternBar = activeChangeIndex !== undefined ? Math.max(0, markerIndex - activeChangeIndex) : undefined;
      const beats = chordBeats([firstChord ?? {}, ...inside], effective.numerator);
      bars.push({ section: section ?? 'Default', start, end: finish, stops: [start, ...inside, finish], beats, beatEnd: effective.numerator + 1, rhythm: effective, ...(patternBar !== undefined ? { patternBar } : {}) });
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
  return worshipSequenceBlocks(lyrics, sequence).flatMap((block, occurrence) => bars.filter(bar => musicalSectionKey(bar.section) === musicalSectionKey(block.label) || bar.section === 'Default' && !/^\[.*\]$/m.test(lyrics ?? '')).map((bar, patternBar) => ({ ...bar, occurrence, patternBar: bar.patternBar ?? patternBar })));
}

export function lyricCursorAt(lyrics: string | null | undefined, bars: Array<LyricBar & { occurrence: number }>, barPosition: number, numerator: number, denominator: number): LyricCursor | null {
  if (barPosition < 0) return null;
  const bar = bars[Math.floor(barPosition)];
  if (!bar) return null;
  numerator = bar.rhythm?.numerator ?? numerator;
  denominator = bar.rhythm?.denominator ?? denominator;
  const starts = offsets(lyrics), lines = lyricLines(lyrics ?? null);
  const fraction = barPosition % 1;
  const counts = [...(bar.beats ?? bar.stops.slice(0, -1).map((_, i) => 1 + i * numerator / (bar.stops.length - 1))), numerator + 1];
  const beat = 1 + fraction * numerator;
  const slot = Math.max(0, counts.findIndex((count, i) => i > 0 && count > beat) - 1);
  const interval = slot + (beat - counts[slot]) / (counts[slot + 1] - counts[slot]);
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

export function timedPracticeBars(lyrics: string | null | undefined, bars: LyricBar[], annotations: ChordAnnotation[], numerator: number, initialChord = "") {
  const resolved = resolveChordAnnotations(annotations, lyrics ?? null).sort((a, b) => a.absoluteLineIndex - b.absoluteLineIndex || a.anchorIndex - b.anchorIndex);
  let previousChord = initialChord;
  return bars.map(bar => ({ section: bar.section, ...(bar.rhythm ? { numerator: bar.rhythm.numerator, denominator: bar.rhythm.denominator, pattern: bar.rhythm.pattern } : {}), ...(resolved.some(chord => chord.beat !== undefined && musicalSectionKey(chord.section ?? 'Default') === musicalSectionKey(bar.section) && bar.stops.slice(0, -1).some(stop => chord.absoluteLineIndex === stop.lineIndex && chord.anchorIndex === stop.anchorIndex)) ? { exactTiming: true } : {}), ...('patternBar' in bar ? { patternBar: bar.patternBar as number } : {}), chords: bar.stops.slice(0, -1).map((position, index, stops) => {
    const candidates = resolved.filter(chord => musicalSectionKey(chord.section ?? 'Default') === musicalSectionKey(bar.section));
    const chord = candidates.filter(chord => chord.absoluteLineIndex === position.lineIndex && chord.anchorIndex === position.anchorIndex).slice(-1)[0];
    previousChord = chord?.chord || previousChord;
    return { beat: bar.beats?.[index] ?? 1 + index * (bar.rhythm?.numerator ?? numerator) / stops.length, chord: previousChord };
  }) }));
}

// A live segue enters at the first annotated chord on the selected page.
export function liveJumpStart(lyrics: string | null | undefined, timeline: Array<LyricBar & { occurrence: number }>, annotations: ChordAnnotation[], page?: { occurrence: number; lineStart: number; lineEnd: number }) {
  const fallback = page ? timeline.findIndex(bar => bar.occurrence === page.occurrence && bar.start.lineIndex >= page.lineStart && bar.start.lineIndex < page.lineEnd) : 0;
  const changes = resolveChordAnnotations(annotations, lyrics ?? null).filter(chord => chord.chord && (!page || chord.absoluteLineIndex >= page.lineStart && chord.absoluteLineIndex < page.lineEnd)).sort((a, b) => a.absoluteLineIndex - b.absoluteLineIndex || a.anchorIndex - b.anchorIndex);
  for (const chord of changes) {
    const position = { lineIndex: chord.absoluteLineIndex, anchorIndex: chord.anchorIndex };
    const index = timeline.findIndex(bar => (!page || bar.occurrence === page.occurrence) && musicalSectionKey(bar.section) === musicalSectionKey(chord.section ?? 'Default') && compare(bar.start, position) <= 0 && compare(position, bar.end) < 0);
    if (index >= 0) return { index, stop: Math.max(0, timeline[index].stops.findIndex(stop => compare(stop, position) === 0)) };
  }
  return { index: fallback, stop: 0 };
}

export function timelineWithEntry<T extends LyricBar>(timeline: T[], index: number, stop: number): T[] {
  if (!stop || !timeline[index] || stop >= timeline[index].stops.length - 1) return timeline;
  return timeline.map((bar, current) => {
    if (current !== index) return bar;
    const end = bar.beatEnd;
    const start = bar.beats?.[stop];
    const beats = end !== undefined && start !== undefined ? bar.beats!.slice(stop).map(beat => 1 + (beat - start) * (end - 1) / (end - start)) : undefined;
    return { ...bar, start: bar.stops[stop], stops: bar.stops.slice(stop), ...(beats ? { beats } : {}) };
  });
}

// Fill only the current bar, even when it crosses lines or begins inside a word.
export function lyricBarHighlightFill(start: LyricPosition | null, cursor: LyricPosition | null, lineIndex: number, anchor: number): number {
  if (!start || !cursor || compare({ lineIndex, anchorIndex: anchor + 1 }, start) <= 0 || compare({ lineIndex, anchorIndex: anchor }, cursor) >= 0) return 0;
  const from = lineIndex === start.lineIndex ? Math.max(0, start.anchorIndex - anchor) : 0;
  const to = lineIndex === cursor.lineIndex ? Math.min(1, cursor.anchorIndex - anchor) : 1;
  return Math.max(0, to - from);
}

// A short, continuous trail follows the cursor across source lines and wrapping.
export function lyricHighlightDistance(lyrics: string, cursor: LyricPosition, lineIndex: number, anchor: number): number {
  const starts = offsets(lyrics);
  return starts[cursor.lineIndex] + cursor.anchorIndex - starts[lineIndex] - anchor;
}
export function lyricHighlightTrail(distance: number): number {
  return Math.max(0, Math.min(1, 1 - Math.max(0, distance - 1) / 12));
}

// A gentle swell per visual beat; the timing edge itself never moves or lags.
export function lyricHighlightPulse(position: number | null, beats: number): number {
  if (position === null || !Number.isFinite(position)) return 1;
  const phase = ((position * beats % 1) + 1) % 1;
  return 0.72 + 0.28 * Math.exp(-phase * 5);
}
