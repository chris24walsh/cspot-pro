import { Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildPracticePerformance, PracticeAudioPlayer } from "../musicPractice";
import type { SongRhythm } from "../songRhythm";

export function PracticeListenButton({ rhythm, lyrics, sequence, section, previewChord, transpose = 0 }: {
  rhythm?: SongRhythm | null; lyrics?: string | null; sequence?: string | null; section?: string;
  previewChord?: string; transpose?: number;
}) {
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const playerRef = useRef<PracticeAudioPlayer | null>(null);
  const signature = JSON.stringify(rhythm);
  function stop() { const player = playerRef.current; playerRef.current = null; player?.stop(); setPlaying(false); }
  useEffect(() => {
    stop(); setError(null);
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => { document.removeEventListener("visibilitychange", hide); const player = playerRef.current; playerRef.current = null; player?.stop(); };
  }, [signature, lyrics, sequence, transpose]);
  async function listen() {
    if (playing) { stop(); return; }
    if (!rhythm) return;
    setError(null);
    let requested: PracticeAudioPlayer | null = null;
    try {
      const mode = rhythm.arrangements?.some((entry) => entry.chart.trim()) ? "song" : "strum";
      const performance = buildPracticePerformance(rhythm, { mode, section, lyrics, sequence, previewChord, transpose, countIn: true, metronome: true });
      const player = new PracticeAudioPlayer(); requested = player; playerRef.current = player; setPlaying(true);
      await player.play(performance, false, () => {}, () => { if (playerRef.current === player) { playerRef.current = null; setPlaying(false); } });
    } catch (cause) {
      if (requested && playerRef.current !== requested) return;
      stop(); setError(cause instanceof Error ? cause.message : "Could not play song practice.");
    }
  }
  return <div className="musician-practice-listen">
    <button aria-label={playing ? "Stop song practice" : "Listen to song practice"} aria-pressed={playing} className="musician-reader-toggle" disabled={!rhythm} onClick={() => void listen()} title={rhythm ? playing ? "Stop practice playback" : "Listen to chords and strumming (local practice audio)" : "Add song rhythm to enable practice playback"} type="button">
      {playing ? <Square size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}<span className="musician-control-text">{playing ? "Stop" : "Listen"}</span>
    </button>
    {error ? <div className="musician-practice-error" role="alert">{error}<button aria-label="Dismiss practice error" onClick={() => setError(null)} type="button">×</button></div> : null}
  </div>;
}
