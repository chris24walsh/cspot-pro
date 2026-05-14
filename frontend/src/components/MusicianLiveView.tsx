import { ChevronLeft, ChevronRight, Music2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getPresentationLiveState,
  updatePresentationLiveState,
  type PlanDetail,
  type PresentationLiveSyncState,
  type Song,
} from "../api";
import {
  LEADING_CHORD_ANCHORS,
  MUSICAL_KEYS,
  TRAILING_CHORD_ANCHORS,
  deriveAbsoluteKey,
  deriveCapoKey,
  lyricLines,
  parseChordChart,
  semitoneDistance,
  transposeChordSymbol,
  type ChordAnnotation,
  type ChordDetailMode,
  type ChordDisplayMode,
} from "../chordSheet";
import { buildPresentationSlides, resolveLiveIndex, type PresentationLiveState } from "../presentation";

interface MusicianLiveViewProps {
  plan: PlanDetail | null;
  songs: Song[];
}

function syncStateFromApi(state: PresentationLiveSyncState): PresentationLiveState {
  return {
    planId: state.plan_id,
    index: state.index,
    updatedAt: state.updated_at,
    planItemId: state.plan_item_id,
    slideOffset: state.slide_offset,
    theme: state.theme,
    blanked: state.blanked,
    fullscreen: state.fullscreen,
  };
}

function compactLine(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function findSlideLineOffset(sourceLyrics: string, slideText: string) {
  const sourceLines = lyricLines(sourceLyrics).map(compactLine);
  const slideLines = lyricLines(slideText).map(compactLine);
  if (!sourceLines.length || !slideLines.length) {
    return -1;
  }

  for (let index = 0; index <= sourceLines.length - slideLines.length; index += 1) {
    const matches = slideLines.every((line, offset) => sourceLines[index + offset] === line);
    if (matches) {
      return index;
    }
  }

  const firstLine = slideLines[0];
  return sourceLines.findIndex((line) => line === firstLine);
}

function boundedIndex(index: number, length: number) {
  if (!length) {
    return 0;
  }
  return Math.min(Math.max(index, 0), length - 1);
}

function clampNumber(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeCapo(value: number) {
  return Math.min(Math.max(Math.trunc(value), 0), 11);
}

function shiftKey(key: string | null, semitones: number) {
  if (!key) {
    return MUSICAL_KEYS[0];
  }
  const index = MUSICAL_KEYS.findIndex((candidate) => candidate === key);
  if (index < 0) {
    return key;
  }
  return MUSICAL_KEYS[(index + semitones + 120) % MUSICAL_KEYS.length];
}

function fitFontSize(lines: string[]) {
  const lineCount = Math.max(lines.length, 1);
  const longestLine = Math.max(...lines.map((line) => Array.from(line).length), 1);
  const widthDrivenSize = 980 / Math.max(longestLine * 0.72, 1);
  const heightDrivenSize = 430 / Math.max(lineCount * 1.48, 1);
  return Math.floor(clampNumber(Math.min(widthDrivenSize, heightDrivenSize), 17, 44));
}

function fitFontSizeForSlides(slideTexts: string[]) {
  const sizes = slideTexts.map((text) => fitFontSize(lyricLines(text))).filter((size) => Number.isFinite(size));
  if (!sizes.length) {
    return 34;
  }
  return Math.min(...sizes);
}

function musicianChordLabel(
  chord: string,
  options: {
    baseAbsoluteKey: string | null;
    capo: number;
    capoKey: string | null;
    detailMode: ChordDetailMode;
    displayMode: ChordDisplayMode;
  },
) {
  const preferFlats = chord.includes("b");
  const keyShift = options.baseAbsoluteKey
    ? semitoneDistance(options.baseAbsoluteKey, deriveAbsoluteKey(options.capoKey ?? options.baseAbsoluteKey, options.capo))
    : 0;
  const absoluteChord = transposeChordSymbol(chord, keyShift, {
    detailMode: options.detailMode,
    preferFlats,
  });

  if (options.displayMode === "capo") {
    return transposeChordSymbol(absoluteChord, -options.capo, {
      detailMode: options.detailMode,
      preferFlats,
    });
  }

  return transposeChordSymbol(absoluteChord, 0, {
    detailMode: options.detailMode,
    preferFlats,
  });
}

function publishStateForSlide(plan: PlanDetail, slides: ReturnType<typeof buildPresentationSlides>, nextIndex: number): PresentationLiveState {
  const slide = slides[boundedIndex(nextIndex, slides.length)] ?? null;
  const slideOffset = slide
    ? slides.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id)
    : 0;

  return {
    planId: plan.id,
    index: boundedIndex(nextIndex, slides.length),
    updatedAt: Date.now(),
    planItemId: slide?.planItemId ?? null,
    slideOffset: Math.max(slideOffset, 0),
    theme: "light",
    blanked: false,
    fullscreen: false,
  };
}

function MusicianChordLine({
  annotations,
  baseAbsoluteKey,
  capo,
  capoKey,
  detailMode,
  displayMode,
  line,
  showChords,
}: {
  annotations: ChordAnnotation[];
  baseAbsoluteKey: string | null;
  capo: number;
  capoKey: string | null;
  detailMode: ChordDetailMode;
  displayMode: ChordDisplayMode;
  line: string;
  showChords: boolean;
}) {
  const totalSlots = Math.max(LEADING_CHORD_ANCHORS + line.length + TRAILING_CHORD_ANCHORS, 16);
  const characters = Array.from(line);

  return (
    <div className="musician-chord-line" style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1ch))` }}>
      {annotations.map((annotation) => {
        const label = musicianChordLabel(annotation.chord, {
          baseAbsoluteKey,
          capo,
          capoKey,
          detailMode,
          displayMode,
        });
        return (
          <span
            className={`musician-chord-token ${showChords ? "" : "is-hidden"}`}
            key={annotation.id}
            style={{
              gridColumn: `${Math.min(Math.max(annotation.anchorIndex + 1, 1), totalSlots)} / span ${Math.max(label.length, 1)}`,
              gridRow: 1,
            }}
          >
            {label}
          </span>
        );
      })}
      {characters.map((character, index) => (
        <span
          className={character.trim() ? "musician-lyric-character" : "musician-lyric-space"}
          key={`${index}-${character}`}
          style={{ gridColumn: LEADING_CHORD_ANCHORS + index + 1, gridRow: 2 }}
        >
          {character === " " ? "\u00a0" : character}
        </span>
      ))}
    </div>
  );
}

export function MusicianLiveView({ plan, songs }: MusicianLiveViewProps) {
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(null);
  const [showChords, setShowChords] = useState(true);
  const [displayMode, setDisplayMode] = useState<ChordDisplayMode>("capo");
  const [detailMode, setDetailMode] = useState<ChordDetailMode>("simple");
  const [capo, setCapo] = useState(0);
  const [absoluteKey, setAbsoluteKey] = useState<string | null>(null);
  const [capoKey, setCapoKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pollingRef = useRef(false);

  const slides = useMemo(() => buildPresentationSlides(plan?.items ?? [], songs), [plan?.items, songs]);
  const liveIndex = useMemo(() => resolveLiveIndex(slides, liveState), [liveState, slides]);
  const liveSlide = slides[liveIndex] ?? null;
  const liveItem = plan?.items.find((item) => item.id === liveSlide?.planItemId) ?? null;
  const liveSong = liveItem?.song_id ? songs.find((song) => song.id === liveItem.song_id) ?? null : null;
  const chordChart = useMemo(() => parseChordChart(liveSong?.chords ?? null).document, [liveSong?.chords]);
  const liveFontSize = useMemo(
    () => fitFontSizeForSlides(slides.filter((slide) => slide.itemType === "song").map((slide) => slide.text)),
    [slides],
  );
  const slideLineOffset = useMemo(
    () => findSlideLineOffset(liveSong?.lyrics ?? "", liveSlide?.text ?? ""),
    [liveSlide?.text, liveSong?.lyrics],
  );

  const annotationsByLine = useMemo(() => {
    const grouped = new Map<number, ChordAnnotation[]>();
    if (slideLineOffset < 0) {
      return grouped;
    }
    for (const annotation of chordChart.annotations) {
      const slideLineIndex = annotation.lineIndex - slideLineOffset;
      if (slideLineIndex < 0) {
        continue;
      }
      const existing = grouped.get(slideLineIndex) ?? [];
      existing.push(annotation);
      grouped.set(slideLineIndex, existing);
    }
    for (const annotations of grouped.values()) {
      annotations.sort((left, right) => left.anchorIndex - right.anchorIndex);
    }
    return grouped;
  }, [chordChart.annotations, slideLineOffset]);

  useEffect(() => {
    setLiveState(null);
    setMessage(null);
  }, [plan?.id]);

  useEffect(() => {
    const nextCapo = normalizeCapo(chordChart.capo);
    const nextCapoKey =
      chordChart.capoKey ?? (chordChart.absoluteKey ? deriveCapoKey(chordChart.absoluteKey, nextCapo) : MUSICAL_KEYS[0]);
    const nextAbsoluteKey = chordChart.absoluteKey ?? deriveAbsoluteKey(nextCapoKey, nextCapo);
    setCapo(nextCapo);
    setCapoKey(nextCapoKey);
    setAbsoluteKey(nextAbsoluteKey);
  }, [chordChart.absoluteKey, chordChart.capo, chordChart.capoKey, liveSong?.id]);

  useEffect(() => {
    if (!plan?.id) {
      return undefined;
    }

    async function pullLiveState() {
      if (!plan?.id || pollingRef.current) {
        return;
      }
      pollingRef.current = true;
      try {
        const remoteState = await getPresentationLiveState(plan.id);
        setLiveState(syncStateFromApi(remoteState));
        setMessage(null);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Could not sync live slide.");
      } finally {
        pollingRef.current = false;
      }
    }

    void pullLiveState();
    const timer = window.setInterval(() => void pullLiveState(), 1800);
    return () => window.clearInterval(timer);
  }, [plan?.id]);

  async function moveLive(delta: -1 | 1) {
    if (!plan || !slides.length) {
      return;
    }
    const nextState = publishStateForSlide(plan, slides, liveIndex + delta);
    setLiveState(nextState);
    try {
      const synced = await updatePresentationLiveState(plan.id, {
        plan_id: nextState.planId,
        index: nextState.index,
        plan_item_id: nextState.planItemId ?? null,
        slide_offset: nextState.slideOffset ?? 0,
        updated_at: nextState.updatedAt,
        theme: nextState.theme ?? "light",
        blanked: false,
        fullscreen: false,
      });
      setLiveState(syncStateFromApi(synced));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not move live slide.");
    }
  }

  function changeRealKey(delta: -1 | 1) {
    setAbsoluteKey((currentAbsoluteKey) => {
      const nextAbsoluteKey = shiftKey(currentAbsoluteKey ?? chordChart.absoluteKey ?? MUSICAL_KEYS[0], delta);
      setCapoKey(deriveCapoKey(nextAbsoluteKey, capo));
      return nextAbsoluteKey;
    });
  }

  function changeCapo(delta: -1 | 1) {
    setCapo((currentCapo) => {
      const nextCapo = normalizeCapo(currentCapo + delta);
      const shapesKey = capoKey ?? chordChart.capoKey ?? MUSICAL_KEYS[0];
      setAbsoluteKey(deriveAbsoluteKey(shapesKey, nextCapo));
      setCapoKey(shapesKey);
      return nextCapo;
    });
  }

  function changeActiveKeyControl(delta: -1 | 1) {
    if (displayMode === "absolute") {
      changeRealKey(delta);
      return;
    }
    changeCapo(delta);
  }

  const lyricLinesForSlide = lyricLines(liveSlide?.text ?? "");
  const currentAbsoluteKey = absoluteKey ?? chordChart.absoluteKey ?? (capoKey ? deriveAbsoluteKey(capoKey, capo) : null);
  const currentCapoKey = capoKey ?? (currentAbsoluteKey ? deriveCapoKey(currentAbsoluteKey, capo) : null);
  const baseAbsoluteKey =
    chordChart.absoluteKey ?? deriveAbsoluteKey(chordChart.capoKey ?? currentCapoKey ?? MUSICAL_KEYS[0], chordChart.capo);
  const activeKey = displayMode === "absolute" ? currentAbsoluteKey : currentCapoKey;
  const keyControlTitle = displayMode === "absolute" ? "Key" : "Capo";
  const keyControlValue = displayMode === "absolute" ? (currentAbsoluteKey ?? "Unset") : String(capo);

  return (
    <section className="musician-live-view" aria-label="Musician live view">
      <div className="musician-live-toolbar">
        <div className="musician-live-title">
          <strong>{liveSong?.title ?? liveSlide?.sectionTitle ?? "Waiting for a song"}</strong>
          <span>Key: {activeKey ?? "Unset"}</span>
        </div>
        <div className="musician-live-controls" aria-label="Musician display controls">
          <button
            aria-pressed={showChords}
            className={`chord-toggle-button ${showChords ? "is-active" : ""}`}
            onClick={() => setShowChords((current) => !current)}
            type="button"
          >
            <span aria-hidden="true" />
            Chords
          </button>
          <div className="musician-pill-toggle" aria-label="Chord display mode">
            <button className={displayMode === "absolute" ? "is-active" : ""} onClick={() => setDisplayMode("absolute")} type="button">
              Real
            </button>
            <button className={displayMode === "capo" ? "is-active" : ""} onClick={() => setDisplayMode("capo")} type="button">
              Capo
            </button>
          </div>
          <div className="musician-pill-toggle" aria-label="Chord detail">
            <button className={detailMode === "simple" ? "is-active" : ""} onClick={() => setDetailMode("simple")} type="button">
              Easy
            </button>
            <button className={detailMode === "advanced" ? "is-active" : ""} disabled onClick={() => setDetailMode("advanced")} type="button">
              Advanced
            </button>
          </div>
          <div className="musician-stepper" aria-label={keyControlTitle}>
            <span>{keyControlTitle}</span>
            <button onClick={() => changeActiveKeyControl(-1)} type="button" aria-label={`Lower ${keyControlTitle}`}>
              -
            </button>
            <strong>{keyControlValue}</strong>
            <button onClick={() => changeActiveKeyControl(1)} type="button" aria-label={`Raise ${keyControlTitle}`}>
              +
            </button>
          </div>
        </div>
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      <div
        className="musician-live-stage"
        style={{ "--musician-live-font-size": `${liveFontSize}px` } as CSSProperties & Record<"--musician-live-font-size", string>}
      >
        {!liveSlide ? (
          <p className="empty-state compact-empty">
            <Music2 size={18} aria-hidden="true" />
            Select a service with worship songs to start.
          </p>
        ) : liveSlide.itemType !== "song" ? (
          <div className="musician-live-waiting">
            <p className="eyebrow">Current service item</p>
            <h3>{liveSlide.sectionTitle}</h3>
            <p>The congregation view is not on a song right now.</p>
          </div>
        ) : (
          <div className="musician-chord-sheet" aria-label="Lyrics with chords">
            {lyricLinesForSlide.map((line, index) => (
              <MusicianChordLine
                annotations={annotationsByLine.get(index) ?? []}
                baseAbsoluteKey={baseAbsoluteKey}
                capo={capo}
                capoKey={currentCapoKey}
                detailMode={detailMode}
                displayMode={displayMode}
                key={`${index}-${line}`}
                line={line}
                showChords={showChords}
              />
            ))}
          </div>
        )}
      </div>

      <div className="musician-live-transport">
        <button className="text-button" disabled={!slides.length || liveIndex <= 0} onClick={() => void moveLive(-1)} type="button">
          <ChevronLeft size={16} aria-hidden="true" />
          Previous
        </button>
        <span>
          {slides.length ? liveIndex + 1 : 0} / {slides.length}
        </span>
        <button
          className="primary-button"
          disabled={!slides.length || liveIndex >= slides.length - 1}
          onClick={() => void moveLive(1)}
          type="button"
        >
          Next
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
