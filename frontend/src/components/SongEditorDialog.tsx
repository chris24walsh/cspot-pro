import { Archive, ArrowRightLeft, Columns3, Copy, Guitar, Link2, ListRestart, Search, Save, Trash2, WandSparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { createSong, updateSong, type Song } from "../api";
import {
  chordPositionForLine,
  createEmptyChordChart,
  clearChordAnnotations,
  deriveCapoKey,
  displayChord,
  LEADING_CHORD_ANCHORS,
  lyricLines,
  MUSICAL_KEYS,
  normalizeChordSymbolInput,
  parseChordChart,
  removeChordAnnotation,
  resolveChordAnnotations,
  serializeChordChart,
  setChordChartAbsoluteKey,
  semitoneDistance,
  TRAILING_CHORD_ANCHORS,
  transposeChordSymbol,
  upsertChordAnnotation,
  validateChordSymbol,
  wrapChordEditorLine,
  type ChordAnnotation,
  type ChordChartDocument,
  type ChordDetailMode,
  type ChordDisplayMode,
} from "../chordSheet";
import { normalizeSongRhythm, type BarMarker, type BarRhythmChange } from "../songRhythm";
import { buildPracticePerformance, PracticeAudioPlayer, parseBarChart, transposeBarCharts } from "../musicPractice";
import { canonicalizeWorshipLyrics, normalizeWorshipSequence } from "../worshipText";
import { useConfirmationDialog } from "./ConfirmationDialog";
import { chordBeats, placeBarMarker, removeBarMarker, rhythmWithBarMarkers } from "../barMarkers";
import { timedPracticeBars, lyricBarLayout, lyricColumnWidths, wrapTimedLine, lyricCursorAt, lyricPlaybackBars, musicalSectionKey, type LyricCursor } from "../lyricTiming";
import { LyricMusicControls, TimingDot } from "./LyricMusicControls";
import { CompactControlMenu } from "./CompactControlMenu";
import { BarRhythmEditor } from "./BarRhythmEditor";
import { SongRhythmEditor } from "./SongRhythmEditor";
import { SongYouTubeSearch } from "./SongYouTubeSearch";
import { useEscapeClose } from "./useEscapeClose";

type SongForm = Omit<Song, "id" | "lyrics_status">;
type SongEditorTab = "lyrics" | "details" | "chords";
type GuitarShapeMode = "standard" | "open-e";
type GuitarChordShape = {
  baseFret?: number;
  frets: Array<number | "x">;
  fingers?: Array<number | null>;
  label?: string;
};

export function chordEditorLineLengthForWidth(panelWidth: number) {
  // Allow only for the preview border, compact horizontal padding, and a small
  // safety gutter for chord labels that extend beyond their anchor.
  const usableWidth = Math.max(0, panelWidth - 28);
  return Math.max(14, Math.min(90, Math.floor(usableWidth / 12)));
}

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
    rhythm: song.rhythm ?? null,
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
  const lyrics = form.lyrics ? canonicalizeWorshipLyrics(form.lyrics, form.sequence) : null;
  const sequence = normalizeWorshipSequence(form.sequence, lyrics);
  return {
    title: form.title.trim(),
    alternate_title: form.alternate_title || null,
    author: form.author || null,
    lyrics,
    chords,
    rhythm: normalizeSongRhythm(rhythmWithBarMarkers(form.rhythm, parseChordChart(chords, lyrics).document.annotations)),
    ccli_number: form.ccli_number || null,
    book_reference: form.book_reference || null,
    license: form.license || null,
    sequence,
    youtube_id: form.youtube_id || null,
    external_link: form.external_link || null,
    worship_role: form.worship_role || "any",
    energy: form.energy ? Number(form.energy) : null,
    tempo: form.tempo || null,
    theme_tags: form.theme_tags || null,
  };
}

function savedSongSignature(song: Song) {
  const parsed = parseChordChart(song.chords, song.lyrics);
  return JSON.stringify(normalizeForm(formFromSong(song), serializeChordChart(parsed.document, parsed.legacyText)));
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

function sectionLabel(line: string) {
  return line.trim().match(/^\[([^\]]+)\]$/)?.[1]?.trim() ?? null;
}

function isVerseLabel(label: string | null) {
  return Boolean(label?.match(/^v(?:erse)?\s*\d*/i));
}

function verseSections(lines: string[]) {
  const sections: Array<{ end: number; label: string; start: number }> = [];
  lines.forEach((line, index) => {
    const label = sectionLabel(line);
    if (!isVerseLabel(label)) return;
    let end = lines.length;
    for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
      if (sectionLabel(lines[nextIndex])) {
        end = nextIndex;
        break;
      }
    }
    sections.push({ end, label: label ?? "Verse", start: index + 1 });
  });
  return sections;
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
  onFindLyrics,
  onSaved,
  song,
}: {
  canEdit: boolean;
  mode?: "create" | "edit";
  onArchive?: (song: Song) => void | Promise<void>;
  onClose: () => void;
  onFindLyrics?: (song: Song) => void;
  onSaved: (song: Song) => void | Promise<void>;
  song: Song;
}) {
  const { confirm, confirmationDialog } = useConfirmationDialog();
  useEscapeClose(true, onClose);
  const [youtubeSearchOpen, setYoutubeSearchOpen] = useState(false);
  const [tab, setTab] = useState<SongEditorTab>("lyrics");
  const [barEditing, setBarEditing] = useState(false);
  const [combinedEditing, setCombinedEditing] = useState(false);
  const modeHoldTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const modeHoldTriggered = useRef(false);
  function clearModeHold() { if (modeHoldTimer.current) clearTimeout(modeHoldTimer.current); modeHoldTimer.current = null; }
  useEffect(() => clearModeHold, []);
  function enableCombinedEditing() { clearModeHold(); setCombinedEditing(true); setBarEditing(false); cancelInlineChordEdit(); setDraggedBarId(null); setDraggedAnnotationId(null); }

  const [transposeChordsOnKeyChange, setTransposeChordsOnKeyChange] = useState(true);
  const [form, setForm] = useState<SongForm>(() => formFromSong(song));
  const [chordChart, setChordChart] = useState<ChordChartDocument>(() => parseChordChart(song.chords, song.lyrics).document);
  const [legacyChords, setLegacyChords] = useState<string | null>(() => parseChordChart(song.chords, song.lyrics).legacyText);
  const [selectedLineIndex, setSelectedLineIndex] = useState(0);
  const [selectedAnchorIndex, setSelectedAnchorIndex] = useState(0);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [inlineChordEditorOpen, setInlineChordEditorOpen] = useState(false);
  const [chordInput, setChordInput] = useState("");
  const [editingBarId, setEditingBarId] = useState<string | null>(null);
  const [chordBeat, setChordBeat] = useState<number | undefined>();
  const previewPlayer = useRef<PracticeAudioPlayer | null>(null);
  const [previewingBar, setPreviewingBar] = useState(false);
  useEffect(() => () => previewPlayer.current?.stop(), []);
  const [draggedBarId, setDraggedBarId] = useState<string | null>(null);
  const [draggedAnnotationId, setDraggedAnnotationId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ lineIndex: number; slotIndex: number } | null>(null);
  const [hoveredAnchor, setHoveredAnchor] = useState<{ lineIndex: number; slotIndex: number } | null>(null);
  const [hoveredChordId, setHoveredChordId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [chordEditorLineLength, setChordEditorLineLength] = useState(80);
  const chordChartPanelRef = useRef<HTMLDivElement | null>(null);
  const [persistedSongId, setPersistedSongId] = useState<string | null>(mode === "edit" ? song.id : null);
  const [lastSavedSong, setLastSavedSong] = useState(song);
  const [savedSignature, setSavedSignature] = useState(() => mode === "create" ? "" : savedSongSignature(song));
  const displayMode: ChordDisplayMode = "absolute";
  const detailMode: ChordDetailMode = "advanced";
  const chordLyrics = useMemo(
    () => form.lyrics ? canonicalizeWorshipLyrics(form.lyrics, form.sequence) : null,
    [form.lyrics, form.sequence],
  );
  const lines = useMemo(() => lyricLines(chordLyrics), [chordLyrics]);
  const lineAnnotations = resolveChordAnnotations(chordChart.annotations, chordLyrics)
    .slice()
    .sort((left, right) => left.absoluteLineIndex - right.absoluteLineIndex || left.anchorIndex - right.anchorIndex);
  const effectiveRhythm = useMemo(() => rhythmWithBarMarkers(form.rhythm, chordChart.annotations), [form.rhythm, chordChart.annotations]);
  const [musicCursor, setMusicCursor] = useState<LyricCursor | null>(null);
  const timingBars = useMemo(() => lyricBarLayout(chordLyrics, effectiveRhythm, chordChart.annotations), [chordLyrics, effectiveRhythm, chordChart.annotations]);
  const lineBars = resolveChordAnnotations(form.rhythm?.markers ?? [], chordLyrics);
  useEffect(() => {
    const dot = chordChartPanelRef.current?.querySelector('.lyric-timing-dot');
    dot?.closest('.musician-line-grid')?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
  }, [musicCursor?.lineIndex]);
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
    const parsed = parseChordChart(song.chords, song.lyrics);
    setChordChart(parsed.document);
    setLegacyChords(parsed.legacyText);
    setTab("lyrics");
    setTransposeChordsOnKeyChange(true);
    setBarEditing(false);
    setMessage(null);
    setPersistedSongId(mode === "edit" ? song.id : null);
    setLastSavedSong(song);
    setSavedSignature(mode === "create" ? "" : savedSongSignature(song));
  }, [mode, song]);

  useEffect(() => {
    setSelectedLineIndex((current) => Math.min(current, Math.max(lines.length - 1, 0)));
  }, [lines]);

  useEffect(() => {
    if (tab !== "chords" || !chordChartPanelRef.current) return;
    const panel = chordChartPanelRef.current;
    const updateLineLength = () => {
      setChordEditorLineLength(chordEditorLineLengthForWidth(panel.clientWidth));
    };
    updateLineLength();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(updateLineLength);
    observer.observe(panel);
    return () => observer.disconnect();
  }, [tab]);

  function normalizeChordInput(value: string) {
    const input = normalizeChordSymbolInput(value);
    const validation = validateChordSymbol(input);
    return validation.normalized || input;
  }

  function editableChordValue(annotation: ChordAnnotation) {
    return displayChord(annotation.chord, { capo: chordChart.capo, detailMode: "advanced", displayMode });
  }

  function updateAbsoluteKey(nextValue: string) {
    setChordChart((current) => setChordChartAbsoluteKey(current, nextValue, { transposeChords: transposeChordsOnKeyChange }));
    if (transposeChordsOnKeyChange) {
      if (chordChart.absoluteKey && nextValue) setForm((current) => ({ ...current, rhythm: transposeBarCharts(current.rhythm, semitoneDistance(chordChart.absoluteKey!, nextValue)) }));
      setLegacyChords(null);
    }
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


  function startInlineChordEdit(lineIndex: number, anchorIndex: number, annotation?: ChordAnnotation) {
    previewPlayer.current?.stop();
    setPreviewingBar(false);
    if (!chordChart.absoluteKey && !chordChart.capoKey) {
      setMessage("Set the song key before adding chords.");
      return;
    }
    setChordBeat(annotation?.beat);
    setSelectedLineIndex(lineIndex);
    setSelectedAnchorIndex(anchorIndex);
    setEditingAnnotationId(annotation?.id ?? null);
    setInlineChordEditorOpen(true);
    setChordInput(annotation ? editableChordValue(annotation) : "");
  }

  function cancelInlineChordEdit() {
    previewPlayer.current?.stop();
    setPreviewingBar(false);
    setEditingAnnotationId(null);
    setInlineChordEditorOpen(false);
    setHoveredAnchor(null);
    setHoveredChordId(null);
    setChordInput("");
  }

  function draftChordTiming() {
    const position = chordPositionForLine(chordLyrics, selectedLineIndex);
    if (!position) throw new Error("Choose a lyric line first.");
    const validation = validateChordSymbol(chordInput);
    if (validation.error) throw new Error(validation.error);
    const chord = transposeChordSymbol(validation.normalized, displayMode === "capo" ? chordChart.capo : 0);
    const draft = upsertChordAnnotation(chordChart, { ...position, anchorIndex: selectedAnchorIndex, id: editingAnnotationId, chord, beat: chordBeat });
    const bars = lyricBarLayout(chordLyrics, form.rhythm, draft.annotations);
    const bar = bars.find(bar => bar.stops.some(stop => stop.lineIndex === selectedLineIndex && stop.anchorIndex === selectedAnchorIndex));
    if (bar) {
      const resolved = resolveChordAnnotations(draft.annotations, chordLyrics);
      chordBeats(bar.stops.slice(0, -1).map(stop => resolved.find(chord => chord.absoluteLineIndex === stop.lineIndex && chord.anchorIndex === stop.anchorIndex) ?? {}), bar.rhythm?.numerator ?? form.rhythm?.numerator ?? 4, true);
    }
    if (chordBeat !== undefined && bar) {
      const stop = bar.stops.findIndex(stop => stop.lineIndex === selectedLineIndex && stop.anchorIndex === selectedAnchorIndex);
      if (stop === 0 && chordBeat !== 1) throw new Error("The first chord starts on beat 1. Add a bar boundary before it to change its bar.");
    }
    return { draft, bar };
  }

  async function previewChordBar() {
    if (previewingBar) { previewPlayer.current?.stop(); setPreviewingBar(false); return; }
    try {
      const { draft, bar } = draftChordTiming();
      if (!bar || !effectiveRhythm) throw new Error("Add bar markers to set chord timing.");
      const bars = timedPracticeBars(chordLyrics, [bar], draft.annotations, effectiveRhythm.numerator);
      const player = new PracticeAudioPlayer(); previewPlayer.current = player;
      setPreviewingBar(true);
      await player.play(buildPracticePerformance(effectiveRhythm, { mode: "song", countIn: false, metronome: true, bars }), true, () => {}, () => setPreviewingBar(false));
    } catch (error) { setPreviewingBar(false); setMessage(error instanceof Error ? error.message : "Could not preview bar."); }
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
    try { draftChordTiming(); } catch (error) { setMessage(error instanceof Error ? error.message : "Invalid chord timing."); return; }
    const storedChord = transposeChordSymbol(validation.normalized, displayMode === "capo" ? chordChart.capo : 0, {
      detailMode: "advanced",
      preferFlats: chordChart.absoluteKey?.includes("b") || chordChart.capoKey?.includes("b"),
    });
    const position = chordPositionForLine(chordLyrics, selectedLineIndex);
    if (!position) {
      setMessage("Choose a lyric line before adding a chord.");
      return;
    }
    setChordChart((current) =>
      upsertChordAnnotation(current, {
        chord: storedChord,
        id: editingAnnotationId,
        ...position,
        anchorIndex: selectedAnchorIndex,
        beat: chordBeat,
      }),
    );
    setLegacyChords(null);
    cancelInlineChordEdit();
  }

  function saveOrCloseInlineEditor() {
    if (chordInput.trim()) {
      saveAnnotation();
    } else if (editingAnnotationId) {
      setChordChart((current) => removeChordAnnotation(current, editingAnnotationId));
      setLegacyChords(null);
      cancelInlineChordEdit();
    } else {
      cancelInlineChordEdit();
    }
  }

  function openBarSettings(marker: BarMarker) {
    cancelInlineChordEdit();
    setEditingBarId(marker.id);
  }

  function saveBarSettings(change: BarRhythmChange | undefined) {
    if (!form.rhythm) return;
    const next = { ...form.rhythm, markers: form.rhythm.markers?.map(marker => marker.id === editingBarId ? { ...marker, rhythm: change } : marker) };
    const resolved = resolveChordAnnotations(chordChart.annotations, chordLyrics);
    try {
      for (const bar of lyricBarLayout(chordLyrics, next, chordChart.annotations)) {
        chordBeats(bar.stops.slice(0, -1).map(stop => resolved.find(chord => chord.absoluteLineIndex === stop.lineIndex && chord.anchorIndex === stop.anchorIndex) ?? {}), bar.rhythm?.numerator ?? next.numerator, true);
      }
    } catch { return "An assigned chord beat falls outside this meter or overlaps another change. Adjust the chord timing before shortening this bar."; }
    setForm(current => ({ ...current, rhythm: next }));
    setEditingBarId(null);
  }

  function editBarAt(lineIndex: number, anchorIndex: number, movingId?: string) {
    if (!canEdit) return;
    const position = chordPositionForLine(chordLyrics, lineIndex);
    if (!position) return;
    const clicked = form.rhythm?.markers?.find(marker => marker.section === position.section && marker.lineIndex === position.lineIndex && marker.anchorIndex === anchorIndex);
    if (clicked && !movingId) { openBarSettings(clicked); return; }
    setForm((current) => {
      const existing = current.rhythm?.markers?.find((marker) => marker.section === position.section && marker.lineIndex === position.lineIndex && marker.anchorIndex === anchorIndex);
      const rhythm = !movingId && existing && current.rhythm
        ? removeBarMarker(current.rhythm, chordChart.annotations, existing.id)
        : placeBarMarker(current.rhythm, chordChart.annotations, { ...position, anchorIndex }, movingId);
      return { ...current, rhythm };
    });
  }

  function moveAnnotation(annotationId: string, lineIndex: number, anchorIndex: number) {
    const annotation = chordChart.annotations.find((candidate) => candidate.id === annotationId);
    const position = chordPositionForLine(chordLyrics, lineIndex);
    if (!annotation || !position) return;
    setChordChart((current) => upsertChordAnnotation(current, { ...annotation, ...position, anchorIndex }));
    setLegacyChords(null);
  }

  function barsAtChords() {
    if (!canEdit) return;
    setForm(current => {
      let rhythm = current.rhythm;
      for (const chord of chordChart.annotations) {
        if (rhythm?.markers?.some(marker => marker.section === chord.section && marker.lineIndex === chord.lineIndex && marker.anchorIndex === chord.anchorIndex)) continue;
        rhythm = placeBarMarker(rhythm, chordChart.annotations, { section: chord.section, lineIndex: chord.lineIndex, anchorIndex: chord.anchorIndex });
      }
      return { ...current, rhythm };
    });
  }

  function dropAt(lineIndex: number, anchorIndex: number) {
    setDropTarget(null);
    if (!canEdit) return;
    if (combinedEditing) {
      const source = chordChart.annotations.find(chord => chord.id === draggedAnnotationId) ?? form.rhythm?.markers?.find(bar => bar.id === draggedBarId);
      const position = chordPositionForLine(chordLyrics, lineIndex);
      if (!source || !position) return;
      const chord = chordChart.annotations.find(chord => chord.section === source.section && chord.lineIndex === source.lineIndex && chord.anchorIndex === source.anchorIndex);
      const bar = form.rhythm?.markers?.find(bar => bar.section === source.section && bar.lineIndex === source.lineIndex && bar.anchorIndex === source.anchorIndex);
      const nextChart = chord ? upsertChordAnnotation(chordChart, { ...chord, ...position, anchorIndex }) : chordChart;
      if (chord) { setChordChart(nextChart); setLegacyChords(null); }
      if (bar) setForm(current => ({ ...current, rhythm: placeBarMarker(current.rhythm, nextChart.annotations, { ...position, anchorIndex }, bar.id) }));
    } else if (barEditing && draggedBarId) editBarAt(lineIndex, anchorIndex, draggedBarId);
    else if (!barEditing && draggedAnnotationId) moveAnnotation(draggedAnnotationId, lineIndex, anchorIndex);
    setDraggedAnnotationId(null); setDraggedBarId(null);
  }

  function copyVerseChords() {
    const sections = verseSections(lines);
    if (sections.length < 2) {
      setMessage("Add at least two verse sections before copying chords.");
      return;
    }
    const selectedSection = sections.find((section) => selectedLineIndex >= section.start && selectedLineIndex < section.end);
    const sourceSection =
      selectedSection ??
      sections.find((section) =>
        lineAnnotations.some((annotation) => annotation.absoluteLineIndex >= section.start && annotation.absoluteLineIndex < section.end),
      );
    if (!sourceSection) {
      setMessage("Add chords to one verse before copying them.");
      return;
    }
    const sourceAnnotations = lineAnnotations.filter(
      (annotation) => annotation.absoluteLineIndex >= sourceSection.start && annotation.absoluteLineIndex < sourceSection.end,
    );
    if (!sourceAnnotations.length) {
      setMessage("Add chords to the selected verse before copying them.");
      return;
    }
    setChordChart((current) => {
      const targetSections = sections.filter((section) => section !== sourceSection);
      const targetLineIndexes = new Set<number>();
      for (const section of targetSections) {
        const lineCount = section.end - section.start;
        for (let offset = 0; offset < lineCount; offset += 1) {
          targetLineIndexes.add(section.start + offset);
        }
      }
      const replacedAnnotationIds = new Set(
        lineAnnotations
          .filter((annotation) => targetLineIndexes.has(annotation.absoluteLineIndex))
          .map((annotation) => annotation.id),
      );
      const retained = current.annotations.filter((annotation) => !replacedAnnotationIds.has(annotation.id));
      const copied = targetSections.flatMap((section) =>
        sourceAnnotations.flatMap((annotation) => {
          const offset = annotation.absoluteLineIndex - sourceSection.start;
          const targetLineIndex = section.start + offset;
          const targetLine = lines[targetLineIndex];
          if (targetLine == null || targetLineIndex >= section.end) return [];
          const position = chordPositionForLine(chordLyrics, targetLineIndex);
          if (!position) return [];
          return [{
            id: `${targetLineIndex}-${annotation.anchorIndex}-${annotation.chord}-${Math.random().toString(36).slice(2, 7)}`,
            ...position,
            anchorIndex: annotation.anchorIndex,
            chord: annotation.chord,
            beat: annotation.beat,
          }];
        }),
      );
      return { ...current, annotations: [...retained, ...copied] };
    });
    setLegacyChords(null);
    setMessage("Verse chords copied.");
  }

  async function clearAllChords() {
    if (!canEdit || (!lineAnnotations.length && !legacyChords)) return;
    const confirmed = await confirm({
      confirmLabel: "Clear all chords",
      message: "Remove every chord annotation from this song? The lyrics, key, and capo will be kept.",
      title: "Clear all chords",
      tone: "danger",
    });
    if (!confirmed) return;
    setChordChart((current) => clearChordAnnotations(current));
    setLegacyChords(null);
    cancelInlineChordEdit();
    setMessage("All chords cleared. Save the song to keep this change.");
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
      for (const chart of form.rhythm?.arrangements ?? []) {
        const managed = form.rhythm?.markers?.some(marker => (marker.section ?? "Default") === chart.section);
        if (!managed) parseBarChart(chart.chart, form.rhythm!.numerator, chart.section);
      }
      const payload = normalizeForm(form, serializeChordChart(chordChart, legacyChords));
      const saved = persistedSongId ? await updateSong(persistedSongId, payload) : await createSong(payload);
      setPersistedSongId(saved.id);
      setLastSavedSong(saved);
      setSavedSignature(savedSongSignature(saved));
      await onSaved(saved);
      setMessage("Saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save song.");
    } finally {
      setSaving(false);
    }
  }

  async function formatLyricsAndSequence() {
    if (!canEdit || !persistedSongId || isDirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const normalized = normalizeForm(form, serializeChordChart(chordChart, legacyChords));
      const saved = await updateSong(persistedSongId, {
        lyrics: normalized.lyrics,
        sequence: normalized.sequence,
      });
      setForm(formFromSong(saved));
      setLastSavedSong(saved);
      setSavedSignature(savedSongSignature(saved));
      await onSaved(saved);
      setMessage("Formatted lyric labels and sequence.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not format this song.");
    } finally {
      setSaving(false);
    }
  }

  const currentSignature = JSON.stringify(normalizeForm(form, serializeChordChart(chordChart, legacyChords)));
  const isDirty = currentSignature !== savedSignature;

  async function archiveSong() {
    if (!onArchive) return;
    const confirmed = await confirm({
      confirmLabel: "Archive song",
      message: `Archive “${lastSavedSong.title}”?`,
      title: "Archive song",
      tone: "danger",
    });
    if (confirmed) await onArchive(lastSavedSong);
  }

  return (
    <>
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
              {mode === "edit" ? (
                <button
                  aria-label="Format lyric labels and sequence"
                  className="section-icon-button song-editor-action-button"
                  disabled={saving || isDirty || !canEdit || !lastSavedSong.lyrics?.trim()}
                  onClick={() => void formatLyricsAndSequence()}
                  title={isDirty ? "Save changes before formatting" : "Format lyric labels and sequence"}
                  type="button"
                >
                  <ListRestart size={16} aria-hidden="true" />
                </button>
              ) : null}
              {mode === "edit" && !lastSavedSong.lyrics?.trim() && onFindLyrics ? (
                <button
                  aria-label="Find lyrics from provider"
                  className="section-icon-button song-editor-action-button"
                  disabled={saving || isDirty || !canEdit}
                  onClick={() => onFindLyrics(lastSavedSong)}
                  title={isDirty ? "Save changes before finding lyrics" : "Find lyrics from provider"}
                  type="button"
                >
                  <WandSparkles size={16} aria-hidden="true" />
                </button>
              ) : null}
              {mode === "edit" && onArchive ? (
                <button
                  aria-label="Archive song"
                  className="section-icon-button section-remove-button song-editor-action-button"
                  disabled={saving || !canEdit}
                  onClick={() => void archiveSong()}
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
                disabled={saving || !isDirty || !canEdit || !form.title.trim()}
                onClick={() => void saveSong()}
                title={saving ? "Saving..." : "Save song"}
                type="button"
              >
                <Save size={16} aria-hidden="true" />
              </button>
              <span className={`song-editor-save-status ${isDirty ? "is-unsaved" : "is-saved"}`}>
                {saving ? "Saving…" : isDirty ? "Unsaved" : "Saved"}
              </span>
            </div>
          </div>
          {message ? <p className="form-message">{message}</p> : null}
          <div className="song-editor-tab-toolbar">
            <div className="song-editor-tab-group">
              <div className="tab-row" role="tablist" aria-label="Song editor sections">
                {(["lyrics", "details", "chords"] as const).map((nextTab) => (
                  <button className={`tab-button ${tab === nextTab ? "active" : ""}`} key={nextTab} onClick={() => setTab(nextTab)} type="button">
                    {nextTab[0].toUpperCase() + nextTab.slice(1)}
                  </button>
                ))}
              </div>
              {tab === "chords" ? <button aria-label="Switch between chord and bar editing" aria-pressed={barEditing || combinedEditing} className={`section-icon-button section-edit-button musician-bars-toggle ${barEditing || combinedEditing ? "is-active" : ""}`} onContextMenu={event => { event.preventDefault(); enableCombinedEditing(); }} onPointerDown={event => { if (event.button !== 0) return; modeHoldTriggered.current = false; clearModeHold(); modeHoldTimer.current = setTimeout(() => { modeHoldTriggered.current = true; enableCombinedEditing(); }, 500); }} onPointerUp={clearModeHold} onPointerCancel={clearModeHold} onPointerLeave={clearModeHold} onClick={() => { if (modeHoldTriggered.current) { modeHoldTriggered.current = false; return; } if (combinedEditing) { setCombinedEditing(false); setBarEditing(false); } else setBarEditing(enabled => !enabled); cancelInlineChordEdit(); setDraggedBarId(null); setDraggedAnnotationId(null); }} title="Click to switch chords/bars; right-click or hold to move both together" type="button">{combinedEditing ? <Link2 size={15} aria-hidden="true" /> : barEditing ? <Columns3 size={15} aria-hidden="true" /> : <Guitar size={15} aria-hidden="true" />}<span>{combinedEditing ? "Both" : barEditing ? "Bars" : "Chords"}</span></button> : null}
              {tab === "chords" ? <LyricMusicControls rhythm={effectiveRhythm} lyrics={chordLyrics} sequence={form.sequence} annotations={chordChart.annotations} bars={timingBars} onCursor={setMusicCursor} /> : null}
              {tab === "chords" ? <SongRhythmEditor annotations={chordChart.annotations} onPosition={(position, mode, section) => {
                const timeline = lyricPlaybackBars(chordLyrics, form.sequence, timingBars).filter(bar => mode !== "part" || musicalSectionKey(bar.section) === musicalSectionKey(section));
                const uniquePart = mode === "part" ? timeline.filter(bar => bar.occurrence === timeline[0]?.occurrence) : timeline;
                setMusicCursor(position === null || mode === "strum" || !effectiveRhythm ? null : lyricCursorAt(chordLyrics, uniquePart, position, effectiveRhythm.numerator, effectiveRhythm.denominator));
              }} value={effectiveRhythm} canEdit={canEdit} lyrics={chordLyrics} sequence={form.sequence} previewChord={activeDisplayedChord ?? chordChart.absoluteKey ?? "C"} songChords={lineAnnotations.map((entry) => ({ section: entry.section, chord: entry.chord }))} onSave={saveSong} saving={saving} isDirty={isDirty} onChange={(rhythm) => setForm((current) => ({ ...current, rhythm }))} /> : null}
            </div>
            {tab === "chords" ? (
              <CompactControlMenu label="Chord tools" icon={<Guitar size={16} aria-hidden="true" />}>
                {close => <>
                  <div className="song-chord-menu-key" role="group" aria-label="Key and capo">
                    <label className="compact-field musician-key-field">
                      Key
                      <select disabled={!canEdit} onChange={(event) => updateAbsoluteKey(event.target.value)} value={chordChart.absoluteKey ?? ""}>
                        <option value="">Unset</option>
                        {MUSICAL_KEYS.map((keyOption) => <option key={keyOption} value={keyOption}>{keyOption}</option>)}
                      </select>
                    </label>
                    <label className="compact-field musician-capo-field">Capo<select disabled={!canEdit} onChange={(event) => updateCapo(Number(event.target.value))} value={chordChart.capo}>{[0, 1, 2, 3, 4, 5].map((capo) => <option key={capo} value={capo}>{capo}</option>)}</select></label>
                    <button
                      aria-label="Transpose chords when changing key"
                      aria-pressed={transposeChordsOnKeyChange}
                      className={`section-icon-button musician-transpose-toggle ${transposeChordsOnKeyChange ? "is-active" : ""}`}
                      disabled={!canEdit}
                      onClick={() => setTransposeChordsOnKeyChange((enabled) => !enabled)}
                      title={transposeChordsOnKeyChange ? "Transpose chords when changing key: on. Click to preserve existing chords." : "Transpose chords when changing key: off. Click to transpose existing chords."}
                      type="button"
                    >
                      <ArrowRightLeft size={15} aria-hidden="true" />
                    </button>
                    </div>
                    <hr />
                      <button aria-label="Copy verse chords" className="text-button musician-copy-verse-button" disabled={!canEdit || lineAnnotations.length === 0} role="menuitem" onClick={() => { close(); copyVerseChords(); }} title="Copy verse chords" type="button">
                        <Copy size={14} aria-hidden="true" />
                        <span>Copy verse chords</span>
                      </button>
                      <button aria-label="Add bars at all chords" role="menuitem" disabled={!canEdit || !chordChart.annotations.length} onClick={() => { close(); barsAtChords(); }} type="button"><Columns3 size={14} aria-hidden="true" /><span>Bars at chords</span></button>
                  <button aria-label="Clear all chords" className="danger-button musician-clear-chords-button" disabled={!canEdit || (!lineAnnotations.length && !legacyChords)} role="menuitem" onClick={() => { close(); void clearAllChords(); }} title="Clear all chords" type="button">
                        <Trash2 size={14} aria-hidden="true" />
                        <span>Clear all chords</span>
                      </button>
              </>}
              </CompactControlMenu>
            ) : null}
          </div>
        </div>

        <div className={`song-editor-scroll is-${tab}-tab`}>
          {tab === "details" ? (
            <div className="form-grid">
              <label>Title<input disabled={!canEdit} onChange={(event) => setForm({ ...form, title: event.target.value })} required value={form.title} /></label>
              <div className="field-block worship-slot-field">
                <span>Song Type</span>
                <div className="checkbox-pill-grid">
                  {WORSHIP_SLOT_OPTIONS.map((option) => {
                    const selectedValues = worshipRoleValues(form.worship_role);
                    return (
                      <label className={`checkbox-pill ${selectedValues.has(option.value) ? "selected" : ""}`} key={option.value}>
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
                <small className="field-help">Types are learned after a worship-set date passes. A removed type stays removed until the song is used in that position again.</small>
              </div>
              <label className="wide-field">
                <span>Categories</span>
                <input
                  disabled={!canEdit}
                  onChange={(event) => setForm({ ...form, theme_tags: event.target.value })}
                  placeholder="hymn, gentle, unaccompanied, big band, christmas, easter"
                  value={form.theme_tags ?? ""}
                />
                <small className="field-help">Comma-separated. Christmas, Easter, Advent, and Lent songs stay out of general suggestions.</small>
              </label>
              <label className="wide-field youtube-field">
                <span>YouTube Link / ID</span>
                <span className="inline-input-action">
                  <input disabled={!canEdit} onBlur={(event) => setForm({ ...form, youtube_id: extractYouTubeId(event.target.value) })} onChange={(event) => setForm({ ...form, youtube_id: event.target.value })} value={form.youtube_id ?? ""} />
                  <button aria-label="Search YouTube for this song" className="section-icon-button" onClick={() => setYoutubeSearchOpen((open) => !open)} title="Search YouTube" type="button">
                    <Search size={15} aria-hidden="true" />
                  </button>
                </span>
              </label>
              {youtubeSearchOpen ? (
                <SongYouTubeSearch
                  initialQuery={(form.title || song.title).trim()}
                  value={form.youtube_id}
                  canEdit={canEdit}
                  onSelect={(id) => setForm((current) => ({ ...current, youtube_id: id }))}
                  onClose={() => setYoutubeSearchOpen(false)}
                />
              ) : null}
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
              <div className="musician-chart-panel" ref={chordChartPanelRef}>
                {combinedEditing ? <small className="field-help">Drag a chord or bar to move both at that position together. Click the mode toggle to return to chord editing.</small> : null}
                {barEditing ? <small className="field-help">Click a lyric or chord position to add a bar boundary; drag a bar to move it, or click it again to remove it. Chords within each bar divide its time evenly.</small> : null}
                {lines.length ? (
                  <div className="musician-preview">
                    {lines.map((line, lineIndex) => {
                      if (/^\[[^\]]+\]$/.test(line.trim())) {
                        return <div className="musician-section-marker" key={`${lineIndex}-${line}`}>{line}</div>;
                      }
                      const annotations = lineAnnotations.filter((annotation) => annotation.absoluteLineIndex === lineIndex);
                      const totalSlots = line.length + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS;
                      const renderSlot = (slotIndex: number, gridColumn: number) => {
                        const annotation = annotations.find((candidate) => candidate.anchorIndex === slotIndex);
                        const bar = lineBars.find((marker) => marker.absoluteLineIndex === lineIndex && marker.anchorIndex === slotIndex);
                        const isEditing =
                          !barEditing && inlineChordEditorOpen &&
                          selectedLineIndex === lineIndex &&
                          selectedAnchorIndex === slotIndex &&
                          (editingAnnotationId === null ? !annotation : annotation != null && editingAnnotationId === annotation.id);
                        if (isEditing) {
                          const showTimingControls = Boolean(annotation && timingBars.some(timingBar =>
                            timingBar.stops.slice(1, -1).some(stop => stop.lineIndex === lineIndex && stop.anchorIndex === slotIndex),
                          ));
                          return (
                            <span className="musician-slot-editor" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) saveOrCloseInlineEditor(); }} key={`editor-${lineIndex}-${slotIndex}`} style={{ gridColumn, gridRow: 1 }}>
                              <input
                                autoFocus
                                disabled={!canEdit}
                                onChange={(event) => { setChordInput(normalizeChordInput(event.target.value)); previewPlayer.current?.stop(); setPreviewingBar(false); }}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                  }
                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelInlineChordEdit();
                                  }
                                }}
                                onKeyUp={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    saveOrCloseInlineEditor();
                                  }
                                }}
                                placeholder={detailMode === "advanced" ? "BbMAJ7/D" : "Bbm"}
                                size={Math.min(8, Math.max(2, chordInput.length || 2))}
                                value={chordInput}
                              />
                              {showTimingControls ? <>
                              <label className="chord-beat-control">Play on
                                <select aria-label="Chord playback beat" value={chordBeat ?? ""} disabled={!canEdit || !timingBars.length} onChange={event => { setChordBeat(event.target.value ? Number(event.target.value) : undefined); previewPlayer.current?.stop(); setPreviewingBar(false); }}>
                                  <option value="">Auto</option>
                                  {Array.from({ length: (timingBars.find(bar => bar.stops.some(stop => stop.lineIndex === lineIndex && stop.anchorIndex === slotIndex))?.rhythm?.numerator ?? form.rhythm?.numerator ?? 4) * 2 }, (_, i) => 1 + i / 2).map(beat => <option value={beat} key={beat}>{Number.isInteger(beat) ? beat : `& of ${Math.floor(beat)}`}</option>)}
                                </select>
                              </label>
                              <button type="button" disabled={!timingBars.length || !chordInput.trim()} onClick={() => void previewChordBar()}>{previewingBar ? "Stop" : "Loop bar"}</button>
                              <button type="button" onClick={saveOrCloseInlineEditor}>Done</button>
                              </> : null}
                              {annotation ? <button className="musician-delete-button" disabled={!canEdit} onMouseDown={(event) => event.preventDefault()} onClick={() => { setChordChart((current) => removeChordAnnotation(current, annotation.id)); setLegacyChords(null); cancelInlineChordEdit(); }} type="button">x</button> : null}
                            </span>
                          );
                        }
                        return (
                          <button
                            className={`musician-slot ${annotation ? "has-chord" : ""} ${bar ? "has-bar" : ""} ${bar?.rhythm ? "has-rhythm-change" : ""} ${barEditing ? "is-bar-editing" : ""} ${dropTarget?.lineIndex === lineIndex && dropTarget.slotIndex === slotIndex ? "is-drop-target" : ""}`}
                            aria-label={barEditing ? `${bar ? "Settings for" : "Add"} bar at line ${lineIndex + 1}, position ${slotIndex}` : undefined}
                            title={bar ? `Bar settings${bar.rhythm ? ` · ${bar.rhythm.numerator}/${bar.rhythm.denominator} · ${bar.rhythm.scope === "bar" ? "this bar" : "continues"}` : ""}. Right-click to edit; drag to move.` : barEditing ? "Click to add bar" : undefined}
                            disabled={!canEdit}
                            draggable={Boolean(combinedEditing ? bar || annotation : barEditing ? bar : annotation) && canEdit}
                            key={`slot-${lineIndex}-${slotIndex}`}
                            onContextMenu={event => { if (bar) { event.preventDefault(); openBarSettings(bar); } }}
                            onClick={() => barEditing ? editBarAt(lineIndex, slotIndex) : startInlineChordEdit(lineIndex, slotIndex, annotation)}
                            onDragEnd={() => { setDraggedAnnotationId(null); setDraggedBarId(null); setDropTarget(null); }}
                            onDragOver={(event) => { if (combinedEditing ? draggedBarId || draggedAnnotationId : barEditing ? draggedBarId : draggedAnnotationId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget({ lineIndex, slotIndex }); } }}
                            onDragStart={(event) => { if ((barEditing || combinedEditing) && bar) { setDraggedBarId(bar.id); event.dataTransfer.setData("text/plain", bar.id); } else if (annotation) setDraggedAnnotationId(annotation.id); }}
                            onDrop={(event) => {
                              event.preventDefault();
                              dropAt(lineIndex, slotIndex);
                            }}
                            onFocus={() => { setHoveredAnchor({ lineIndex, slotIndex }); setHoveredChordId(annotation?.id ?? null); }}
                            onMouseEnter={() => { setHoveredAnchor({ lineIndex, slotIndex }); setHoveredChordId(annotation?.id ?? null); }}
                            onMouseLeave={() => { setHoveredAnchor(null); setHoveredChordId(null); }}
                            style={{ gridColumn, gridRow: 1 }}
                            type="button"
                          >
                            <span className="musician-slot-chord">{bar?.rhythm ? <small className="chord-beat-label">{bar.rhythm.numerator}/{bar.rhythm.denominator}{bar.rhythm.scope === "continue" ? "→" : ""} </small> : null}{(barEditing || combinedEditing) && bar ? "│ " : ""}{annotation ? <>{displayChord(annotation.chord, { capo: chordChart.capo, detailMode, displayMode })}{annotation.beat !== undefined ? <small className="chord-beat-label">{Number.isInteger(annotation.beat) ? annotation.beat : `&${Math.floor(annotation.beat)}`}</small> : null}</> : barEditing && bar ? "" : "·"}</span>
                          </button>
                        );
                      };
                      return (timingBars.length ? wrapTimedLine(line, chordEditorLineLength, lyricColumnWidths(chordLyrics, timingBars, lineIndex, LEADING_CHORD_ANCHORS, line.length)) : wrapChordEditorLine(line, chordEditorLineLength)).map((segment, segmentIndex, segments) => {
                        const globalSlotStart = segmentIndex === 0 ? 0 : LEADING_CHORD_ANCHORS + segment.start;
                        const globalSlotEnd = segmentIndex === segments.length - 1 ? totalSlots : LEADING_CHORD_ANCHORS + segment.end;
                        const visualSlotCount = globalSlotEnd - globalSlotStart;
                        const widths = lyricColumnWidths(chordLyrics, timingBars, lineIndex, globalSlotStart, visualSlotCount);
                        return (
                          <div className={`musician-line-grid ${segmentIndex > 0 ? "is-continuation" : ""}`} key={`${lineIndex}-${segment.start}`} onDragLeave={event => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setDropTarget(null); }} style={{ gridTemplateColumns: widths.map(width => `${width}ch`).join(" ") }}>
                            {dropTarget?.lineIndex === lineIndex && dropTarget.slotIndex >= globalSlotStart && dropTarget.slotIndex < globalSlotEnd ? <span aria-hidden="true" className="musician-drop-column" style={{ gridColumn: dropTarget.slotIndex - globalSlotStart + 1, gridRow: "1 / 3" }} /> : null}
                            {musicCursor?.lineIndex === lineIndex && musicCursor.anchorIndex >= globalSlotStart && musicCursor.anchorIndex < globalSlotEnd ? <TimingDot widths={widths} anchor={musicCursor.anchorIndex - globalSlotStart} pulse={musicCursor.pulse} /> : null}
                            {Array.from({ length: visualSlotCount }, (_, localSlotIndex) => {
                              const slotIndex = globalSlotStart + localSlotIndex;
                              return renderSlot(slotIndex, localSlotIndex + 1);
                            })}
                            {Array.from({ length: segment.end - segment.start }, (_, localCharIndex) => {
                              const charIndex = segment.start + localCharIndex;
                              return (
                                <button
                                  className={`musician-char ${line[charIndex] === " " ? "is-space" : ""} ${hoveredAnchor?.lineIndex === lineIndex && hoveredAnchor.slotIndex === LEADING_CHORD_ANCHORS + charIndex ? "is-anchor-hovered" : ""} ${dropTarget?.lineIndex === lineIndex && dropTarget.slotIndex === LEADING_CHORD_ANCHORS + charIndex ? "is-drop-target" : ""}`}
                                  disabled={!canEdit}
                                  key={`${lineIndex}-char-${charIndex}`}
                                  onDragOver={(event) => { if (draggedBarId || draggedAnnotationId) { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropTarget({ lineIndex, slotIndex: LEADING_CHORD_ANCHORS + charIndex }); } }}
                                  onDrop={(event) => {
                                    if (draggedBarId || draggedAnnotationId) { event.preventDefault(); dropAt(lineIndex, LEADING_CHORD_ANCHORS + charIndex); }
                                  }}
                                  onClick={() => {
                                    const slotIndex = LEADING_CHORD_ANCHORS + charIndex;
                                    if (barEditing) { editBarAt(lineIndex, slotIndex); return; }
                                    const annotation = annotations.find((candidate) => candidate.anchorIndex === slotIndex);
                                    startInlineChordEdit(lineIndex, slotIndex, annotation);
                                  }}
                                  style={{ gridColumn: LEADING_CHORD_ANCHORS + charIndex - globalSlotStart + 1, gridRow: 2 }}
                                  type="button"
                                >
                                  {line[charIndex] === " " ? "\u00a0" : line[charIndex]}
                                </button>
                              );
                            })}
                          </div>
                        );
                      });
                    })}
                  </div>
                ) : (
                  <p className="field-help">Add lyrics first, then place chord annotations over individual words without changing the lyric text.</p>
                )}
              </div>
              <div className="musician-chord-summary">
                <GuitarChordDiagram chord={activeDisplayedChord} shapeMode="standard" />
              </div>
              {legacyChords ? <p className="field-help">Legacy chord text will be preserved when this song is saved.</p> : null}
            </section>
          ) : null}
        </div>
      </section>
    </div>
    {editingBarId && form.rhythm ? (() => {
      const marker = form.rhythm.markers?.find(marker => marker.id === editingBarId);
      if (!marker) return null;
      const layout = timingBars.find(bar => bar.start.lineIndex === resolveChordAnnotations([marker], chordLyrics)[0]?.absoluteLineIndex && bar.start.anchorIndex === marker.anchorIndex);
      const value: BarRhythmChange = marker.rhythm ?? { numerator: layout?.rhythm?.numerator ?? form.rhythm.numerator, denominator: layout?.rhythm?.denominator ?? form.rhythm.denominator, pattern: layout?.rhythm?.pattern, scope: "bar" };
      return <BarRhythmEditor value={value} songRhythm={form.rhythm} onClose={() => setEditingBarId(null)} onSave={saveBarSettings} onRemove={() => { setForm(current => ({ ...current, rhythm: removeBarMarker(current.rhythm!, chordChart.annotations, editingBarId) })); setEditingBarId(null); }} />;
    })() : null}
    {confirmationDialog}
    </>
  );
}
