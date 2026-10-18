import { expect, it } from 'vitest';
import { liveJumpStart, timelineWithEntry, lyricBarLayout, lyricColumnWidths, lyricCursorAt, lyricPlaybackBars, timedPracticeBars, wrapTimedLine } from './lyricTiming';
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

it('preserves normal character spacing and source anchors when wrapping', () => {
  const bars = lyricBarLayout(lyrics, rhythm, chords);
  const widths = lyricColumnWidths(lyrics, bars, 1, 0, 22);
  expect(widths).toEqual(Array(22).fill(1));
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
  const bars = lyricBarLayout(simple, { ...rhythm, numerator: 6, denominator: 8, markers: [{ id: 'one', section: null, lineIndex: 0, anchorIndex: 3 }] }, []);
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


it('does not spread letters or rewrap lyrics when chords and bars move inside words', () => {
  const text = '[V1]\nInto Your glorious day';
  const render = (chordAnchor: number, barAnchor: number) => {
    const annotations = [{ id: 'c', section: 'V1', lineIndex: 0, anchorIndex: chordAnchor, chord: 'C' }];
    const metadata = { ...rhythm, markers: [{ id: 'bar', section: 'V1', lineIndex: 0, anchorIndex: barAnchor }] };
    const bars = lyricBarLayout(text, metadata, annotations);
    const widths = lyricColumnWidths(text, bars, 1, 3, 22);
    return { widths, segments: wrapTimedLine('Into Your glorious day', 18, widths) };
  };
  const baseline = render(3, 3);
  for (const [chord, bar] of [[22, 3], [23, 3], [23, 21], [8, 7]]) {
    expect(render(chord, bar)).toEqual(baseline);
  }
});


it('carries the last played chord through empty bars and across repeated section boundaries', () => {
  const lyrics = '[V1]\nSing first\n[C]\nHold it\nChange now';
  const annotations = [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' },
    { id: 'c', section: 'C', lineIndex: 1, anchorIndex: 3, chord: 'G' },
  ];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'c1', section: 'C', lineIndex: 0, anchorIndex: 3 },
    { id: 'c2', section: 'C', lineIndex: 1, anchorIndex: 3 },
  ] };
  const layout = lyricBarLayout(lyrics, rhythm, annotations);
  const song = timedPracticeBars(lyrics, lyricPlaybackBars(lyrics, 'V1 C C', layout), annotations, 4);
  expect(song.map(bar => bar.chords[0].chord)).toEqual(['C', 'C', 'G', 'G', 'G']);
  const part = timedPracticeBars(lyrics, layout.filter(bar => bar.section === 'C'), annotations, 4);
  expect(part.map(bar => bar.chords[0].chord)).toEqual(['', 'G']); // no previous chord when practice starts here
});

it('treats annotations as changes and does not inherit a chord from before the playback start', () => {
  const lyrics = '[V1]\nEarlier chord\nEmpty opening\nFirst change\nKeep playing';
  const annotations = [{ id: 'earlier', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }, { id: 'change', section: 'V1', lineIndex: 2, anchorIndex: 3, chord: 'G' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [0, 1, 2, 3].map(lineIndex => ({ id: `bar-${lineIndex}`, section: 'V1', lineIndex, anchorIndex: 3 })) };
  const layout = lyricBarLayout(lyrics, rhythm, annotations);
  expect(timedPracticeBars(lyrics, layout.slice(1), annotations, 4).map(bar => bar.chords[0].chord)).toEqual(['', 'G', 'G']);
  expect(timedPracticeBars(lyrics, layout, annotations, 4).map(bar => bar.chords[0].chord)).toEqual(['C', 'C', 'G', 'G']);
  expect(timedPracticeBars(lyrics, layout.slice(1), annotations, 4, 'F').map(bar => bar.chords[0].chord)).toEqual(['F', 'G', 'G']);
});


it('enters a manual destination at its first annotated chord as a fresh downbeat', () => {
  const text = '[V1]\nEarlier\n[C]\nEmpty opening\nSing together';
  const annotations = [{ id: 'old', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }, { id: 'new', section: 'C', lineIndex: 1, anchorIndex: 8, chord: 'F' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [{ id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3 }, { id: 'c1', section: 'C', lineIndex: 0, anchorIndex: 3 }, { id: 'c2', section: 'C', lineIndex: 1, anchorIndex: 3 }] };
  const timeline = lyricPlaybackBars(text, 'V1 C C', lyricBarLayout(text, rhythm, annotations));
  const page = { occurrence: 2, lineStart: 3, lineEnd: 5 };
  const entry = liveJumpStart(text, timeline, annotations, page);
  expect(entry).toEqual({ index: 4, stop: 1 });
  const adjusted = timelineWithEntry(timeline, entry.index, entry.stop);
  expect(timedPracticeBars(text, adjusted.slice(entry.index), annotations, 4)[0].chords[0]).toEqual({ chord: 'F', beat: 1 });
  expect(lyricCursorAt(text, adjusted, entry.index, 4, 4)).toMatchObject({ occurrence: 2, lineIndex: 4, anchorIndex: 8, pulse: 0 });
  expect(timeline[entry.index].start.anchorIndex).toBe(3); // saved bars are untouched
  expect(liveJumpStart(text, timeline, [], page)).toEqual({ index: 3, stop: 0 });
});

import { lyricBarHighlightFill } from './lyricTiming';
it('fills only the current bar across words, wrapped lines and partial characters', () => {
  const start = { lineIndex: 1, anchorIndex: 6 }, cursor = { lineIndex: 2, anchorIndex: 8.5 };
  expect(lyricBarHighlightFill(start, cursor, 1, 5)).toBe(0);
  expect(lyricBarHighlightFill(start, cursor, 1, 6)).toBe(1);
  expect(lyricBarHighlightFill(start, cursor, 2, 8)).toBe(0.5);
  expect(lyricBarHighlightFill(start, cursor, 2, 9)).toBe(0);
  expect(lyricBarHighlightFill({ lineIndex: 2, anchorIndex: 8 }, cursor, 1, 6)).toBe(0);
  expect(lyricBarHighlightFill(start, null, 1, 6)).toBe(0);
});

import { lyricHighlightTrail } from './lyricTiming';
it('fades continuously behind the leading edge before the bar ends', () => {
  expect(lyricHighlightTrail(0.5)).toBe(1);
  expect(lyricHighlightTrail(6.5)).toBeCloseTo(1 - 5.5 / 12);
  expect(lyricHighlightTrail(17.5)).toBe(0);
});

import { lyricHighlightPulse } from './lyricTiming';
it('gently swells on each beat without fully extinguishing the trail', () => {
  expect(lyricHighlightPulse(0, 4)).toBe(1);
  expect(lyricHighlightPulse(0.25, 4)).toBe(1);
  expect(lyricHighlightPulse(0.2, 4)).toBeGreaterThan(0.72);
  expect(lyricHighlightPulse(0.2, 4)).toBeLessThan(0.8);
  expect(lyricHighlightPulse(null, 4)).toBe(1);
});

it('keeps the previous-bar trail outside the new bar accent', () => {
  const start = { lineIndex: 1, anchorIndex: 8 }, cursor = { lineIndex: 1, anchorIndex: 10.5 };
  expect(lyricBarHighlightFill(start, cursor, 1, 7)).toBe(0);
  expect(lyricBarHighlightFill(start, cursor, 1, 8)).toBe(1);
  expect(lyricBarHighlightFill(start, cursor, 0, 12)).toBe(0);
});

it('plays an offbeat chord independently of its lyric anchor and aligns the cursor to that count', () => {
  const timed = chords.map(chord => chord.id === 'g' ? { ...chord, beat: 3.5 } : chord);
  const bars = lyricBarLayout(lyrics, rhythm, timed);
  expect(timedPracticeBars(lyrics, bars, timed, 4)[0].chords).toEqual([{ beat: 1, chord: 'C' }, { beat: 3.5, chord: 'G' }]);
  const timeline = lyricPlaybackBars(lyrics, 'V1', bars);
  expect(lyricCursorAt(lyrics, timeline, 0.625, 4, 4)?.anchorIndex).toBe(10);
  const moved = timed.map(chord => chord.id === 'g' ? { ...chord, anchorIndex: 14 } : chord);
  expect(timedPracticeBars(lyrics, lyricBarLayout(lyrics, rhythm, moved), moved, 4)[0].chords[1].beat).toBe(3.5);
});

it('starts a live entry on count one while preserving relative timing of remaining changes', () => {
  const timed = chords.map(chord => chord.id === 'g' ? { ...chord, beat: 4 } : chord);
  const timeline = lyricPlaybackBars(lyrics, 'V1', lyricBarLayout(lyrics, rhythm, timed));
  const entry = timelineWithEntry(timeline, 0, 1);
  expect(timedPracticeBars(lyrics, entry, timed, 4)[0].chords).toEqual([{ beat: 1, chord: 'G' }]);
  expect(lyricCursorAt(lyrics, entry, 0, 4, 4)?.anchorIndex).toBe(10);
});

it('resolves continuing meter changes, temporary exceptions, and resets in source order', () => {
  const text = '[V1]\none two three four\n[C]\nfive six';
  const changes: SongRhythm = { numerator: 4, denominator: 4, notes: '', patterns: [], markers: [
    { id: 'a', section: 'V1', lineIndex: 0, anchorIndex: 3, rhythm: { numerator: 3, denominator: 4, scope: 'continue' } },
    { id: 'b', section: 'V1', lineIndex: 0, anchorIndex: 7, rhythm: { numerator: 2, denominator: 4, scope: 'bar' } },
    { id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 11 },
    { id: 'd', section: 'C', lineIndex: 0, anchorIndex: 3 },
    { id: 'e', section: 'C', lineIndex: 0, anchorIndex: 8, rhythm: { numerator: 4, denominator: 4, scope: 'continue' } },
  ] };
  const bars = lyricBarLayout(text, changes, []);
  expect(bars.map(bar => bar.rhythm?.numerator)).toEqual([3, 2, 3, 3, 4]);
  expect(lyricPlaybackBars(text, 'V1 C V1', bars).map(bar => bar.rhythm?.numerator)).toEqual([3, 2, 3, 3, 4, 3, 2, 3]);
  expect(lyricCursorAt(text, lyricPlaybackBars(text, 'V1', bars), 1.5, 4, 4)?.pulse).toBe(0);
});
