import { CircleStop, ExternalLink, Headphones, Mic, MicOff, MonitorPlay, Play, Plus, Radio, Save, Trash2, X } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import {
  getBroadcastViewerSettings,
  broadcastAudioSourceTestUrl,
  deleteBroadcastRecording,
  getBroadcastRecordings,
  getLivePresentationServices,
  startBroadcastRecording,
  stopBroadcastRecording,
  updateManualLivestream,
  updateBroadcastViewerSettings,
  type BroadcastViewerSettings,
  type BroadcastRecording,
  type PresentationLiveService,
} from "../api";
import { go2RtcAudioStreamUrl } from "../broadcastCamera";
import { recordingTimestampTitle, SermonRecordingPlayer } from "./SermonRecordingPlayer";
import { AudioMixerPanel } from "./AudioMixerPanel";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { LiveStreamAudio, LowLatencyCamera } from "./LowLatencyCamera";

const EMPTY_SETTINGS: BroadcastViewerSettings = {
  auto_record_sermons: true,
  recording_grace_seconds: 60,
  camera_url: null,
  camera_sources: [],
  audio_sources: [],
  audio_scenes: [],
  active_audio_scene: "pastor",
  audio_scene_automation: true,
  active_camera_id: null,
  camera_cycle_seconds: 0,
  camera_cycle_started_at: null,
  camera_fade_ms: 1200,
  live_audio_url: null,
  live_audio_source: "none",
  live_audio_stream_name: null,
  manual_live_audience: "off",
  mixer_name: null,
  mixer_protocol: "none",
  mixer_control_url: null,
  mixer_notes: null,
  slide_delay_ms: 800,
  offline_message: "No service is streaming right now",
  pre_service_audio_url: null,
  pre_service_room_audio_enabled: true,
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

function recordingCountdown(deadline: string | null, now = Date.now()) {
  if (!deadline) return null;
  const seconds = Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function BroadcastManager({
  activeTab,
  canManage,
  onSelectTab,
}: {
  activeTab: "recordings" | "livestream" | "mixer";
  canManage: boolean;
  onSelectTab: (tab: "viewer" | "recordings" | "livestream" | "mixer") => void;
}) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [form, setForm] = useState<BroadcastViewerSettings>(EMPTY_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<BroadcastRecording[]>([]);
  const [liveService, setLiveService] = useState<PresentationLiveService | null>(null);
  const [recordingAction, setRecordingAction] = useState(false);
  const [autoRecordingAction, setAutoRecordingAction] = useState(false);
  const [livestreamAction, setLivestreamAction] = useState(false);
  const [playingRecording, setPlayingRecording] = useState<BroadcastRecording | null>(null);
  const [clock, setClock] = useState(Date.now());
  const [testingCameraId, setTestingCameraId] = useState<string | null>(null);
  const [testingAudioId, setTestingAudioId] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    void getBroadcastViewerSettings()
      .then(setForm)
      .catch((error) => setMessage(error instanceof Error ? error.message : "Could not load viewer settings."))
      .finally(() => setLoading(false));
  }, []);

  async function loadRecordings() {
    const [nextRecordings, liveServices] = await Promise.all([
      getBroadcastRecordings(),
      canManage ? getLivePresentationServices() : Promise.resolve([]),
    ]);
    setRecordings(nextRecordings);
    setLiveService(liveServices[0] ?? null);
  }

  useEffect(() => {
    void loadRecordings().catch(() => undefined);
    const timer = window.setInterval(() => void loadRecordings().catch(() => undefined), 5000);
    return () => window.clearInterval(timer);
  }, [canManage]);

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

  async function toggleAutomaticRecording() {
    const enabled = !form.auto_record_sermons;
    setAutoRecordingAction(true);
    setMessage(null);
    try {
      const settings = await updateBroadcastViewerSettings({ auto_record_sermons: enabled });
      setForm((current) => ({ ...current, auto_record_sermons: settings.auto_record_sermons }));
      setMessage(`Automatic sermon recording ${enabled ? "enabled" : "disabled"}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update automatic recording.");
    } finally {
      setAutoRecordingAction(false);
    }
  }

  async function setLivestreamAudience(audience: "off" | "public" | "admins") {
    setLivestreamAction(true);
    setMessage(null);
    try {
      const settings = await updateManualLivestream(audience);
      setForm((current) => ({ ...current, manual_live_audience: settings.manual_live_audience }));
      setMessage(
        audience === "public"
          ? "Livestream started for everyone."
          : audience === "admins"
            ? "Admin-only test livestream started."
            : "Livestream stopped.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the livestream.");
    } finally {
      setLivestreamAction(false);
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
    if (!canManage) return;
    setSaving(true);
    setMessage(null);
    try {
      setForm(await updateBroadcastViewerSettings(form));
      setMessage("Broadcast settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save viewer settings.");
    } finally {
      setSaving(false);
    }
  }

  function addCamera() {
    const id = `camera-${Date.now().toString(36)}`;
    setForm((current) => ({
      ...current,
      active_camera_id: current.active_camera_id ?? id,
      camera_sources: [...current.camera_sources, { id, label: `Camera ${current.camera_sources.length + 1}`, url: "" }],
    }));
  }

  function updateCamera(id: string, field: "label" | "url", value: string) {
    setForm((current) => ({
      ...current,
      camera_sources: current.camera_sources.map((source) => source.id === id ? { ...source, [field]: value } : source),
    }));
  }

  function removeCamera(id: string) {
    setForm((current) => {
      const camera_sources = current.camera_sources.filter((source) => source.id !== id);
      const active_camera_id = current.active_camera_id === id ? camera_sources[0]?.id ?? null : current.active_camera_id;
      const live_audio_source = current.live_audio_source === id ? current.audio_sources[0]?.id ?? camera_sources[0]?.id ?? "none" : current.live_audio_source;
      return { ...current, active_camera_id, camera_sources, live_audio_source };
    });
    setTestingCameraId((current) => current === id ? null : current);
  }

  function addAudioSource() {
    const id = `audio-${Date.now().toString(36)}`;
    setForm((current) => ({
      ...current,
      audio_sources: [
        ...current.audio_sources,
        {
          id,
          label: `Audio ${current.audio_sources.length + 1}`,
          stream_name: null,
          url: "",
          gain_db: 0,
          mix_enabled: true,
          role: "other",
        },
      ],
    }));
  }

  function updateAudioSource(id: string, field: "label" | "url" | "role", value: string) {
    setForm((current) => ({
      ...current,
      audio_sources: current.audio_sources.map((source) => source.id === id
        ? { ...source, [field]: value, ...(field === "url" ? { stream_name: null } : {}) }
        : source),
    }));
  }

  function removeAudioSource(id: string) {
    setForm((current) => {
      const audio_sources = current.audio_sources.filter((source) => source.id !== id);
      const live_audio_source = current.live_audio_source === id ? audio_sources[0]?.id ?? current.camera_sources[0]?.id ?? "none" : current.live_audio_source;
      return { ...current, audio_sources, live_audio_source };
    });
    setTestingAudioId((current) => current === id ? null : current);
  }

  async function testAudioSource(sourceId: string) {
    if (testingAudioId === sourceId) {
      setTestingAudioId(null);
      return;
    }
    setMessage(null);
    try {
      const settings = await updateBroadcastViewerSettings({
        audio_sources: form.audio_sources,
        live_audio_source: form.live_audio_source,
      });
      setForm((current) => ({ ...current, ...settings }));
      setTestingAudioId(sourceId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not test the audio source.");
    }
  }

  async function useAudioSource(sourceId: string) {
    setMessage(null);
    try {
      const settings = await updateBroadcastViewerSettings({
        audio_sources: form.audio_sources,
        live_audio_source: sourceId,
      });
      setForm((current) => ({ ...current, ...settings }));
      setMessage(`${settings.audio_sources.find((source) => source.id === sourceId)?.label ?? "Audio source"} is now live.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not change the live audio source.");
    }
  }

  async function commitAudioMix(
    audioSources: BroadcastViewerSettings["audio_sources"],
    liveAudioSource: string,
  ) {
    setSaving(true);
    setMessage(null);
    try {
      const settings = await updateBroadcastViewerSettings({
        audio_sources: audioSources,
        live_audio_source: liveAudioSource,
      });
      setForm((current) => ({ ...current, ...settings }));
      setMessage(liveAudioSource === "mix" ? "The source mix is now live." : "Audio mix updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update the source mix.");
    } finally {
      setSaving(false);
    }
  }

  async function putCameraOnAir(cameraId: string) {
    setMessage(null);
    try {
      const settings = await updateBroadcastViewerSettings({
        active_camera_id: cameraId,
        camera_sources: form.camera_sources,
      });
      setForm((current) => ({ ...current, ...settings }));
      setMessage(`${settings.camera_sources.find((source) => source.id === cameraId)?.label ?? "Camera"} is now on air.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not switch cameras.");
    }
  }

  return (
    <form className="broadcast-settings" onSubmit={(event) => void save(event)}>
      <div className="section-heading">
        <div>
          <p className="eyebrow">Broadcast</p>
          <h2>{canManage ? "Admin controls" : "Recordings"}</h2>
        </div>
        {canManage ? <button className="primary-button icon-text-button" disabled={loading || saving || autoRecordingAction} type="submit">
          <Save size={15} aria-hidden="true" />
          {saving ? "Saving…" : "Save"}
        </button> : null}
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      {canManage && activeTab === "livestream" ? <>
      <div className="broadcast-settings-grid" role="tabpanel" aria-label="Livestream settings">
        <section className={`wide-field broadcast-live-launch ${form.manual_live_audience !== "off" ? "is-live" : ""}`} aria-label="Livestream controls">
          <div>
            <strong>{form.manual_live_audience === "public" ? "Live for everyone" : form.manual_live_audience === "admins" ? "Admin test is live" : "Livestream is off"}</strong>
            <small>Start the camera and audio feed without starting the presenter slideshow.</small>
          </div>
          <div className="broadcast-live-launch-actions">
            <button
              className="primary-button icon-text-button"
              disabled={loading || livestreamAction || form.manual_live_audience === "public"}
              onClick={() => void setLivestreamAudience("public")}
              type="button"
            >
              <Radio size={14} aria-hidden="true" /> Start for everyone
            </button>
            <button
              className="text-button icon-text-button"
              disabled={loading || livestreamAction || form.manual_live_audience === "admins"}
              onClick={() => void setLivestreamAudience("admins")}
              type="button"
            >
              <MonitorPlay size={14} aria-hidden="true" /> Start admin test
            </button>
            <button
              className="danger-button icon-text-button"
              disabled={loading || livestreamAction || form.manual_live_audience === "off"}
              onClick={() => void setLivestreamAudience("off")}
              type="button"
            >
              <CircleStop size={14} aria-hidden="true" /> Stop livestream
            </button>
          </div>
        </section>
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
        <section className="wide-field broadcast-camera-settings" aria-label="Camera sources">
          <div className="broadcast-camera-settings-heading">
            <div>
              <strong>Camera sources</strong>
              <small>Sources stay warm so switching can cross-fade without waiting for a new stream.</small>
            </div>
            <button className="text-button icon-text-button" disabled={loading || form.camera_sources.length >= 8} onClick={addCamera} type="button">
              <Plus size={14} aria-hidden="true" /> Add camera
            </button>
          </div>
          <div className="broadcast-camera-source-list">
            {form.camera_sources.map((source) => (
              <article className={`broadcast-camera-source ${form.active_camera_id === source.id ? "is-on-air" : ""}`} key={source.id}>
                <input
                  aria-label="Camera name"
                  disabled={loading}
                  onChange={(event) => updateCamera(source.id, "label", event.target.value)}
                  placeholder="Lectern"
                  value={source.label}
                />
                <input
                  aria-label={`${source.label} stream URL`}
                  disabled={loading}
                  inputMode="url"
                  onChange={(event) => updateCamera(source.id, "url", event.target.value)}
                  placeholder="/app/camera/api/stream.m3u8?src=…"
                  type="text"
                  value={source.url}
                />
                <button
                  aria-pressed={testingCameraId === source.id}
                  className="text-button icon-text-button"
                  disabled={loading || !source.url}
                  onClick={() => setTestingCameraId((current) => current === source.id ? null : source.id)}
                  type="button"
                >
                  <MonitorPlay size={14} aria-hidden="true" /> {testingCameraId === source.id ? "Close" : "Test"}
                </button>
                <button
                  aria-pressed={form.active_camera_id === source.id}
                  className={form.active_camera_id === source.id ? "primary-button icon-text-button" : "text-button icon-text-button"}
                  disabled={loading || !source.url || form.active_camera_id === source.id}
                  onClick={() => void putCameraOnAir(source.id)}
                  type="button"
                >
                  <Radio size={14} aria-hidden="true" /> {form.active_camera_id === source.id ? "On air" : "Fade to"}
                </button>
                <button aria-label={`Remove ${source.label}`} className="section-icon-button" disabled={loading} onClick={() => removeCamera(source.id)} type="button">
                  <X size={15} aria-hidden="true" />
                </button>
                {testingCameraId === source.id ? (
                  <div className="broadcast-source-test broadcast-camera-test">
                    <LowLatencyCamera label={`${source.label} test preview`} url={source.url} />
                  </div>
                ) : null}
              </article>
            ))}
            {!form.camera_sources.length ? <p className="muted-copy">No camera sources configured.</p> : null}
          </div>
        </section>
        <section className="wide-field broadcast-camera-settings broadcast-audio-settings" aria-label="Audio sources">
          <div className="broadcast-camera-settings-heading">
            <div>
              <strong>Audio sources</strong>
              <small>Add room, desk, or church-PC playback feeds. Choosing PC media directly keeps desk rehearsals in-room and out of pre-service livestream audio.</small>
            </div>
            <button className="text-button icon-text-button" disabled={loading || form.audio_sources.length >= 8} onClick={addAudioSource} type="button">
              <Plus size={14} aria-hidden="true" /> Add audio
            </button>
          </div>
          <div className="broadcast-camera-source-list">
            {form.audio_sources.map((source) => (
              <article className={`broadcast-camera-source broadcast-audio-source ${form.live_audio_source === source.id ? "is-on-air" : ""}`} key={source.id}>
                <input
                  aria-label="Audio source name"
                  disabled={loading}
                  onChange={(event) => updateAudioSource(source.id, "label", event.target.value)}
                  placeholder="Desk feed"
                  value={source.label}
                />
                <input
                  aria-label={`${source.label} stream URL`}
                  disabled={loading}
                  inputMode="url"
                  onChange={(event) => updateAudioSource(source.id, "url", event.target.value)}
                  placeholder="http://audio-host:8091/audio/desk.mp3?token=…"
                  type="text"
                  value={source.url ?? ""}
                />
                <select
                  aria-label={`${source.label} role`}
                  disabled={loading}
                  onChange={(event) => updateAudioSource(source.id, "role", event.target.value)}
                  value={source.role ?? "other"}
                >
                  <option value="desk">Sound desk</option>
                  <option value="media">Church PC media</option>
                  <option value="room">Room microphone</option>
                  <option value="other">Other</option>
                </select>
                <button className="text-button icon-text-button" disabled={loading || !source.url} onClick={() => void testAudioSource(source.id)} type="button">
                  <Headphones size={14} aria-hidden="true" /> {testingAudioId === source.id ? "Stop" : "Listen"}
                </button>
                <button
                  aria-pressed={form.live_audio_source === source.id}
                  className={form.live_audio_source === source.id ? "primary-button icon-text-button" : "text-button icon-text-button"}
                  disabled={loading || !source.url || form.live_audio_source === source.id}
                  onClick={() => void useAudioSource(source.id)}
                  type="button"
                >
                  <Radio size={14} aria-hidden="true" /> {form.live_audio_source === source.id ? "Live" : "Use live"}
                </button>
                <button aria-label={`Remove ${source.label}`} className="section-icon-button" disabled={loading} onClick={() => removeAudioSource(source.id)} type="button">
                  <X size={15} aria-hidden="true" />
                </button>
                {testingAudioId === source.id ? (
                  <div className="broadcast-source-test broadcast-audio-test">
                    <LiveStreamAudio
                      label={`${source.label} test audio`}
                      url={
                        (source.stream_name
                          ? go2RtcAudioStreamUrl(source.stream_name)
                          : null) ?? broadcastAudioSourceTestUrl(source.id)
                      }
                    />
                  </div>
                ) : null}
              </article>
            ))}
            {!form.audio_sources.length ? <p className="muted-copy">No independent audio sources configured.</p> : null}
          </div>
        </section>
        <label>
          Base camera dwell
          <span className="input-with-suffix">
            <input disabled={loading} min={0} max={3600} onChange={(event) => setForm({ ...form, camera_cycle_seconds: Number(event.target.value) })} type="number" value={form.camera_cycle_seconds} />
            <span>seconds</span>
          </span>
          <small>Use 0 for manual controls. Sources named Lectern or Pulpit get more airtime, especially during prayer, sermons, and announcements; seeded variation keeps the pace natural.</small>
        </label>
        <label>
          Camera fade
          <span className="input-with-suffix">
            <input disabled={loading} min={0} max={10} step={0.1} onChange={(event) => setForm({ ...form, camera_fade_ms: Math.round(Number(event.target.value) * 1000) })} type="number" value={form.camera_fade_ms / 1000} />
            <span>seconds</span>
          </span>
        </label>
        <label>
          Slideshow delay
          <span className="input-with-suffix">
            <input disabled={loading} min={0} max={10} step={0.1} onChange={(event) => setForm({ ...form, slide_delay_ms: Math.round(Number(event.target.value) * 1000) })} type="number" value={form.slide_delay_ms / 1000} />
            <span>seconds</span>
          </span>
          <small>Delay slide changes to align them with the camera.</small>
        </label>
        <label>
          Live audio source
          <select disabled={loading} onChange={(event) => setForm({ ...form, live_audio_source: event.target.value })} value={form.live_audio_source}>
            <option value="none">No live audio</option>
            {form.audio_sources.some((source) => source.mix_enabled) ? <option value="mix">Source mix</option> : null}
            {form.audio_sources.length ? <optgroup label="Independent audio">
              {form.audio_sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
            </optgroup> : null}
            {form.camera_sources.length ? <optgroup label="Camera audio">
              {form.camera_sources.map((source) => <option key={source.id} value={source.id}>{source.label} camera</option>)}
            </optgroup> : null}
          </select>
        </label>
        <label className="wide-field">
          Pre-service worship audio or YouTube URL
          <input disabled={loading} onChange={(event) => setForm({ ...form, pre_service_audio_url: event.target.value || null })} placeholder="YouTube link or https://…/music.mp3" type="url" value={form.pre_service_audio_url || ""} />
        </label>
        <label>
          Church PC line-out
          <select disabled={loading} onChange={(event) => setForm({ ...form, pre_service_room_audio_enabled: event.target.value === "on" })} value={form.pre_service_room_audio_enabled ? "on" : "muted"}>
            <option value="on">Play through desk / speakers</option>
            <option value="muted">Muted during rehearsal</option>
          </select>
          <small>This affects only the presentation PC output. Online pre-service audio continues playing.</small>
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
        A presenter slideshow also starts the public stream automatically. The controls above can run camera and audio independently; admin test mode stays hidden from other viewers.
      </p>
      </> : null}

      {activeTab === "recordings" ? <section className="broadcast-recordings broadcast-tab-panel" aria-label="Sermon recordings" role="tabpanel">
        {canManage ? <label className="recording-grace-setting">
          <span>
            <strong>Automatic stop grace period</strong>
            <small>Keep one continuous audio file when briefly leaving the sermon, blanking, reaching End, or stopping the slideshow.</small>
          </span>
          <span className="input-with-suffix">
            <input disabled={loading} min={0} max={600} onChange={(event) => setForm({ ...form, recording_grace_seconds: Number(event.target.value) })} type="number" value={form.recording_grace_seconds} />
            <span>seconds</span>
          </span>
        </label> : null}
        <div className="section-heading">
          <div>
            <p className="eyebrow">Audio + slides</p>
            <h2>Sermon recordings</h2>
          </div>
          {canManage ? <div className="broadcast-recording-heading-actions">
            <button
              aria-pressed={form.auto_record_sermons}
              className={`${form.auto_record_sermons ? "text-button" : "primary-button"} icon-text-button`}
              disabled={loading || saving || autoRecordingAction}
              onClick={() => void toggleAutomaticRecording()}
              type="button"
            >
              {form.auto_record_sermons ? <MicOff size={15} aria-hidden="true" /> : <Mic size={15} aria-hidden="true" />}
              {autoRecordingAction ? "Updating…" : form.auto_record_sermons ? "Turn off auto-record" : "Turn on auto-record"}
            </button>
            {activeRecording ? (
              <button className="danger-button icon-text-button" disabled={recordingAction} onClick={() => void stopRecording()} type="button">
                <CircleStop size={15} aria-hidden="true" /> Stop recording
              </button>
            ) : (
              <button className="primary-button icon-text-button" disabled={!liveService || recordingAction} onClick={() => void startRecording()} type="button">
                <Mic size={15} aria-hidden="true" /> Record now
              </button>
            )}
          </div> : null}
        </div>
        <p className="muted-copy">
          {canManage ? (form.auto_record_sermons
            ? "Recording starts automatically on sermon sections and stores compact mono audio with synchronized slide timings."
            : "Automatic sermon recording is off. You can still start a recording manually with Record now.")
            : "Listen to saved sermon audio with its synchronized slides."}
        </p>
        <div className="broadcast-recording-list">
          {recordings.length ? recordings.map((recording) => (
            <article className="broadcast-recording-row" key={recording.id}>
              <div>
                <strong>{recordingTimestampTitle(recording)}</strong>
                <span>{recording.status === "recording" || recording.status === "paused"
                  ? recording.status === "paused"
                    ? "Recording paused"
                    : recording.pending_stop_at
                      ? `Recording continues · ending in ${recordingCountdown(recording.pending_stop_at, clock)} · ${recording.pending_stop_reason ?? "Left sermon"}`
                      : "Recording now"
                  : [
                      `${Math.round((recording.duration_seconds ?? 0) / 60)} min`,
                      formatRecordingSize(recording.size_bytes),
                      `${recording.timeline.length} slide changes`,
                      recording.end_reason ? `Ended: ${recording.end_reason}` : null,
                    ].filter(Boolean).join(" · ")}
                </span>
              </div>
              <div className="broadcast-recording-actions">
                {recording.status === "ready" ? (
                  <button className="text-button icon-text-button" onClick={() => setPlayingRecording(recording)} type="button">
                    <Play size={15} aria-hidden="true" /> Play sermon
                  </button>
                ) : <span className={`status-badge ${recording.status}`}>{recording.status}</span>}
                {canManage && recording.status !== "recording" && recording.status !== "paused" ? (
                  <button aria-label="Delete recording" className="danger-button" onClick={() => void removeRecording(recording)} title="Delete recording" type="button">
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </article>
          )) : <p className="muted-copy">No sermon recordings yet.</p>}
        </div>
      </section> : null}

      {canManage && activeTab === "mixer" ? (
        <section className="broadcast-mixer broadcast-tab-panel" aria-label="Musician audio mixer" role="tabpanel">
          <AudioMixerPanel
            activeScene={form.active_audio_scene}
            automation={form.audio_scene_automation}
            disabled={loading || saving}
            liveAudioSource={form.live_audio_source}
            onChange={(audio_sources) => setForm((current) => ({ ...current, audio_sources }))}
            onCommit={commitAudioMix}
            onAutomationChange={async (audio_scene_automation) => {
              const settings = await updateBroadcastViewerSettings({ audio_scene_automation });
              setForm((current) => ({ ...current, ...settings }));
            }}
            onSceneChange={async (active_audio_scene) => {
              const settings = await updateBroadcastViewerSettings({ active_audio_scene });
              setForm((current) => ({ ...current, ...settings }));
            }}
            scenes={form.audio_scenes}
            sources={form.audio_sources}
          />
          <div className="broadcast-mixer-heading">
            <div>
              <p className="eyebrow">Musician audio</p>
              <h2>Mixer desk integration</h2>
            </div>
            {form.mixer_control_url && (form.mixer_protocol === "web" || form.mixer_protocol === "bridge") ? (
              <a className="primary-button icon-text-button" href={form.mixer_control_url} rel="noreferrer" target="_blank">
                <ExternalLink size={15} aria-hidden="true" /> Open mixer controls
              </a>
            ) : null}
          </div>

          <div className="broadcast-settings-grid">
            <label>
              Integration type
              <select disabled={loading} onChange={(event) => setForm({ ...form, mixer_protocol: event.target.value as BroadcastViewerSettings["mixer_protocol"] })} value={form.mixer_protocol}>
                <option value="none">Not configured</option>
                <option value="web">Desk has browser controls</option>
                <option value="bridge">OSC/MIDI control bridge</option>
                <option value="audio-only">Audio capture only</option>
              </select>
            </label>
            <label>
              Mixer desk
              <input disabled={loading} onChange={(event) => setForm({ ...form, mixer_name: event.target.value || null })} placeholder="Make and model, e.g. Behringer X32" value={form.mixer_name || ""} />
            </label>
            <label className="wide-field">
              Desk or bridge control URL
              <input disabled={loading || form.mixer_protocol === "none" || form.mixer_protocol === "audio-only"} inputMode="url" onChange={(event) => setForm({ ...form, mixer_control_url: event.target.value || null })} placeholder="https://mixer-control.church.local" type="url" value={form.mixer_control_url || ""} />
              <small>Use the desk’s web interface, or an HTTPS control bridge on the church network. CSpot opens it separately so the manufacturer’s controls and safety limits remain intact.</small>
            </label>
            <label className="wide-field">
              Installation notes
              <textarea disabled={loading} onChange={(event) => setForm({ ...form, mixer_notes: event.target.value || null })} placeholder="Control VLAN, monitor bus assignments, interface input, or setup notes" value={form.mixer_notes || ""} />
            </label>
          </div>

          <div className="broadcast-mixer-paths">
            <article>
              <strong>Digital network desk</strong>
              <span>Connect the desk and control device to the same trusted LAN. Use its browser interface now, or a model-specific OSC/MIDI bridge for native CSpot faders.</span>
            </article>
            <article>
              <strong>Analogue desk</strong>
              <span>Send a dedicated aux or matrix output through a class-compliant USB audio interface to a Raspberry Pi. This supplies livestream and recording audio, but cannot remotely move analogue faders.</span>
            </article>
            <article>
              <strong>Native musician mixes</strong>
              <span>Channel faders, mute safety, and monitor-bus control require the desk make/model and the buses musicians may change. Save those details above before enabling a protocol adapter.</span>
            </article>
          </div>

          <div className="broadcast-mixer-route">
            <span>Current broadcast audio</span>
            <strong>{form.live_audio_source === "none"
              ? "No live audio"
              : form.live_audio_source === "mix"
                ? "Source mix"
              : form.audio_sources.find((source) => source.id === form.live_audio_source)?.label
                ?? `${form.camera_sources.find((source) => source.id === form.live_audio_source)?.label ?? form.live_audio_source} camera`}</strong>
            <button className="text-button" onClick={() => onSelectTab("livestream")} type="button">Change audio routing</button>
          </div>
        </section>
      ) : null}
      {playingRecording ? <SermonRecordingPlayer onClose={() => setPlayingRecording(null)} recording={playingRecording} /> : null}
      {confirmationDialog}
    </form>
  );
}
