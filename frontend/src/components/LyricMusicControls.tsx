import { Guitar, Play, Square } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type ChordAnnotation } from '../chordSheet';
import { buildPracticePerformance, PracticeAudioPlayer } from '../musicPractice';
import { lyricCursorAt, lyricPlaybackBars, timedPracticeBars, type LyricBar, type LyricCursor } from '../lyricTiming';
import { worshipSequenceBlocks } from '../worshipText';
import type { SongRhythm } from '../songRhythm';

export function LyricMusicControls({ rhythm, lyrics, sequence, annotations, bars, transpose = 0, onCursor }: {
  rhythm: SongRhythm | null | undefined; lyrics: string | null | undefined; sequence: string | null | undefined;
  annotations: ChordAnnotation[]; bars: LyricBar[]; transpose?: number; onCursor: (cursor: LyricCursor | null) => void;
}) {
  const [playing, setPlaying] = useState(false), [chords, setChords] = useState(false), [error, setError] = useState<string | null>(null);
  const playerRef = useRef<PracticeAudioPlayer | null>(null);
  const callback = useRef(onCursor); callback.current = onCursor;
  const timeline = useMemo(() => lyricPlaybackBars(lyrics, sequence, bars), [lyrics, sequence, bars]);
  const signature = JSON.stringify([rhythm, lyrics, sequence, annotations, transpose, chords]);
  function stop() { const player = playerRef.current; playerRef.current = null; player?.stop(); setPlaying(false); callback.current(null); }
  useEffect(() => {
    stop(); setError(null);
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hide);
    return () => { document.removeEventListener('visibilitychange', hide); playerRef.current?.stop(); playerRef.current = null; callback.current(null); };
  }, [signature]);
  async function listen() {
    if (playing) { stop(); return; }
    if (!rhythm) return;
    let player: PracticeAudioPlayer | null = null;
    try {
      setError(null);
      if (!timeline.length) throw new Error('Place bar boundaries in the chord editor to follow the lyrics.');
      const missing = worshipSequenceBlocks(lyrics, sequence).find((_block, occurrence) => !timeline.some(bar => bar.occurrence === occurrence));
      if (missing) throw new Error(`Place bar boundaries for ${missing.label} before following the whole song.`);
      const practiceBars = timedPracticeBars(lyrics, timeline, annotations, rhythm.numerator);
      const performance = buildPracticePerformance(rhythm, { mode: 'song', countIn: true, metronome: true, chords, transpose, bars: practiceBars });
      player = new PracticeAudioPlayer(); const requested = player; playerRef.current = player; setPlaying(true);
      await player.play(performance, false, () => {}, () => { if (playerRef.current === requested) { playerRef.current = null; setPlaying(false); callback.current(null); } }, position => {
        if (playerRef.current === requested) callback.current(lyricCursorAt(lyrics, timeline, position, rhythm.numerator, rhythm.denominator));
      });
    } catch (cause) { if (player && playerRef.current !== player) return; stop(); setError(cause instanceof Error ? cause.message : 'Could not start playback.'); }
  }
  return <div className="musician-practice-listen">
    <button aria-label={playing ? 'Stop music playback' : 'Listen with timing guide'} aria-pressed={playing} className="musician-reader-toggle" disabled={!rhythm} onClick={() => void listen()} title="Play from the first bar, with one bar of count-in" type="button">{playing ? <Square size={16} /> : <Play size={16} />}<span className="musician-control-text">{playing ? 'Stop' : 'Listen'}</span></button>
    <button aria-label="Add MIDI chords to metronome" aria-pressed={chords} className={`musician-reader-toggle ${chords ? 'is-active' : ''}`} onClick={() => setChords(value => !value)} title={chords ? 'Metronome and chords' : 'Metronome only; enable to add chords'} type="button"><Guitar size={16} /><span className="musician-control-text">MIDI</span></button>
    {error ? <div className="musician-practice-error" role="alert">{error}<button aria-label="Dismiss playback error" onClick={() => setError(null)} type="button">×</button></div> : null}
  </div>;
}

export function TimingDot({ widths, anchor, pulse }: { widths: number[]; anchor: number; pulse: number }) {
  const slot = Math.max(0, Math.min(anchor, widths.length));
  const left = widths.slice(0, Math.floor(slot)).reduce((sum, width) => sum + width, 0) + (widths[Math.floor(slot)] ?? 0) * (slot % 1);
  return <span aria-hidden="true" className="lyric-timing-dot" style={{ left: `${left}ch`, transform: `translate(-50%, ${-Math.sin(pulse * Math.PI) * 0.55}em)` }} />;
}
