import { expect, it } from 'vitest';
import { validateBarMeterChange, liveJumpStart, timelineWithEntry, lyricBarLayout, lyricColumnWidths, lyricCursorAt, lyricPlaybackBars, timedPracticeBars, wrapTimedLine } from './lyricTiming';
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

it('joins an unmarked chorus opening to the preceding bar and plays its D on beat 3', async () => {
  const text = '[V1]\nReign in me again\n[C]\nLord reign in me';
  const annotations: ChordAnnotation[] = [
    { id: 'v-c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' },
    { id: 'v-g', section: 'V1', lineIndex: 0, anchorIndex: 12, chord: 'G' },
    { id: 'c-d', section: 'C', lineIndex: 0, anchorIndex: 8, chord: 'D', beat: 3 },
    { id: 'c-c', section: 'C', lineIndex: 0, anchorIndex: 14, chord: 'C' },
  ];
  const marked: SongRhythm = { numerator: 4, denominator: 4, bpm: 100, patterns: [], notes: '', markers: [
    { id: 'v-c', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'v-g', section: 'V1', lineIndex: 0, anchorIndex: 12 },
    { id: 'c-c', section: 'C', lineIndex: 0, anchorIndex: 14 },
  ] };
  const layout = lyricBarLayout(text, marked, annotations);
  const timeline = lyricPlaybackBars(text, 'V1 C V1 C', layout);
  expect(timeline).toHaveLength(6);
  const practice = timedPracticeBars(text, timeline, annotations, 4);
  expect(practice.map(bar => bar.chords)).toEqual([
    [{ beat: 1, chord: 'C' }], [{ beat: 1, chord: 'G' }, { beat: 3, chord: 'D' }], [{ beat: 1, chord: 'C' }],
    [{ beat: 1, chord: 'C' }], [{ beat: 1, chord: 'G' }, { beat: 3, chord: 'D' }], [{ beat: 1, chord: 'C' }],
  ]);
  expect(timeline[2].patternBar).toBe(0);
  expect(lyricCursorAt(text, timeline, 1.5, 4, 4)).toMatchObject({ occurrence: 1, lineIndex: 3, anchorIndex: 8, pulse: 0 });
  expect(lyricCursorAt(text, timeline, 4.5, 4, 4)).toMatchObject({ occurrence: 3, lineIndex: 3, anchorIndex: 8 });
  const { buildPracticePerformance } = await import('./musicPractice');
  const performance = buildPracticePerformance(marked, { mode: 'song', lyrics: text, sequence: 'V1 C V1 C', annotations, metronome: true });
  expect(performance.bars).toHaveLength(6);
  expect(performance.bars[1].chords).toEqual(practice[1].chords);
  expect(performance.totalTicks).toBe(6 * performance.barTicks);
  const explicit = { ...marked, markers: [...marked.markers!, { id: 'c-d', section: 'C', lineIndex: 0, anchorIndex: 8 }] };
  const separate = lyricPlaybackBars(text, 'V1 C', lyricBarLayout(text, explicit, annotations));
  expect(separate).toHaveLength(4);
  expect(timedPracticeBars(text, separate, annotations, 4)[2].chords).toEqual([{ beat: 1, chord: 'D' }]);
});

it('preserves assigned pickup counts in chosen playback order without mutating source bars, and permits standalone entries', () => {
  const text = '[V1]\nVerse ending\n[V2]\nAnother ending\n[C]\nLord reign in me';
  const annotations: ChordAnnotation[] = [
    { id: 'v1', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'G' },
    { id: 'v2', section: 'V2', lineIndex: 0, anchorIndex: 3, chord: 'Em' },
    { id: 'd', section: 'C', lineIndex: 0, anchorIndex: 8, chord: 'D', beat: 3 },
    { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 14, chord: 'C' },
  ];
  const marked: SongRhythm = { ...rhythm, markers: annotations.filter(chord => chord.id !== 'd').map(({ chord: _chord, ...position }) => position) };
  const layout = lyricBarLayout(text, marked, annotations);
  const original = JSON.stringify(layout);
  const reordered = lyricPlaybackBars(text, 'V2 C C V1 C', layout);
  expect(reordered).toHaveLength(5);
  expect(timedPracticeBars(text, reordered, annotations, 4).map(bar => bar.chords.map(chord => chord.chord))).toEqual([['Em', 'D'], ['C', 'D'], ['C'], ['G', 'D'], ['C']]);
  expect(lyricCursorAt(text, reordered, 1.5, 4, 4)).toMatchObject({ occurrence: 2, lineIndex: 5, anchorIndex: 8 });
  expect(lyricCursorAt(text, reordered, 3.5, 4, 4)).toMatchObject({ occurrence: 4, lineIndex: 5, anchorIndex: 8 });
  expect(JSON.stringify(layout)).toBe(original);
  const page = { occurrence: 4, lineStart: 5, lineEnd: 6 };
  const entry = liveJumpStart(text, reordered, annotations, page);
  expect(entry).toEqual({ index: 3, stop: 0 });
  const entered = timelineWithEntry(reordered, entry.index, entry.stop);
  expect(lyricCursorAt(text, entered, 3, 4, 4)).toMatchObject({ occurrence: 3, lineIndex: 1, anchorIndex: 3 });
  expect(timedPracticeBars(text, entered.slice(3), annotations, 4)[0].chords).toEqual([{ beat: 1, chord: 'G' }, { beat: 3, chord: 'D' }]);
  const standalone = lyricPlaybackBars(text, 'C', layout);
  expect(timedPracticeBars(text, standalone, annotations, 4)[0].chords).toEqual([{ beat: 1, chord: 'D' }]);
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

it.each([
  [4, 1.5], [12, 2], [13, 3], [23, 3], [33, 3], [34, 4], [41, 4.5],
])('defaults a single mid-bar change to halfway unless heavily skewed (anchor %i, beat %s)', (anchor, beat) => {
  const text = '[V1]\n' + 'Sing '.repeat(10);
  const annotations: ChordAnnotation[] = [
    { id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' },
    { id: 'g', section: 'V1', lineIndex: 0, anchorIndex: anchor, chord: 'G' },
  ];
  const marked: SongRhythm = { ...rhythm, markers: [
    { id: 'start', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'end', section: 'V1', lineIndex: 0, anchorIndex: 43 },
  ] };
  const timeline = lyricPlaybackBars(text, 'V1', lyricBarLayout(text, marked, annotations));
  expect(timedPracticeBars(text, timeline, annotations, 4)[0].chords).toEqual([{ chord: 'C', beat: 1 }, { chord: 'G', beat }]);
  expect(lyricCursorAt(text, timeline, (beat - 1) / 4, 4, 4)?.anchorIndex).toBe(anchor);
  const explicit = annotations.map(chord => chord.id === 'g' ? { ...chord, beat: 3.5 } : chord);
  expect(lyricBarLayout(text, marked, explicit)[0].beats).toEqual([1, 3.5]);
});

it('uses the same skewed default for the lyric cursor and a soft off-grid audio attack', async () => {
  const { buildPracticePerformance, MIDI_PPQ } = await import('./musicPractice');
  const text = '[V1]\n' + 'Sing '.repeat(10);
  const annotations: ChordAnnotation[] = [
    { id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' },
    { id: 'g', section: 'V1', lineIndex: 0, anchorIndex: 4, chord: 'G' },
  ];
  const marked: SongRhythm = { ...rhythm, patterns: [{ section: 'Default', subdivision: 1, strokes: ['D', '-', '-', '-'] }], markers: [
    { id: 'start', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'end', section: 'V1', lineIndex: 0, anchorIndex: 43 },
  ] };
  const music = buildPracticePerformance(marked, { mode: 'song', lyrics: text, sequence: 'V1', annotations });
  expect(music.bars[0].chords[1].beat).toBe(1.5);
  const added = music.notes.filter(note => note.channel === 0 && note.tick >= MIDI_PPQ / 2 && note.tick < MIDI_PPQ / 2 + 40);
  expect(added.length).toBeGreaterThan(0);
  expect(added.every(note => note.soft && note.velocity === 50)).toBe(true);
});

it('measures a run-on chord’s relative position across playback lines without counting section headings', () => {
  const text = '[V1]\nLast\n[C]\n' + 'Sing '.repeat(10);
  const annotations: ChordAnnotation[] = [
    { id: 'g', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'G' },
    { id: 'd', section: 'C', lineIndex: 0, anchorIndex: 0, chord: 'D' },
    { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 43, chord: 'C' },
  ];
  const marked: SongRhythm = { ...rhythm, markers: [
    { id: 'g', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 43 },
  ] };
  const timeline = lyricPlaybackBars(text, 'V1 C', lyricBarLayout(text, marked, annotations));
  expect(timedPracticeBars(text, timeline, annotations, 4)[0].chords).toEqual([{ chord: 'G', beat: 1 }, { chord: 'D', beat: 1.5 }]);
  expect(lyricCursorAt(text, timeline, 0.125, 4, 4)).toMatchObject({ occurrence: 1, lineIndex: 3, anchorIndex: 0 });
});

it('follows repeated occurrences, crosses lines inside a bar, and changes page anchors only at the next bar', () => {
  const timeline = lyricPlaybackBars(lyrics, 'V1 C V1', lyricBarLayout(lyrics, rhythm, chords));
  expect(timeline.map(bar => bar.occurrence)).toEqual([0, 0, 1, 2]);
  expect(lyricCursorAt(lyrics, timeline, -0.1, 4, 4)).toBeNull();
  expect(lyricCursorAt(lyrics, timeline, 0.5, 4, 4)).toMatchObject({ lineIndex: 1, anchorIndex: 10, occurrence: 0, barStartLine: 1 });
  expect(lyricCursorAt(lyrics, timeline, 1, 4, 4)).toMatchObject({ lineIndex: 2, anchorIndex: 3, barStartLine: 2 });
  expect(lyricCursorAt(lyrics, timeline, 3, 4, 4)?.occurrence).toBe(2);
  expect(lyricCursorAt(lyrics, timeline, 4, 4, 4)).toBeNull();
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
  expect(performance.bars).toHaveLength(4);
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


it('allows a one-bar meter correction despite invalid chord timing in another verse', () => {
  const text = '[V1]\nSing a song\n[V2]\nSing a song';
  const annotations: ChordAnnotation[] = ['V1', 'V2'].flatMap(section => [
    { id: `${section}-c`, section, lineIndex: 0, anchorIndex: 3, chord: 'C' },
    { id: `${section}-g`, section, lineIndex: 0, anchorIndex: 10, chord: 'G', beat: 4 },
  ]);
  const before: SongRhythm = { numerator: 3, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'v1', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'v2', section: 'V2', lineIndex: 0, anchorIndex: 3 },
  ] };
  const after: SongRhythm = { ...before, markers: before.markers!.map(marker => marker.id === 'v2' ? { ...marker, rhythm: { numerator: 4, denominator: 4, scope: 'bar' as const } } : marker) };
  expect(() => validateBarMeterChange(text, before, after, annotations)).not.toThrow();
  expect(() => validateBarMeterChange(text, after, before, annotations)).toThrow();
});


it('moves forward across shortened lines with stale bar and chord anchors', () => {
  const text = '[V2]\nSearch me, try me\nConsume all my darkness\nShine on me, shine on me';
  const markers = [
    { id: 'start', section: 'V2', lineIndex: 0, anchorIndex: 3 },
    { id: 'stale', section: 'V2', lineIndex: 0, anchorIndex: 36 },
    { id: 'next', section: 'V2', lineIndex: 1, anchorIndex: 3 },
  ];
  const annotations = markers.map(marker => ({ ...marker, chord: 'Em' }));
  const timeline = lyricPlaybackBars(text, 'V2', lyricBarLayout(text, { ...rhythm, markers }, annotations));
  expect(timeline[1].start.anchorIndex).toBe(36);
  let previous = { lineIndex: 1, anchorIndex: 0 };
  for (let step = 0; step <= 200; step++) {
    const cursor = lyricCursorAt(text, timeline, step / 100, 4, 4)!;
    expect(cursor.anchorIndex).toBeGreaterThanOrEqual(0);
    expect(cursor.anchorIndex).toBeLessThan(text.split('\n')[cursor.lineIndex].length + 8);
    expect(cursor.lineIndex > previous.lineIndex || cursor.lineIndex === previous.lineIndex && cursor.anchorIndex >= previous.anchorIndex).toBe(true);
    previous = cursor;
  }
  expect(lyricCursorAt(text, timeline, 2, 4, 4)).toMatchObject({ lineIndex: 2, anchorIndex: 3 });
});

it('repeats the full guided lyric timeline for multiplied sequence sections', () => {
  const repeated = lyricPlaybackBars(lyrics, 'V1 Cx3 V1', lyricBarLayout(lyrics, rhythm, chords));
  const explicit = lyricPlaybackBars(lyrics, 'V1 C C C V1', lyricBarLayout(lyrics, rhythm, chords));
  expect(repeated).toEqual(explicit);
  expect(repeated.map(bar => bar.occurrence)).toEqual([0, 0, 1, 2, 3, 4]);
});
