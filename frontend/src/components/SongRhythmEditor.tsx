import { Music2, X } from "lucide-react";
import { useRef, useState } from "react";
import {
  resizeStrumPattern, STRUM_PRESETS, STRUM_SECTIONS, STROKE_CYCLE, STROKE_NAMES, STROKE_SYMBOLS,
  strumCounts, type SongRhythm, type StrumPattern, type StrumSection,
} from "../songRhythm";
import { useEscapeClose } from "./useEscapeClose";

const METERS = ["4/4", "3/4", "6/8", "2/4", "12/8"];
const emptyRhythm = (): SongRhythm => ({ numerator: 4, denominator: 4, patterns: [], notes: "" });

export function SongRhythmEditor({ value, canEdit, onChange }: {
  value: SongRhythm | null; canEdit: boolean; onChange: (value: SongRhythm | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<StrumSection>("Default");
  const [customMeter, setCustomMeter] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useEscapeClose(open, close, 1);
  const rhythm = value ?? emptyRhythm();
  const meter = `${rhythm.numerator}/${rhythm.denominator}`;
  const pattern = rhythm.patterns.find((entry) => entry.section === section)
    ?? { section, subdivision: rhythm.denominator === 8 ? 1 : 2, strokes: [] } as StrumPattern;
  const editablePattern = resizeStrumPattern(pattern, rhythm.numerator);
  const counts = strumCounts(rhythm, editablePattern);
  const presets = STRUM_PRESETS.filter((preset) => preset.numerator === rhythm.numerator && preset.denominator === rhythm.denominator);
  const selectedPreset = presets.find((preset) => preset.subdivision === pattern.subdivision && preset.strokes.join() === pattern.strokes.join());

  function updatePattern(next: StrumPattern) {
    const patterns = rhythm.patterns.filter((entry) => entry.section !== section).concat(next)
      .sort((a, b) => STRUM_SECTIONS.indexOf(a.section) - STRUM_SECTIONS.indexOf(b.section));
    onChange({ ...rhythm, patterns });
  }

  function updateMeter(numerator: number, denominator: SongRhythm["denominator"]) {
    onChange({ ...rhythm, numerator, denominator, patterns: rhythm.patterns.map((entry) => resizeStrumPattern(entry, numerator)) });
  }

  return (
    <>
      <button aria-label="Song rhythm" aria-expanded={open} className={`section-icon-button section-edit-button song-rhythm-trigger ${value ? "is-active" : ""}`}
        onClick={() => setOpen((current) => !current)} ref={triggerRef} title="Meter and strumming patterns" type="button">
        <Music2 size={15} aria-hidden="true" /><span>Rhythm</span>
      </button>
      {open ? (
        <section className="song-rhythm-panel" aria-label="Meter and strumming patterns">
          <div className="song-rhythm-heading">
            <strong>Meter &amp; strumming</strong>
            <button aria-label="Close rhythm editor" className="section-icon-button" onClick={close} title="Close rhythm editor" type="button"><X size={15} aria-hidden="true" /></button>
          </div>
          <div className="song-rhythm-fields">
            <label className="compact-field">Meter
              <select aria-label="Song meter" disabled={!canEdit} value={!value && !customMeter ? "" : customMeter || !METERS.includes(meter) ? "custom" : meter}
                onChange={(event) => {
                  if (!event.target.value) { onChange(null); setCustomMeter(false); return; }
                  if (event.target.value === "custom") { setCustomMeter(true); onChange(rhythm); return; }
                  setCustomMeter(false);
                  const [numerator, denominator] = event.target.value.split("/").map(Number);
                  updateMeter(numerator, denominator as SongRhythm["denominator"]);
                }}>
                <option value="">Unset</option>
                {METERS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                <option value="custom">Custom</option>
              </select>
            </label>
            {customMeter || !METERS.includes(meter) ? <>
              <label className="compact-field">Count<select aria-label="Beats per bar" disabled={!canEdit} value={rhythm.numerator} onChange={(event) => updateMeter(Number(event.target.value), rhythm.denominator)}>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select></label>
              <label className="compact-field">Unit<select aria-label="Meter beat unit" disabled={!canEdit} value={rhythm.denominator} onChange={(event) => updateMeter(rhythm.numerator, Number(event.target.value) as SongRhythm["denominator"])}>{[2, 4, 8, 16].map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label>
            </> : null}
            <label className="compact-field">Applies to
              <select aria-label="Strumming section" value={section} onChange={(event) => setSection(event.target.value as StrumSection)}>
                {STRUM_SECTIONS.map((entry) => <option key={entry} value={entry}>{entry === "Default" ? "Whole song" : entry}</option>)}
              </select>
            </label>
          </div>
          <label className="song-rhythm-preset">Common pattern
            <select aria-label="Common strumming pattern" disabled={!canEdit} value={selectedPreset?.id ?? ""} onChange={(event) => {
              const preset = presets.find((entry) => entry.id === event.target.value);
              if (preset) updatePattern({ section, subdivision: preset.subdivision, strokes: [...preset.strokes] });
            }}>
              <option value="">{pattern.strokes.length ? "Custom pattern" : "Choose a pattern or edit below"}</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.strokes.map((stroke) => STROKE_SYMBOLS[stroke]).join(" ")}</option>)}
            </select>
          </label>
          <div className="song-rhythm-fields">
            <label className="compact-field">Grid
              <select aria-label="Strumming grid subdivision" disabled={!canEdit} value={pattern.subdivision} onChange={(event) => updatePattern(resizeStrumPattern(editablePattern, rhythm.numerator, Number(event.target.value) as 1 | 2))}>
                <option value={1}>One per {rhythm.denominator === 8 ? "eighth note" : "beat"}</option>
                <option value={2}>Two per {rhythm.denominator === 8 ? "eighth note" : "beat"}</option>
              </select>
            </label>
            {pattern.strokes.length ? <button className="text-button" disabled={!canEdit} onClick={() => onChange({ ...rhythm, patterns: rhythm.patterns.filter((entry) => entry.section !== section) })} type="button">Clear pattern</button> : null}
          </div>
          <div className="song-strum-grid" style={{ gridTemplateColumns: `repeat(${editablePattern.strokes.length}, minmax(26px, 1fr))` }}>
            {editablePattern.strokes.map((stroke, index) => (
              <div className="song-strum-cell" key={index}>
                <span>{counts[index]}</span>
                <button aria-label={`Strum ${index + 1}, count ${counts[index]}: ${STROKE_NAMES[stroke]}. Click to change.`} disabled={!canEdit}
                  onClick={() => updatePattern({ ...editablePattern, strokes: editablePattern.strokes.map((entry, position) => position === index ? STROKE_CYCLE[(STROKE_CYCLE.indexOf(entry) + 1) % STROKE_CYCLE.length] : entry) })}
                  title="Click to cycle: rest, downstroke, upstroke, muted stroke" type="button">{STROKE_SYMBOLS[stroke]}</button>
              </div>
            ))}
          </div>
          <small className="field-help">↓ Down · ↑ Up · – Rest · × Muted. Click a stroke to change it. Keep your hand moving through rests.</small>
          {section !== "Default" ? <small className="field-help">This pattern overrides the whole-song pattern for {section.toLowerCase()} sections.</small> : null}
          <label className="song-rhythm-notes">Feel / notes
            <textarea aria-label="Rhythm notes" disabled={!canEdit} maxLength={500} onChange={(event) => onChange({ ...rhythm, notes: event.target.value })} placeholder="Gentle swing; accent beats 2 and 4; pick the verses…" rows={2} value={rhythm.notes} />
          </label>
          <small className="field-help">Changes are included when you save the song.</small>
        </section>
      ) : null}
    </>
  );
}
