import { CircleStop, Mic, Play, Save, Trash2 } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  getBroadcastViewerSettings,
  deleteBroadcastRecording,
  getBroadcastRecordings,
  getLivePresentationServices,
  startBroadcastRecording,
  stopBroadcastRecording,
  updateBroadcastViewerSettings,
  type BroadcastViewerSettings,
  type BroadcastRecording,
  type PresentationLiveService,
} from "../api";
import { recordingTimestampTitle, SermonRecordingPlayer } from "./SermonRecordingPlayer";
import { useConfirmationDialog } from "./ConfirmationDialog";

const EMPTY_SETTINGS: BroadcastViewerSettings = {
  camera_url: null,
  live_audio_url: null,
  offline_message: "No service is streaming right now",
  pre_service_audio_url: null,
  pre_service_minutes: 60,
  starting_soon_message: "Our service will begin shortly",
  stream_description: "Join us online for worship, prayer, Scripture, and teaching.",
  stream_title: "Sunday Service",
};

export function formatRecordingSize(sizeBytes: number | null) {
  if (!sizeBytes) return null;
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / 1024 / 1024).toFixed(1)} MB`;
}

export function BroadcastManager() {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [form, setForm] = useState<BroadcastViewerSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<BroadcastRecording[]>([]);
  const [liveService, setLiveService] = useState<PresentationLiveService | null>(null);
  const [recordingAction, setRecordingAction] = useState(false);
  const [playingRecording, setPlayingRecording] = useState<BroadcastRecording | null>(null);

  useEffect(() => {
    void getBroadcastViewerSettings()
      .then(setForm)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load viewer settings."))
      .finally(() => setLoading(false));
  }, []);

  async function loadRecordings() {
    const [nextRecordings, liveServices] = await Promise.all([
      getBroadcastRecordings(),
      getLivePresentationServices(),
    ]);
    setRecordings(nextRecordings);
    setLiveService(liveServices[0] ?? null);
  }

  useEffect(() => {
    void loadRecordings().catch(() => undefined);
    const timer = window.setInterval(() => void loadRecordings().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const activeRecording = recordings.find((recording) => recording.status === "recording" || recording.status === "paused") ?? null;

  async function startRecording() {
    if (!liveService) return;
    setRecordingAction(true);
    try {
      await startBroadcastRecording({
        plan_id: liveService.plan_id,
        plan_item_id: liveService.plan_item_id,
      });
      await loadRecordings();
      setMessage("Sermon recording started.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start recording.");
    } finally {
      setRecordingAction(false);
    }
  }

  async function stopRecording() {
    setRecordingAction(true);
    try {
      await stopBroadcastRecording();
      await loadRecordings();
      setMessage("Sermon recording saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not stop recording.");
    } finally {
      setRecordingAction(false);
    }
  }

  async function removeRecording(recording: BroadcastRecording) {
    const confirmed = await confirm({
      confirmLabel: "Delete recording",
      message: `Permanently delete the recording from ${recordingTimestampTitle(recording)}?`,
      title: "Delete sermon recording",
      tone: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteBroadcastRecording(recording.id);
      await loadRecordings();
      setMessage("Recording deleted.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete recording.");
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      setForm(await updateBroadcastViewerSettings(form));
      setMessage("Viewer settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save viewer settings.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="broadcast-settings" onSubmit={(event) => void save(event)}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Broadcast</p>
          <h2>Viewer settings</h2>
        </div>
        <button className="primary-button icon-text-button" disabled={loading || saving} type="submit">
          <Save size={15} aria-hidden="true" />
          {saving ? "Saving…" : "Save"}
        </button>
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      <div className="broadcast-settings-grid">
        <label>
          Stream title
          <input disabled={loading} onChange={(event) => setForm({ ...form, stream_title: event.target.value })} value={form.stream_title} />
        </label>
        <label>
          Starting-soon window
          <span className="input-with-suffix">
            <input
              disabled={loading}
              max={180}
              min={0}
              onChange={(event) => setForm({ ...form, pre_service_minutes: Number(event.target.value) })}
              type="number"
              value={form.pre_service_minutes}
            />
            <span>minutes</span>
          </span>
        </label>
        <label className="wide-field">
          Stream description
          <textarea disabled={loading} onChange={(event) => setForm({ ...form, stream_description: event.target.value || null })} value={form.stream_description || ""} />
        </label>
        <label className="wide-field">
          Camera or livestream URL
          <input
            disabled={loading}
            inputMode="url"
            onChange={(event) => setForm({ ...form, camera_url: event.target.value || null })}
            placeholder="/app/camera/api/stream.m3u8?src=…"
            type="text"
            value={form.camera_url || ""}
          />
          <small>Use an HTTPS URL or an app-relative camera proxy path.</small>
        </label>
        <label className="wide-field">
          Live audio stream URL
          <input
            disabled={loading}
            inputMode="url"
            onChange={(event) => setForm({ ...form, live_audio_url: event.target.value || null })}
            placeholder="https://audio-host.example/cspot.mp3"
            type="text"
            value={form.live_audio_url || ""}
          />
          <small>Audio from a Raspberry Pi or desk feed. This is preferred for live playback and sermon recording.</small>
        </label>
        <label className="wide-field">
          Pre-service worship audio or YouTube URL
          <input disabled={loading} onChange={(event) => setForm({ ...form, pre_service_audio_url: event.target.value || null })} placeholder="YouTube link or https://…/music.mp3" type="url" value={form.pre_service_audio_url || ""} />
        </label>
        <label>
          Starting-soon message
          <input disabled={loading} onChange={(event) => setForm({ ...form, starting_soon_message: event.target.value })} value={form.starting_soon_message} />
        </label>
        <label>
          Offline message
          <input disabled={loading} onChange={(event) => setForm({ ...form, offline_message: event.target.value })} value={form.offline_message} />
        </label>
      </div>
      <p className="muted-copy broadcast-settings-note">
        Live media and the slideshow appear only while the presenter slideshow is running. Pre-service audio is offered during the configured window before the next scheduled service.
      </p>

      <section className="broadcast-recordings" aria-label="Sermon recordings">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audio + slides</p>
            <h2>Sermon recordings</h2>
          </div>
          {activeRecording ? (
            <button className="danger-button icon-text-button" disabled={recordingAction} onClick={() => void stopRecording()} type="button">
              <CircleStop size={15} aria-hidden="true" /> Stop recording
            </button>
          ) : (
            <button className="primary-button icon-text-button" disabled={!liveService || recordingAction} onClick={() => void startRecording()} type="button">
              <Mic size={15} aria-hidden="true" /> Record now
            </button>
          )}
        </div>
        <p className="muted-copy">
          Recording starts automatically on sermon sections and stores compact mono audio with synchronized slide timings.
        </p>
        <div className="broadcast-recording-list">
          {recordings.length ? recordings.map((recording) => (
            <article className="broadcast-recording-row" key={recording.id}>
              <div>
                <strong>{recordingTimestampTitle(recording)}</strong>
                <span>{recording.status === "recording" || recording.status === "paused"
                  ? recording.status === "paused" ? "Recording paused" : "Recording now"
                  : [
                      `${Math.round((recording.duration_seconds ?? 0) / 60)} min`,
                      formatRecordingSize(recording.size_bytes),
                      `${recording.timeline.length} slide changes`,
                    ].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="broadcast-recording-actions">
                {recording.status === "ready" ? (
                  <button className="text-button icon-text-button" onClick={() => setPlayingRecording(recording)} type="button">
                    <Play size={15} aria-hidden="true" /> Play sermon
                  </button>
                ) : <span className={`status-badge ${recording.status}`}>{recording.status}</span>}
                {recording.status !== "recording" && recording.status !== "paused" ? (
                  <button aria-label="Delete recording" className="danger-button" onClick={() => void removeRecording(recording)} title="Delete recording" type="button">
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </article>
          )) : <p className="muted-copy">No sermon recordings yet.</p>}
        </div>
      </section>
      {playingRecording ? <SermonRecordingPlayer onClose={() => setPlayingRecording(null)} recording={playingRecording} /> : null}
      {confirmationDialog}
    </form>
  );
}
