import { Guitar, Play, Square, Timer, Volume2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type ChordAnnotation } from '../chordSheet';
import { buildPracticePerformance, PracticeAudioPlayer } from '../musicPractice';
import { lyricCursorAt, lyricPlaybackBars, timedPracticeBars, type LyricBar, type LyricCursor } from '../lyricTiming';
import { worshipSequenceBlocks } from '../worshipText';
import { CompactControlMenu } from './CompactControlMenu';
import type { SongRhythm } from '../songRhythm';

export function LyricMusicControls({ rhythm, lyrics, sequence, annotations, bars, transpose = 0, onCursor, onStarted, canPractice = true, backing, startAt }: {
  rhythm: SongRhythm | null | undefined; lyrics: string | null | undefined; sequence: string | null | undefined;
  startAt?: { occurrence: number; lineStart: number; lineEnd: number };
  canPractice?: boolean; onStarted?: () => void;
  backing?: { playing: boolean; disabledReason?: string; toggle: () => Promise<void> };
  annotations: ChordAnnotation[]; bars: LyricBar[]; transpose?: number; onCursor: (cursor: LyricCursor | null) => void;
}) {
  const [playing, setPlaying] = useState(false), [error, setError] = useState<string | null>(null);
  const playerRef = useRef<PracticeAudioPlayer | null>(null);
  const callback = useRef(onCursor); callback.current = onCursor;
  const timeline = useMemo(() => lyricPlaybackBars(lyrics, sequence, bars), [lyrics, sequence, bars]);
  const signature = JSON.stringify([rhythm, lyrics, sequence, annotations, transpose, canPractice]);
  function stop() { const player = playerRef.current; playerRef.current = null; player?.stop(); setPlaying(false); callback.current(null); }
  useEffect(() => {
    stop(); setError(null);
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); playerRef.current?.stop(); playerRef.current = null; callback.current(null); };
  }, [signature]);
  useEffect(() => { if (backing?.playing && playerRef.current) stop(); }, [backing?.playing]);
  async function listen(chords: boolean) {
    if (playing) { stop(); return; }
    if (!rhythm || !canPractice) return;
    if (backing?.playing) await backing.toggle();
    let player: PracticeAudioPlayer | null = null;
    try {
      setError(null);
      if (!timeline.length) throw new Error('Place bar boundaries in the chord editor to follow the lyrics.');
      // Capture the selected page once; automatic page turns must not restart playback.
      const startIndex = startAt ? timeline.findIndex(bar => bar.occurrence === startAt.occurrence && bar.start.lineIndex >= startAt.lineStart && bar.start.lineIndex < startAt.lineEnd) : 0;
      if (startIndex < 0) throw new Error('Place a bar boundary on this slide to start playback here.');
      const missing = worshipSequenceBlocks(lyrics, sequence).find((_block, occurrence) => occurrence >= (startAt?.occurrence ?? 0) && !timeline.some(bar => bar.occurrence === occurrence));
      if (missing) throw new Error(`Place bar boundaries for ${missing.label} before following the whole song.`);
      const practiceBars = timedPracticeBars(lyrics, timeline, annotations, rhythm.numerator).slice(startIndex);
      const performance = buildPracticePerformance(rhythm, { mode: 'song', countIn: true, metronome: true, chords, transpose, bars: practiceBars });
      player = new PracticeAudioPlayer(); const requested = player; playerRef.current = player; setPlaying(true); onStarted?.();
      await player.play(performance, false, () => {}, () => { if (playerRef.current === requested) { playerRef.current = null; setPlaying(false); callback.current(null); } }, position => {
        if (playerRef.current === requested) callback.current(position < 0 ? null : lyricCursorAt(lyrics, timeline, position + startIndex, rhythm.numerator, rhythm.denominator));
      });
    } catch (cause) { if (player && playerRef.current !== player) return; stop(); setError(cause instanceof Error ? cause.message : 'Could not start playback.'); }
  }
  return <div className="musician-practice-listen">
    <CompactControlMenu label={playing || backing?.playing ? 'Stop playback' : 'Play'} icon={playing || backing?.playing ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />} active={playing || backing?.playing} action={playing || backing?.playing ? () => { if (playing) stop(); else void backing?.toggle(); } : undefined}>
      {close => <>
        {canPractice ? <>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); void listen(false); }} type="button"><Timer size={16} aria-hidden="true" /><span>Metronome<small>{rhythm ? `${rhythm.bpm ?? 90} BPM · ${startAt ? 'current slide' : 'song start'} · count-in` : 'Add song rhythm first'}</small></span></button>
          <button role="menuitem" disabled={!rhythm} onClick={() => { close(); void listen(true); }} type="button"><Guitar size={16} aria-hidden="true" /><span>MIDI strum<small>Chords + metronome · {startAt ? 'current slide' : 'song start'}</small></span></button>
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
