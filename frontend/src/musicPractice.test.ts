import { describe, expect, it, vi } from "vitest";
import { buildPracticePerformance, PracticeSilentPlayer, chordMidiNotes, MIDI_PPQ, parseBarChart, practiceMidi, rhythmQuarterBpm, transposeBarCharts } from "./musicPractice";
import type { SongRhythm } from "./songRhythm";

const rhythm: SongRhythm = { numerator: 4, denominator: 4, notes: "", bpm: 120,
  patterns: [{ section: "Default", subdivision: 1, strokes: ["D", "-", "D", "-"] }],
  arrangements: [{ section: "Default", chart: "C@1 G@3 | Am *2" }],
};

describe("practice arrangements", () => {
  it("parses evenly divided chords, explicit fractional counts and repeated bars", () => {
    const bars = parseBarChart("C G | Am@1 F@2.5 *2", 4, "V1");
    expect(bars).toHaveLength(3);
    expect(bars[0].chords).toEqual([{ chord: "C", beat: 1 }, { chord: "G", beat: 3 }]);
    expect(bars[1].chords[1]).toEqual({ chord: "F", beat: 2.5 });
    expect(bars[2]).toEqual(bars[1]);
    expect(bars[0].section).toBe("V1");
  });

  it.each(["C@2", "C@1 G@5", "C@1 G@1", "C@1 G", "not-a-chord", "C *17"])("rejects an invalid chart: %s", (chart) => {
    expect(() => parseBarChart(chart, 4)).toThrow();
  });

  it("combines chord changes with strum timing and a separate count-in", () => {
    const music = buildPracticePerformance(rhythm, { mode: "song", countIn: true, metronome: false });
    expect(music.bars).toHaveLength(3);
    expect(music.countInTicks).toBe(4 * MIDI_PPQ);
    expect(music.totalTicks).toBe(16 * MIDI_PPQ);
    expect(music.notes.filter((note) => note.channel === 9)).toHaveLength(4);
    expect(music.notes.filter((note) => note.channel === 0 && note.tick >= 1920 && note.tick < 2000).map((note) => note.pitch)).toEqual(chordMidiNotes("C"));
    expect(music.notes.filter((note) => note.channel === 0 && note.tick >= 2880 && note.tick < 2960).map((note) => note.pitch)).toEqual(chordMidiNotes("G"));
  });

  it("follows repeated lyric parts and their section strums", () => {
    const music = buildPracticePerformance({ ...rhythm, patterns: [...rhythm.patterns, { section: "Chorus", subdivision: 1, strokes: ["U", "-", "-", "-"] }], arrangements: [
      { section: "V1", chart: "C" }, { section: "C", chart: "G *2" },
    ] }, { mode: "song", lyrics: "[V1]\nVerse words\n[C]\nChorus words", sequence: "V1 C V1 C" });
    expect(music.bars.map((bar) => bar.section)).toEqual(["V1", "C", "C", "V1", "C", "C"]);
    expect(music.notes.filter((note) => note.channel === 0 && note.tick >= music.barTicks && note.tick < music.barTicks + 50).map((note) => note.pitch)).toEqual(chordMidiNotes("G").reverse());
    expect(() => buildPracticePerformance({ ...rhythm, arrangements: [{ section: "V1", chart: "C" }] }, { mode: "song", lyrics: "[V1]\nVerse words\n[C]\nChorus words", sequence: "V1 C" })).toThrow("Add bars for C");
  });

  it("keeps the compound-meter pulse and written chord counts distinct", () => {
    const six: SongRhythm = { numerator: 6, denominator: 8, bpm: 60, notes: "", patterns: [{ section: "Default", subdivision: 1, strokes: ["D", "-", "-", "D", "-", "-"] }], arrangements: [{ section: "Default", chart: "C G" }] };
    expect(rhythmQuarterBpm(six)).toBe(90);
    const music = buildPracticePerformance(six, { mode: "song" });
    expect(music.barTicks).toBe(1440);
    expect(music.bars[0].chords[1].beat).toBe(4);
    expect(music.totalTicks / MIDI_PPQ * 60 / music.quarterBpm).toBe(2);
    expect(readMidi(practiceMidi(music)).events.find((event) => event.status === 0x58)?.data).toEqual([6, 3, 36, 8]);
  });

  it("transposes bar chords and slash bass notes without changing counts or repeats", () => {
    const shifted = transposeBarCharts({ ...rhythm, arrangements: [{ section: "V1", chart: "C/E@1 G@3 *2\nAm | F" }] }, 2)!;
    expect(shifted.arrangements?.[0].chart).toBe("D/F#@1 A@3 *2\nBm | G");
    expect(shifted.patterns).toEqual(rhythm.patterns);
    const music = buildPracticePerformance(rhythm, { mode: "song", transpose: 2 });
    expect(music.notes.filter((note) => note.tick < 50).map((note) => note.pitch)).toEqual(chordMidiNotes("D"));
  });

  it("voices minor, suspended, diminished, extended and slash chords distinctly", () => {
    expect(chordMidiNotes("Am")).toContain(60); // minor third, C
    expect(chordMidiNotes("A")).toContain(61); // major third, C#
    expect(chordMidiNotes("C7")).toContain(58);
    expect(chordMidiNotes("Cmaj7")).toContain(59);
    expect(chordMidiNotes("Cdim7")).toContain(57);
    expect(chordMidiNotes("Csus2")).toContain(50);
    expect(chordMidiNotes("C/E")[0]).toBe(40);
    expect(chordMidiNotes("Cm7b5")).toContain(54);
    expect(chordMidiNotes("Cadd9")).toContain(62);
  });

  it("requires an audible strum and a valid tempo", () => {
    expect(() => buildPracticePerformance({ ...rhythm, bpm: 0 }, { mode: "strum" })).toThrow("tempo");
    expect(() => buildPracticePerformance({ ...rhythm, patterns: [] }, { mode: "strum" })).toThrow("strumming pattern");
  });
});

function readMidi(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 22;
  let tick = 0;
  const events: Array<{ tick: number; status: number; data: number[] }> = [];
  const variable = () => { let value = 0; let byte: number; do { byte = bytes[offset++]; value = value * 128 + (byte & 127); } while (byte & 128); return value; };
  while (offset < bytes.length) {
    tick += variable();
    const status = bytes[offset++];
    if (status === 0xff) {
      const type = bytes[offset++]; const length = variable();
      events.push({ tick, status: type, data: Array.from(bytes.slice(offset, offset + length)) }); offset += length;
    } else {
      const length = (status & 0xf0) === 0xc0 ? 1 : 2;
      events.push({ tick, status, data: Array.from(bytes.slice(offset, offset + length)) }); offset += length;
    }
  }
  return { format: view.getUint16(8), tracks: view.getUint16(10), ppq: view.getUint16(12), length: view.getUint32(18), events };
}

it("exports a complete standard MIDI file with meter, tempo, guitar and matching note-offs", () => {
  const performance = buildPracticePerformance(rhythm, { mode: "song", countIn: true, metronome: true });
  const bytes = practiceMidi(performance);
  expect(Array.from(bytes.slice(0, 4))).toEqual([77, 84, 104, 100]);
  const midi = readMidi(bytes);
  expect(midi.format).toBe(0); expect(midi.tracks).toBe(1); expect(midi.ppq).toBe(480);
  expect(midi.length).toBe(bytes.length - 22);
  expect(midi.events.find((event) => event.status === 0x51)?.data).toEqual([7, 161, 32]); // 500,000 μs / quarter
  expect(midi.events.find((event) => event.status === 0x58)?.data).toEqual([4, 2, 24, 8]);
  expect(midi.events.find((event) => event.status === 0xc0)?.data).toEqual([25]);
  const starts = midi.events.filter((event) => (event.status & 0xf0) === 0x90);
  const ends = midi.events.filter((event) => (event.status & 0xf0) === 0x80);
  expect(starts).toHaveLength(performance.notes.length); expect(ends).toHaveLength(starts.length);
  expect(midi.events[midi.events.length - 1]).toEqual({ tick: performance.totalTicks, status: 0x2f, data: [] });
});

it('keeps opening bars silent and starts clicks one bar before the first chord', () => {
  const music = buildPracticePerformance({ ...rhythm, patterns: [] }, { mode: 'song', countIn: true, metronome: true, bars: [
    { section: 'Default', chords: [{ beat: 1, chord: '' }] },
    { section: 'Default', chords: [{ beat: 1, chord: '' }] },
    { section: 'Default', chords: [{ beat: 1, chord: 'G' }] },
  ] });
  expect(music.countInTicks).toBe(0);
  expect(Math.min(...music.notes.filter(note => note.channel === 9).map(note => note.tick))).toBe(music.barTicks);
  expect(Math.min(...music.notes.filter(note => note.channel === 0).map(note => note.tick))).toBe(2 * music.barTicks);
});

it('adds only the missing lead-in when the first chord change is inside the opening bar', () => {
  const music = buildPracticePerformance({ ...rhythm, patterns: [] }, { mode: 'song', countIn: true, metronome: true, bars: [
    { section: 'Default', chords: [{ beat: 1, chord: '' }, { beat: 3, chord: 'C' }] },
  ] });
  expect(music.countInTicks).toBe(music.barTicks / 2);
  const clicks = music.notes.filter(note => note.channel === 9);
  expect(clicks[0].tick).toBe(0);
  expect(new Set(clicks.map(note => note.tick)).size).toBe(clicks.length);
  expect(Math.min(...music.notes.filter(note => note.channel === 0).map(note => note.tick))).toBe(music.barTicks);
});

it('ends on the last sounded full chord with a four-second sustain and MIDI expression fade', () => {
  const bars = [{ section: 'Default', chords: [{ beat: 1, chord: 'C' }] }, { section: 'Default', chords: [{ beat: 1, chord: 'G' }] }];
  const music = buildPracticePerformance(rhythm, { mode: 'song', bars, finish: true, transpose: 2 });
  const ending = music.notes.filter(note => note.finishing);
  expect(ending.map(note => note.pitch)).toEqual(chordMidiNotes('A'));
  expect(ending[0].tick).toBe(2 * music.barTicks);
  expect(ending[0].duration / MIDI_PPQ * 60 / music.quarterBpm).toBeCloseTo(4);
  expect(music.totalTicks).toBeGreaterThan(ending[ending.length - 1].tick + ending[ending.length - 1].duration);
  const expression = readMidi(practiceMidi(music)).events.filter(event => event.status === 0xb0 && event.data[0] === 11);
  expect(expression[0].data[1]).toBe(127);
  expect(expression[expression.length - 1].data[1]).toBe(1);
  expect(music.notes.filter(note => note.channel === 9).every(note => note.tick < ending[0].tick)).toBe(true);
  expect(buildPracticePerformance(rhythm, { mode: 'song', bars, finish: false }).notes.some(note => note.finishing)).toBe(false);
  expect(buildPracticePerformance(rhythm, { mode: 'song', bars, finish: true, chords: false }).notes.some(note => note.finishing)).toBe(false);
});


it('plays X as muted guitar strings and keeps them distinct from metronome clicks', () => {
  const music = buildPracticePerformance({ ...rhythm, patterns: [{ section: 'Default', subdivision: 1, strokes: ['D', 'X', '-', '-'] }] }, { mode: 'song', metronome: true });
  const muted = music.notes.filter(note => note.channel === 1);
  expect(muted.length).toBeGreaterThan(1);
  expect(muted.every(note => note.duration <= 240)).toBe(true);
  expect(music.notes.filter(note => note.channel === 9).every(note => note.pitch === 76 || note.pitch === 77)).toBe(true);
  expect(readMidi(practiceMidi(music)).events.find(event => event.status === 0xc1)?.data).toEqual([28]);
});

it('lets strings ring through rests and damps them exactly at the next muted stroke', () => {
  const music = buildPracticePerformance({ ...rhythm, bpm: 120, patterns: [{ section: 'Default', subdivision: 1, strokes: ['D', '-', 'X', '-'] }] }, { mode: 'song', bars: [{ section: 'Default', chords: [{ beat: 1, chord: 'C' }] }] });
  const strings = music.notes.filter(note => note.channel === 0);
  expect(strings[0].duration).toBe(2 * MIDI_PPQ);
  expect(strings.every(note => note.tick + note.duration === 2 * MIDI_PPQ)).toBe(true);
  expect(music.notes.filter(note => note.channel === 1).every(note => note.duration <= 240)).toBe(true);
  const open = buildPracticePerformance({ ...rhythm, bpm: 120, patterns: [{ section: 'Default', subdivision: 1, strokes: ['D', '-', '-', '-'] }] }, { mode: 'song', bars: [{ section: 'Default', chords: [{ beat: 1, chord: 'C' }] }] });
  expect(open.notes.find(note => note.channel === 0)!.duration).toBe(4 * MIDI_PPQ);
});
it('ends the previous string voice on a repluck and damps the old chord on chord changes', () => {
  const music = buildPracticePerformance({ ...rhythm, patterns: [{ section: 'Default', subdivision: 1, strokes: ['D', 'D', '-', '-'] }] }, { mode: 'song', bars: [{ section: 'Default', chords: [{ beat: 1, chord: 'C' }, { beat: 2, chord: 'F' }] }] });
  expect(music.notes.filter(note => note.channel === 0 && note.tick < MIDI_PPQ).every(note => note.tick + note.duration === MIDI_PPQ)).toBe(true);
});

it('alternates a two-bar pattern at normal tempo and respects a later-page starting phase', () => {
  const two = { ...rhythm, patterns: [{ section: 'Default' as const, bars: 2 as const, subdivision: 1 as const, strokes: ['D', '-', '-', '-', '-', 'U', 'X', '-'] as ('D' | 'U' | 'X' | '-')[] }] };
  const chart = [{ section: 'Default', chords: [{ beat: 1, chord: 'C' }] }];
  const music = buildPracticePerformance(two, { mode: 'song', bars: [...chart, ...chart, ...chart] });
  const starts = music.notes.filter(note => note.channel === 0).map(note => note.tick);
  expect(starts).toContain(0);
  expect(starts).toContain(music.barTicks + MIDI_PPQ);
  expect(starts).toContain(2 * music.barTicks);
  expect(music.notes.find(note => note.channel === 1)!.tick).toBe(music.barTicks + 2 * MIDI_PPQ);
  const later = buildPracticePerformance(two, { mode: 'song', bars: [{ ...chart[0], patternBar: 1 }] });
  expect(later.notes.find(note => note.channel === 0)!.tick).toBe(MIDI_PPQ);
});


it("redirects silent guidance on the next bar without creating audio", async () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "performance"] });
  const player = new PracticeSilentPlayer();
  const progress = vi.fn(), committed = vi.fn(), ended = vi.fn();
  try {
    const music = buildPracticePerformance(rhythm, { mode: "song", countIn: false, metronome: false, chords: false });
    await player.play(music, false, () => {}, ended);
    vi.advanceTimersByTime(1000);
    await player.queuePerformance(music, progress, committed);
    vi.advanceTimersByTime(1050);
    expect(committed).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(committed).toHaveBeenCalledOnce();
    expect(progress).toHaveBeenCalledWith(expect.any(Number));
    expect(progress.mock.calls[0][0]).toBeLessThan(0.02);
    expect(ended).not.toHaveBeenCalled();
    player.stop();
    vi.advanceTimersByTime(5000);
    expect(committed).toHaveBeenCalledOnce();
    expect(ended).toHaveBeenCalledOnce();
  } finally { player.stop(); vi.useRealTimers(); }
});


it('keeps upstrokes softer than downstrokes, including accented beats, and mutes softer still', () => {
  const voice = (stroke: 'D' | 'U' | 'X') => buildPracticePerformance({ ...rhythm, patterns: [{ section: 'Default', subdivision: 1, strokes: [stroke, stroke, stroke, stroke] }] }, { mode: 'strum', countIn: false, metronome: false }).notes;
  const down = voice('D'), up = voice('U'), muted = voice('X');
  expect(Math.max(...up.map(note => note.velocity))).toBeLessThan(Math.min(...down.map(note => note.velocity)));
  expect(Math.max(...muted.map(note => note.velocity))).toBeLessThan(Math.min(...up.map(note => note.velocity)));
  expect(muted[0].pitch).toBeGreaterThan(muted[muted.findIndex(note => note.tick >= MIDI_PPQ) - 1].pitch);
});


it.each([0, 1, 2])('clicks only the bar before MIDI starts, including opening rests (%s)', emptyBars => {
  const bars = [...Array.from({ length: emptyBars }, () => ({ section: 'Default', chords: [{ chord: '', beat: 1 }] })), { section: 'Default', chords: [{ chord: 'C', beat: 1 }] }, { section: 'Default', chords: [{ chord: 'G', beat: 1 }] }];
  const music = buildPracticePerformance(rhythm, { mode: 'song', bars, countIn: true, metronome: false, metronomeLeadIn: true });
  const firstChord = music.notes.find(note => note.channel === 0)!.tick;
  const clicks = music.notes.filter(note => note.channel === 9);
  expect(clicks).toHaveLength(4);
  expect(clicks[0].tick).toBe(firstChord - music.barTicks);
  expect(clicks.every(note => note.tick < firstChord)).toBe(true);
});


it.each(['S', 's'] as const)('plays soft strokes with shorter pitched sustain and the correct direction (%s)', stroke => {
  const music = buildPracticePerformance({ ...rhythm, patterns: [{ section: 'Default', subdivision: 1, strokes: [stroke, '-', '-', '-'] }] }, { mode: 'strum', countIn: false, metronome: false });
  expect(music.notes.every(note => note.channel === 0 && note.velocity === 50 && note.soft)).toBe(true);
  expect(music.notes[0].pitch < music.notes[1].pitch).toBe(stroke === 'S');
  expect(music.notes[0].duration / MIDI_PPQ * 60 / music.quarterBpm).toBeCloseTo(0.7);
});

it('preserves 8/8 bar and stroke timings when converted to four subdivisions in 4/4 at half BPM', () => {
  const old: SongRhythm = { numerator: 8, denominator: 8, bpm: 180, notes: '', patterns: [{ section: 'Default', subdivision: 2, bars: 1, strokes: ['D', '-', 'U', 'S', 's', '-', 'X', '-','D', '-', 'U', '-', 'D', '-', 'U', '-'] }], arrangements: [{ section: 'Default', chart: 'C@1 G@5 | Am' }] };
  const converted: SongRhythm = { ...old, numerator: 4, denominator: 4, bpm: 90, patterns: old.patterns.map(pattern => ({ ...pattern, subdivision: 4 })), arrangements: [{ section: 'Default', chart: 'C@1 G@3 | Am' }] };
  const before = buildPracticePerformance(old, { mode: 'song', countIn: false, metronome: false });
  const after = buildPracticePerformance(converted, { mode: 'song', countIn: false, metronome: false });
  expect(after.quarterBpm).toBe(before.quarterBpm);
  expect(after.totalTicks).toBe(before.totalTicks);
  const timings = (music: typeof before) => music.notes.map(({ tick, duration, pitch, channel }) => ({ tick, duration, pitch, channel }));
  expect(timings(after)).toEqual(timings(before));
});

it.each([0, 2, 4])('uses exactly %i intro bars even when the song opens with rests', countInBars => {
  const music = buildPracticePerformance(rhythm, { mode: 'song', countIn: true, countInBars, metronome: true, bars: [
    { section: 'V1', chords: [{ chord: '', beat: 1 }] },
    { section: 'V1', chords: [{ chord: 'C', beat: 1 }] },
  ] });
  expect(music.countInTicks).toBe(countInBars * music.barTicks);
  expect(music.notes.filter(note => note.channel === 9 && note.tick < music.countInTicks)).toHaveLength(countInBars * 4);
  expect(music.notes.filter(note => note.channel === 0).every(note => note.tick >= (countInBars + 1) * music.barTicks)).toBe(true);
});

it('sounds an explicitly timed offbeat change even when the strum grid has no stroke there', () => {
  const music = buildPracticePerformance({ ...rhythm, arrangements: [{ section: 'Default', chart: 'C@1 G@3.5' }] }, { mode: 'song', countIn: false });
  const attack = music.notes.filter(note => note.channel === 0 && note.tick >= 2.5 * MIDI_PPQ && note.tick < 2.5 * MIDI_PPQ + 40);
  expect(attack.map(note => note.pitch)).toEqual(chordMidiNotes('G'));
  expect(Math.min(...attack.map(note => note.tick))).toBe(2.5 * MIDI_PPQ);
});
