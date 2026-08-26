import { Radio, Volume2, VolumeX } from "lucide-react";

import type { BroadcastAudioScene, BroadcastAudioSource } from "../api";

interface AudioMixerPanelProps {
  compact?: boolean;
  disabled?: boolean;
  activeScene: string;
  automation: boolean;
  onAutomationChange: (enabled: boolean) => Promise<void> | void;
  onSceneChange: (sceneId: string) => Promise<void> | void;
  liveAudioSource: string;
  onChange: (sources: BroadcastAudioSource[]) => void;
  onCommit: (sources: BroadcastAudioSource[], liveAudioSource: string) => Promise<void> | void;
  sources: BroadcastAudioSource[];
  scenes: BroadcastAudioScene[];
}

function sourceWith(
  sources: BroadcastAudioSource[],
  sourceId: string,
  patch: Partial<BroadcastAudioSource>,
) {
  return sources.map((source) => source.id === sourceId ? { ...source, ...patch } : source);
}

export function AudioMixerPanel({
  compact = false,
  disabled = false,
  activeScene,
  automation,
  liveAudioSource,
  onChange,
  onCommit,
  onAutomationChange,
  onSceneChange,
  scenes,
  sources,
}: AudioMixerPanelProps) {
  function setGain(sourceId: string, gainDb: number, commit: boolean) {
    const next = sourceWith(sources, sourceId, { gain_db: gainDb });
    onChange(next);
    if (commit) void onCommit(next, liveAudioSource);
  }

  function toggleSource(sourceId: string, enabled: boolean) {
    const next = sourceWith(sources, sourceId, { mix_enabled: enabled });
    onChange(next);
    void onCommit(next, liveAudioSource);
  }

  if (!sources.length) {
    return <p className="muted-copy audio-mixer-empty">Add an independent audio source to build a mix.</p>;
  }

  return (
    <section className={`audio-mixer-panel ${compact ? "is-compact" : ""}`} aria-label="Broadcast source mixer">
      <header>
        <div>
          <strong>Source mix</strong>
          {!compact ? <small>Set each feed’s digital input trim, then combine the enabled feeds for livestream and recording.</small> : null}
        </div>
        <button
          aria-pressed={liveAudioSource === "mix"}
          className={liveAudioSource === "mix" ? "primary-button icon-text-button" : "text-button icon-text-button"}
          disabled={disabled || liveAudioSource === "mix" || !sources.some((source) => source.mix_enabled)}
          onClick={() => void onCommit(sources, "mix")}
          type="button"
        >
          <Radio size={14} aria-hidden="true" /> {liveAudioSource === "mix" ? "Mix live" : "Use mix"}
        </button>
      </header>
      <div className="audio-mixer-scenes" aria-label="Audio scenes">
        {scenes.map((scene) => (
          <button
            aria-pressed={activeScene === scene.id}
            className={activeScene === scene.id ? "primary-button" : "text-button"}
            disabled={disabled}
            key={scene.id}
            onClick={() => void onSceneChange(scene.id)}
            type="button"
          >
            {scene.label}
          </button>
        ))}
        {!compact ? (
          <label className="audio-scene-automation">
            <input checked={automation} disabled={disabled} onChange={(event) => void onAutomationChange(event.target.checked)} type="checkbox" />
            Follow presentation
          </label>
        ) : null}
      </div>
      <div className="audio-mixer-channels">
        {sources.map((source) => (
          <article className={!source.mix_enabled ? "is-muted" : ""} key={source.id}>
            <button
              aria-label={`${source.mix_enabled ? "Mute" : "Include"} ${source.label}`}
              aria-pressed={!source.mix_enabled}
              className="section-icon-button audio-mixer-mute"
              disabled={disabled}
              onClick={() => toggleSource(source.id, !source.mix_enabled)}
              title={source.mix_enabled ? "Mute in mix" : "Include in mix"}
              type="button"
            >
              {source.mix_enabled ? <Volume2 size={15} aria-hidden="true" /> : <VolumeX size={15} aria-hidden="true" />}
            </button>
            <label>
              <span><strong>{source.label}</strong><output>{source.gain_db > 0 ? "+" : ""}{source.gain_db} dB</output></span>
              <input
                aria-label={`${source.label} input level`}
                disabled={disabled}
                max={24}
                min={-30}
                onChange={(event) => setGain(source.id, Number(event.currentTarget.value), false)}
                onKeyUp={(event) => setGain(source.id, Number(event.currentTarget.value), true)}
                onPointerUp={(event) => setGain(source.id, Number(event.currentTarget.value), true)}
                step={1}
                type="range"
                value={source.gain_db}
              />
            </label>
          </article>
        ))}
      </div>
      {!compact ? <p>Changes are saved to the selected scene. Pastor and Worship follow service slides; Media follows play/stop controls. Use Congregation manually for someone speaking from their seat.</p> : null}
    </section>
  );
}
