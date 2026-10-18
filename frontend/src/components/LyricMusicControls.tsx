import { Footprints, Guitar, Play, Square, Timer, Volume2, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { transposeChordSymbol, type ChordAnnotation } from '../chordSheet';
import { performanceBarLength, buildPracticePerformance, PracticeAudioPlayer, PracticeSilentPlayer, MIDI_PPQ, type PracticeBar } from '../musicPractice';
import { liveJumpStart, timelineWithEntry, lyricCursorAt, lyricPlaybackBars, timedPracticeBars, type LyricBar, type LyricCursor } from '../lyricTiming';
import { worshipSequenceBlocks } from '../worshipText';
import { usePedalKeyboard } from '../usePedalKeyboard';
import { CompactControlMenu } from './CompactControlMenu';
import type { SongRhythm } from '../songRhythm';

type PlayMode = "metronome" | "midi" | "midi-only" | "silent";
type StartPosition = { occurrence: number; lineStart: number; lineEnd: number };

export interface MusicTimingProgress { barDurationsMs?: number[]; startIndex: number; position: number; barDurationMs: number; totalBars: number; introBars?: number; introChord?: string; introCountIn?: boolean; firstBarStop?: number }

export function LyricMusicControls({ rhythm, lyrics, sequence, annotations, bars, transpose = 0, onCursor, onStarted, canPractice = true, backing, startAt, onTiming, jumpRevision = 0, onJumpPending, onJumpCommitted, onPedalNavigate, onSaveIntroBars, onRestoreKeyboardCapture, rootChord }: {
  rootChord?: string;
  onRestoreKeyboardCapture?: () => void;
  onSaveIntroBars?: (bars: number) => Promise<void>;
  onPedalNavigate?: (direction: -1 | 0 | 1) => void;
  rhythm: SongRhythm | null | undefined; lyrics: string | null | undefined; sequence: string | null | undefined;
  onJumpCommitted?: () => void; jumpRevision?: number; onJumpPending?: (pending: boolean) => void;
  onTiming?: (timing: MusicTimingProgress | null) => void;
  startAt?: { occurrence: number; lineStart: number; lineEnd: number };
  canPractice?: boolean; onStarted?: () => void;
  backing?: { playing: boolean; disabledReason?: string; toggle: () => Promise<void> };
  annotations: ChordAnnotation[]; bars: LyricBar[]; transpose?: number; onCursor: (cursor: LyricCursor | null) => void;
}) {
  const [savingIntro, setSavingIntro] = useState(false);
  const [pedalEnabled, setPedalEnabled] = useState(false);
  const [armedMode, setArmedMode] = useState<PlayMode | null>(null);
  const [pedalJump, setPedalJump] = useState<{ revision: number; target: StartPosition } | null>(null);
  const [chooser, setChooser] = useState<number | null>(null);
  const currentBar = useRef(0);
  const currentPosition = useRef(-1);
  const leftTap = useRef<(() => void) | null>(null);
  const resumeAt = useRef<StartPosition | undefined>();
  const sections = useMemo(() => worshipSequenceBlocks(lyrics, sequence), [lyrics, sequence]);
  function sectionStart(occurrence: number): StartPosition | undefined {
    const bar = timeline.find(bar => bar.occurrence === occurrence);
    return bar ? { occurrence, lineStart: bar.start.lineIndex, lineEnd: bar.start.lineIndex + 1 } : undefined;
  }
  function requestJump(target: StartPosition) {
    setPedalJump(previous => ({ revision: (previous?.revision ?? 0) + 1, target }));
  }
  function trackPosition(index: number) {
    if (index < 0) return;
    currentBar.current = Math.min(Math.floor(index), timeline.length - 1);
    currentPosition.current = index;
  }
  usePedalKeyboard(pedalEnabled && canPractice, (direction, held) => {
    const occurrence = timeline[currentBar.current]?.occurrence ?? startAt?.occurrence ?? 0;
    if (chooser !== null) {
      if (held && direction === -1) { setChooser(null); return; }
      if (held && direction === 1) {
        const target = sectionStart(chooser); setChooser(null);
        if (target) { if (playing) requestJump(target); else { resumeAt.current = target; if (armedMode) void listen(armedMode, target); } }
      } else setChooser(Math.max(0, Math.min(sections.length - 1, chooser + direction)));
      return;
    }
    if (held && direction === -1) { setChooser(occurrence); return; }
    if (held && direction === 1) {
      if (playing) {
        const bar = timeline[currentBar.current];
        resumeAt.current = bar ? { occurrence: bar.occurrence, lineStart: bar.start.lineIndex, lineEnd: bar.start.lineIndex + 1 } : startAt;
        stop();
      } else if (armedMode) void listen(armedMode, resumeAt.current ?? startAt);
      return;
    }
    if (!playing) { if (direction === -1) { resumeAt.current = undefined; onPedalNavigate?.(-1); } return; }
    if (direction === 1) onPedalNavigate?.(1);
    else leftTap.current?.();
  }, direction => {
    if (!playing && chooser === null && !armedMode) {
      resumeAt.current = undefined;
      onPedalNavigate?.(direction);
      return true;
    }
    if (direction === -1 && playing && chooser === null) {
      // A selected destination may still be queued while the old source plays.
      // Keep stepping back during that wait and through any partial entry bar,
      // then retain the normal first-half-of-the-first-full-bar window.
      const entry = liveJumpStart(lyrics, timeline, annotations, startAt);
      const firstFullBar = entry.index + (entry.stop > 0 ? 1 : 0);
      const back = jumpPending || jumpRevision !== handledJump.current
        || entry.index >= 0 && currentPosition.current < firstFullBar + 0.5;
      const navigate = onPedalNavigate;
      leftTap.current = () => navigate?.(back ? -1 : 0);
    }
    if (direction !== 1 || playing || chooser !== null || !armedMode) return false;
    void listen(armedMode, resumeAt.current ?? startAt);
    return true;
  });
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
    stop(); setError(null); setChooser(null); resumeAt.current = undefined; currentPosition.current = -1; currentBar.current = 0;
  }, [signature]);
  const jumpToken = `${jumpRevision}:${pedalJump?.revision ?? 0}`;
  const handledToken = useRef(jumpToken);
  useEffect(() => {
    if (jumpToken === handledToken.current) return;
    const external = jumpRevision !== handledJump.current;
    handledToken.current = jumpToken;
    const destination = external ? startAt : pedalJump?.target;
    handledJump.current = jumpRevision;
    const requested = playerRef.current;
    const mode = modeRef.current;
    if (!requested || !mode) { pendingCallback.current?.(false); return; }
    const revision = jumpToken;
    const committed = commitCallback.current;
    setJumpPending(true); pendingCallback.current?.(true);
    void (async () => {
      try {
        if (!rhythm) throw new Error("Add rhythm and bar boundaries to this song before playing from here.");
        const { index, stop: firstBarStop } = liveJumpStart(lyrics, timeline, annotations, destination);
        const jumpTimeline = timelineWithEntry(timeline, index, firstBarStop);
        if (index < 0 || !timeline.length) throw new Error("Place a bar boundary on this slide to play from here.");
        const missing = worshipSequenceBlocks(lyrics, sequence).find((_block, occurrence) => occurrence >= (destination?.occurrence ?? 0) && !timeline.some(bar => bar.occurrence === occurrence));
        if (missing) throw new Error(`Place bar boundaries for ${missing.label} before playing from here.`);
        // Live navigation keeps the chord sounding at the end of this bar.
        const oldBars = activeBars.current;
        const changes = oldBars.bars.slice(0, Math.max(0, Math.floor(oldBars.position) + 1)).flatMap(bar => bar.chords).filter(change => change.chord);
        const previous = changes[changes.length - 1]?.chord;
        const initialChord = (mode === "midi" || mode === "midi-only") && previous ? transposeChordSymbol(previous, oldBars.transpose - transpose) : "";
        const practiceBars = timedPracticeBars(lyrics, jumpTimeline.slice(index), annotations, rhythm.numerator, initialChord);
        const music = buildPracticePerformance(rhythm, { mode: "song", countIn: false, metronome: mode !== "silent" && mode !== "midi-only", metronomeDuringRests: true, chords: (mode === "midi" || mode === "midi-only"), finish: (mode === "midi" || mode === "midi-only"), transpose, bars: practiceBars });
        await readyRef.current;
        if (playerRef.current !== requested || handledToken.current !== revision) return;
        await requested.queuePerformance(music, position => {
          if (playerRef.current !== requested) return;
          trackPosition(index + position);
          activeBars.current = { bars: practiceBars, position, transpose };
          callback.current(lyricCursorAt(lyrics, jumpTimeline, index + position, rhythm.numerator, rhythm.denominator));
          timingCallback.current?.({ startIndex: index, position, barDurationMs: performanceBarLength(music, Math.max(0, Math.floor(position))) / MIDI_PPQ * 60_000 / music.quarterBpm, barDurationsMs: practiceBars.map((_, i) => performanceBarLength(music, i) / MIDI_PPQ * 60_000 / music.quarterBpm), totalBars: practiceBars.length, firstBarStop });
        }, () => { if (playerRef.current === requested && handledToken.current === revision) { committed?.(); setJumpPending(false); pendingCallback.current?.(false); } });
      } catch (cause) {
        if (playerRef.current !== requested || handledToken.current !== revision) return;
        setJumpPending(false); pendingCallback.current?.(false);
        setError(cause instanceof Error ? cause.message : "Could not play from here.");
      }
    })();
  }, [jumpToken]);
  useEffect(() => { if (backing?.playing && playerRef.current) stop(); }, [backing?.playing]);
  async function listen(mode: PlayMode, destination = startAt) {
    if (playing) { stop(); return; }
    if (!rhythm || !canPractice) return;
    if (backing?.playing) await backing.toggle();
    let player: PracticeAudioPlayer | PracticeSilentPlayer | null = null;
    try {
      setError(null);
      if (!timeline.length) throw new Error('Place bar boundaries in the chord editor to follow the lyrics.');
      // Capture the selected page once; automatic page turns must not restart playback.
      const startIndex = destination ? timeline.findIndex(bar => bar.occurrence === destination.occurrence && bar.start.lineIndex >= destination.lineStart && bar.start.lineIndex < destination.lineEnd) : 0;
      if (startIndex < 0) throw new Error('Place a bar boundary on this slide to start playback here.');
      const missing = worshipSequenceBlocks(lyrics, sequence).find((_block, occurrence) => occurrence >= (destination?.occurrence ?? 0) && !timeline.some(bar => bar.occurrence === occurrence));
      if (missing) throw new Error(`Place bar boundaries for ${missing.label} before following the whole song.`);
      const practiceBars = timedPracticeBars(lyrics, timeline.slice(startIndex), annotations, rhythm.numerator);
      const introBars = pedalEnabled ? rhythm.intro_bars ?? 2 : 0;
      const openingChord = timedPracticeBars(lyrics, timeline, annotations, rhythm.numerator)
        .flatMap(bar => bar.chords).find(change => change.chord)?.chord || rootChord || '';
      const performanceBars: PracticeBar[] = [
        ...Array.from({ length: introBars }, (_, patternBar) => ({ section: practiceBars[0]?.section ?? 'Default', patternBar, chords: [{ beat: 1, chord: openingChord }] })),
        ...practiceBars,
      ];
      const builtPerformance = buildPracticePerformance(rhythm, { mode: 'song', countIn: mode !== 'silent', countInBars: pedalEnabled ? 1 : undefined, metronomeLeadIn: mode === 'midi-only', metronome: mode !== "silent" && mode !== "midi-only", chords: (mode === "midi" || mode === "midi-only"), finish: (mode === "midi" || mode === "midi-only"), transpose, bars: performanceBars });
      // Publish a full silent preparation bar before lyrics begin, regardless of opening rests.
      const performance = mode === 'silent' && !pedalEnabled ? { ...builtPerformance, countInTicks: builtPerformance.barTicks, totalTicks: builtPerformance.totalTicks + builtPerformance.barTicks } : builtPerformance;
      player = mode === "silent" ? new PracticeSilentPlayer() : new PracticeAudioPlayer(); const requested = player; playerRef.current = player; modeRef.current = mode; setPlaying(true); onStarted?.();
      currentBar.current = startIndex; currentPosition.current = startIndex - 1;
      activeBars.current = { bars: performanceBars, position: -1, transpose };
      readyRef.current = player.play(performance, false, () => {}, () => { if (playerRef.current === requested) { playerRef.current = null; modeRef.current = null; setPlaying(false); setJumpPending(false); pendingCallback.current?.(false); callback.current(null); timingCallback.current?.(null); } }, position => {
        if (playerRef.current === requested) {
          const lyricPosition = position - introBars;
          trackPosition(lyricPosition < 0 ? -1 : lyricPosition + startIndex);
          activeBars.current = { bars: performanceBars, position, transpose };
          callback.current(lyricPosition < 0 ? null : lyricCursorAt(lyrics, timeline, lyricPosition + startIndex, rhythm.numerator, rhythm.denominator));
          timingCallback.current?.({ startIndex, position: lyricPosition, barDurationMs: (lyricPosition < 0 ? performance.barTicks : performanceBarLength(performance, Math.floor(position))) / MIDI_PPQ * 60_000 / performance.quarterBpm, barDurationsMs: practiceBars.map((_, i) => performanceBarLength(performance, i + introBars) / MIDI_PPQ * 60_000 / performance.quarterBpm), totalBars: practiceBars.length, introBars: pedalEnabled ? introBars : undefined, introChord: openingChord ? transposeChordSymbol(openingChord, transpose) : undefined, introCountIn: pedalEnabled });
        }
      });
      await readyRef.current;
    } catch (cause) { if (player && playerRef.current !== player) return; stop(); setError(cause instanceof Error ? cause.message : 'Could not start playback.'); }
  }
  function selectMode(mode: PlayMode) {
    onRestoreKeyboardCapture?.();
    if (pedalEnabled) { stop(); resumeAt.current = undefined; setArmedMode(mode); }
    else void listen(mode);
  }
  return <div className="musician-practice-listen" data-pedal-enabled={pedalEnabled && canPractice ? "true" : undefined}>
    {pedalEnabled && chooser !== null ? <div className="pedal-section-picker" aria-label="Pedal section selection">
      <small>Jump to section · {chooser + 1}/{sections.length}</small>
      <strong>{sections[chooser]?.label}</strong>
      <span>← / → select · hold → confirm · hold ← cancel</span>
    </div> : null}
    {jumpPending ? <small role="status">Jump queued…</small> : null}
    <CompactControlMenu label={playing || backing?.playing ? 'Stop playback' : 'Play'} icon={playing || backing?.playing ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} active={playing || backing?.playing} action={playing || backing?.playing ? () => { if (playing) stop(); else void backing?.toggle(); onRestoreKeyboardCapture?.(); } : undefined}>
      {close => <>
        {canPractice ? <>
          <div className="pedal-playback-options">
            <button role="menuitemcheckbox" aria-checked={pedalEnabled} onClick={() => { stop(); setArmedMode(null); setChooser(null); resumeAt.current = undefined; setPedalEnabled(!pedalEnabled); onRestoreKeyboardCapture?.(); }} type="button"><Footprints size={16} aria-hidden="true" /><span>Pedal mode: {pedalEnabled ? 'On' : 'Off'}</span></button>
            <label>Intro<select aria-label="Song intro bars" value={rhythm?.intro_bars ?? 2} disabled={!rhythm || !onSaveIntroBars || savingIntro} title={!onSaveIntroBars ? 'Song editing permission required' : 'Saved for this song · used when Pedal mode is on'} onChange={async event => {
              const bars = Number(event.target.value);
              setSavingIntro(true); setError(null);
              try { await onSaveIntroBars?.(bars); }
              catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not save intro bars.'); }
              finally { setSavingIntro(false); }
            }}>{Array.from({ length: 17 }, (_, bars) => <option key={bars} value={bars}>{bars} {bars === 1 ? 'bar' : 'bars'}</option>)}</select></label>
          </div>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); selectMode("silent"); }} type="button"><VolumeX size={16} aria-hidden="true" /><span>Lyrics only<small>Follow the lyrics · no sound</small></span></button>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); selectMode("metronome"); }} type="button"><Timer size={16} aria-hidden="true" /><span>Click only<small>{rhythm ? `Steady beat · ${rhythm.bpm ?? 90} BPM` : 'Add song rhythm first'}</small></span></button>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); selectMode("midi"); }} type="button"><Guitar size={16} aria-hidden="true" /><span>Guitar + click<small>Guitar chords + steady clicks · {startAt ? 'current slide' : 'song start'}</small></span></button>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); selectMode("midi-only"); }} type="button"><Guitar size={16} aria-hidden="true" /><span>Guitar only<small>Click count-in · then guitar chords</small></span></button>
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
