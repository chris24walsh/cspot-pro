import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createSong,
  deleteSong,
  getFiles,
  getSongs,
  parseSlideDeck,
  updateSong,
  uploadStoredFile,
  type ParsedSlideDeck,
  type Song,
  type StoredFile,
} from "../api";
import {
  createEmptyChordChart,
  deriveAbsoluteKey,
  deriveCapoKey,
  displayChord,
  MUSICAL_KEYS,
  LEADING_CHORD_ANCHORS,
  lyricLines,
  normalizeKeySignature,
  parseChordChart,
  removeChordAnnotation,
  semitoneDistance,
  serializeChordChart,
  transposeChordSymbol,
  transposeChordAnnotations,
  TRAILING_CHORD_ANCHORS,
  type ChordAnnotation,
  type ChordChartDocument,
  type ChordDetailMode,
  type ChordDisplayMode,
  type KeyAnchorMode,
  upsertChordAnnotation,
} from "../chordSheet";
import { analyzeImportedSongSlides, analyzeWorshipText, formatWorshipText } from "../worshipText";

type SongPayload = Omit<Song, "id" | "lyrics_status">;
type ImportPreview = {
  duplicateSongId: string | null;
  duplicateSongTitle: string | null;
  filename: string;
  notes: string[];
  parsed: ParsedSlideDeck;
  sequence: string | null;
  title: string;
};

type GuitarChordShape = {
  baseFret?: number;
  frets: Array<number | "x">;
  fingers?: Array<number | null>;
};

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

function blankSong(): SongPayload {
  return {
    title: "",
    alternate_title: null,
    author: null,
    lyrics: null,
    chords: null,
    ccli_number: null,
    book_reference: null,
    license: "Unknown",
    sequence: null,
    youtube_id: null,
    external_link: null,
  };
}

function formFromSong(song: Song): SongPayload {
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
  };
}

function normalizeForm(form: SongPayload): SongPayload {
  return {
    title: form.title,
    alternate_title: form.alternate_title || null,
    author: form.author || null,
    lyrics: form.lyrics ? formatWorshipText(form.lyrics, { removeChordLines: true }) : null,
    chords: form.chords || null,
    ccli_number: form.ccli_number || null,
    book_reference: form.book_reference || null,
    license: form.license || null,
    sequence: form.sequence || null,
    youtube_id: form.youtube_id || null,
    external_link: form.external_link || null,
  };
}

function diagramChordKey(chord: string) {
  const main = chord.trim().split("/")[0] ?? "";
  const match = main.match(/^([A-G](?:#|b)?)(m|maj7|maj|min|dim|sus\d?|add\d?|[0-9]*)?/);
  if (!match) {
    return "";
  }

  const [, root, quality = ""] = match;
  if (quality === "m" || quality === "min") {
    return `${root}m`;
  }
  if (quality === "7") {
    return `${root}7`;
  }
  return root;
}

function GuitarChordDiagram({ chord }: { chord: string | null }) {
  const chordKey = chord ? diagramChordKey(chord) : "";
  const shape = chordKey ? GUITAR_CHORDS[chordKey] : null;
  const stringX = [14, 32, 50, 68, 86, 104];
  const fretY = [26, 46, 66, 86, 106];

  if (!chord) {
    return (
      <div className="chord-diagram-card empty">
        <strong>Chord</strong>
        <span>Hover or edit a chord</span>
      </div>
    );
  }

  if (!shape) {
    return (
      <div className="chord-diagram-card empty">
        <strong>{chord}</strong>
        <span>No guitar shape yet</span>
      </div>
    );
  }

  return (
    <div className="chord-diagram-card">
      <strong>{chord}</strong>
      <svg aria-label={`${chord} guitar chord`} className="chord-diagram" role="img" viewBox="0 0 118 128">
        {shape.baseFret && shape.baseFret > 1 ? <text className="chord-fret-label" x="108" y="43">{shape.baseFret}fr</text> : null}
        {stringX.map((x) => (
          <line className="chord-string" key={`string-${x}`} x1={x} x2={x} y1="26" y2="106" />
        ))}
        {fretY.map((y, index) => (
          <line className={index === 0 && !shape.baseFret ? "chord-nut" : "chord-fret"} key={`fret-${y}`} x1="14" x2="104" y1={y} y2={y} />
        ))}
        {shape.frets.map((fret, index) => {
          const x = stringX[index];
          if (fret === "x") {
            return <text className="chord-muted" key={`mark-${index}`} x={x - 4} y="18">x</text>;
          }
          if (fret === 0) {
            return <circle className="chord-open" cx={x} cy="13" key={`mark-${index}`} r="3.5" />;
          }
          const y = fretY[Math.max(0, Math.min(fret - 1, fretY.length - 2))] + 10;
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

export function SongManager({
  canCreate,
  canEdit,
  onDataChange,
}: {
  canCreate: boolean;
  canEdit: boolean;
  onDataChange: () => void;
}) {
  const [songs, setSongs] = useState<Song[]>([]);
  const [selectedSong, setSelectedSong] = useState<Song | null>(null);
  const [mode, setMode] = useState<"edit" | "create">("edit");
  const [form, setForm] = useState<SongPayload>(blankSong());
  const [songFiles, setSongFiles] = useState<StoredFile[]>([]);
  const [fileToUpload, setFileToUpload] = useState<File | null>(null);
  const [fileDisplayName, setFileDisplayName] = useState("");
  const [songDeckFiles, setSongDeckFiles] = useState<File[]>([]);
  const [parsedSongDeck, setParsedSongDeck] = useState<ParsedSlideDeck | null>(null);
  const [importPreviews, setImportPreviews] = useState<ImportPreview[]>([]);
  const [parsedSequence, setParsedSequence] = useState<string | null>(null);
  const [parseNotes, setParseNotes] = useState<string[]>([]);
  const [chordChart, setChordChart] = useState<ChordChartDocument>(createEmptyChordChart());
  const [legacyChords, setLegacyChords] = useState<string | null>(null);
  const [selectedLineIndex, setSelectedLineIndex] = useState(0);
  const [selectedAnchorIndex, setSelectedAnchorIndex] = useState(0);
  const [editingAnnotationId, setEditingAnnotationId] = useState<string | null>(null);
  const [inlineChordEditorOpen, setInlineChordEditorOpen] = useState(false);
  const [chordInput, setChordInput] = useState("");
  const [displayMode, setDisplayMode] = useState<ChordDisplayMode>("absolute");
  const [detailMode, setDetailMode] = useState<ChordDetailMode>("advanced");
  const [draggedAnnotationId, setDraggedAnnotationId] = useState<string | null>(null);
  const [hoveredAnchor, setHoveredAnchor] = useState<{ lineIndex: number; slotIndex: number } | null>(null);
  const [hoveredChordId, setHoveredChordId] = useState<string | null>(null);
  const [activeSongTab, setActiveSongTab] = useState<"details" | "lyrics" | "chords">("details");
  const [searchTerm, setSearchTerm] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const filteredSongs = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) {
      return songs;
    }

    return songs.filter((song) =>
      [song.title, song.alternate_title, song.author, song.ccli_number]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(query)),
    );
  }, [songs, searchTerm]);

  const lines = useMemo(() => lyricLines(form.lyrics), [form.lyrics]);
  const editableKey = chordChart.keyAnchor === "absolute" ? chordChart.absoluteKey : chordChart.capoKey;
  const derivedKey = chordChart.keyAnchor === "absolute" ? chordChart.capoKey : chordChart.absoluteKey;
  function hydrateChordState(raw: string | null) {
    const parsed = parseChordChart(raw);
    setChordChart(parsed.document);
    setLegacyChords(parsed.legacyText);
    setEditingAnnotationId(null);
    setInlineChordEditorOpen(false);
    setHoveredChordId(null);
    setChordInput("");
  }

  function normalizedSongKey(value: string) {
    return value.trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  }

  function findDuplicateSong(title: string) {
    const key = normalizedSongKey(title);
    return songs.find((song) =>
      [song.title, song.alternate_title]
        .filter(Boolean)
        .some((value) => normalizedSongKey(value!) === key),
    );
  }

  async function load(selectedId?: string | null) {
    setLoading(true);
    setMessage(null);

    try {
      const nextSongs = await getSongs();
      setSongs(nextSongs);
      const target =
        selectedId === null
          ? nextSongs[0]
          : nextSongs.find((song) => song.id === selectedId) ?? selectedSong ?? nextSongs[0];

      if (target) {
        setSelectedSong(target);
        setForm(formFromSong(target));
        setMode("edit");
        setParsedSongDeck(null);
        setImportPreviews([]);
        setParsedSequence(target.sequence);
        setParseNotes([]);
        hydrateChordState(target.chords);
        setSongFiles(await getFiles({ song_id: target.id }));
      } else {
        startCreate();
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load songs.");
    } finally {
      setLoading(false);
    }
  }

  function startCreate() {
    setSelectedSong(null);
    setMode("create");
    setForm(blankSong());
    setSongFiles([]);
    setParsedSongDeck(null);
    setImportPreviews([]);
    setParsedSequence(null);
    setParseNotes([]);
    hydrateChordState(null);
    setMessage(null);
  }

  function startImportDraft() {
    setSelectedSong(null);
    setMode("create");
    setForm(blankSong());
    setSongFiles([]);
    hydrateChordState(null);
    setMessage(null);
  }

  async function selectSong(song: Song) {
    setSelectedSong(song);
    setForm(formFromSong(song));
    setMode("edit");
    setParsedSongDeck(null);
    setImportPreviews([]);
    setParsedSequence(song.sequence);
    setParseNotes([]);
    hydrateChordState(song.chords);
    setMessage(null);
    setSongFiles(await getFiles({ song_id: song.id }));
  }

  async function submitSong(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((mode === "create" && !canCreate) || (mode === "edit" && !canEdit)) {
      setMessage("You do not have permission to save songs.");
      return;
    }
    setMessage(null);

    try {
      const payload = normalizeForm({
        ...form,
        chords: serializeChordChart(chordChart, legacyChords),
      });
      const saved =
        mode === "create" ? await createSong(payload) : await updateSong(selectedSong!.id, payload);
      await load(saved.id);
      onDataChange();
      setMessage(mode === "create" ? "Song created." : "Song updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save song.");
    }
  }

  function normalizeChordInput(value: string) {
    return value
      .replace(/[^A-Ga-g#bB/0-9A-Za-z()+.\-\s]/g, "")
      .toUpperCase()
      .replace(/([A-G])B/g, "$1b");
  }

  function editableChordValue(annotation: ChordAnnotation) {
    return displayChord(annotation.chord, {
      capo: chordChart.capo,
      detailMode: "advanced",
      displayMode,
    });
  }

  function updateAbsoluteKey(nextValue: string) {
    const nextAbsoluteKey = normalizeKeySignature(nextValue);
    setChordChart((current) => {
      const currentLinkedAbsoluteKey =
        current.absoluteKey && current.capoKey && deriveAbsoluteKey(current.capoKey, current.capo) === current.absoluteKey;
      const nextChart: ChordChartDocument = {
        ...current,
        absoluteKey: nextAbsoluteKey,
      };

      if (nextAbsoluteKey && current.absoluteKey && currentLinkedAbsoluteKey && nextAbsoluteKey !== current.absoluteKey) {
        nextChart.annotations = transposeChordAnnotations(
          current.annotations,
          semitoneDistance(current.absoluteKey, nextAbsoluteKey),
          { preferFlats: nextAbsoluteKey.includes("b") },
        );
      }

      if (nextAbsoluteKey) {
        if (current.capoKey) {
          if (current.keyAnchor === "capo") {
            nextChart.capo = semitoneDistance(current.capoKey, nextAbsoluteKey);
          } else {
            nextChart.capoKey = deriveCapoKey(nextAbsoluteKey, current.capo);
          }
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
      const currentLinkedAbsoluteKey =
        current.absoluteKey && current.capoKey && deriveAbsoluteKey(current.capoKey, current.capo) === current.absoluteKey;
      const nextChart: ChordChartDocument = {
        ...current,
        capo: nextCapo,
      };

      if (current.keyAnchor === "capo" && current.capoKey) {
        const nextAbsoluteKey = deriveAbsoluteKey(current.capoKey, nextCapo);
        if (current.absoluteKey && currentLinkedAbsoluteKey && current.absoluteKey !== nextAbsoluteKey) {
          nextChart.annotations = transposeChordAnnotations(
            current.annotations,
            semitoneDistance(current.absoluteKey, nextAbsoluteKey),
            { preferFlats: nextAbsoluteKey.includes("b") },
          );
        }
        nextChart.absoluteKey = nextAbsoluteKey;
      } else if (current.absoluteKey) {
        nextChart.capoKey = deriveCapoKey(current.absoluteKey, nextCapo);
      }

      return nextChart;
    });
    setLegacyChords(null);
  }

  function updateCapoKey(nextValue: string) {
    const nextCapoKey = normalizeKeySignature(nextValue);
    setChordChart((current) => {
      const currentLinkedAbsoluteKey =
        current.absoluteKey && current.capoKey && deriveAbsoluteKey(current.capoKey, current.capo) === current.absoluteKey;
      const nextChart: ChordChartDocument = {
        ...current,
        capoKey: nextCapoKey,
      };

      if (!nextCapoKey) {
        return nextChart;
      }

      if (current.keyAnchor === "capo") {
        const nextAbsoluteKey = deriveAbsoluteKey(nextCapoKey, current.capo);
        if (current.absoluteKey && currentLinkedAbsoluteKey && current.absoluteKey !== nextAbsoluteKey) {
          nextChart.annotations = transposeChordAnnotations(
            current.annotations,
            semitoneDistance(current.absoluteKey, nextAbsoluteKey),
            { preferFlats: nextAbsoluteKey.includes("b") },
          );
        }
        nextChart.absoluteKey = nextAbsoluteKey;
      } else if (current.absoluteKey) {
        nextChart.capo = semitoneDistance(nextCapoKey, current.absoluteKey);
      }

      return nextChart;
    });
    setLegacyChords(null);
  }

  function updateKeyAnchor(nextAnchor: KeyAnchorMode) {
    setChordChart((current) => {
      const nextChart: ChordChartDocument = {
        ...current,
        keyAnchor: nextAnchor,
      };

      if (nextAnchor === "absolute" && current.absoluteKey && !current.capoKey) {
        nextChart.capoKey = deriveCapoKey(current.absoluteKey, current.capo);
      }

      if (nextAnchor === "capo" && current.capoKey && !current.absoluteKey) {
        nextChart.absoluteKey = deriveAbsoluteKey(current.capoKey, current.capo);
      }

      return nextChart;
    });
  }

  function updateEditableKey(nextValue: string) {
    if (chordChart.keyAnchor === "absolute") {
      updateAbsoluteKey(nextValue);
      return;
    }
    updateCapoKey(nextValue);
  }

  function startInlineChordEdit(lineIndex: number, anchorIndex: number, annotation?: ChordAnnotation) {
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
    if (!chordInput.trim()) {
      setMessage("Enter a chord symbol first.");
      return;
    }

    const storedChord = transposeChordSymbol(chordInput.trim(), displayMode === "capo" ? chordChart.capo : 0, {
      detailMode: "advanced",
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
    setMessage("Chord annotation updated.");
  }

  function saveOrCloseInlineEditor() {
    if (chordInput.trim()) {
      saveAnnotation();
      return;
    }
    cancelInlineChordEdit();
  }

  function moveAnnotation(annotationId: string, lineIndex: number, anchorIndex: number) {
    const annotation = chordChart.annotations.find((candidate) => candidate.id === annotationId);
    if (!annotation) {
      return;
    }

    setChordChart((current) =>
      upsertChordAnnotation(current, {
        id: annotation.id,
        chord: annotation.chord,
        lineIndex,
        anchorIndex,
      }),
    );
    setLegacyChords(null);
  }

  function printChordChart() {
    const printWindow = window.open("", "_blank", "noopener,noreferrer,width=900,height=700");
    if (!printWindow) {
      setMessage("The browser blocked the print window.");
      return;
    }

    const chartHtml = lines
      .map((line, lineIndex) => {
        const annotations = chordChart.annotations.filter((annotation) => annotation.lineIndex === lineIndex);
        const totalSlots = line.length + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS;
        const slots = Array.from({ length: totalSlots }, (_, slotIndex) => {
          const annotation = annotations.find((candidate) => candidate.anchorIndex === slotIndex);
          const chord = annotation
            ? displayChord(annotation.chord, {
                capo: chordChart.capo,
                detailMode,
                displayMode,
              })
            : "&nbsp;";
          const lyricIndex = slotIndex - LEADING_CHORD_ANCHORS;
          const lyric =
            lyricIndex >= 0 && lyricIndex < line.length ? line[lyricIndex].replace(/ /g, "&nbsp;") : "&nbsp;";
          return `<span class="word"><span class="chord">${chord}</span><span class="lyric">${lyric}</span></span>`;
        }).join("");
        return `<div class="line">${slots}</div>`;
      })
      .join("");

    printWindow.document.write(`<!doctype html>
<html>
  <head>
    <title>${form.title} Chart</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 24px; color: #111; }
      h1 { margin: 0 0 8px; font-size: 28px; }
      .meta { margin-bottom: 24px; color: #555; }
      .line { display: flex; flex-wrap: wrap; gap: 12px; margin-bottom: 16px; }
      .word { display: flex; flex-direction: column; align-items: center; min-width: 24px; }
      .chord { font-weight: 700; color: #134e4a; font-size: 14px; min-height: 18px; }
      .lyric { font-size: 18px; }
    </style>
  </head>
  <body>
    <h1>${form.title}</h1>
    <div class="meta">View: ${displayMode === "absolute" ? "Absolute chords" : `Capo shapes (capo ${chordChart.capo})`} · Detail: ${detailMode} · Concert key: ${chordChart.absoluteKey ?? "unset"} · Capo key: ${chordChart.capoKey ?? "unset"} · Locked: ${chordChart.keyAnchor}</div>
    ${chartHtml}
  </body>
</html>`);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
  }

  async function removeSong() {
    if (!selectedSong) {
      return;
    }
    if (!canCreate) {
      setMessage("You do not have permission to archive songs.");
      return;
    }

    const confirmed = window.confirm(`Archive song "${selectedSong.title}"?`);
    if (!confirmed) {
      return;
    }

    setMessage(null);

    try {
      await deleteSong(selectedSong.id);
      setSelectedSong(null);
      await load(null);
      onDataChange();
      setMessage("Song archived.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not archive song.");
    }
  }

  async function uploadSongFile() {
    if (!selectedSong || !fileToUpload) {
      setMessage("Select a song and a slide file first.");
      return;
    }
    if (!canCreate) {
      setMessage("You do not have permission to attach files.");
      return;
    }

    setMessage(null);
    try {
      await uploadStoredFile({
        file: fileToUpload,
        display_name: fileDisplayName || fileToUpload.name,
        song_id: selectedSong.id,
      });
      setFileToUpload(null);
      setFileDisplayName("");
      setSongFiles(await getFiles({ song_id: selectedSong.id }));
      setMessage("Slide file attached to song.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not upload slide file.");
    }
  }

  function analyzeDeck(deck: ParsedSlideDeck) {
    return analyzeImportedSongSlides(
      deck.slides.map((slide) => slide.text),
      deck.filename.replace(/\.[^.]+$/, ""),
    );
  }

  function applyAnalysisToForm(parsed: ParsedSlideDeck) {
    const analysis = analyzeDeck(parsed);
    const suggestedTitle = analysis.suggestions.title ?? parsed.filename.replace(/\.[^.]+$/, "");
    setParsedSongDeck(parsed);
    setParsedSequence(analysis.sequence);
    setParseNotes(analysis.notes);
    setForm((current) => ({
      ...current,
      title: current.title || suggestedTitle,
      author: current.author || analysis.suggestions.author,
      ccli_number: current.ccli_number || analysis.suggestions.ccliNumber,
      license: current.license === "Unknown" && analysis.suggestions.license ? analysis.suggestions.license : current.license,
      lyrics: analysis.lyrics,
      sequence: current.sequence || analysis.sequence,
    }));
    return { analysis, suggestedTitle };
  }

  function autoParseEditorLyrics() {
    const analysis = analyzeWorshipText(form.lyrics ?? "", { title: form.title });
    setForm({
      ...form,
      lyrics: analysis.lyrics,
      sequence: form.sequence || analysis.sequence,
    });
    setParsedSequence(analysis.sequence);
    setParseNotes(analysis.notes);
    setMessage(
      analysis.sequence
        ? `Detected ${analysis.sections.length} section${analysis.sections.length === 1 ? "" : "s"} and updated the song structure.`
        : "Formatted lyrics, but could not confidently infer a section sequence yet.",
    );
  }

  async function parseFirstSongDeck() {
    const [file] = songDeckFiles;
    if (!file) {
      setMessage("Choose a PowerPoint or OpenDocument song file first.");
      return;
    }
    if (!canCreate && !canEdit) {
      setMessage("You do not have permission to parse imported song slides.");
      return;
    }

    try {
      const parsed = await parseSlideDeck(file);
      applyAnalysisToForm(parsed);
      setMessage(`Parsed ${parsed.slide_count} slide${parsed.slide_count === 1 ? "" : "s"} into lyrics.`);
    } catch (error) {
      setParsedSongDeck(null);
      setImportPreviews([]);
      setParsedSequence(null);
      setParseNotes([]);
      setMessage(error instanceof Error ? error.message : "Could not parse song deck.");
    }
  }

  async function handleSongDeckSelection(files: File[]) {
    startImportDraft();
    setSongDeckFiles(files);
    setParsedSongDeck(null);
    setImportPreviews([]);
    setParsedSequence(null);
    setParseNotes([]);

    if (!files.length) {
      return;
    }

    try {
      const previews: ImportPreview[] = [];

      for (const file of files) {
        const parsed = await parseSlideDeck(file);
        const analysis = analyzeDeck(parsed);
        const title = analysis.suggestions.title ?? parsed.filename.replace(/\.[^.]+$/, "");
        const duplicate = findDuplicateSong(title);
        previews.push({
          duplicateSongId: duplicate?.id ?? null,
          duplicateSongTitle: duplicate?.title ?? null,
          filename: parsed.filename,
          notes: analysis.notes,
          parsed,
          sequence: analysis.sequence,
          title,
        });
      }

      setImportPreviews(previews);

      if (previews.length === 1) {
        applyAnalysisToForm(previews[0].parsed);
        setMessage(
          previews[0].duplicateSongTitle
            ? `Parsed ${previews[0].filename}. It looks like this may already exist as "${previews[0].duplicateSongTitle}".`
            : `Parsed ${previews[0].filename} and filled the editor for you.`,
        );
        return;
      }

      const duplicateCount = previews.filter((preview) => preview.duplicateSongId).length;
      setMessage(
        duplicateCount
          ? `Prepared ${previews.length} song imports. ${duplicateCount} look like existing songs and will be skipped on bulk import.`
          : `Prepared ${previews.length} song imports. Review if you want, or bulk import straight away.`,
      );
    } catch (error) {
      setImportPreviews([]);
      setMessage(error instanceof Error ? error.message : "Could not parse selected song deck files.");
    }
  }

  async function bulkImportSongDecks() {
    if (!songDeckFiles.length) {
      setMessage("Choose one or more PowerPoint/OpenDocument song files first.");
      return;
    }
    if (!canCreate) {
      setMessage("You do not have permission to bulk import songs.");
      return;
    }

    setMessage(null);
    let imported = 0;
    let skipped = 0;
    const failures: string[] = [];
    const importedKeys = new Set(songs.flatMap((song) => [song.title, song.alternate_title].filter(Boolean).map((value) => normalizedSongKey(value!))));

    for (const file of songDeckFiles) {
      try {
        const parsed = await parseSlideDeck(file);
        const analysis = analyzeDeck(parsed);
        if (!analysis.lyrics) {
          failures.push(`${file.name}: no lyrics found`);
          continue;
        }
        const title = analysis.suggestions.title ?? parsed.filename.replace(/\.[^.]+$/, "");
        const titleKey = normalizedSongKey(title);
        if (importedKeys.has(titleKey) || findDuplicateSong(title)) {
          skipped += 1;
          continue;
        }
        await createSong({
          ...blankSong(),
          title,
          author: analysis.suggestions.author,
          ccli_number: analysis.suggestions.ccliNumber,
          license: analysis.suggestions.license ?? "Unknown",
          lyrics: analysis.lyrics,
          sequence: analysis.sequence,
        });
        importedKeys.add(titleKey);
        imported += 1;
      } catch (error) {
        failures.push(`${file.name}: ${error instanceof Error ? error.message : "failed"}`);
      }
    }

    await load(null);
    onDataChange();
    setMessage(
      failures.length
        ? `Imported ${imported}. Skipped ${skipped}. ${failures.length} failed: ${failures.join("; ")}`
        : `Imported ${imported} song${imported === 1 ? "" : "s"}${skipped ? ` and skipped ${skipped} duplicates` : ""}.`,
    );
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!lines.length) {
      setSelectedLineIndex(0);
      setSelectedAnchorIndex(0);
      return;
    }

    setChordChart((current) => ({
      ...current,
      annotations: current.annotations.filter((annotation) => {
        const line = lines[annotation.lineIndex];
        return line != null && annotation.anchorIndex <= line.length + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS;
      }),
    }));
    setSelectedLineIndex((current) => Math.min(current, lines.length - 1));
  }, [lines]);

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
        ? displayChord(activeChordAnnotation.chord, {
            capo: chordChart.capo,
            detailMode,
            displayMode,
          })
        : null;

  return (
    <section className="manager-grid" aria-label="Song management">
      <aside className="manager-list">
        <div className="section-heading">
          <h2>Songs</h2>
          <button className="text-button" disabled={!canCreate} onClick={startCreate} type="button">
            New Song
          </button>
        </div>

        <label className="list-search">
          <span>Search</span>
          <input
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Title, author, CCLI"
            type="search"
            value={searchTerm}
          />
        </label>

        <div className="stack-list">
          {filteredSongs.map((song) => (
            <button
              className={`stack-row ${song.id === selectedSong?.id ? "selected" : ""}`}
              key={song.id}
              onClick={() => void selectSong(song)}
              type="button"
            >
              <strong>{song.title}</strong>
              <span>
                {song.author ?? "Unknown author"} · {song.lyrics_status}
              </span>
            </button>
          ))}
          {!filteredSongs.length ? (
            <div className="empty-state">No songs match that search.</div>
          ) : null}
        </div>
      </aside>

      <form className="editor-panel" onSubmit={(event) => void submitSong(event)}>
        <div className="section-heading">
          <div>
            <p className="eyebrow">{mode === "create" ? "Create" : "Edit"}</p>
            <h2>{mode === "create" ? "New Song" : selectedSong?.title ?? "Song"}</h2>
          </div>
          <div className="action-row">
            {mode === "edit" ? (
              <button className="danger-button" disabled={!canCreate} onClick={() => void removeSong()} type="button">
                Archive Song
              </button>
            ) : null}
            <button className="primary-button" disabled={loading || (mode === "create" ? !canCreate : !canEdit)} type="submit">
              Save Song
            </button>
          </div>
        </div>

        {message ? <p className="form-message">{message}</p> : null}

        <details className="dropdown-panel">
          <summary>Import Song Slides</summary>
          <div className="dropdown-panel-body">
            <div className="form-grid">
              <label className="wide-field">
                PowerPoint / OpenDocument Files
                <input
                  accept=".pptx,.odp"
                  disabled={!canCreate && !canEdit}
                  multiple
                  onChange={(event) => {
                    void handleSongDeckSelection(Array.from(event.target.files ?? []));
                  }}
                  type="file"
                />
              </label>
            </div>
            {importPreviews.length > 1 ? (
              <div className="stack-list compact">
                {importPreviews.map((preview) => (
                  <div className="stack-row readonly" key={preview.filename}>
                    <strong>{preview.title}</strong>
                    <span>
                      {preview.parsed.slide_count} slides
                      {preview.sequence ? ` · ${preview.sequence}` : ""}
                      {preview.duplicateSongTitle ? ` · matches ${preview.duplicateSongTitle}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {parsedSongDeck ? (
              <>
                <div className="empty-state import-summary">
                  <strong>{parsedSongDeck.filename}</strong>
                  <span>{parsedSongDeck.slide_count} slides parsed</span>
                  <span>{parsedSequence ? `Inferred sequence: ${parsedSequence}` : "No confident sequence inferred yet"}</span>
                  {findDuplicateSong(form.title)?.title ? <span>Possible duplicate: {findDuplicateSong(form.title)?.title}</span> : null}
                </div>
                {parseNotes.length ? (
                  <div className="stack-list compact">
                    {parseNotes.map((note) => (
                      <div className="stack-row readonly" key={note}>
                        <span>{note}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="deck-preview">
                  {parsedSongDeck.slides.slice(0, 8).map((slide) => (
                    <article className="slide-tile readonly" key={slide.index}>
                      <span>{slide.index.toString().padStart(2, "0")}</span>
                      <strong>{slide.text.split(/\r?\n/)[0] ?? `Slide ${slide.index}`}</strong>
                    </article>
                  ))}
                </div>
              </>
            ) : null}
            <div className="action-row form-actions">
              <button className="text-button" disabled={!canCreate && !canEdit} onClick={() => void parseFirstSongDeck()} type="button">
                Parse Into Editor
              </button>
              <button className="primary-button" disabled={!canCreate} onClick={() => void bulkImportSongDecks()} type="button">
                Bulk Import Songs
              </button>
            </div>
          </div>
        </details>

        <div className="tab-row" role="tablist" aria-label="Song editor sections">
          <button
            className={`tab-button ${activeSongTab === "details" ? "active" : ""}`}
            onClick={() => setActiveSongTab("details")}
            type="button"
          >
            Details
          </button>
          <button
            className={`tab-button ${activeSongTab === "lyrics" ? "active" : ""}`}
            onClick={() => setActiveSongTab("lyrics")}
            type="button"
          >
            Lyrics
          </button>
          <button
            className={`tab-button ${activeSongTab === "chords" ? "active" : ""}`}
            onClick={() => setActiveSongTab("chords")}
            type="button"
          >
            Chords
          </button>
        </div>

        {activeSongTab === "details" ? (
          <div className="form-grid">
          <label>
            Title
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
              required
              value={form.title}
            />
          </label>

          <label>
            Alternate Title
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, alternate_title: event.target.value })}
              value={form.alternate_title ?? ""}
            />
          </label>

          <label>
            Author
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, author: event.target.value })}
              value={form.author ?? ""}
            />
          </label>

          <label>
            License
            <select
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, license: event.target.value })}
              value={form.license ?? "Unknown"}
            >
              <option value="Unknown">Unknown</option>
              <option value="Public Domain">Public Domain</option>
              <option value="CCLI">CCLI</option>
              <option value="Other">Other</option>
            </select>
          </label>

          <label>
            CCLI Number
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, ccli_number: event.target.value })}
              value={form.ccli_number ?? ""}
            />
          </label>

          <label>
            Sequence
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, sequence: event.target.value })}
              placeholder="V1 C V2 C B C"
              value={form.sequence ?? ""}
            />
          </label>

          <label>
            YouTube ID
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, youtube_id: event.target.value })}
              value={form.youtube_id ?? ""}
            />
          </label>

          <label>
            External Link
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, external_link: event.target.value })}
              value={form.external_link ?? ""}
            />
          </label>

          <label className="wide-field">
            Book Reference
            <input
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, book_reference: event.target.value })}
              value={form.book_reference ?? ""}
            />
          </label>
          </div>
        ) : null}

        {activeSongTab === "lyrics" ? (
          <div className="form-grid single-column">
          <label className="wide-field">
            Lyrics
            <div className="field-action-row">
              <button
                className="text-button"
                disabled={mode === "create" ? !canCreate : !canEdit}
                onClick={() => autoParseEditorLyrics()}
                type="button"
              >
                Auto Parse Structure
              </button>
              <button
                className="text-button"
                disabled={mode === "create" ? !canCreate : !canEdit}
                onClick={() =>
                  setForm({
                    ...form,
                    lyrics: form.lyrics ? formatWorshipText(form.lyrics, { removeChordLines: true }) : "",
                  })
                }
                type="button"
              >
                Format Lyrics
              </button>
            </div>
            {parsedSequence ? <p className="field-help">Inferred sequence: {parsedSequence}</p> : null}
            <textarea
              disabled={mode === "create" ? !canCreate : !canEdit}
              onChange={(event) => setForm({ ...form, lyrics: event.target.value })}
              rows={8}
              value={form.lyrics ?? ""}
            />
          </label>
          </div>
        ) : null}

        {activeSongTab === "chords" ? (
          <div className="form-grid single-column">
          <label className="wide-field">
            Chords
            <div className="musician-tools">
              <div className="musician-workbench">
                <aside className="musician-side-panel">
                  <GuitarChordDiagram chord={activeDisplayedChord} />
                  <div className="musician-toolbar">
                <div className="segmented-control">
                  <button
                    className={displayMode === "absolute" ? "is-active" : ""}
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    onClick={() => setDisplayMode("absolute")}
                    type="button"
                  >
                    Absolute
                  </button>
                  <button
                    className={displayMode === "capo" ? "is-active" : ""}
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    onClick={() => setDisplayMode("capo")}
                    type="button"
                  >
                    Capo Shapes
                  </button>
                </div>
                <div className="segmented-control compact-toggle">
                  <button
                    className={detailMode === "simple" ? "is-active" : ""}
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    onClick={() => setDetailMode("simple")}
                    type="button"
                  >
                    Simple
                  </button>
                  <button
                    className={detailMode === "advanced" ? "is-active" : ""}
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    onClick={() => setDetailMode("advanced")}
                    type="button"
                  >
                    Advanced
                  </button>
                </div>
                <div className="segmented-control compact-toggle">
                  <button
                    className={chordChart.keyAnchor === "absolute" ? "is-active" : ""}
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    onClick={() => updateKeyAnchor("absolute")}
                    type="button"
                  >
                    Concert
                  </button>
                  <button
                    className={chordChart.keyAnchor === "capo" ? "is-active" : ""}
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    onClick={() => updateKeyAnchor("capo")}
                    type="button"
                  >
                    Capo
                  </button>
                </div>
                <label className="compact-field">
                  Key
                  <select
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    onChange={(event) => updateEditableKey(event.target.value)}
                    value={editableKey ?? ""}
                  >
                    <option value="">Unset</option>
                    {MUSICAL_KEYS.map((keyOption) => (
                      <option key={`editable-${keyOption}`} value={keyOption}>
                        {keyOption}
                      </option>
                    ))}
                  </select>
                  {derivedKey ? (
                    <span className="field-help">
                      {chordChart.keyAnchor === "absolute" ? "Capo" : "Concert"} {derivedKey}
                    </span>
                  ) : null}
                </label>
                <label className="compact-field">
                  Capo
                  <input
                    disabled={mode === "create" ? !canCreate : !canEdit}
                    min={0}
                    onChange={(event) => updateCapo(Number(event.target.value || 0))}
                    type="number"
                    value={chordChart.capo}
                  />
                </label>
                <button className="text-button" onClick={printChordChart} type="button">
                  Print Chart
                </button>
                  </div>
                </aside>

                <div className="musician-chart-panel">
                  {lines.length ? (
                    <div className="musician-preview">
                      {lines.map((line, lineIndex) => {
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
                              <span
                                className="musician-slot-editor"
                                key={`editor-${lineIndex}-${slotIndex}`}
                                style={{ gridColumn: slotIndex + 1, gridRow: 1 }}
                              >
                                <input
                                  autoFocus
                                  disabled={mode === "create" ? !canCreate : !canEdit}
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
                                {annotation ? (
                                  <button
                                    className="musician-delete-button"
                                    disabled={mode === "create" ? !canCreate : !canEdit}
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() => {
                                      const annotationId = annotation.id;
                                      setChordChart((current) => removeChordAnnotation(current, annotationId));
                                      cancelInlineChordEdit();
                                    }}
                                    type="button"
                                  >
                                    x
                                  </button>
                                ) : null}
                              </span>
                            );
                          }

                          return (
                            <button
                              className={`musician-slot ${annotation ? "has-chord" : ""}`}
                              disabled={mode === "create" ? !canCreate : !canEdit}
                              draggable={Boolean(annotation) && (mode === "create" ? canCreate : canEdit)}
                              onDragEnd={() => setDraggedAnnotationId(null)}
                              onDragOver={(event) => {
                                if (draggedAnnotationId) {
                                  event.preventDefault();
                                }
                              }}
                              onDragStart={() => {
                                if (annotation) {
                                  setDraggedAnnotationId(annotation.id);
                                }
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                if (draggedAnnotationId) {
                                  moveAnnotation(draggedAnnotationId, lineIndex, slotIndex);
                                  setDraggedAnnotationId(null);
                                }
                              }}
                              key={`slot-${lineIndex}-${slotIndex}`}
                              onBlur={() => {
                                setHoveredAnchor(null);
                                setHoveredChordId(null);
                              }}
                              onClick={() => startInlineChordEdit(lineIndex, slotIndex, annotation)}
                              onFocus={() => {
                                setHoveredAnchor({ lineIndex, slotIndex });
                                setHoveredChordId(annotation?.id ?? null);
                              }}
                              onMouseEnter={() => {
                                setHoveredAnchor({ lineIndex, slotIndex });
                                setHoveredChordId(annotation?.id ?? null);
                              }}
                              onMouseLeave={() => {
                                setHoveredAnchor(null);
                                setHoveredChordId(null);
                              }}
                              style={{ gridColumn: slotIndex + 1, gridRow: 1 }}
                              type="button"
                            >
                              <span className="musician-slot-chord">
                                {annotation
                                  ? displayChord(annotation.chord, {
                                      capo: chordChart.capo,
                                      detailMode,
                                      displayMode,
                                    })
                                  : "·"}
                              </span>
                            </button>
                          );
                        };

                        return (
                          <div
                            className="musician-line-grid"
                            key={`${lineIndex}-${line}`}
                            style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(1ch, 1ch))` }}
                          >
                            {Array.from({ length: totalSlots }, (_, slotIndex) => renderSlot(slotIndex))}
                            {Array.from({ length: line.length }, (_, charIndex) => (
                              <button
                                className={`musician-char ${line[charIndex] === " " ? "is-space" : ""} ${
                                  hoveredAnchor?.lineIndex === lineIndex &&
                                  hoveredAnchor.slotIndex === LEADING_CHORD_ANCHORS + charIndex
                                    ? "is-anchor-hovered"
                                    : ""
                                }`}
                                disabled={mode === "create" ? !canCreate : !canEdit}
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
              </div>

              {legacyChords ? <p className="field-help">Legacy chord text will be preserved when this song is saved.</p> : null}
            </div>
          </label>
          </div>
        ) : null}

        {mode === "edit" ? (
          <>
            <details className="dropdown-panel">
              <summary>Slide Files</summary>
              <div className="dropdown-panel-body">
                <div className="form-grid">
                  <label>
                    Display Name
                    <input
                      disabled={!canCreate}
                      onChange={(event) => setFileDisplayName(event.target.value)}
                      placeholder={fileToUpload?.name ?? "Optional"}
                      value={fileDisplayName}
                    />
                  </label>

                  <label>
                    File
                    <input
                      disabled={!canCreate}
                      accept=".ppt,.pptx,.pdf,.key,.txt,.png,.jpg,.jpeg"
                      onChange={(event) => setFileToUpload(event.target.files?.[0] ?? null)}
                      type="file"
                    />
                  </label>
                </div>
                <div className="action-row form-actions">
                  <button className="primary-button" disabled={!canCreate} onClick={() => void uploadSongFile()} type="button">
                    Attach File
                  </button>
                </div>
              </div>
            </details>

            <div className="stack-list compact">
              {songFiles.map((file) => (
                <div className="stack-row readonly" key={file.id}>
                  <strong>{file.display_name}</strong>
                  <span>{file.content_type ?? "file"}</span>
                </div>
              ))}
            </div>
          </>
        ) : null}
      </form>
    </section>
  );
}
