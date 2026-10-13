import { expect, it } from 'vitest';
import { lyricBarLayout, lyricColumnWidths, lyricCursorAt, lyricPlaybackBars, wrapTimedLine } from './lyricTiming';
import type { ChordAnnotation } from './chordSheet';
import type { SongRhythm } from './songRhythm';
const lyrics = '[V1]\nSing a song now\nKeep the rhythm\n[C]\nPraise again';
const chords: ChordAnnotation[] = [
  { id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' },
  { id: 'g', section: 'V1', lineIndex: 0, anchorIndex: 10, chord: 'G' },
  { id: 'f', section: 'C', lineIndex: 0, anchorIndex: 3, chord: 'F' },
];
const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
  { id: 'v', section: 'V1', lineIndex: 1, anchorIndex: 3 },
  { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3 },
] };

it('creates source spans, including the implicit first bar, without crossing section headings', () => {
  const bars = lyricBarLayout(lyrics, rhythm, chords);
  expect(bars).toHaveLength(3);
  expect(bars[0].start).toEqual({ lineIndex: 1, anchorIndex: 3 });
  expect(bars[0].end).toEqual({ lineIndex: 2, anchorIndex: 3 });
  expect(bars[1].end.lineIndex).toBe(2);
  expect(bars[2].start.lineIndex).toBe(4);
});

it('spaces chord changes equally in time and keeps the same source anchors when wrapping', () => {
  const bars = lyricBarLayout(lyrics, rhythm, chords);
  const widths = lyricColumnWidths(lyrics, bars, 1, 0, 22);
  // The shorter C-to-G span is expanded to match G-to-the-next-bar (including the line break).
  expect(widths[3]).toBeGreaterThan(1);
  expect(widths[10]).toBe(1);
  const segments = wrapTimedLine('Sing a song now', 10, widths.slice(3));
  expect(segments.map(segment => segment.line).join('')).toBe('Sing a song now');
  expect(segments.length).toBeGreaterThan(1);
  expect(segments[1].start).toBe(segments[0].end);
});

it('follows repeated occurrences, crosses lines inside a bar, and changes page anchors only at the next bar', () => {
  const timeline = lyricPlaybackBars(lyrics, 'V1 C V1', lyricBarLayout(lyrics, rhythm, chords));
  expect(timeline.map(bar => bar.occurrence)).toEqual([0, 0, 1, 2, 2]);
  expect(lyricCursorAt(lyrics, timeline, -0.1, 4, 4)).toBeNull();
  expect(lyricCursorAt(lyrics, timeline, 0.5, 4, 4)).toMatchObject({ lineIndex: 1, anchorIndex: 10, occurrence: 0, barStartLine: 1 });
  expect(lyricCursorAt(lyrics, timeline, 1, 4, 4)).toMatchObject({ lineIndex: 2, anchorIndex: 3, barStartLine: 2 });
  expect(lyricCursorAt(lyrics, timeline, 3, 4, 4)?.occurrence).toBe(2);
  expect(lyricCursorAt(lyrics, timeline, 5, 4, 4)).toBeNull();
});

it('bounces on the compound-meter pulse and supports unsectioned lyrics', () => {
  const simple = 'Sing now';
  const bars = lyricBarLayout(simple, { ...rhythm, markers: [{ id: 'one', section: null, lineIndex: 0, anchorIndex: 3 }] }, []);
  const timeline = lyricPlaybackBars(simple, null, bars);
  expect(timeline).toHaveLength(1);
  expect(lyricCursorAt(simple, timeline, 0.25, 6, 8)?.pulse).toBe(0.5);
  expect(lyricCursorAt(simple, timeline, 0.5, 6, 8)?.pulse).toBe(0);
});

it('uses the shared marker timing in editor playback and MIDI instead of an approximate manual chart', async () => {
  const { buildPracticePerformance, practiceMidi } = await import('./musicPractice');
  const performance = buildPracticePerformance({ ...rhythm, arrangements: [{ section: 'Default', chart: 'D *12' }] }, { mode: 'song', lyrics, sequence: 'V1 C V1', annotations: chords, metronome: true });
  expect(performance.bars).toHaveLength(5);
  expect(performance.bars[0].chords).toEqual([{ beat: 1, chord: 'C' }, { beat: 3, chord: 'G' }]);
  expect(performance.bars[2].chords[0].chord).toBe('F');
  expect(practiceMidi(performance).slice(0, 4)).toEqual(new Uint8Array([77, 84, 104, 100]));
});
