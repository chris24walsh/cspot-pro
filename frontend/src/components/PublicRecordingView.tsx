import { useEffect, useMemo, useState } from "react";

import {
  getPublicRecording,
  publicRecordingAssetUrl,
  type BroadcastRecording,
  type PublicRecording,
} from "../api";
import { RecordingTransport } from "./RecordingTransport";

export function PublicRecordingView({ token }: { token: string }) {
  const [recording, setRecording] = useState<PublicRecording | null>(null);
  const [time, setTime] = useState(0);
  const [message, setMessage] = useState("Loading recording…");

  useEffect(() => {
    void getPublicRecording(token)
      .then((value) => {
        setRecording(value);
        setMessage("");
      })
      .catch(() => setMessage("This recording is unavailable or its public link has been turned off."));
  }, [token]);

  const slide = useMemo(
    () => [...(recording?.slides ?? [])].reverse().find((candidate) => candidate.at <= time),
    [recording?.slides, time],
  );
  if (!recording) {
    return <main className="public-recording-shell"><section><p>{message}</p></section></main>;
  }
  const transportRecording = {
    id: token,
    title: recording.title,
    status: "ready",
    duration_seconds: recording.duration_seconds,
  } as BroadcastRecording;
  return (
    <main className="public-recording-shell">
      <section className="public-recording-card">
        <header>
          <p className="eyebrow">Sermon recording</p>
          <h1>{recording.title}</h1>
          {recording.recorded_at ? <time>{new Date(recording.recorded_at).toLocaleString()}</time> : null}
        </header>
        <div className="public-recording-stage">
          {slide ? <img alt="Sermon slide" src={publicRecordingAssetUrl(slide.image_url)} /> : null}
        </div>
        <RecordingTransport
          audioUrl={publicRecordingAssetUrl(recording.audio_url)}
          onTimeChange={setTime}
          recording={transportRecording}
        />
      </section>
    </main>
  );
}
