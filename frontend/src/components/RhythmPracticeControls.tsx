import { Download, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { buildPracticePerformance, practiceMidi, PracticeAudioPlayer, type PracticeMode } from "../musicPractice";
import type { ChordAnnotation } from "../chordSheet";
import type { SongRhythm } from "../songRhythm";

export function RhythmPracticeControls({ rhythm, annotations, section = "Default", strumSection, lyrics, sequence, previewChord = "C", transpose = 0, title = "Song", onPosition, onTempoChange }: {
  onPosition?: (position: number | null, mode: PracticeMode, section: string) => void;
  annotations?: ChordAnnotation[]; rhythm: SongRhythm; section?: string; strumSection?: string; lyrics?: string | null; sequence?: string | null;
  previewChord?: string; transpose?: number; title?: string; onTempoChange?: (bpm: number) => void;
}) {
  const [bpm, setBpm] = useState(rhythm.bpm ?? 90);
  const [chord, setChord] = useState(previewChord);
  const [loop, setLoop] = useState(false);
  const [countIn, setCountIn] = useState(true);
  const [metronome, setMetronome] = useState(true);
  const [playing, setPlaying] = useState<PracticeMode | null>(null);
  const [bar, setBar] = useState(-1);
  const [barCount, setBarCount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState<PracticeMode>("song");
  const positionCallback = useRef(onPosition); positionCallback.current = onPosition;
  const playerRef = useRef<PracticeAudioPlayer | null>(null);
  const signature = JSON.stringify(rhythm);
  const stop = () => { const player = playerRef.current; playerRef.current = null; player?.stop(); setPlaying(null); positionCallback.current?.(null, "song", section); };
  useEffect(() => { setBpm(rhythm.bpm ?? 90); }, [rhythm.bpm]);
  useEffect(() => { setChord(previewChord); }, [previewChord]);
  useEffect(() => {
    stop();
    const hide = () => { if (document.hidden) stop(); };
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      const player = playerRef.current; playerRef.current = null; player?.stop(); positionCallback.current?.(null, "song", section);
    };
  }, [signature, section, strumSection, lyrics, sequence, transpose, bpm, chord, loop, countIn, metronome]);

  function performance(mode: PracticeMode) {
    return buildPracticePerformance({ ...rhythm, bpm }, { mode, annotations, section: mode === "strum" ? strumSection ?? section : section, lyrics, sequence, previewChord: chord, transpose, countIn, metronome, finish: !loop });
  }

  async function listen(mode: PracticeMode) {
    stop(); setError(null);
    let requestedPlayer: PracticeAudioPlayer | null = null;
    try {
      const music = performance(mode);
      const player = new PracticeAudioPlayer();
      requestedPlayer = player;
      playerRef.current = player;
      setBar(-1); setBarCount(music.bars.length); setPlaying(mode);
      await player.play(music, loop, (index) => { if (playerRef.current === player) setBar(index); }, () => {
        if (playerRef.current === player) { playerRef.current = null; setPlaying(null); positionCallback.current?.(null, mode, section); }
      }, position => { if (playerRef.current === player) positionCallback.current?.(position, mode, section); });
    } catch (cause) {
      if (requestedPlayer && playerRef.current !== requestedPlayer) return;
      stop(); setError(cause instanceof Error ? cause.message : "Could not start audio preview.");
    }
  }

  function download() {
    setError(null);
    try {
      const bytes = practiceMidi(performance(exportMode));
      const url = URL.createObjectURL(new Blob([new Uint8Array(bytes).buffer], { type: "audio/midi" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${title.replace(/[^a-z0-9_-]+/gi, "-")}-${exportMode}.mid`;
      document.body.appendChild(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not export MIDI."); }
  }

  return <div className="rhythm-practice-controls">
    <div className="rhythm-practice-actions">
      {playing ? <button aria-label="Stop practice playback" className="text-button" onClick={stop} type="button"><Square size={14} aria-hidden="true" />Stop</button> : <>
        <button aria-label="Listen to strumming pattern" className="text-button" onClick={() => void listen("strum")} type="button"><Play size={14} aria-hidden="true" />Listen strum</button>
        <button aria-label="Listen to selected part chords and strum" className="text-button" onClick={() => void listen("part")} type="button"><Play size={14} aria-hidden="true" />Listen {section === "Default" ? "chart" : section}</button>
        <button aria-label="Listen to whole song chords and strum" className="text-button" onClick={() => void listen("song")} type="button"><Play size={14} aria-hidden="true" />Listen song</button>
      </>}
      {playing ? <small role="status">{bar < 0 ? countIn ? "Count-in…" : "Starting…" : `Bar ${Math.min(bar + 1, barCount)} / ${barCount}`}</small> : null}
    </div>
    <details className="rhythm-playback-options">
      <summary>Tempo {bpm || "–"} · playback &amp; MIDI</summary>
    <div className="song-rhythm-fields">
      <label className="compact-field">Tempo<input aria-label="Practice tempo BPM" max={240} min={30} onChange={(event) => {
        const next = Number(event.target.value); setBpm(next); if (Number.isInteger(next) && next >= 30 && next <= 240) onTempoChange?.(next);
      }} type="number" value={bpm || ""} /> BPM</label>
      <label className="compact-field">Preview chord<input aria-label="Strum preview chord" maxLength={24} onChange={(event) => setChord(event.target.value)} value={chord} /></label>
    </div>
    <div className="rhythm-practice-options">
      <label><input checked={countIn} onChange={(event) => setCountIn(event.target.checked)} type="checkbox" />Count-in</label>
      <label><input checked={metronome} onChange={(event) => setMetronome(event.target.checked)} type="checkbox" />Metronome</label>
      <label><input checked={loop} onChange={(event) => setLoop(event.target.checked)} type="checkbox" />Loop</label>
    </div>
    <div className="song-rhythm-fields">
      <label className="compact-field">MIDI<select aria-label="MIDI export contents" onChange={(event) => setExportMode(event.target.value as PracticeMode)} value={exportMode}><option value="strum">Strum pattern</option><option value="part">Selected part / chart</option><option value="song">Whole song</option></select></label>
      <button aria-label="Download practice MIDI" className="text-button" onClick={download} type="button"><Download size={14} aria-hidden="true" />Download MIDI</button>
    </div>
    <small className="field-help">Synthesized practice audio. In 6/8 and 12/8, BPM counts the dotted-quarter pulse. Song playback uses the whole-song chart, or follows the lyric sequence through part charts.</small>
    </details>
    {error ? <p className="form-message" role="alert">{error}</p> : null}
  </div>;
}
