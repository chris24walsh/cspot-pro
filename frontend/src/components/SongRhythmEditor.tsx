import { Music2, Save, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { Fragment, useEffect, useRef, useState } from "react";
import {
  resizeStrumPattern, STRUM_PRESETS, STRUM_SECTIONS, STROKE_CYCLE, STROKE_NAMES, STROKE_SYMBOLS,
  strumCounts, type RhythmPreset, type SongRhythm, type StrumPattern, type StrumSection,
} from "../songRhythm";
import { createRhythmPreset, getRhythmPresets, updateRhythmPreset } from "../api";
import { parseBarChart, songPracticeParts } from "../musicPractice";
import type { ChordAnnotation } from "../chordSheet";
import type { PracticeMode } from "../musicPractice";
import { RhythmPracticeControls } from "./RhythmPracticeControls";
import { useEscapeClose } from "./useEscapeClose";

const METERS = ["4/4", "3/4", "6/8", "2/4", "12/8"];
const emptyRhythm = (): SongRhythm => ({ numerator: 4, denominator: 4, patterns: [], notes: "" });

export function SongRhythmEditor({ value, canEdit, onChange, lyrics, sequence, previewChord, songChords = [], annotations, onPosition, onSave, saving, isDirty, inline = false, initialSection = "Default" }: {
  onPosition?: (position: number | null, mode: PracticeMode, section: string) => void;
  annotations?: ChordAnnotation[]; value: SongRhythm | null; canEdit: boolean; onChange: (value: SongRhythm | null) => void;
  lyrics?: string | null; sequence?: string | null; previewChord?: string;
  songChords?: Array<{ section: string | null; chord: string }>;
  initialSection?: StrumSection; inline?: boolean; onSave?: () => Promise<void>; saving?: boolean; isDirty?: boolean;
}) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [open, setOpen] = useState(inline);
  const [section, setSection] = useState<StrumSection>(initialSection);
  const [customMeter, setCustomMeter] = useState(false);
  const [library, setLibrary] = useState<RhythmPreset[]>([]);
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [libraryMessage, setLibraryMessage] = useState<string | null>(null);
  const [meterName, setMeterName] = useState("");
  const [barPart, setBarPart] = useState("Default");
  useEffect(() => {
    if (!open) return;
    let active = true;
    setLibraryBusy(true);
    void getRhythmPresets().then((presets) => { if (active) setLibrary(presets); }).catch((error) => {
      if (active) setLibraryMessage(error instanceof Error ? error.message : "Could not load shared presets.");
    }).finally(() => { if (active) setLibraryBusy(false); });
    return () => { active = false; };
  }, [open]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); triggerRef.current?.focus(); };
  useEscapeClose(!inline && open && !confirmationDialog, close, 1);
  const rhythm = value ?? emptyRhythm();
  const meter = `${rhythm.numerator}/${rhythm.denominator}`;
  const pattern = rhythm.patterns.find((entry) => entry.section === section)
    ?? { section, subdivision: rhythm.denominator === 8 ? 1 : 2, strokes: [] } as StrumPattern;
  const editablePattern = resizeStrumPattern(pattern, rhythm.numerator);
  const counts = strumCounts(rhythm, editablePattern);
  const presets = STRUM_PRESETS.filter((preset) => preset.numerator === rhythm.numerator && preset.denominator === rhythm.denominator);
  const savedMeters = library.filter((entry) => entry.kind === "meter");
  const savedStrums = library.filter((entry) => entry.kind === "strum");
  const selectedSaved = savedStrums.find((entry) => entry.numerator === rhythm.numerator && entry.denominator === rhythm.denominator && entry.name === pattern.name && entry.subdivision === pattern.subdivision && entry.strokes?.join() === pattern.strokes.join());
  const savedMeter = savedMeters.find((entry) => entry.numerator === rhythm.numerator && entry.denominator === rhythm.denominator);
  const partNames = Array.from(new Set(["Default", ...songPracticeParts(lyrics, sequence), ...(rhythm.arrangements ?? []).map((entry) => entry.section)]));
  const linkedBars = rhythm.markers?.some((marker) => (marker.section ?? "Default") === barPart) ?? false;
  const chart = rhythm.arrangements?.find((entry) => entry.section === barPart)?.chart ?? "";
  let chartError: string | null = null;
  let barLabels: string[] = [];
  try { barLabels = parseBarChart(chart, rhythm.numerator, barPart).map((bar) => bar.chords.map((chord) => `${chord.chord}@${Number(chord.beat.toFixed(2))}`).join(" ")); }
  catch (error) { chartError = error instanceof Error ? error.message : "Check the bar chart."; }
  const selectedPreset = presets.find((preset) => preset.subdivision === pattern.subdivision && preset.strokes.join() === pattern.strokes.join());

  function updatePattern(next: StrumPattern) {
    const patterns = rhythm.patterns.filter((entry) => entry.section !== section).concat(next)
      .sort((a, b) => STRUM_SECTIONS.indexOf(a.section) - STRUM_SECTIONS.indexOf(b.section));
    onChange({ ...rhythm, patterns });
  }

  function updateMeter(numerator: number, denominator: SongRhythm["denominator"]) {
    onChange({ ...rhythm, numerator, denominator, patterns: rhythm.patterns.map((entry) => resizeStrumPattern(entry, numerator)) });
  }

  function updateChart(next: string) {
    const arrangements = (rhythm.arrangements ?? []).filter((entry) => entry.section !== barPart);
    if (next.trim()) arrangements.push({ section: barPart, chart: next });
    onChange({ ...rhythm, arrangements });
  }

  async function saveLibrary(kind: "meter" | "strum") {
    setLibraryBusy(true); setLibraryMessage(null);
    try {
      const payload = { kind, name: kind === "meter" ? meterName.trim() : (pattern.name ?? "").trim(),
        numerator: rhythm.numerator, denominator: rhythm.denominator,
        subdivision: kind === "strum" ? pattern.subdivision : null, strokes: kind === "strum" ? [...pattern.strokes] : null };
      const latest = kind === "strum" ? await getRhythmPresets() : library;
      const existing = latest.find(entry => entry.kind === kind && entry.name.trim().toLowerCase() === payload.name.toLowerCase());
      if (kind === "strum" && existing && !await confirm({ title: "Update shared strum?", confirmLabel: "Update strum", message: `Replace “${existing.name}” with this pattern? Other players will see the updated pattern in the shared library. Patterns already applied to songs will stay unchanged.` })) return;
      const saved = kind === "strum" && existing ? await updateRhythmPreset(existing.id, payload) : await createRhythmPreset(payload);
      setLibrary([...latest.filter(entry => entry.id !== saved.id), saved]);
      setLibraryMessage(`“${saved.name}” ${kind === "strum" && existing ? "updated" : "saved"} for all players.`);
      if (kind === "meter") setCustomMeter(false);
    } catch (error) { setLibraryMessage(error instanceof Error ? error.message : "Could not save the shared preset."); }
    finally { setLibraryBusy(false); }
  }

  return (
    <>
      {confirmationDialog ? createPortal(<div style={{ position: "relative", zIndex: 200 }}>{confirmationDialog}</div>, document.body) : null}
      {!inline ? <button aria-label="Song rhythm" aria-expanded={open} className={`section-icon-button section-edit-button song-rhythm-trigger ${value ? "is-active" : ""}`}
        onClick={() => setOpen((current) => !current)} ref={triggerRef} title="Meter and strumming patterns" type="button">
        <Music2 size={15} aria-hidden="true" /><span>Rhythm</span>
      </button> : null}
      {open ? (
        <section className={`song-rhythm-panel ${inline ? "is-inline" : ""}`} aria-label="Meter and strumming patterns">
          {!inline ? <div className="song-rhythm-heading">
            <strong>Meter &amp; strumming</strong>
            <button aria-label="Close rhythm editor" className="section-icon-button" onClick={close} title="Close rhythm editor" type="button"><X size={15} aria-hidden="true" /></button>
          </div> : null}
          <div className="song-rhythm-fields">
            <label className="compact-field">Beat keeper<select aria-label="Beat keeper visual count" disabled={!canEdit} value={rhythm.visual_beats ?? 0} onChange={event => onChange({ ...rhythm, visual_beats: Number(event.target.value) || null })}><option value={0}>Auto (meter)</option>{Array.from({ length: 12 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} beats</option>)}</select></label>
            <label className="compact-field">Meter
              <select aria-label="Song meter" disabled={!canEdit} value={!value && !customMeter ? "" : customMeter ? "custom" : savedMeter ? `meter:${savedMeter.id}` : !METERS.includes(meter) ? "custom" : meter}
                onChange={(event) => {
                  if (!event.target.value) { onChange(null); setCustomMeter(false); return; }
                  if (event.target.value === "custom") { setCustomMeter(true); onChange(rhythm); return; }
                  setCustomMeter(false);
                  if (event.target.value.startsWith("meter:")) {
                    const saved = savedMeters.find((entry) => `meter:${entry.id}` === event.target.value)!;
                    updateMeter(saved.numerator, saved.denominator); return;
                  }
                  const [numerator, denominator] = event.target.value.split("/").map(Number);
                  updateMeter(numerator, denominator as SongRhythm["denominator"]);
                }}>
                <option value="">Unset</option>
                {METERS.map((entry) => <option key={entry} value={entry}>{entry}</option>)}
                {savedMeters.length ? <optgroup label="Shared custom meters">{savedMeters.map((entry) => <option key={entry.id} value={`meter:${entry.id}`}>{entry.name} · {entry.numerator}/{entry.denominator}{entry.kind === "strum" && entry.strokes!.length === 2 * entry.numerator * entry.subdivision! ? " · 2 bars" : ""}</option>)}</optgroup> : null}
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
          <div className="rhythm-save-preset-row">
            <label className="compact-field">Meter name<input aria-label="Shared meter name" disabled={!canEdit} maxLength={80} onChange={(event) => setMeterName(event.target.value)} placeholder="e.g. Seven in two groups" value={meterName} /></label>
            <button className="text-button" disabled={!canEdit || libraryBusy || !meterName.trim()} onClick={() => void saveLibrary("meter")} type="button"><Save size={14} aria-hidden="true" />Save meter to library</button>
          </div>
          <label className="song-rhythm-preset">Common / saved pattern
            <select aria-label="Common strumming pattern" disabled={!canEdit} value={selectedSaved ? `strum:${selectedSaved.id}` : selectedPreset?.id ?? ""} onChange={(event) => {
              if (event.target.value.startsWith("strum:")) {
                const saved = savedStrums.find((entry) => `strum:${entry.id}` === event.target.value)!;
                setCustomMeter(false);
                onChange({ ...rhythm, numerator: saved.numerator, denominator: saved.denominator,
                  patterns: rhythm.patterns.filter((entry) => entry.section !== section).map((entry) => resizeStrumPattern(entry, saved.numerator)).concat({ section, name: saved.name, bars: (saved.strokes!.length / (saved.numerator * saved.subdivision!)) as 1 | 2, subdivision: saved.subdivision!, strokes: [...saved.strokes!] }),
                }); return;
              }
              const preset = presets.find((entry) => entry.id === event.target.value);
              if (preset) updatePattern({ section, name: preset.name, subdivision: preset.subdivision, strokes: [...preset.strokes] });
            }}>
              <option value="">{pattern.strokes.length ? "Custom pattern" : "Choose a pattern or edit below"}</option>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.strokes.map((stroke) => STROKE_SYMBOLS[stroke]).join(" ")}</option>)}
              {savedStrums.length ? <optgroup label="Shared strums">{savedStrums.map((entry) => <option key={entry.id} value={`strum:${entry.id}`}>{entry.name} · {entry.numerator}/{entry.denominator}{entry.kind === "strum" && entry.strokes!.length === 2 * entry.numerator * entry.subdivision! ? " · 2 bars" : ""}</option>)}</optgroup> : null}
            </select>
          </label>
          <div className="song-rhythm-fields">
            <label className="compact-field">Grid
              <select aria-label="Strumming grid subdivision" disabled={!canEdit} value={pattern.subdivision} onChange={(event) => updatePattern(resizeStrumPattern(editablePattern, rhythm.numerator, Number(event.target.value) as 1 | 2 | 4))}>
                <option value={1}>One per {rhythm.denominator === 8 ? "eighth note" : "beat"}</option>
                <option value={2}>Two per {rhythm.denominator === 8 ? "eighth note" : "beat"}</option>
                <option value={4}>Four per beat · 1 e &amp; a</option>
              </select>
            </label>
            <label className="compact-field">Pattern length<select aria-label="Strum pattern length" disabled={!canEdit} value={pattern.bars ?? 1} onChange={event => updatePattern(resizeStrumPattern(editablePattern, rhythm.numerator, pattern.subdivision, Number(event.target.value) as 1 | 2))}><option value={1}>1 bar</option><option value={2}>2 bars</option></select></label>
            {pattern.strokes.length ? <button className="text-button" disabled={!canEdit} onClick={() => onChange({ ...rhythm, patterns: rhythm.patterns.filter((entry) => entry.section !== section) })} type="button">Clear pattern</button> : null}
          </div>
          <div className="song-strum-grid" style={{ gridTemplateColumns: `repeat(${rhythm.numerator * pattern.subdivision}, minmax(26px, 1fr))` }}>
            {editablePattern.strokes.map((stroke, index) => (
              <Fragment key={index}>
                {(pattern.bars ?? 1) === 2 && index % (rhythm.numerator * pattern.subdivision) === 0 ? <small style={{ gridColumn: "1 / -1", textAlign: "left" }}>Bar {Math.floor(index / (rhythm.numerator * pattern.subdivision)) + 1}</small> : null}
              <div className="song-strum-cell">
                <span>{counts[index]}</span>
                <button aria-label={`Strum ${index + 1}, count ${counts[index]}: ${STROKE_NAMES[stroke]}. Click to change.`} disabled={!canEdit}
                  onClick={() => updatePattern({ ...editablePattern, strokes: editablePattern.strokes.map((entry, position) => position === index ? STROKE_CYCLE[(STROKE_CYCLE.indexOf(entry) + 1) % STROKE_CYCLE.length] : entry) })}
                  title="Click to cycle: rest, downstroke, upstroke, soft downstroke, soft upstroke, muted stroke" type="button">{STROKE_SYMBOLS[stroke]}</button>
              </div>
              </Fragment>
            ))}
          </div>
          <RhythmPracticeControls annotations={annotations} onPosition={onPosition} rhythm={rhythm} section={barPart} strumSection={section} lyrics={lyrics} sequence={sequence} previewChord={previewChord} onTempoChange={canEdit ? (bpm) => onChange({ ...rhythm, bpm }) : undefined} />
          <div className="rhythm-save-preset-row">
            <label className="compact-field">Strum name<input aria-label="Shared strum name" disabled={!canEdit} maxLength={80} onChange={(event) => updatePattern({ ...editablePattern, name: event.target.value })} placeholder="Name this pattern" value={pattern.name ?? ""} /></label>
            <button className="text-button" disabled={!canEdit || libraryBusy || !pattern.name?.trim() || !pattern.strokes.some((stroke) => stroke !== "-")} onClick={() => void saveLibrary("strum")} type="button"><Save size={14} aria-hidden="true" />Save strum to library</button>
          </div>
          {libraryMessage ? <p className="form-message" role="status">{libraryMessage}</p> : null}
          <small className="field-help">Library presets are shared with other players. Selecting a saved strum also selects its meter.</small>
          <small className="field-help">↓ Down · ↑ Up · ⇣ Soft down · ⇡ Soft up · – Rest · × Muted. Click a stroke to change it. Keep your hand moving through rests.</small>
          {section !== "Default" ? <small className="field-help">This pattern overrides the whole-song pattern for {section.toLowerCase()} sections.</small> : null}
          <label className="song-rhythm-notes">Feel / notes
            <textarea aria-label="Rhythm notes" disabled={!canEdit} maxLength={500} onChange={(event) => onChange({ ...rhythm, notes: event.target.value })} placeholder="Gentle swing; accent beats 2 and 4; pick the verses…" rows={2} value={rhythm.notes} />
          </label>
          <details className="rhythm-bar-editor">
            <summary>Bars &amp; chords · {barLabels.length} bars in selected chart</summary>
            <label className="compact-field">Part<select aria-label="Bar chart part" onChange={(event) => setBarPart(event.target.value)} value={barPart}>{partNames.map((part) => <option key={part} value={part}>{part === "Default" ? "Whole song" : part}</option>)}</select></label>
            {linkedBars ? <small className="field-help">This chart follows the bar markers in the chord panel. Use Bars mode there to move boundaries; chord changes within a bar divide its time evenly.</small> : null}
            <textarea aria-label="Chord bar chart" disabled={!canEdit || linkedBars} maxLength={8000} onChange={(event) => updateChart(event.target.value)} placeholder="C | Am | F G | C *2" rows={3} value={chart} />
            <small className="field-help">Separate bars with | or new lines. C G splits a bar evenly. C@1 G@3 sets exact counts. C *4 repeats a bar four times. Counts follow the meter's written unit (eighth notes in 6/8).</small>
            <button className="text-button" disabled={!canEdit || Boolean(chart.trim()) || !songChords.length} onClick={() => updateChart(songChords.filter((entry) => barPart === "Default" || entry.section === barPart).map((entry) => entry.chord).join(" | "))} type="button">Start from song chords</button>
            <small className="field-help">Starting from song chords places one chord per bar; adjust the timing to match the song.</small>
            {chartError ? <p className="form-message" role="alert">{chartError}</p> : <div className="rhythm-bar-preview">{barLabels.map((label, index) => <span key={index}><small>{index + 1}</small>{label}</span>)}</div>}
          </details>
          <div className="song-rhythm-fields">
            <small className="field-help">{isDirty ? "Song changes are unsaved." : "Song changes are saved."}</small>
            {onSave ? <button aria-label="Save song rhythm" className="text-button" disabled={!canEdit || saving || !isDirty || Boolean(chartError)} onClick={() => void onSave()} type="button"><Save size={14} aria-hidden="true" />{saving ? "Saving…" : "Save song"}</button> : null}
          </div>
        </section>
      ) : null}
    </>
  );
}
