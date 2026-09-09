import { useRef, useState } from "react";
import { broadcastRecordingAudioUrl, trimBroadcastRecording, type BroadcastRecording } from "../api";

export function recordingTime(seconds: number) {
  const value = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

export function parseRecordingTime(value: string): number {
  if (!/^\d+:[0-5]\d(?:\.\d{1,3})?$/.test(value.trim())) return NaN;
  const [minutes, seconds] = value.trim().split(":").map(Number);
  return minutes * 60 + seconds;
}

export function RecordingTransport({ recording, canManage = false, onTimeChange, onTrimmed }: {
  recording: BroadcastRecording;
  canManage?: boolean;
  onTimeChange: (seconds: number) => void;
  onTrimmed?: (recording: BroadcastRecording) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const previewEnd = useRef<number | null>(null);
  const [duration, setDuration] = useState(recording.duration_seconds ?? 0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimOpen, setTrimOpen] = useState(false);
  const [start, setStart] = useState("0:00");
  const [end, setEnd] = useState(recordingTime(duration));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const startSeconds = parseRecordingTime(start);
  const endSeconds = parseRecordingTime(end);
  const validTrim = Number.isFinite(startSeconds) && Number.isFinite(endSeconds)
    && startSeconds >= 0 && endSeconds <= duration && endSeconds - startSeconds >= 1;

  function seek(value: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(value)) return;
    previewEnd.current = null;
    const nextTime = Math.max(0, Math.min(duration, value));
    audio.currentTime = nextTime;
    setTime(nextTime);
    onTimeChange(nextTime);
  }

  async function play() {
    try { await audioRef.current?.play(); }
    catch { setMessage("Could not play audio. Please try again."); }
  }

  async function saveTrim() {
    if (!validTrim || saving) return;
    audioRef.current?.pause();
    previewEnd.current = null;
    setSaving(true);
    setMessage("");
    try {
      const copy = await trimBroadcastRecording(recording.id, startSeconds, endSeconds);
      setMessage("Trimmed copy saved. The original recording is still available.");
      setTrimOpen(false);
      onTrimmed?.(copy);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save trimmed copy.");
    } finally { setSaving(false); }
  }

  return <div className="recording-transport">
    <audio ref={audioRef} autoPlay preload="metadata" src={broadcastRecordingAudioUrl(recording.id)}
      onLoadedMetadata={(event) => {
        if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
      }}
      onDurationChange={(event) => {
        if (Number.isFinite(event.currentTarget.duration)) setDuration(event.currentTarget.duration);
      }}
      onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)}
      onError={() => setMessage("Could not load recording audio. Close the player and try again.")}
      onTimeUpdate={(event) => {
        const audio = event.currentTarget;
        if (previewEnd.current !== null && audio.currentTime >= previewEnd.current) {
          audio.pause();
          audio.currentTime = previewEnd.current;
          previewEnd.current = null;
        }
        setTime(audio.currentTime);
        onTimeChange(audio.currentTime);
      }} />
    <div className="recording-seek-row">
      <span>{recordingTime(time)}</span>
      <input aria-label="Seek recording" aria-valuetext={`${recordingTime(time)} of ${recordingTime(duration)}`}
        type="range" min={0} max={duration} step={0.1} value={time} disabled={!duration}
        onChange={(event) => seek(Number(event.target.value))} />
      <span>{recordingTime(duration)}</span>
    </div>
    <div className="action-row">
      <button type="button" className="text-button" disabled={!duration} onClick={() => seek(time - 30)} aria-label="Skip back 30 seconds">−30s</button>
      <button type="button" className="primary-button" onClick={() => {
        previewEnd.current = null;
        if (playing) audioRef.current?.pause(); else void play();
      }}>{playing ? "Pause" : "Play"}</button>
      <button type="button" className="text-button" disabled={!duration} onClick={() => seek(time + 30)} aria-label="Skip forward 30 seconds">+30s</button>
      <label>Speed <select aria-label="Playback speed" defaultValue="1" onChange={(event) => {
        if (audioRef.current) audioRef.current.playbackRate = Number(event.target.value);
      }}>{[0.75, 1, 1.25, 1.5, 2].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}</select></label>
      <label>Volume <input aria-label="Recording volume" type="range" min="0" max="1" step="0.05" defaultValue="1"
        onChange={(event) => { if (audioRef.current) audioRef.current.volume = Number(event.target.value); }} /></label>
      {canManage ? <button type="button" className="text-button" disabled={!duration || saving} onClick={() => {
        previewEnd.current = null;
        if (!trimOpen) { setStart("0:00"); setEnd(recordingTime(duration)); }
        setTrimOpen(!trimOpen);
      }}>{trimOpen ? "Cancel trim" : "Trim recording"}</button> : null}
    </div>
    {canManage && trimOpen ? <fieldset className="recording-trim" disabled={saving}>
      <legend>Keep this part of the recording</legend>
      <div className="action-row">
        <label>Start (m:ss) <input aria-label="Trim start" value={start} onChange={(event) => { previewEnd.current = null; setStart(event.target.value); }} /></label>
        <button className="text-button" type="button" onClick={() => setStart(recordingTime(time))}>Set start here</button>
        <label>End (m:ss) <input aria-label="Trim end" value={end} onChange={(event) => { previewEnd.current = null; setEnd(event.target.value); }} /></label>
        <button className="text-button" type="button" onClick={() => setEnd(recordingTime(time))}>Set end here</button>
      </div>
      <p>{validTrim ? `Keep ${recordingTime(endSeconds - startSeconds)}. The original will stay available.` : "Enter valid m:ss times, keeping at least one second within the recording."}</p>
      <div className="action-row">
        <button className="text-button" type="button" disabled={!validTrim} onClick={() => {
          seek(startSeconds); previewEnd.current = endSeconds; void play();
        }}>Preview selection</button>
        <button className="text-button" type="button" disabled={!validTrim} onClick={() => {
          seek(Math.max(startSeconds, endSeconds - 5)); previewEnd.current = endSeconds; void play();
        }}>Preview last 5 seconds</button>
        <button className="primary-button" type="button" disabled={!validTrim} onClick={() => void saveTrim()}>{saving ? "Saving trimmed copy…" : "Save trimmed copy"}</button>
      </div>
    </fieldset> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
