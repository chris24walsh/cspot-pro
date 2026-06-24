import { Save } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  getBroadcastViewerSettings,
  updateBroadcastViewerSettings,
  type BroadcastViewerSettings,
} from "../api";

const EMPTY_SETTINGS: BroadcastViewerSettings = {
  camera_url: null,
  offline_message: "No service is streaming right now",
  pre_service_audio_url: null,
  pre_service_minutes: 60,
  starting_soon_message: "Our service will begin shortly",
  stream_description: "Join us online for worship, prayer, Scripture, and teaching.",
  stream_title: "Sunday Service",
};

export function BroadcastManager() {
  const [form, setForm] = useState<BroadcastViewerSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    void getBroadcastViewerSettings()
      .then(setForm)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load viewer settings."))
      .finally(() => setLoading(false));
  }, []);

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
          <input disabled={loading} onChange={(event) => setForm({ ...form, camera_url: event.target.value || null })} placeholder="https://…" type="url" value={form.camera_url || ""} />
        </label>
        <label className="wide-field">
          Pre-service worship audio or stream URL
          <input disabled={loading} onChange={(event) => setForm({ ...form, pre_service_audio_url: event.target.value || null })} placeholder="https://…/music.mp3" type="url" value={form.pre_service_audio_url || ""} />
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
        The camera and slideshow appear only while the presenter slideshow is running. Pre-service audio is offered during the configured window before the next scheduled service.
      </p>
    </form>
  );
}
