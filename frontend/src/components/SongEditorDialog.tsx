import { Archive, Search, Save, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { createSong, updateSong, type Song } from "../api";
import {
  createEmptyChordChart,
  deriveAbsoluteKey,
  deriveCapoKey,
  displayChord,
  LEADING_CHORD_ANCHORS,
  lyricLines,
  MUSICAL_KEYS,
  normalizeChordSymbolInput,
  normalizeKeySignature,
  parseChordChart,
  removeChordAnnotation,
  semitoneDistance,
  serializeChordChart,
  TRAILING_CHORD_ANCHORS,
  transposeChordAnnotations,
  transposeChordSymbol,
  upsertChordAnnotation,
  validateChordSymbol,
  type ChordAnnotation,
  type ChordChartDocument,
  type ChordDetailMode,
  type ChordDisplayMode,
} from "../chordSheet";
import { canonicalizeWorshipLyrics } from "../worshipText";

type SongForm = Omit<Song, "id" | "lyrics_status">;
type SongEditorTab = "lyrics" | "details" | "chords";
type GuitarShapeMode = "standard" | "open-e";
type GuitarChordShape = {
  baseFret?: number;
  frets: Array<number | "x">;
  fingers?: Array<number | null>;
  label?: string;
};

const WORSHIP_SLOT_OPTIONS = [
  { value: "opener", label: "Opening" },
  { value: "middle", label: "Middle" },
  { value: "response", label: "Response" },
  { value: "closer", label: "Closing" },
] as const;

const GUITAR_CHORDS: Record<string, GuitarChordShape> = {
  A: { frets: ["x", 0, 2, 2, 2, 0], fingers: [null, null, 1, 2, 3, null] },
  Am: { frets: ["x", 0, 2, 2, 1, 0], fingers: [null, null, 2, 3, 1, null] },
  A7: { frets: ["x", 0, 2, 0, 2, 0], fingers: [null, null, 1, null, 2, null] },
  B: { baseFret: 2, frets: ["x", 1, 3, 3, 3, 1], fingers: [null, 1, 3, 3, 3, 1] },
  Bm: { baseFret: 2, frets: ["x", 1, 3, 3, 2, 1], fingers: [null, 1, 3, 4, 2, 1] },
  B7: { frets: ["x", 2, 1, 2, 0, 2], fingers: [null, 2, 1, 3, null, 4] },
  C: { frets: ["x", 3, 2, 0, 1, 0], fingers: [null, 3, 2, null, 1, null] },
  C7: { frets: ["x", 3, 2, 3, 1, 0], fingers: [null, 3, 2, 4, 1, null] },
  D: { frets: ["x", "x", 0, 2, 3, 2], fingers: [null, null, null, 1, 3, 2] },
  Dm: { frets: ["x", "x", 0, 2, 3, 1], fingers: [null, null, null, 2, 3, 1] },
  D7: { frets: ["x", "x", 0, 2, 1, 2], fingers: [null, null, null, 2, 1, 3] },
  E: { frets: [0, 2, 2, 1, 0, 0], fingers: [null, 2, 3, 1, null, null] },
  Em: { frets: [0, 2, 2, 0, 0, 0], fingers: [null, 2, 3, null, null, null] },
  E7: { frets: [0, 2, 0, 1, 0, 0], fingers: [null, 2, null, 1, null, null] },
  F: { baseFret: 1, frets: [1, 3, 3, 2, 1, 1], fingers: [1, 3, 4, 2, 1, 1] },
  Fm: { baseFret: 1, frets: [1, 3, 3, 1, 1, 1], fingers: [1, 3, 4, 1, 1, 1] },
  G: { frets: [3, 2, 0, 0, 0, 3], fingers: [2, 1, null, null, null, 3] },
  G7: { frets: [3, 2, 0, 0, 0, 1], fingers: [3, 2, null, null, null, 1] },
};

const OPEN_E_GUITAR_CHORDS: Record<string, GuitarChordShape> = {
  E: { frets: [0, 7, 9, 9, 0, 0], fingers: [null, 1, 3, 4, null, null], label: "open E" },
  E7: { frets: [0, 7, 6, 7, 0, 0], fingers: [null, 2, 1, 3, null, null], label: "open E7" },
  A: { frets: ["x", 0, 7, 6, 0, 0], fingers: [null, null, 2, 1, null, null], label: "A2 / open E" },
  A7: { frets: ["x", 0, 7, 6, 8, 0], fingers: [null, null, 2, 1, 3, null], label: "A7 / open E" },
  B: { frets: ["x", 2, 4, 4, 0, 0], fingers: [null, 1, 3, 4, null, null], label: "Bsus / open E" },
  B7: { frets: ["x", 2, 1, 2, 0, 0], fingers: [null, 2, 1, 3, null, null], label: "B7 / open E" },
  "C#m": { frets: ["x", 4, 6, 6, 0, 0], fingers: [null, 1, 3, 4, null, null], label: "C#m7 / open E" },
  "F#m": { frets: [2, 4, 4, 2, 0, 0], fingers: [1, 3, 4, 1, null, null], label: "F#m11 / open E" },
  "G#m": { frets: [4, 6, 6, 4, 0, 0], fingers: [1, 3, 4, 1, null, null], label: "G#m / open E" },
};

function formFromSong(song: Song): SongForm {
  return {
    title: song.title,
    alternate_title: song.alternate_title,
    author: song.author,
    lyrics: song.lyrics,
    chords: song.chords,
    ccli_number: song.ccli_number,
    book_reference: song.book_reference,
    license: song.license,
    sequence: song.sequence,
    youtube_id: song.youtube_id,
    external_link: song.external_link,
    worship_role: song.worship_role,
    energy: song.energy,
    tempo: song.tempo,
    theme_tags: song.theme_tags,
  };
}

function normalizeForm(form: SongForm, chords: string | null): SongForm {
  return {
    title: form.title.trim(),
    alternate_title: form.alternate_title || null,
    author: form.author || null,
    lyrics: form.lyrics ? canonicalizeWorshipLyrics(form.lyrics, form.sequence) : null,
    chords,
    ccli_number: form.ccli_number || null,
    book_reference: form.book_reference || null,
    license: form.license || null,
    sequence: form.sequence || null,
    youtube_id: form.youtube_id || null,
    external_link: form.external_link || null,
    worship_role: form.worship_role || "any",
    energy: form.energy ? Number(form.energy) : null,
    tempo: form.tempo || null,
    theme_tags: form.theme_tags || null,
  };
}

function worshipRoleValues(value: string | null | undefined) {
  return new Set((value ?? "").split(",").map((entry) => entry.trim()).filter((entry) => entry && entry !== "any"));
}

function nextWorshipRoleValue(currentValue: string | null | undefined, toggledValue: string, checked: boolean) {
  const values = worshipRoleValues(currentValue);
  if (checked) {
    values.add(toggledValue);
  } else {
    values.delete(toggledValue);
  }
  return values.size ? Array.from(values).join(",") : "any";
}

function extractYouTubeId(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    const watchId = parsed.searchParams.get("v");
    if (watchId) return watchId;
    const pathMatch = parsed.pathname.match(/(?:\/shorts\/|\/embed\/|\/)([A-Za-z0-9_-]{11})/);
    if (pathMatch?.[1]) return pathMatch[1];
  } catch {
    // Let raw IDs and URL fragments fall through.
  }
  const match = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?.*v=|shorts\/|embed\/))([A-Za-z0-9_-]{11})/);
  return match?.[1] ?? trimmed;
}

function diagramChordKey(chord: string) {
  const main = chord.trim().split("/")[0] ?? "";
  const match = main.match(/^([A-G](?:#|b)?)(m|maj7|maj|min|dim|sus\d?|add\d?|[0-9]*)?/);
  if (!match) return "";
  const [, root, quality = ""] = match;
  if (quality === "m" || quality === "min") return `${root}m`;
  if (quality === "7") return `${root}7`;
  return root;
}

function resolveGuitarShape(chordKey: string, shapeMode: GuitarShapeMode) {
  if (shapeMode === "open-e") {
    return OPEN_E_GUITAR_CHORDS[chordKey] ?? GUITAR_CHORDS[chordKey] ?? null;
  }
  return GUITAR_CHORDS[chordKey] ?? null;
}

function diagramBaseFret(shape: GuitarChordShape) {
  if (shape.baseFret) return shape.baseFret;
  const fretted = shape.frets.filter((fret): fret is number => typeof fret === "number" && fret > 0);
  const minimumFret = Math.min(...fretted);
  return Number.isFinite(minimumFret) && minimumFret > 3 ? minimumFret : undefined;
}

function diagramFretPosition(baseFret: number | undefined, fret: number) {
  if (fret <= 0) return 0;
  if (!baseFret || baseFret <= 1) return fret;
  return fret - baseFret + 1;
}

function GuitarChordDiagram({ chord, shapeMode }: { chord: string | null; shapeMode: GuitarShapeMode }) {
  const chordKey = chord ? diagramChordKey(chord) : "";
  const shape = chordKey ? resolveGuitarShape(chordKey, shapeMode) : null;
  const stringX = [14, 32, 50, 68, 86, 104];
  const fretY = [26, 46, 66, 86, 106];
  const baseFret = shape ? diagramBaseFret(shape) : undefined;

  if (!chord || !shape) {
    return (
      <div className="chord-diagram-card empty">
        <strong>{chord || "Chord"}</strong>
        <span>{chord ? "No guitar shape yet" : "Hover or edit a chord"}</span>
      </div>
    );
  }

  return (
    <div className="chord-diagram-card">
      <strong>{chord}</strong>
      {shape.label ? <span>{shape.label}</span> : null}
      <svg aria-label={`${chord} guitar chord`} className="chord-diagram" role="img" viewBox="0 0 118 128">
        {baseFret && baseFret > 1 ? <text className="chord-fret-label" x="108" y="43">{baseFret}fr</text> : null}
        {stringX.map((x) => <line className="chord-string" key={`string-${x}`} x1={x} x2={x} y1="26" y2="106" />)}
        {fretY.map((y, index) => (
          <line className={index === 0 && !baseFret ? "chord-nut" : "chord-fret"} key={`fret-${y}`} x1="14" x2="104" y1={y} y2={y} />
        ))}
        {shape.frets.map((fret, index) => {
          const x = stringX[index];
          if (fret === "x") return <text className="chord-muted" key={`mark-${index}`} x={x - 4} y="18">x</text>;
          if (fret === 0) return <circle className="chord-open" cx={x} cy="13" key={`mark-${index}`} r="3.5" />;
          const fretPosition = diagramFretPosition(baseFret, fret);
          const y = fretY[Math.max(0, Math.min(fretPosition - 1, fretY.length - 2))] + 10;
          return (
            <g key={`mark-${index}`}>
              <circle className="chord-finger-dot" cx={x} cy={y} r="7" />
              {shape.fingers?.[index] ? <text className="chord-finger-label" x={x - 3.5} y={y + 4}>{shape.fingers[index]}</text> : null}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function SongEditorDialog({
  canEdit,
  mode = "edit",
  onArchive,
  onClose,
  onSaved,
  song,
}: {
  canEdit: boolean;
  mode?: "create" | "edit";
  onArchive?: (song: Song) => void | Promise<void>;
  onClose: () => void;
  onSaved: (song: Song) => void | Promise<void>;
  song: Song;
}) {
  const [tab, setTab] = useState<SongEditorTab>("lyrics");
  const [form, setForm] = useState<SongForm>(() => formFromSong(song));
  const [chordChart, setChordChart] = useState<ChordChartDocument>(() => parseChordChart(song.chords).document);
  const [legacyChords, setLegacyChords] = useState<string | null>(() => parseChordChart(song.chords).legacyText);
  const [selectedLineIndex, setSelectedLineIndex] = useState(0);
  const [selectedAnchorIndex, setSelectedAnchorIndex] = useState(0);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [inlineChordEditorOpen, setInlineChordEditorOpen] = useState(false);
  const [chordInput, setChordInput] = useState("");
  const [draggedAnnotationId, setDraggedAnnotationId] = useState<string | null>(null);
  const [hoveredAnchor, setHoveredAnchor] = useState<{ lineIndex: number; slotIndex: number } | null>(null);
  const [hoveredChordId, setHoveredChordId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const displayMode: ChordDisplayMode = "absolute";
  const detailMode: ChordDetailMode = "advanced";
  const lines = useMemo(() => lyricLines(form.lyrics), [form.lyrics]);
  const derivedCapoKey = chordChart.absoluteKey ? deriveCapoKey(chordChart.absoluteKey, chordChart.capo) : chordChart.capoKey;
  const lineAnnotations = chordChart.annotations
    .slice()
    .sort((left, right) => left.lineIndex - right.lineIndex || left.anchorIndex - right.anchorIndex);
  const activeChordAnnotation =
    lineAnnotations.find((annotation) => annotation.id === editingAnnotationId) ??
    lineAnnotations.find((annotation) => annotation.id === hoveredChordId) ??
    null;
  const activeDisplayedChord =
    inlineChordEditorOpen && chordInput.trim()
      ? chordInput.trim()
      : activeChordAnnotation
        ? displayChord(activeChordAnnotation.chord, { capo: chordChart.capo, detailMode, displayMode })
        : null;

  useEffect(() => {
    setForm(formFromSong(song));
    const parsed = parseChordChart(song.chords);
    setChordChart(parsed.document);
    setLegacyChords(parsed.legacyText);
    setTab("lyrics");
    setMessage(null);
  }, [song]);

  useEffect(() => {
    setChordChart((current) => ({
      ...current,
      annotations: current.annotations.filter((annotation) => {
        const line = lines[annotation.lineIndex];
        return line != null && annotation.anchorIndex <= line.length + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS;
      }),
    }));
    setSelectedLineIndex((current) => Math.min(current, Math.max(lines.length - 1, 0)));
  }, [lines]);

  function normalizeChordInput(value: string) {
    const input = normalizeChordSymbolInput(value);
    const validation = validateChordSymbol(input);
    return validation.normalized || input;
  }

  function editableChordValue(annotation: ChordAnnotation) {
    return displayChord(annotation.chord, { capo: chordChart.capo, detailMode: "advanced", displayMode });
  }

  function updateAbsoluteKey(nextValue: string) {
    const nextAbsoluteKey = normalizeKeySignature(nextValue);
    setChordChart((current) => {
      const linked = current.absoluteKey && current.capoKey && deriveAbsoluteKey(current.capoKey, current.capo) === current.absoluteKey;
      const nextChart: ChordChartDocument = { ...current, absoluteKey: nextAbsoluteKey, keyAnchor: "absolute" };
      if (nextAbsoluteKey && current.absoluteKey && linked && nextAbsoluteKey !== current.absoluteKey) {
        nextChart.annotations = transposeChordAnnotations(current.annotations, semitoneDistance(current.absoluteKey, nextAbsoluteKey), {
          preferFlats: nextAbsoluteKey.includes("b"),
        });
      }
      if (nextAbsoluteKey) {
        if (current.capoKey) {
          if (current.keyAnchor === "capo") nextChart.capo = semitoneDistance(current.capoKey, nextAbsoluteKey);
          else nextChart.capoKey = deriveCapoKey(nextAbsoluteKey, current.capo);
        } else if (current.capo > 0) {
          nextChart.capoKey = deriveCapoKey(nextAbsoluteKey, current.capo);
        }
      }
      return nextChart;
    });
    setLegacyChords(null);
  }

  function updateCapo(nextCapoValue: number) {
    const nextCapo = Math.max(0, Math.trunc(nextCapoValue));
    setChordChart((current) => {
      const nextChart: ChordChartDocument = { ...current, capo: nextCapo, keyAnchor: "absolute" };
      if (current.absoluteKey) nextChart.capoKey = deriveCapoKey(current.absoluteKey, nextCapo);
      return nextChart;
    });
    setLegacyChords(null);
  }

  function openYouTubeSearch() {
    const query = (form.title || song.title).trim();
    if (!query) return;
    window.open(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`, "_blank", "noopener,noreferrer");
  }

  function startInlineChordEdit(lineIndex: number, anchorIndex: number, annotation?: ChordAnnotation) {
    if (!chordChart.absoluteKey && !chordChart.capoKey) {
      setMessage("Set the song key before adding chords.");
      return;
    }
    setSelectedLineIndex(lineIndex);
    setSelectedAnchorIndex(anchorIndex);
    setEditingAnnotationId(annotation?.id ?? null);
    setInlineChordEditorOpen(true);
    setChordInput(annotation ? editableChordValue(annotation) : "");
  }

  function cancelInlineChordEdit() {
    setEditingAnnotationId(null);
    setInlineChordEditorOpen(false);
    setHoveredAnchor(null);
    setHoveredChordId(null);
    setChordInput("");
  }

  function saveAnnotation() {
    if (!chordChart.absoluteKey && !chordChart.capoKey) {
      setMessage("Set the song key before adding chords.");
      return;
    }
    const validation = validateChordSymbol(chordInput);
    if (validation.error) {
      setMessage(validation.error);
      return;
    }
    const storedChord = transposeChordSymbol(validation.normalized, displayMode === "capo" ? chordChart.capo : 0, {
      detailMode: "advanced",
      preferFlats: chordChart.absoluteKey?.includes("b") || chordChart.capoKey?.includes("b"),
    });
    setChordChart((current) =>
      upsertChordAnnotation(current, {
        chord: storedChord,
        id: editingAnnotationId,
        lineIndex: selectedLineIndex,
        anchorIndex: selectedAnchorIndex,
      }),
    );
    setLegacyChords(null);
    cancelInlineChordEdit();
  }

  function saveOrCloseInlineEditor() {
    if (chordInput.trim()) saveAnnotation();
    else cancelInlineChordEdit();
  }

  function moveAnnotation(annotationId: string, lineIndex: number, anchorIndex: number) {
    const annotation = chordChart.annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) return;
    setChordChart((current) => upsertChordAnnotation(current, { id: annotation.id, chord: annotation.chord, lineIndex, anchorIndex }));
    setLegacyChords(null);
  }

  async function saveSong() {
    if (!canEdit) return;
    if (chordChart.annotations.length && !chordChart.absoluteKey && !chordChart.capoKey) {
      setTab("chords");
      setMessage("Set the song key before saving chord annotations.");
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const payload = normalizeForm(form, serializeChordChart(chordChart, legacyChords));
      const saved = mode === "create" ? await createSong(payload) : await updateSong(song.id, payload);
      await onSaved(saved);
      onClose();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save song.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="song-editor-dialog-title"
        aria-modal="true"
        className="app-dialog app-dialog-wide edit-song-dialog song-editor-dialog"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="song-editor-dialog-top">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Edit Song</p>
              <h2 id="song-editor-dialog-title">{mode === "create" ? "New Song" : form.title || song.title}</h2>
            </div>
            <div className="action-row">
              {mode === "edit" && onArchive ? (
                <button
                  aria-label="Archive song"
                  className="section-icon-button section-remove-button song-editor-action-button"
                  disabled={saving || !canEdit}
                  onClick={() => void onArchive(song)}
                  title="Archive song"
                  type="button"
                >
                  <Archive size={16} aria-hidden="true" />
                </button>
              ) : null}
              <button aria-label="Close" className="section-icon-button song-editor-action-button" onClick={onClose} title="Close" type="button">
                <X size={16} aria-hidden="true" />
              </button>
              <button
                aria-label={saving ? "Saving song" : "Save song"}
                className="section-icon-button song-editor-action-button song-editor-save-button"
                disabled={saving || !canEdit || !form.title.trim()}
                onClick={() => void saveSong()}
                title={saving ? "Saving..." : "Save song"}
                type="button"
              >
                <Save size={16} aria-hidden="true" />
              </button>
            </div>
          </div>
          {message ? <p className="form-message">{message}</p> : null}
          <div className="tab-row" role="tablist" aria-label="Song editor sections">
            {(["lyrics", "details", "chords"] as const).map((nextTab) => (
              <button className={`tab-button ${tab === nextTab ? "active" : ""}`} key={nextTab} onClick={() => setTab(nextTab)} type="button">
                {nextTab[0].toUpperCase() + nextTab.slice(1)}
              </button>
            ))}
          </div>
        </div>

        <div className="song-editor-scroll">
          {tab === "details" ? (
            <div className="form-grid">
              <label>Title<input disabled={!canEdit} onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></label>
              <div className="field-block worship-slot-field">
                <span>Worship Slot</span>
                <div className="checkbox-pill-grid">
                  {WORSHIP_SLOT_OPTIONS.map((option) => {
                    const selectedValues = worshipRoleValues(form.worship_role);
                    return (
                      <label className="checkbox-pill" key={option.value}>
                        <input
                          checked={selectedValues.has(option.value)}
                          disabled={!canEdit}
                          onChange={(event) => setForm({ ...form, worship_role: nextWorshipRoleValue(form.worship_role, option.value, event.target.checked) })}
                          type="checkbox"
                        />
                        <span>{option.label}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="wide-field youtube-field">
                <span>YouTube Link / ID</span>
                <span className="inline-input-action">
                  <input disabled={!canEdit} onBlur={(event) => setForm({ ...form, youtube_id: extractYouTubeId(event.target.value) })} onChange={(event) => setForm({ ...form, youtube_id: event.target.value })} value={form.youtube_id ?? ""} />
                  <button aria-label="Search YouTube for this song" className="section-icon-button" onClick={openYouTubeSearch} title="Search YouTube" type="button">
                    <Search size={15} aria-hidden="true" />
                  </button>
                </span>
              </label>
            </div>
          ) : null}

          {tab === "lyrics" ? (
            <div className="form-grid single-column">
              <div className="field-block wide-field">
                <label htmlFor="song-dialog-sequence">Sequence<input disabled={!canEdit} id="song-dialog-sequence" onChange={(event) => setForm({ ...form, sequence: event.target.value })} placeholder="V1 C V2 C B C" value={form.sequence ?? ""} /></label>
                <textarea id="song-dialog-lyrics" disabled={!canEdit} onChange={(event) => setForm({ ...form, lyrics: event.target.value })} rows={18} value={form.lyrics ?? ""} />
              </div>
            </div>
          ) : null}

          {tab === "chords" ? (
            <section className="musician-tools" aria-label="Chord editor">
              <div className="musician-chord-editor-bar">
                <div className="musician-chord-summary">
                  <GuitarChordDiagram chord={activeDisplayedChord} shapeMode="standard" />
                </div>
                <div className="musician-toolbar">
                  <div className="musician-control-row musician-key-row">
                    <label className="compact-field musician-key-field">
                      Key
                      <select disabled={!canEdit} onChange={(event) => updateAbsoluteKey(event.target.value)} value={chordChart.absoluteKey ?? ""}>
                        <option value="">Unset</option>
                        {MUSICAL_KEYS.map((keyOption) => <option key={keyOption} value={keyOption}>{keyOption}</option>)}
                      </select>
                    </label>
                    <label className="compact-field musician-capo-field">Capo<input disabled={!canEdit} min={0} onChange={(event) => updateCapo(Number(event.target.value || 0))} type="number" value={chordChart.capo} /></label>
                    <span className="field-help musician-derived-key">{chordChart.absoluteKey ? `${chordChart.absoluteKey}${chordChart.capo > 0 && derivedCapoKey ? `/${derivedCapoKey}c${chordChart.capo}` : ""}` : "Set key before adding chords"}</span>
                  </div>
                </div>
              </div>

              <div className="musician-chart-panel">
                {lines.length ? (
                  <div className="musician-preview">
                    {lines.map((line, lineIndex) => {
                      if (/^\[[^\]]+\]$/.test(line.trim())) {
                        return <div className="musician-section-marker" key={`${lineIndex}-${line}`}>{line}</div>;
                      }
                      const annotations = lineAnnotations.filter((annotation) => annotation.lineIndex === lineIndex);
                      const totalSlots = line.length + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS;
                      const renderSlot = (slotIndex: number) => {
                        const annotation = annotations.find((candidate) => candidate.anchorIndex === slotIndex);
                        const isEditing =
                          inlineChordEditorOpen &&
                          selectedLineIndex === lineIndex &&
                          selectedAnchorIndex === slotIndex &&
                          (editingAnnotationId === null ? !annotation : annotation != null && editingAnnotationId === annotation.id);
                        if (isEditing) {
                          return (
                            <span className="musician-slot-editor" key={`editor-${lineIndex}-${slotIndex}`} style={{ gridColumn: slotIndex + 1, gridRow: 1 }}>
                              <input
                                autoFocus
                                disabled={!canEdit}
                                onBlur={() => saveOrCloseInlineEditor()}
                                onChange={(event) => setChordInput(normalizeChordInput(event.target.value))}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    saveOrCloseInlineEditor();
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelInlineChordEdit();
                                  }
                                }}
                                placeholder={detailMode === "advanced" ? "BbMAJ7/D" : "Bbm"}
                                size={Math.max(1, chordInput.length || 1)}
                                value={chordInput}
                              />
                              {annotation ? <button className="musician-delete-button" disabled={!canEdit} onMouseDown={(event) => event.preventDefault()} onClick={() => { setChordChart((current) => removeChordAnnotation(current, annotation.id)); cancelInlineChordEdit(); }} type="button">x</button> : null}
                            </span>
                          );
                        }
                        return (
                          <button
                            className={`musician-slot ${annotation ? "has-chord" : ""}`}
                            disabled={!canEdit}
                            draggable={Boolean(annotation) && canEdit}
                            key={`slot-${lineIndex}-${slotIndex}`}
                            onClick={() => startInlineChordEdit(lineIndex, slotIndex, annotation)}
                            onDragEnd={() => setDraggedAnnotationId(null)}
                            onDragOver={(event) => { if (draggedAnnotationId) event.preventDefault(); }}
                            onDragStart={() => { if (annotation) setDraggedAnnotationId(annotation.id); }}
                            onDrop={(event) => {
                              event.preventDefault();
                              if (draggedAnnotationId) {
                                moveAnnotation(draggedAnnotationId, lineIndex, slotIndex);
                                setDraggedAnnotationId(null);
                              }
                            }}
                            onFocus={() => { setHoveredAnchor({ lineIndex, slotIndex }); setHoveredChordId(annotation?.id ?? null); }}
                            onMouseEnter={() => { setHoveredAnchor({ lineIndex, slotIndex }); setHoveredChordId(annotation?.id ?? null); }}
                            onMouseLeave={() => { setHoveredAnchor(null); setHoveredChordId(null); }}
                            style={{ gridColumn: slotIndex + 1, gridRow: 1 }}
                            type="button"
                          >
                            <span className="musician-slot-chord">{annotation ? displayChord(annotation.chord, { capo: chordChart.capo, detailMode, displayMode }) : "·"}</span>
                          </button>
                        );
                      };
                      return (
                        <div className="musician-line-grid" key={`${lineIndex}-${line}`} style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(1ch, 1ch))` }}>
                          {Array.from({ length: totalSlots }, (_, slotIndex) => renderSlot(slotIndex))}
                          {Array.from({ length: line.length }, (_, charIndex) => (
                            <button
                              className={`musician-char ${line[charIndex] === " " ? "is-space" : ""} ${hoveredAnchor?.lineIndex === lineIndex && hoveredAnchor.slotIndex === LEADING_CHORD_ANCHORS + charIndex ? "is-anchor-hovered" : ""}`}
                              disabled={!canEdit}
                              key={`${lineIndex}-char-${charIndex}`}
                              onClick={() => {
                                const slotIndex = LEADING_CHORD_ANCHORS + charIndex;
                                const annotation = annotations.find((candidate) => candidate.anchorIndex === slotIndex);
                                startInlineChordEdit(lineIndex, slotIndex, annotation);
                              }}
                              style={{ gridColumn: LEADING_CHORD_ANCHORS + charIndex + 1, gridRow: 2 }}
                              type="button"
                            >
                              {line[charIndex] === " " ? "\u00a0" : line[charIndex]}
                            </button>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="field-help">Add lyrics first, then place chord annotations over individual words without changing the lyric text.</p>
                )}
              </div>
              {legacyChords ? <p className="field-help">Legacy chord text will be preserved when this song is saved.</p> : null}
            </section>
          ) : null}
        </div>
      </section>
    </div>
  );
}
