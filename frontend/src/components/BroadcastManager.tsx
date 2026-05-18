import { Camera, Circle, Radio, RefreshCw, Square } from "lucide-react";
import { useEffect, useState } from "react";

import { ApiError, getObsStatus, runObsAction, type ObsStatus } from "../api";

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

export function BroadcastManager() {
  const [status, setStatus] = useState<ObsStatus | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  async function refresh() {
    try {
      setMessage(null);
      setStatus(await getObsStatus());
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

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(timer);
  }, []);

  const connected = Boolean(status?.connected);

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
