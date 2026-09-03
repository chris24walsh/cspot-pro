import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getBroadcastViewerSettings, updateBroadcastViewerSettings, type BroadcastAudioScene, type BroadcastAudioSource } from "../api";

function sceneId(label: string) {
  return label.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `scene-${Date.now()}`;
}

export function AudioSceneManager({ onMessage }: { onMessage: (message: string) => void }) {
  const [scenes, setScenes] = useState<BroadcastAudioScene[]>([]);
  const [sources, setSources] = useState<BroadcastAudioSource[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => { void getBroadcastViewerSettings().then((settings) => { setScenes(settings.audio_scenes); setSources(settings.audio_sources); }).catch((error) => onMessage(error instanceof Error ? error.message : "Could not load scenes.")); }, [onMessage]);

  function updateScene(index: number, patch: Partial<BroadcastAudioScene>) {
    setScenes((current) => current.map((scene, sceneIndex) => sceneIndex === index ? { ...scene, ...patch } : scene));
  }

  async function save() {
    setSaving(true);
    try {
      const settings = await updateBroadcastViewerSettings({ audio_scenes: scenes });
      setScenes(settings.audio_scenes);
      onMessage("Audio scenes saved.");
    } catch (error) { onMessage(error instanceof Error ? error.message : "Could not save scenes."); }
    finally { setSaving(false); }
  }

  return <section className="subsection-panel admin-settings-panel">
    <div className="section-heading"><div><p className="eyebrow">Presentation cues</p><h3>Audio scenes</h3></div><div className="action-row"><button className="text-button" onClick={() => { const label = `Scene ${scenes.length + 1}`; setScenes([...scenes, { id: sceneId(label), label, channels: {}, room_media_enabled: false }]); }} type="button"><Plus size={14} /> Add scene</button><button className="primary-button" disabled={saving} onClick={() => void save()} type="button"><Save size={14} /> {saving ? "Saving…" : "Save scenes"}</button></div></div>
    <p className="muted-copy">Slides can select any scene. Source switches control the livestream/recording mix; “play media in room” also sends that slide’s music to the church speakers.</p>
    <div className="stack">{scenes.map((scene, index) => <fieldset className="service-schedule-rule" key={scene.id}><legend>{scene.label}</legend><div className="broadcast-settings-grid"><label>Name<input maxLength={80} onChange={(event) => updateScene(index, { label: event.target.value })} value={scene.label} /></label><label className="toggle-row"><input checked={Boolean(scene.room_media_enabled)} onChange={(event) => updateScene(index, { room_media_enabled: event.target.checked })} type="checkbox" /> Play media in room</label>{sources.map((source) => { const channel = scene.channels[source.id] ?? { gain_db: source.gain_db, enabled: false }; return <div className="scene-source-control" key={source.id}><label className="toggle-row"><input checked={channel.enabled} onChange={(event) => updateScene(index, { channels: { ...scene.channels, [source.id]: { ...channel, enabled: event.target.checked } } })} type="checkbox" /> {source.label} in livestream</label><label>Gain ({channel.gain_db} dB)<input max={24} min={-30} onChange={(event) => updateScene(index, { channels: { ...scene.channels, [source.id]: { ...channel, gain_db: Number(event.target.value) } } })} type="range" value={channel.gain_db} /></label></div>; })}</div>{!['pastor','congregation','worship','media','pre_service','post_service'].includes(scene.id) ? <button className="danger-button" onClick={() => setScenes((current) => current.filter((_, sceneIndex) => sceneIndex !== index))} type="button"><Trash2 size={14} /> Remove</button> : null}</fieldset>)}</div>
  </section>;
}
