import { guitarSampleFor, guitarSustainBuffer, loadGuitarSamples } from "./guitarSamples";
import { transposeChordSymbol, validateChordSymbol, type ChordAnnotation } from "./chordSheet";
import { strumPatternForSection, type SongRhythm, type StrumPattern } from "./songRhythm";
import { lyricBarLayout, lyricPlaybackBars, musicalSectionKey, timedPracticeBars } from "./lyricTiming";
import { worshipSequenceBlocks } from "./worshipText";

export const MIDI_PPQ = 480;
export interface BarChord { beat: number; chord: string }
export interface PracticeBar { patternBar?: number; section: string; chords: BarChord[] }
export interface PracticeNote { tick: number; duration: number; pitch: number; velocity: number; channel: number; finishing?: boolean }
export interface PracticePerformance { notes: PracticeNote[]; bars: PracticeBar[]; barTicks: number; countInTicks: number; totalTicks: number; quarterBpm: number; numerator: number; denominator: number }
export type PracticeMode = "strum" | "part" | "song";

export function parseBarChart(chart: string, numerator: number, section = "Default"): PracticeBar[] {
  const bars: PracticeBar[] = [];
  for (const raw of chart.split(/[|\n]/).map((entry) => entry.trim()).filter(Boolean)) {
    const repeatMatch = raw.match(/\*([0-9]+)\s*$/);
    const repeats = repeatMatch ? Number(repeatMatch[1]) : 1;
    if (repeats < 1 || repeats > 16) throw new Error("Bar repeats must be between 1 and 16.");
    const tokens = (repeatMatch ? raw.slice(0, repeatMatch.index).trim() : raw).split(/[\s,]+/);
    if (tokens.length > 24) throw new Error("Use at most 24 chord changes per bar.");
    const explicit = tokens.some((token) => token.includes("@"));
    if (explicit && !tokens.every((token) => token.includes("@"))) throw new Error("Give every chord a count when using @, for example C@1 G@3.");
    const chords = tokens.map((token, index) => {
      const [symbol, count] = token.split("@");
      const beat = explicit ? Number(count) : 1 + index * numerator / tokens.length;
      if (!symbol || token.split("@").length > 2 || !Number.isFinite(beat) || beat < 1 || beat >= numerator + 1) throw new Error(`Chord counts must be within the ${numerator}-count bar.`);
      const validation = validateChordSymbol(symbol);
      if (validation.error) throw new Error(`“${symbol}”: ${validation.error}`);
      return { beat, chord: validation.normalized };
    });
    if (chords[0].beat !== 1 || chords.some((chord, index) => index > 0 && chord.beat <= chords[index - 1].beat)) throw new Error("Start each bar on count 1, with chord changes in increasing order.");
    for (let repeat = 0; repeat < repeats; repeat += 1) bars.push({ section, chords: chords.map((entry) => ({ ...entry })) });
    if (bars.length > 256) throw new Error("A practice chart can contain up to 256 bars.");
  }
  if (chart.trim() && !bars.length) throw new Error("Enter a chord for each bar.");
  return bars;
}

const PITCH_CLASSES: Record<string, number> = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, Fb: 4, "E#": 5, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11, Cb: 11, "B#": 0 };

export function chordMidiNotes(symbol: string): number[] {
  const validation = validateChordSymbol(symbol);
  if (validation.error) throw new Error(`“${symbol}”: ${validation.error}`);
  const match = validation.normalized.match(/^([A-G](?:#|b)?)([^/]*)(?:\/([A-G](?:#|b)?))?$/)!;
  const [, root, rawQuality, bass] = match;
  const quality = rawQuality.replace(/[()]/g, "").replace(/^ø7?/, "m7b5");
  const minor = /^m(?!aj)/.test(quality);
  const diminished = quality.startsWith("dim");
  const augmented = /^(aug|\+)/.test(quality);
  let intervals = quality === "5" ? [0, 7] : [0, minor || diminished ? 3 : 4, diminished ? 6 : augmented ? 8 : 7];
  if (/sus2/.test(quality) || quality === "2") intervals[1] = 2;
  else if (/sus/.test(quality) || quality === "4") intervals[1] = 5;
  const extension = quality.replace(/^mmaj/, "maj").match(/^(?:maj|m|dim|aug|\+)?(6|7|9|11|13)/)?.[1];
  if (extension === "6") intervals.push(9);
  else if (extension) {
    intervals.push(/maj/.test(quality) ? 11 : diminished && extension === "7" ? 9 : 10);
    if (Number(extension) >= 9) intervals.push(14);
    if (Number(extension) >= 11) intervals.push(17);
    if (Number(extension) >= 13) intervals.push(21);
  }
  const add = quality.match(/add(2|4|9|11|13)/)?.[1];
  if (add) intervals.push(({ "2": 2, "4": 5, "9": 14, "11": 17, "13": 21 } as Record<string, number>)[add]);
  for (const alteration of quality.matchAll(/([b#])(5|9|11|13)/g)) {
    const natural = ({ "5": 7, "9": 14, "11": 17, "13": 21 } as Record<string, number>)[alteration[2]];
    intervals = intervals.filter((interval) => interval !== natural);
    intervals.push(natural + (alteration[1] === "b" ? -1 : 1));
  }
  const rootPitch = 48 + PITCH_CLASSES[root];
  const bassPitch = 36 + PITCH_CLASSES[bass ?? root];
  return Array.from(new Set([bassPitch < 40 ? bassPitch + 12 : bassPitch, ...intervals.map((interval) => rootPitch + interval), rootPitch + 12, rootPitch + intervals[1] + 12])).sort((a, b) => a - b);
}

export function rhythmQuarterBpm(rhythm: SongRhythm): number {
  const pulse = rhythm.denominator === 8 && rhythm.numerator % 3 === 0 ? 1.5 : 4 / rhythm.denominator;
  return (rhythm.bpm ?? 90) * pulse;
}

export function songPracticeParts(lyrics?: string | null, sequence?: string | null): string[] {
  return worshipSequenceBlocks(lyrics, sequence).map((block) => block.label);
}

export function buildPracticePerformance(rhythm: SongRhythm, options: {
  mode: PracticeMode; annotations?: ChordAnnotation[]; section?: string; lyrics?: string | null; sequence?: string | null;
  previewChord?: string; transpose?: number; countIn?: boolean; metronome?: boolean; chords?: boolean; bars?: PracticeBar[]; finish?: boolean; metronomeDuringRests?: boolean;
}): PracticePerformance {
  if (!Number.isInteger(rhythm.bpm ?? 90) || (rhythm.bpm ?? 90) < 30 || (rhythm.bpm ?? 90) > 240) throw new Error("Enter a tempo between 30 and 240 BPM.");
  const section = options.section ?? "Default";
  const charts = rhythm.arrangements ?? [];
  const whole = charts.find((entry) => entry.section === "Default" && entry.chart.trim());
  let bars: PracticeBar[];
  if (options.bars) {
    bars = options.bars;
  } else if (options.mode !== "strum" && options.annotations && rhythm.markers?.length) {
    const layout = lyricBarLayout(options.lyrics, rhythm, options.annotations);
    const timeline = options.mode === "part" ? layout.filter(bar => musicalSectionKey(bar.section) === musicalSectionKey(section)).map((bar, patternBar) => ({ ...bar, patternBar })) : lyricPlaybackBars(options.lyrics, options.sequence, layout);
    if (options.mode === "song") {
      const missing = worshipSequenceBlocks(options.lyrics, options.sequence).find((_block, occurrence) => !timeline.some(bar => 'occurrence' in bar && bar.occurrence === occurrence));
      if (missing) throw new Error(`Place bar boundaries for ${missing.label} before following the whole song.`);
    }
    bars = timedPracticeBars(options.lyrics, timeline, options.annotations, rhythm.numerator);
  } else if (options.mode === "strum") {
    if (!strumPatternForSection(rhythm, section)?.strokes.some((stroke) => stroke !== "-")) throw new Error("Add a strumming pattern with at least one stroke to listen.");
    bars = parseBarChart(`${options.previewChord || "C"} *2`, rhythm.numerator, section);
  } else if (options.mode === "song" && whole) {
    bars = parseBarChart(whole.chart, rhythm.numerator);
  } else {
    const parts = options.mode === "part" ? [section] : songPracticeParts(options.lyrics, options.sequence);
    if (!parts.length) throw new Error("Add a whole-song bar chart, or lyric parts with their own bars.");
    bars = parts.flatMap((part) => {
      const chart = charts.find((entry) => entry.section.toUpperCase() === part.toUpperCase() && entry.chart.trim());
      if (!chart) throw new Error(`Add bars for ${part === "Default" ? "the whole song" : part} before playing this arrangement.`);
      return parseBarChart(chart.chart, rhythm.numerator, part);
    });
  }
  if (!bars.length) throw new Error("Add chords to the bar chart before listening.");
  if (bars.length > 256) throw new Error("A practice arrangement can contain up to 256 bars.");
  const barTicks = rhythm.numerator * 4 / rhythm.denominator * MIDI_PPQ;
  const firstChordBar = bars.findIndex(bar => bar.chords.some(change => Boolean(change.chord)));
  const firstChord = firstChordBar < 0 ? null : bars[firstChordBar].chords.find(change => Boolean(change.chord))!;
  const firstChordTick = firstChord ? firstChordBar * barTicks + (firstChord.beat - 1) / rhythm.numerator * barTicks : null;
  // Opening rests are part of the selected slide. Add only the missing lead-in.
  const countInTicks = options.countIn ? Math.max(0, barTicks - (firstChordTick ?? 0)) : 0;
  const metronomeStart = options.metronomeDuringRests || firstChordTick === null ? 0 : Math.max(0, countInTicks + firstChordTick - barTicks);
  let totalTicks = countInTicks + bars.length * barTicks;
  const quarterBpm = rhythmQuarterBpm(rhythm);
  if (totalTicks / MIDI_PPQ * 60 / quarterBpm > 1200) throw new Error("Keep a practice preview under 20 minutes.");
  const notes: PracticeNote[] = [];
  const pulseCount = rhythm.denominator === 8 && rhythm.numerator % 3 === 0 ? 3 : 1;
  function clicks(start: number, end = start + barTicks) {
    for (let count = 0; count < rhythm.numerator; count += pulseCount) {
      const tick = start + count / rhythm.numerator * barTicks;
      if (tick < 0 || tick < metronomeStart || tick >= end) continue;
      notes.push({ tick, duration: 36, pitch: count === 0 ? 76 : 77, velocity: 65, channel: 9 });
    }
  }
  if (countInTicks) clicks(countInTicks - barTicks, countInTicks);
  let lastPlayedPitches: number[] = [];
  let lastPlayedChord = "";
  const dampTicks: number[] = [];
  let patternBar = -1;
  let previousSection = "";
  bars.forEach((bar, barIndex) => {
    patternBar = bar.section === previousSection ? patternBar + 1 : 0;
    previousSection = bar.section;
    const pattern: StrumPattern = strumPatternForSection(rhythm, bar.section) ?? {
      section: "Default", subdivision: 1, strokes: Array.from({ length: rhythm.numerator }, (_, index) => index % pulseCount === 0 ? "D" : "-"),
    };
    const start = countInTicks + barIndex * barTicks;
    if (options.metronome) clicks(start);
    if (options.chords === false) return;
    const slots = rhythm.numerator * pattern.subdivision;
    const phase = (bar.patternBar ?? patternBar) % (pattern.bars ?? 1);
    pattern.strokes.slice(phase * slots, (phase + 1) * slots).forEach((stroke, index) => {
      if (stroke === "-") return;
      const beat = 1 + index / pattern.subdivision;
      const tick = start + index / slots * barTicks;
      const stepTicks = barTicks / slots;
      const chord = bar.chords.slice().reverse().find((entry) => entry.beat <= beat)?.chord;
      if (!chord) return;
      if (stroke === "X") {
        dampTicks.push(tick);
        chordMidiNotes(transposeChordSymbol(chord, options.transpose ?? 0)).forEach((pitch, stringIndex) => notes.push({
          tick: tick + stringIndex * 3, duration: Math.min(60, stepTicks * 0.4), pitch, velocity: 70, channel: 1,
        }));
        return;
      }
      if (lastPlayedChord && lastPlayedChord !== chord) dampTicks.push(tick);
      lastPlayedChord = chord;
      const pitches = chordMidiNotes(transposeChordSymbol(chord, options.transpose ?? 0));
      lastPlayedPitches = [...pitches];
      if (stroke === "U") pitches.reverse();
      pitches.forEach((pitch, stringIndex) => notes.push({
        tick: tick + stringIndex * Math.min(5, stepTicks / 16), duration: Math.max(12, stepTicks * 0.8 - stringIndex * 5),
        pitch, velocity: index % (pulseCount * pattern.subdivision) === 0 ? 105 : stroke === "U" ? 75 : 90, channel: 0,
      }));
    });
  });
  // Strings ring through rests, until they are replucked or damped by X/a
  // chord change. Use the same note lengths for live audio and MIDI exports.
  const ringing = notes.filter(note => note.channel === 0).sort((a, b) => a.tick - b.tick);
  const ringTicks = 2.5 * quarterBpm / 60 * MIDI_PPQ;
  const nextPlucks = new Map<number, number>();
  let dampIndex = dampTicks.length;
  for (let index = ringing.length - 1; index >= 0; index--) {
    const note = ringing[index];
    while (dampIndex > 0 && dampTicks[dampIndex - 1] > note.tick) dampIndex--;
    const damp = dampTicks[dampIndex] ?? totalTicks;
    const repluck = nextPlucks.get(note.pitch) ?? totalTicks;
    note.duration = Math.max(1, Math.min(ringTicks, damp - note.tick, repluck - note.tick, totalTicks - note.tick));
    nextPlucks.set(note.pitch, note.tick);
  }
  if (options.finish && lastPlayedPitches.length) {
    const secondsPerTick = 60 / quarterBpm / MIDI_PPQ;
    const sustain = 4 / secondsPerTick;
    const ending = totalTicks;
    lastPlayedPitches.forEach((pitch, index) => notes.push({
      tick: ending + index * 0.012 / secondsPerTick, duration: sustain,
      pitch, velocity: 82, channel: 0, finishing: true,
    }));
    totalTicks = Math.ceil(ending + sustain + (lastPlayedPitches.length * 0.012 + 0.04) / secondsPerTick);
  }
  notes.sort((a, b) => a.tick - b.tick);
  return { notes, bars, barTicks, countInTicks, totalTicks, quarterBpm, numerator: rhythm.numerator, denominator: rhythm.denominator };
}

function variableLength(value: number): number[] {
  const bytes = [value & 127];
  for (let rest = value >>> 7; rest; rest >>>= 7) bytes.unshift((rest & 127) | 128);
  return bytes;
}

export function practiceMidi(performance: PracticePerformance): Uint8Array {
  const tempo = Math.round(60_000_000 / performance.quarterBpm);
  const events: Array<{ tick: number; bytes: number[]; order: number }> = [
    { tick: 0, bytes: [0xff, 0x51, 3, (tempo >>> 16) & 255, (tempo >>> 8) & 255, tempo & 255], order: 0 },
    { tick: 0, bytes: [0xff, 0x58, 4, performance.numerator, Math.log2(performance.denominator), Math.round(24 * (performance.denominator === 8 && performance.numerator % 3 === 0 ? 1.5 : 4 / performance.denominator)), 8], order: 0 },
    { tick: 0, bytes: [0xc1, 28], order: 0 }, // General MIDI muted guitar for X strokes.
    { tick: 0, bytes: [0xc0, 25], order: 0 }, // General MIDI steel-string acoustic guitar.
  ];
  for (const note of performance.notes) {
    events.push({ tick: Math.round(note.tick), bytes: [0x90 | note.channel, note.pitch, note.velocity], order: 2 });
    events.push({ tick: Math.round(note.tick + note.duration), bytes: [0x80 | note.channel, note.pitch, 0], order: 1 });
  }
  const ending = performance.notes.find(note => note.finishing);
  if (ending) {
    events.push({ tick: 0, bytes: [0xb0, 11, 127], order: 0 });
    // Expression fades the held guitar voice in MIDI players as well as the
    // natural decay provided by their acoustic guitar patch.
    for (let step = 0; step <= 32; step++) {
      events.push({ tick: Math.round(ending.tick + ending.duration * step / 32), bytes: [0xb0, 11, Math.max(1, Math.round(127 * Math.exp(-6 * step / 32)))], order: 0 });
    }
  }
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const track: number[] = [];
  let previous = 0;
  for (const event of events) { track.push(...variableLength(event.tick - previous), ...event.bytes); previous = event.tick; }
  track.push(...variableLength(Math.max(0, Math.round(performance.totalTicks) - previous)), 0xff, 0x2f, 0);
  const size = track.length;
  return new Uint8Array([0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, MIDI_PPQ >>> 8, MIDI_PPQ & 255,
    0x4d, 0x54, 0x72, 0x6b, (size >>> 24) & 255, (size >>> 16) & 255, (size >>> 8) & 255, size & 255, ...track]);
}

export function transposeBarCharts(rhythm: SongRhythm | null | undefined, semitones: number): SongRhythm | null {
  if (!rhythm) return null;
  return { ...rhythm, arrangements: (rhythm.arrangements ?? []).map((entry) => ({ ...entry,
    chart: entry.chart.replace(/(^|[|\n\s,])([A-Ga-g][^\s|,@*]*)(?=@|[\s|,*]|$)/g, (match, prefix: string, chord: string) => {
      const validation = validateChordSymbol(chord);
      return validation.error ? match : `${prefix}${transposeChordSymbol(validation.normalized, semitones)}`;
    }),
  })) };
}

let activePracticePlayer: PracticeAudioPlayer | PracticeSilentPlayer | null = null;

export class PracticeAudioPlayer {
  private queuedVersion = 0;
  private queue: ((music: PracticePerformance, position: (position: number) => void, commit: () => void) => Promise<void>) | null = null;
  async queuePerformance(music: PracticePerformance, position: (position: number) => void, commit: () => void) {
    if (!this.queue || this.cancelled) throw new Error("Playback is not ready yet. Try the slide again.");
    await this.queue(music, position, commit);
  }
  private context: AudioContext | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private cancelled = false;
  private onEnd: (() => void) | null = null;

  async play(performance: PracticePerformance, loop: boolean, onProgress: (bar: number) => void, onEnd: () => void, onPosition?: (barPosition: number) => void) {
    const AudioConstructor = window.AudioContext ?? (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioConstructor) throw new Error("Audio preview is unavailable in this browser. Download the MIDI file to listen in a music app.");
    activePracticePlayer?.stop();
    activePracticePlayer = this;
    this.onEnd = onEnd;
    this.context = new AudioConstructor();
    const context = this.context;
    await context.resume();
    if (this.cancelled) return;
    if (context.state !== "running") throw new Error("The browser could not start audio. Tap Listen again, or download the MIDI file.");
    let guitar = await loadGuitarSamples(context, performance.notes);
    if (this.cancelled) return;
    let secondsPerTick = 60 / performance.quarterBpm / MIDI_PPQ;
    let started = context.currentTime + 0.08;
    let nextNote = 0;
    let duration = performance.totalTicks * secondsPerTick;
    const master = context.createGain();
    master.gain.value = 0.25;
    master.connect(context.destination);
    type Voice = { source: AudioScheduledSourceNode; gain: GainNode; at: number; end: number; queued: boolean };
    const voices = new Set<Voice>();
    const scheduleNote = (note: PracticeNote, at: number, secondsPerTick: number, guitar: Map<string, AudioBuffer>, queued = false) => {
      const length = Math.max(0.025, note.duration * secondsPerTick);
      const gain = context.createGain();
      const peak = note.velocity / 127 * (note.channel === 9 ? 0.3 : note.channel === 1 ? 0.32 : 0.5);
      const muted = note.channel === 1;
      const soundLength = note.channel === 9 ? 0.05 : muted ? Math.min(0.12, length) : length;
      const source = note.channel === 9 ? context.createOscillator() : context.createBufferSource();
      if ("frequency" in source) {
        source.type = "triangle";
        source.frequency.setValueAtTime(note.pitch === 76 ? 1600 : 1100, at);
      } else {
        const sample = guitarSampleFor(note.pitch, muted);
        const recording = guitar.get(sample.key)!;
        source.buffer = note.finishing ? guitarSustainBuffer(context, recording) : recording;
        if (note.finishing) { source.loop = true; source.loopStart = 1; source.loopEnd = 2; }
        source.playbackRate.setValueAtTime(sample.rate, at);
      }
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(peak, at + 0.003);
      if (note.channel !== 9) gain.gain.exponentialRampToValueAtTime(peak * (note.finishing ? 0.35 : muted ? 0.5 : 0.8), at + (note.finishing ? Math.min(0.6, soundLength * 0.2) : muted ? soundLength * 0.65 : Math.max(0.004, soundLength - 0.025)));
      gain.gain.exponentialRampToValueAtTime(0.0001, at + soundLength);
      source.connect(gain); gain.connect(master);
      source.start(at); source.stop(at + soundLength + 0.02);
      const voice = { source, gain, at, end: at + soundLength, queued };
      voices.add(voice);
      source.onended = () => { voices.delete(voice); source.disconnect(); gain.disconnect(); };
      return voice;
    };
    let pending: { music: PracticePerformance; guitar: Map<string, AudioBuffer>; at: number; index: number; position: (position: number) => void; commit: () => void } | null = null;
    const cut = (voice: Voice, at: number) => {
      if (voice.at >= at) { voice.source.stop(at); return; }
      if (voice.end <= at) return;
      const release = Math.max(context.currentTime, at - 0.012);
      const volume = voice.gain.gain;
      if (typeof volume.cancelAndHoldAtTime === "function") volume.cancelAndHoldAtTime(release);
      else { volume.cancelScheduledValues(release); volume.setValueAtTime(Math.max(0.0001, volume.value), release); }
      volume.exponentialRampToValueAtTime(0.0001, at);
      voice.source.stop(at + 0.005);
    };
    let preparing = false;
    this.queue = async (music, position, commit) => {
      const version = ++this.queuedVersion;
      preparing = true;
      let samples: Map<string, AudioBuffer>;
      try { samples = await loadGuitarSamples(context, music.notes); }
      finally { if (version === this.queuedVersion) preparing = false; }
      if (this.cancelled || version !== this.queuedVersion) return;
      // Keep the existing audio clock and choose the next downbeat after loading.
      const barSeconds = performance.barTicks * secondsPerTick;
      const beginning = started + performance.countInTicks * secondsPerTick;
      const at = beginning + Math.max(0, Math.floor((context.currentTime - beginning) / barSeconds) + 1) * barSeconds;
      for (const voice of voices) {
        if (voice.queued) voice.source.stop(context.currentTime);
        else cut(voice, at);
      }
      pending = { music, guitar: samples, at, index: 0, position, commit };
    };
    const schedule = () => {
      const now = context.currentTime;
      if (pending) {
        const nextSecondsPerTick = 60 / pending.music.quarterBpm / MIDI_PPQ;
        while (pending.index < pending.music.notes.length && pending.at + pending.music.notes[pending.index].tick * nextSecondsPerTick < now + 0.16) {
          const note = pending.music.notes[pending.index++];
          scheduleNote(note, Math.max(now, pending.at + note.tick * nextSecondsPerTick), nextSecondsPerTick, pending.guitar, true);
        }
        if (now >= pending.at) {
          performance = pending.music; guitar = pending.guitar; started = pending.at;
          secondsPerTick = nextSecondsPerTick; duration = performance.totalTicks * secondsPerTick;
          nextNote = pending.index; onPosition = pending.position;
          const commit = pending.commit; pending = null;
          for (const voice of voices) voice.queued = false;
          commit();
        }
      }
      let elapsed = now - started;
      if (elapsed >= duration && !pending && !preparing) {
        if (!loop) { this.stop(); return; }
        started += Math.floor(elapsed / duration) * duration;
        nextNote = 0;
        elapsed = now - started;
      }
      const position = Math.min(performance.bars.length - 0.00001, (elapsed / secondsPerTick - performance.countInTicks) / performance.barTicks);
      onProgress(Math.floor(position));
      onPosition?.(position);
      while (nextNote < performance.notes.length && performance.notes[nextNote].tick * secondsPerTick < elapsed + 0.16) {
        const note = performance.notes[nextNote];
        const intended = started + note.tick * secondsPerTick;
        if (pending && intended >= pending.at) break;
        nextNote++;
        if (intended < now - 0.08) continue;
        const at = Math.max(now, intended);
        const voice = scheduleNote(note, at, secondsPerTick, guitar);
        if (pending) cut(voice, pending.at);
      }
    };
    this.timer = setInterval(schedule, 25);
    schedule();
  }

  stop() {
    this.cancelled = true;
    this.queuedVersion++; this.queue = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.context && this.context.state !== "closed") void this.context.close().catch(() => {});
    this.context = null;
    if (activePracticePlayer === this) activePracticePlayer = null;
    const onEnd = this.onEnd; this.onEnd = null; onEnd?.();
  }
}


// Silent guidance uses a monotonic clock and never creates an AudioContext.
export class PracticeSilentPlayer {
  private timer: ReturnType<typeof setInterval> | null = null;
  private onEnd: (() => void) | null = null;
  async play(music: PracticePerformance, loop: boolean, onProgress: (bar: number) => void, onEnd: () => void, onPosition?: (position: number) => void) {
    activePracticePlayer?.stop(); activePracticePlayer = this; this.onEnd = onEnd;
    const msPerTick = 60_000 / music.quarterBpm / MIDI_PPQ;
    const duration = music.totalTicks * msPerTick;
    let started = performance.now() + 80;
    const tick = () => {
      let elapsed = performance.now() - started;
      if (elapsed >= duration) {
        if (!loop) { this.stop(); return; }
        started += Math.floor(elapsed / duration) * duration; elapsed = performance.now() - started;
      }
      const position = (elapsed / msPerTick - music.countInTicks) / music.barTicks;
      onProgress(Math.floor(position)); onPosition?.(position);
    };
    this.timer = setInterval(tick, 25); tick();
  }
  stop() {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    if (activePracticePlayer === this) activePracticePlayer = null;
    const ended = this.onEnd; this.onEnd = null; ended?.();
  }
}
