import { Save, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getRhythmPresets } from '../api';
import { resizeStrumPattern, STRUM_PRESETS, STROKE_CYCLE, STROKE_NAMES, STROKE_SYMBOLS, strumCounts, type BarRhythmChange, type RhythmPreset, type SongRhythm, type StrumPattern } from '../songRhythm';
import { useEscapeClose } from './useEscapeClose';

export function BarRhythmEditor({ value, songRhythm, onSave, onRemove, onClose }: {
  value: BarRhythmChange; songRhythm: SongRhythm;
  onSave: (change: BarRhythmChange | undefined) => string | void; onRemove: () => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [library, setLibrary] = useState<RhythmPreset[]>([]);
  useEscapeClose(true, onClose, 10);
  useEffect(() => { let active = true; void getRhythmPresets().then(presets => { if (active) setLibrary(presets); }).catch(() => {}); return () => { active = false; }; }, []);
  function meter(numerator: number, denominator: SongRhythm['denominator']) {
    setDraft(current => ({ ...current, numerator, denominator, pattern: current.pattern ? resizeStrumPattern(current.pattern, numerator) : null }));
  }
  function pattern(value: string) {
    const preset = STRUM_PRESETS.find(preset => preset.id === value);
    const saved = library.find(preset => preset.id === value && preset.kind === 'strum');
    const chosen: StrumPattern | null = value === 'new' ? { section: 'Default', bars: 1, subdivision: 1, strokes: Array.from({ length: draft.numerator }, () => 'D') } : preset ? { name: preset.name, section: 'Default', subdivision: preset.subdivision, bars: 1, strokes: [...preset.strokes] }
      : saved?.strokes && saved.subdivision ? { name: saved.name, section: 'Default', subdivision: saved.subdivision, bars: saved.strokes.length / (saved.numerator * saved.subdivision) as 1 | 2, strokes: [...saved.strokes] } : null;
    setDraft(current => ({ ...current, pattern: chosen }));
  }
  const counts = draft.pattern ? strumCounts({ ...songRhythm, ...draft }, draft.pattern) : [];
  return <div className="app-dialog-backdrop" role="presentation" onMouseDown={onClose}>
    <section className="app-dialog bar-rhythm-dialog" role="dialog" aria-modal="true" aria-labelledby="bar-rhythm-title" onMouseDown={event => event.stopPropagation()}>
      <div className="section-heading"><h2 id="bar-rhythm-title">Bar settings</h2><button type="button" aria-label="Close bar settings" title="Close" onClick={onClose}><X size={16} /></button></div>
      <div className="action-row">
        <label className="compact-field">Beats<select aria-label="Bar beats" value={draft.numerator} onChange={event => meter(Number(event.target.value), draft.denominator)}>{Array.from({ length: 12 }, (_, i) => <option key={i + 1}>{i + 1}</option>)}</select></label>
        <label className="compact-field">Unit<select aria-label="Bar beat unit" value={draft.denominator} onChange={event => meter(draft.numerator, Number(event.target.value) as SongRhythm['denominator'])}>{[2, 4, 8, 16].map(unit => <option key={unit}>{unit}</option>)}</select></label>
        <button type="button" onClick={() => { meter(songRhythm.numerator, songRhythm.denominator); setDraft(current => ({ ...current, pattern: null })); }}>Song defaults</button>
      </div>
      <label className="compact-field">Pattern<select aria-label="Bar strumming pattern" value={draft.pattern ? 'custom' : ''} onChange={event => pattern(event.target.value)}>
        <option value="">Use section pattern</option><option value="new">Custom pattern…</option>{draft.pattern ? <option value="custom">{draft.pattern.name || 'Custom pattern'}</option> : null}
        {STRUM_PRESETS.filter(preset => preset.numerator === draft.numerator && preset.denominator === draft.denominator).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        {library.filter(preset => preset.kind === 'strum' && preset.numerator === draft.numerator && preset.denominator === draft.denominator).map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
      </select></label>
      {draft.pattern ? <>
        <label className="compact-field">Subdivision<select aria-label="Bar pattern subdivision" value={draft.pattern.subdivision} onChange={event => setDraft(current => ({ ...current, pattern: resizeStrumPattern(current.pattern!, current.numerator, Number(event.target.value) as 1 | 2 | 4) }))}>{[1, 2, 4].map(value => <option key={value}>{value}</option>)}</select></label>
        <div className="bar-rhythm-strokes">{draft.pattern.strokes.map((stroke, index) => <button type="button" key={index} aria-label={`Bar stroke ${index + 1}: ${STROKE_NAMES[stroke]}`} title={STROKE_NAMES[stroke]} onClick={() => setDraft(current => ({ ...current, pattern: { ...current.pattern!, strokes: current.pattern!.strokes.map((value, i) => i === index ? STROKE_CYCLE[(STROKE_CYCLE.indexOf(value) + 1) % STROKE_CYCLE.length] : value) } }))}><small>{counts[index]}</small>{STROKE_SYMBOLS[stroke]}</button>)}</div>
      </> : null}
      <label className="compact-field">Apply<select aria-label="Bar change duration" value={draft.scope} onChange={event => setDraft(current => ({ ...current, scope: event.target.value as BarRhythmChange['scope'] }))}><option value="bar">This bar only</option><option value="continue">Continue until next change</option></select></label>
      <p className="field-help">A one-bar change returns to the previous settings. Continuing changes follow the lyric chart; repeated sections use their saved bar settings. The quarter-note tempo stays steady.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="action-row">
        <button type="button" onClick={() => setError(onSave(draft) || null)}><Save size={14} aria-hidden="true" />Apply</button>
        <button type="button" onClick={() => setError(onSave(undefined) || null)}>Clear change</button>
        <button type="button" onClick={onRemove}><Trash2 size={14} aria-hidden="true" />Remove bar</button>
      </div>
    </section>
  </div>;
}
