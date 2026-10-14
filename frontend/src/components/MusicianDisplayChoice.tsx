import type { ReactNode } from 'react';
export type MusicianDisplayMode = 'auto' | 'on' | 'off';
export function musicianDisplayVisible(mode: MusicianDisplayMode, playing: boolean, autoDefault = false) {
  return mode === 'on' || mode === 'auto' && (autoDefault || playing);
}
export function readMusicianDisplayMode(key: string, legacyKey?: string): MusicianDisplayMode {
  try {
    const stored = localStorage.getItem(key) ?? (legacyKey ? localStorage.getItem(legacyKey) : null);
    return stored === 'on' || stored === 'off' ? stored : 'auto';
  } catch { return 'auto'; }
}
export function MusicianDisplayChoice({ label, icon, value, onChange, binary = false, description, disabled = false }: {
  label: string; icon: ReactNode; binary?: boolean; description?: string; disabled?: boolean; value: MusicianDisplayMode; onChange: (mode: MusicianDisplayMode) => void;
}) {
  return <div className="musician-display-choice" role="group" aria-label={`${label} display`}>
    <span>{icon}{label}{description ? <small>{description}</small> : null}</span>
    <div>{(binary ? ['on', 'off'] as const : ['auto', 'on', 'off'] as const).map(mode => <button role="menuitemradio" aria-checked={binary ? (value !== 'off') === (mode === 'on') : value === mode} disabled={disabled} aria-label={`${label}: ${mode}`} onClick={() => onChange(mode)} type="button" key={mode}>{mode === 'auto' ? 'Auto' : mode === 'on' ? 'On' : 'Off'}</button>)}</div>
  </div>;
}
