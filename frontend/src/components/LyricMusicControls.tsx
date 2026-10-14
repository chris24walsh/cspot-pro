import { Guitar, Play, Square, Timer, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { transposeChordSymbol, type ChordAnnotation } from '../chordSheet';
import { buildPracticePerformance, PracticeAudioPlayer, PracticeSilentPlayer, MIDI_PPQ, type PracticeBar } from '../musicPractice';
import { liveJumpStart, timelineWithEntry, lyricCursorAt, lyricPlaybackBars, timedPracticeBars, type LyricBar, type LyricCursor } from '../lyricTiming';
import { worshipSequenceBlocks } from '../worshipText';
import { CompactControlMenu } from './CompactControlMenu';
import type { SongRhythm } from '../songRhythm';

export interface MusicTimingProgress { startIndex: number; position: number; barDurationMs: number; totalBars: number; firstBarStop?: number }

export function LyricMusicControls({ rhythm, lyrics, sequence, annotations, bars, transpose = 0, onCursor, onStarted, canPractice = true, backing, startAt, onTiming, jumpRevision = 0, onJumpPending, onJumpCommitted }: {
  rhythm: SongRhythm | null | undefined; lyrics: string | null | undefined; sequence: string | null | undefined;
  onJumpCommitted?: () => void; jumpRevision?: number; onJumpPending?: (pending: boolean) => void;
  onTiming?: (timing: MusicTimingProgress | null) => void;
  startAt?: { occurrence: number; lineStart: number; lineEnd: number };
  canPractice?: boolean; onStarted?: () => void;
  backing?: { playing: boolean; disabledReason?: string; toggle: () => Promise<void> };
  annotations: ChordAnnotation[]; bars: LyricBar[]; transpose?: number; onCursor: (cursor: LyricCursor | null) => void;
}) {
  const [playing, setPlaying] = useState(false), [error, setError] = useState<string | null>(null);
  const activeBars = useRef<{ bars: PracticeBar[]; position: number; transpose: number }>({ bars: [], position: -1, transpose: 0 });
  const modeRef = useRef<"metronome" | "midi" | "midi-only" | "silent" | null>(null);
  const readyRef = useRef<Promise<void>>(Promise.resolve());
  const handledJump = useRef(jumpRevision);
  const [jumpPending, setJumpPending] = useState(false);
  const commitCallback = useRef(onJumpCommitted); commitCallback.current = onJumpCommitted;
  const pendingCallback = useRef(onJumpPending); pendingCallback.current = onJumpPending;
  const playerRef = useRef<PracticeAudioPlayer | PracticeSilentPlayer | null>(null);
  const timingCallback = useRef(onTiming); timingCallback.current = onTiming;
  const callback = useRef(onCursor); callback.current = onCursor;
  const timeline = useMemo(() => lyricPlaybackBars(lyrics, sequence, bars), [lyrics, sequence, bars]);
  const signature = JSON.stringify([{ ...rhythm, visual_beats: undefined }, lyrics, sequence, annotations, transpose, canPractice]);
  function stop() { modeRef.current = null; setJumpPending(false); pendingCallback.current?.(false); const player = playerRef.current; playerRef.current = null; player?.stop(); setPlaying(false); callback.current(null); timingCallback.current?.(null); }
  useEffect(() => {
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); playerRef.current?.stop(); playerRef.current = null; callback.current(null); timingCallback.current?.(null); pendingCallback.current?.(false); };
  }, []);
  useEffect(() => {
    if (modeRef.current && jumpRevision !== handledJump.current) return;
    stop(); setError(null);
  }, [signature]);
  useEffect(() => {
    if (jumpRevision === handledJump.current) return;
    handledJump.current = jumpRevision;
    const requested = playerRef.current;
    const mode = modeRef.current;
    if (!requested || !mode) { pendingCallback.current?.(false); return; }
    const revision = jumpRevision;
    const committed = commitCallback.current;
    setJumpPending(true); pendingCallback.current?.(true);
    void (async () => {
      try {
        if (!rhythm) throw new Error("Add rhythm and bar boundaries to this song before playing from here.");
        const { index, stop: firstBarStop } = liveJumpStart(lyrics, timeline, annotations, startAt);
        const jumpTimeline = timelineWithEntry(timeline, index, firstBarStop);
        if (index < 0 || !timeline.length) throw new Error("Place a bar boundary on this slide to play from here.");
        const missing = worshipSequenceBlocks(lyrics, sequence).find((_block, occurrence) => occurrence >= (startAt?.occurrence ?? 0) && !timeline.some(bar => bar.occurrence === occurrence));
        if (missing) throw new Error(`Place bar boundaries for ${missing.label} before playing from here.`);
        // Live navigation keeps the chord sounding at the end of this bar.
        const oldBars = activeBars.current;
        const changes = oldBars.bars.slice(0, Math.max(0, Math.floor(oldBars.position) + 1)).flatMap(bar => bar.chords).filter(change => change.chord);
        const previous = changes[changes.length - 1]?.chord;
        const initialChord = (mode === "midi" || mode === "midi-only") && previous ? transposeChordSymbol(previous, oldBars.transpose - transpose) : "";
        const practiceBars = timedPracticeBars(lyrics, jumpTimeline.slice(index), annotations, rhythm.numerator, initialChord);
        const music = buildPracticePerformance(rhythm, { mode: "song", countIn: false, metronome: mode !== "silent" && mode !== "midi-only", metronomeDuringRests: true, chords: (mode === "midi" || mode === "midi-only"), finish: (mode === "midi" || mode === "midi-only"), transpose, bars: practiceBars });
        await readyRef.current;
        if (playerRef.current !== requested || handledJump.current !== revision) return;
        await requested.queuePerformance(music, position => {
          if (playerRef.current !== requested) return;
          activeBars.current = { bars: practiceBars, position, transpose };
          callback.current(lyricCursorAt(lyrics, jumpTimeline, index + position, rhythm.numerator, rhythm.denominator));
          timingCallback.current?.({ startIndex: index, position, barDurationMs: music.barTicks / MIDI_PPQ * 60_000 / music.quarterBpm, totalBars: practiceBars.length, firstBarStop });
        }, () => { committed?.(); if (handledJump.current === revision) { setJumpPending(false); pendingCallback.current?.(false); } });
      } catch (cause) {
        if (playerRef.current !== requested || handledJump.current !== revision) return;
        setJumpPending(false); pendingCallback.current?.(false);
        setError(cause instanceof Error ? cause.message : "Could not play from here.");
      }
    })();
  }, [jumpRevision]);
  useEffect(() => { if (backing?.playing && playerRef.current) stop(); }, [backing?.playing]);
  async function listen(mode: "metronome" | "midi" | "midi-only" | "silent") {
    if (playing) { stop(); return; }
    if (!rhythm || !canPractice) return;
    if (backing?.playing) await backing.toggle();
    let player: PracticeAudioPlayer | PracticeSilentPlayer | null = null;
    try {
      setError(null);
      if (!timeline.length) throw new Error('Place bar boundaries in the chord editor to follow the lyrics.');
      // Capture the selected page once; automatic page turns must not restart playback.
      const startIndex = startAt ? timeline.findIndex(bar => bar.occurrence === startAt.occurrence && bar.start.lineIndex >= startAt.lineStart && bar.start.lineIndex < startAt.lineEnd) : 0;
      if (startIndex < 0) throw new Error('Place a bar boundary on this slide to start playback here.');
      const missing = worshipSequenceBlocks(lyrics, sequence).find((_block, occurrence) => occurrence >= (startAt?.occurrence ?? 0) && !timeline.some(bar => bar.occurrence === occurrence));
      if (missing) throw new Error(`Place bar boundaries for ${missing.label} before following the whole song.`);
      const practiceBars = timedPracticeBars(lyrics, timeline.slice(startIndex), annotations, rhythm.numerator);
      const performance = buildPracticePerformance(rhythm, { mode: 'song', countIn: mode !== 'silent' && mode !== 'midi-only', metronome: mode !== "silent" && mode !== "midi-only", chords: (mode === "midi" || mode === "midi-only"), finish: (mode === "midi" || mode === "midi-only"), transpose, bars: practiceBars });
      player = mode === "silent" ? new PracticeSilentPlayer() : new PracticeAudioPlayer(); const requested = player; playerRef.current = player; modeRef.current = mode; setPlaying(true); onStarted?.();
      activeBars.current = { bars: practiceBars, position: -1, transpose };
      readyRef.current = player.play(performance, false, () => {}, () => { if (playerRef.current === requested) { playerRef.current = null; modeRef.current = null; setPlaying(false); setJumpPending(false); pendingCallback.current?.(false); callback.current(null); timingCallback.current?.(null); } }, position => {
        if (playerRef.current === requested) {
          activeBars.current = { bars: practiceBars, position, transpose };
          callback.current(position < 0 ? null : lyricCursorAt(lyrics, timeline, position + startIndex, rhythm.numerator, rhythm.denominator));
          timingCallback.current?.({ startIndex, position, barDurationMs: performance.barTicks / MIDI_PPQ * 60_000 / performance.quarterBpm, totalBars: practiceBars.length });
        }
      });
      await readyRef.current;
    } catch (cause) { if (player && playerRef.current !== player) return; stop(); setError(cause instanceof Error ? cause.message : 'Could not start playback.'); }
  }
  return <div className="musician-practice-listen">
    {jumpPending ? <small role="status">Play from here on the next bar…</small> : null}
    <CompactControlMenu label={playing || backing?.playing ? 'Stop playback' : 'Play'} icon={playing || backing?.playing ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} active={playing || backing?.playing} action={playing || backing?.playing ? () => { if (playing) stop(); else void backing?.toggle(); } : undefined}>
      {close => <>
        {canPractice ? <>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); void listen("silent"); }} type="button"><VolumeX size={16} aria-hidden="true" /><span>Silent guide<small>Dot + auto page turn · no sound</small></span></button>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); void listen("metronome"); }} type="button"><Timer size={16} aria-hidden="true" /><span>Metronome<small>{rhythm ? `${rhythm.bpm ?? 90} BPM · clicks one bar before first chord` : 'Add song rhythm first'}</small></span></button>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); void listen("midi"); }} type="button"><Guitar size={16} aria-hidden="true" /><span>MIDI strum<small>Chords + metronome · {startAt ? 'current slide' : 'song start'}</small></span></button>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); void listen("midi-only"); }} type="button"><Guitar size={16} aria-hidden="true" /><span>MIDI only<small>Chords and strum · no metronome</small></span></button>
        </> : null}
        {backing ? <button role="menuitem" disabled={Boolean(backing.disabledReason)} title={backing.disabledReason} onClick={() => { close(); stop(); setError(null); void backing.toggle(); }} type="button"><Volume2 size={16} aria-hidden="true" /><span>Backing track<small>{backing.disabledReason ?? 'Service audio'}</small></span></button> : null}
      </>}
    </CompactControlMenu>
    {error ? <div className="musician-practice-error" role="alert">{error}<button aria-label="Dismiss playback error" onClick={() => setError(null)} type="button">×</button></div> : null}
  </div>;
}

export function TimingDot({ widths, anchor, pulse }: { widths: number[]; anchor: number; pulse: number }) {
  const slot = Math.max(0, Math.min(anchor, widths.length));
  const left = widths.slice(0, Math.floor(slot)).reduce((sum, width) => sum + width, 0) + (widths[Math.floor(slot)] ?? 0) * (slot % 1);
  return <span aria-hidden="true" className="lyric-timing-dot" style={{ left: `${left}ch`, transform: `translate(-50%, ${-Math.sin(pulse * Math.PI) * 0.55}em)` }} />;
}
