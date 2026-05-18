import { Camera, Circle, Download, Music, Play, Radio, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";

import {
  ApiError,
  broadcastRecordingAudioUrl,
  broadcastRecordingDownloadUrl,
  broadcastRecordingVideoUrl,
  createBroadcastRecordingAudio,
  getBroadcastRecordings,
  getObsStatus,
  runObsAction,
  scanBroadcastRecordings,
  type BroadcastRecording,
  type ObsStatus,
} from "../api";

function statusLabel(status: ObsStatus | null) {
  if (!status) {
    return "Checking OBS";
  }
  if (!status.configured) {
    return "Not configured";
  }
  if (!status.connected) {
    return "Offline";
  }
  return "Connected";
}

function timecode(value: string | null) {
  if (!value) {
    return "00:00:00";
  }
  return value.split(".")[0] ?? value;
}

function formatBytes(value: number | null) {
  if (!value) {
    return "Unknown size";
  }
  const units = ["B", "KB", "MB", "GB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDate(value: string | null) {
  if (!value) {
    return "No date";
  }
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function BroadcastManager() {
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [recordings, setRecordings] = useState<BroadcastRecording[]>([]);
  const [selectedRecordingId, setSelectedRecordingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [busyRecordingId, setBusyRecordingId] = useState<string | null>(null);

  async function refresh() {
    try {
      setMessage(null);
      const [nextStatus, nextRecordings] = await Promise.all([getObsStatus(), getBroadcastRecordings()]);
      setStatus(nextStatus);
      setRecordings(nextRecordings);
      setSelectedRecordingId((current) => current ?? nextRecordings[0]?.id ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not check OBS.");
    }
  }

  async function trigger(action: Parameters<typeof runObsAction>[0]) {
    setBusyAction(action);
    try {
      const response = await runObsAction(action);
      setStatus(response.status);
      setMessage(response.output_path ? `Saved recording to ${response.output_path}` : null);
      if (action === "stop-recording") {
        const nextRecordings = await getBroadcastRecordings();
        setRecordings(nextRecordings);
        setSelectedRecordingId(nextRecordings[0]?.id ?? null);
      }
    } catch (error) {
      const fallback =
        error instanceof ApiError && error.status === 403
          ? "Your account does not have broadcast permission."
          : "OBS could not complete that action.";
      setMessage(error instanceof Error ? error.message : fallback);
      await refresh();
    } finally {
      setBusyAction(null);
    }
  }

  async function scanLibrary() {
    setBusyAction("scan-recordings");
    try {
      const response = await scanBroadcastRecordings();
      setRecordings(response.recordings);
      setSelectedRecordingId((current) => current ?? response.recordings[0]?.id ?? null);
      setMessage(response.added ? `Added ${response.added} recording${response.added === 1 ? "" : "s"}.` : "Recording library is up to date.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not scan recordings.");
    } finally {
      setBusyAction(null);
    }
  }

  async function createAudio(recordingId: string) {
    setBusyRecordingId(recordingId);
    try {
      const updated = await createBroadcastRecordingAudio(recordingId);
      setRecordings((current) => current.map((recording) => (recording.id === updated.id ? updated : recording)));
      setMessage("MP3 audio is ready.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not create MP3 audio.");
    } finally {
      setBusyRecordingId(null);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const connected = Boolean(status?.connected);
  const selectedRecording =
    recordings.find((recording) => recording.id === selectedRecordingId) ?? recordings[0] ?? null;

  return (
    <section className="broadcast-workspace" aria-label="Broadcast controls">
      <div className="broadcast-card broadcast-hero-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Church Computer</p>
            <h2>OBS Broadcast</h2>
          </div>
          <button className="text-button icon-text-button" onClick={() => void refresh()} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
        </div>

        <div className={`broadcast-status-pill ${connected ? "online" : "offline"}`}>
          <Circle size={12} aria-hidden="true" />
          <strong>{statusLabel(status)}</strong>
          {status?.host ? <span>{status.host}:{status.port}</span> : null}
        </div>

        {message ? <p className="form-message">{message}</p> : null}
        {status?.error ? <p className="form-message">{status.error}</p> : null}

        {!status?.configured ? (
          <div className="empty-state broadcast-empty-state">
            <strong>OBS is not configured yet.</strong>
            <span>Set `OBS_WEBSOCKET_HOST`, `OBS_WEBSOCKET_PORT`, and `OBS_WEBSOCKET_PASSWORD` in the API environment, then rebuild/restart.</span>
          </div>
        ) : null}

        <div className="broadcast-grid">
          <article className="broadcast-meter">
            <p className="eyebrow">Recording</p>
            <strong>{status?.recording ? "Recording" : "Stopped"}</strong>
            <span>{timecode(status?.recording_timecode ?? null)}</span>
            <div className="action-row">
              <button
                className="primary-button icon-text-button"
                disabled={!connected || status?.recording || busyAction !== null}
                onClick={() => void trigger("start-recording")}
                type="button"
              >
                <Circle size={14} aria-hidden="true" />
                Start
              </button>
              <button
                className="text-button icon-text-button"
                disabled={!connected || !status?.recording || busyAction !== null}
                onClick={() => void trigger("stop-recording")}
                type="button"
              >
                <Square size={14} aria-hidden="true" />
                Stop
              </button>
            </div>
          </article>

          <article className="broadcast-meter">
            <p className="eyebrow">Stream</p>
            <strong>{status?.streaming ? "Live" : "Stopped"}</strong>
            <span>{timecode(status?.streaming_timecode ?? null)}</span>
            <div className="action-row">
              <button
                className="primary-button icon-text-button"
                disabled={!connected || status?.streaming || busyAction !== null}
                onClick={() => void trigger("start-streaming")}
                type="button"
              >
                <Radio size={14} aria-hidden="true" />
                Start
              </button>
              <button
                className="text-button icon-text-button"
                disabled={!connected || !status?.streaming || busyAction !== null}
                onClick={() => void trigger("stop-streaming")}
                type="button"
              >
                <Square size={14} aria-hidden="true" />
                Stop
              </button>
            </div>
          </article>

          <article className="broadcast-meter">
            <p className="eyebrow">Virtual Camera</p>
            <strong>{status?.virtual_camera ? "On" : "Off"}</strong>
            <span>Use this as the camera in Zoom while you transition.</span>
            <div className="action-row">
              <button
                className="primary-button icon-text-button"
                disabled={!connected || status?.virtual_camera || busyAction !== null}
                onClick={() => void trigger("start-virtual-camera")}
                type="button"
              >
                <Camera size={14} aria-hidden="true" />
                Start
              </button>
              <button
                className="text-button icon-text-button"
                disabled={!connected || !status?.virtual_camera || busyAction !== null}
                onClick={() => void trigger("stop-virtual-camera")}
                type="button"
              >
                <Square size={14} aria-hidden="true" />
                Stop
              </button>
            </div>
          </article>
        </div>
      </div>

      <div className="broadcast-card">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Library</p>
            <h3>Recordings</h3>
          </div>
          <button
            className="text-button icon-text-button"
            disabled={busyAction !== null}
            onClick={() => void scanLibrary()}
            type="button"
          >
            <RefreshCw size={16} aria-hidden="true" />
            Scan Folder
          </button>
        </div>

        {recordings.length === 0 ? (
          <div className="empty-state broadcast-empty-state">
            <strong>No recordings registered yet.</strong>
            <span>Stop an OBS recording, or scan the configured recordings folder.</span>
          </div>
        ) : (
          <div className="broadcast-library">
            <div className="broadcast-recording-list" aria-label="Recordings">
              {recordings.map((recording) => (
                <button
                  className={`broadcast-recording-row ${recording.id === selectedRecording?.id ? "selected" : ""}`}
                  key={recording.id}
                  onClick={() => setSelectedRecordingId(recording.id)}
                  type="button"
                >
                  <strong>{recording.title}</strong>
                  <span>{formatDate(recording.recorded_at)} · {formatBytes(recording.size_bytes)}</span>
                </button>
              ))}
            </div>

            {selectedRecording ? (
              <article className="broadcast-player">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Selected Recording</p>
                    <h3>{selectedRecording.title}</h3>
                  </div>
                  <a
                    className="text-button icon-text-button"
                    href={broadcastRecordingDownloadUrl(selectedRecording.id)}
                  >
                    <Download size={16} aria-hidden="true" />
                    Video
                  </a>
                </div>

                {selectedRecording.media_kind === "video" ? (
                  <video
                    className="broadcast-video"
                    controls
                    preload="metadata"
                    src={broadcastRecordingVideoUrl(selectedRecording.id)}
                  />
                ) : (
                  <audio controls src={broadcastRecordingVideoUrl(selectedRecording.id)} />
                )}

                <div className="action-row">
                  {selectedRecording.has_audio ? (
                    <>
                      <audio controls src={broadcastRecordingAudioUrl(selectedRecording.id)} />
                      <a className="text-button icon-text-button" href={broadcastRecordingAudioUrl(selectedRecording.id)}>
                        <Download size={16} aria-hidden="true" />
                        MP3
                      </a>
                    </>
                  ) : (
                    <button
                      className="text-button icon-text-button"
                      disabled={busyRecordingId === selectedRecording.id}
                      onClick={() => void createAudio(selectedRecording.id)}
                      type="button"
                    >
                      {busyRecordingId === selectedRecording.id ? (
                        <RefreshCw size={16} aria-hidden="true" />
                      ) : (
                        <Music size={16} aria-hidden="true" />
                      )}
                      Create MP3
                    </button>
                  )}
                  <a className="text-button icon-text-button" href={broadcastRecordingVideoUrl(selectedRecording.id)}>
                    <Play size={16} aria-hidden="true" />
                    Open
                  </a>
                </div>
              </article>
            ) : null}
          </div>
        )}
      </div>

      <div className="broadcast-card">
        <p className="eyebrow">Workflow</p>
        <h3>Sunday Morning</h3>
        <div className="broadcast-checklist">
          <span>OBS open on the church computer</span>
          <span>Mic and camera sources visible in OBS</span>
          <span>Start recording before sermon</span>
          <span>Start virtual camera or stream for remote viewers</span>
        </div>
      </div>
    </section>
  );
}
