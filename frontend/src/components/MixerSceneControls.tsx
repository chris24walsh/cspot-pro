import { useEffect, useRef, useState } from 'react';
import { mixerRequest } from '../xr18';
import type { MixerAutomationConfiguration } from './MixerAutomationPanel';

type SceneState = {
  configuration: MixerAutomationConfiguration;
  status: { scene_id: string | null; detail: string };
};

export function MixerSceneControls({ connected }: { connected: boolean }) {
  const [state, setState] = useState<SceneState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(false);
  const revision = useRef(0);
  const changing = useRef(false);
  useEffect(() => {
    alive.current = true;
    let polling = false;
    async function refresh() {
      if (polling || changing.current) return;
      polling = true;
      const version = revision.current;
      try {
        const response = await mixerRequest<SceneState>('/automation');
        if (alive.current && version === revision.current) {
          setState(response);
          setError('');
        }
      } catch (error) {
        if (alive.current && version === revision.current) setError(error instanceof Error ? error.message : 'Could not load mixer scenes');
      } finally { polling = false; }
    }
    void refresh();
    const timer = setInterval(() => void refresh(), 1500);
    return () => { alive.current = false; clearInterval(timer); };
  }, []);
  async function change(patch: { scene_id?: string; follow_service?: boolean }) {
    changing.current = true;
    revision.current += 1;
    setBusy(true);
    setError('');
    try {
      const response = await mixerRequest<SceneState>('/automation/control', 'PATCH', patch);
      if (alive.current) setState(response);
    } catch (error) {
      if (alive.current) setError(error instanceof Error ? error.message : 'Could not change mixer scene');
    } finally {
      changing.current = false;
      if (alive.current) setBusy(false);
    }
  }
  const cfg = state?.configuration;
  const selected = cfg?.manual_scene_id ?? state?.status?.scene_id ?? '';
  return <div className="xr-scene-controls" aria-label="Mixer scene controls">
    <label>Scene<select aria-label="Mixer scene" disabled={busy || !connected || !cfg?.enabled} value={selected}
      title="Apply a scene now. With Auto scenes on, the next service cue takes over."
      onChange={event => void change({ scene_id: event.target.value })}>
      <option value="" disabled>Select scene…</option>
      {cfg?.scenes?.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}
    </select></label>
    <label className="xr-auto-scenes"><input type="checkbox" role="switch" aria-label="Auto scenes"
      disabled={busy || !cfg?.enabled} checked={cfg?.follow_service ?? false}
      onChange={event => void change({ follow_service: event.target.checked })} />Auto scenes</label>
    {cfg && !cfg.enabled && <small>Enable hardware control in Audio scenes.</small>}
    {error && <span role="alert">{error}</span>}
  </div>;
}
