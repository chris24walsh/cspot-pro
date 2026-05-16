import { ChevronLeft, ChevronRight, Maximize, Music2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getPresentationLiveState,
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

function fitFontSize(lines: string[], stageWidth = 1120, stageHeight = 650) {
  const lineCount = Math.max(lines.length, 1);
  const longestLine = Math.max(...lines.map((line) => Array.from(line).length), 1);
  const usableWidth = Math.max(stageWidth * 0.9, 240);
  const usableHeight = Math.max(stageHeight * 0.82, 220);
  const widthDrivenSize = usableWidth / Math.max((longestLine + LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS) * 0.72, 1);
  const heightDrivenSize = usableHeight / Math.max(lineCount * 1.55, 1);
  return Math.floor(clampNumber(Math.min(widthDrivenSize, heightDrivenSize), 22, 56));
}

function fitFontSizeForSlides(slideTexts: string[], stageWidth: number, stageHeight: number) {
  const sizes = slideTexts
    .map((text) => fitFontSize(lyricLines(text), stageWidth, stageHeight))
    .filter((size) => Number.isFinite(size));
  if (!sizes.length) {
    return 40;
  }
  return Math.min(...sizes);
}

function musicianChordLabel(
  chord: string,
  options: {
    baseAbsoluteKey: string | null;
    capo: number;
    detailMode: ChordDetailMode;
    displayMode: ChordDisplayMode;
    targetAbsoluteKey: string | null;
  },
) {
  const targetAbsoluteKey = options.targetAbsoluteKey ?? options.baseAbsoluteKey;
  const preferFlats = Boolean(targetAbsoluteKey?.includes("b") || chord.includes("b"));
  const keyShift =
    options.baseAbsoluteKey && targetAbsoluteKey ? semitoneDistance(options.baseAbsoluteKey, targetAbsoluteKey) : 0;
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

function MusicianChordLine({
  annotations,
  baseAbsoluteKey,
  capo,
  detailMode,
  displayMode,
  line,
  showChords,
  targetAbsoluteKey,
}: {
  annotations: ChordAnnotation[];
  baseAbsoluteKey: string | null;
  capo: number;
  detailMode: ChordDetailMode;
  displayMode: ChordDisplayMode;
  line: string;
  showChords: boolean;
  targetAbsoluteKey: string | null;
}) {
  const totalSlots = Math.max(LEADING_CHORD_ANCHORS + line.length + TRAILING_CHORD_ANCHORS, 16);
  const characters = Array.from(line);

  return (
    <div className="musician-chord-line" style={{ gridTemplateColumns: `repeat(${totalSlots}, 1ch)` }}>
      {annotations.map((annotation) => {
        const label = musicianChordLabel(annotation.chord, {
          baseAbsoluteKey,
          capo,
          detailMode,
          displayMode,
          targetAbsoluteKey,
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
  const [guitarKey, setGuitarKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ height: 650, width: 1120 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pollingRef = useRef(false);

  const worshipItems = useMemo(
    () =>
      [...(plan?.items ?? [])]
        .filter((item) => item.item_type === "song" && item.song_id)
        .sort((left, right) => (Number.parseFloat(left.sequence) || 0) - (Number.parseFloat(right.sequence) || 0)),
    [plan?.items],
  );
  const slides = useMemo(() => buildPresentationSlides(worshipItems, songs), [songs, worshipItems]);
  const [localIndex, setLocalIndex] = useState(0);
  const remoteWorshipIndex = useMemo(() => {
    if (!liveState?.planItemId) {
      return -1;
    }
    return resolveLiveIndex(slides, liveState);
  }, [liveState, slides]);
  const liveIndex = remoteWorshipIndex >= 0 ? remoteWorshipIndex : boundedIndex(localIndex, slides.length);
  const liveSlide = slides[liveIndex] ?? null;
  const liveItem = worshipItems.find((item) => item.id === liveSlide?.planItemId) ?? null;
  const liveSong = liveItem?.song_id ? songs.find((song) => song.id === liveItem.song_id) ?? null : null;
  const chordChart = useMemo(() => parseChordChart(liveSong?.chords ?? null).document, [liveSong?.chords]);
  const liveFontSize = useMemo(
    () => fitFontSizeForSlides(slides.filter((slide) => slide.itemType === "song").map((slide) => slide.text), stageSize.width, stageSize.height),
    [slides, stageSize.height, stageSize.width],
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
    setLocalIndex(0);
    setMessage(null);
  }, [plan?.id]);

  useEffect(() => {
    const nextCapo = normalizeCapo(chordChart.capo);
    const nextAbsoluteKey =
      chordChart.absoluteKey ?? (chordChart.capoKey ? deriveAbsoluteKey(chordChart.capoKey, nextCapo) : null);
    const nextCapoKey =
      chordChart.capoKey ?? (nextAbsoluteKey ? deriveCapoKey(nextAbsoluteKey, nextCapo) : null);
    setCapo(nextCapo);
    setGuitarKey(nextCapoKey);
  }, [chordChart.absoluteKey, chordChart.capo, chordChart.capoKey, liveSong?.id]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return undefined;
    }

    function updateStageSize() {
      if (!element) {
        return;
      }
      const box = element.getBoundingClientRect();
      setStageSize({
        height: Math.max(Math.floor(box.height), 220),
        width: Math.max(Math.floor(box.width), 240),
      });
    }

    updateStageSize();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateStageSize);
      return () => window.removeEventListener("resize", updateStageSize);
    }

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

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

  function moveLive(delta: -1 | 1) {
    setLocalIndex(boundedIndex(liveIndex + delta, slides.length));
    setLiveState(null);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (editing) {
        return;
      }

      if (event.key === "ArrowRight" || event.key === "ArrowDown" || event.key === "PageDown" || event.key === " ") {
        event.preventDefault();
        moveLive(1);
        return;
      }

      if (event.key === "ArrowLeft" || event.key === "ArrowUp" || event.key === "PageUp") {
        event.preventDefault();
        moveLive(-1);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [liveIndex, slides.length]);

  function changeRealKey(delta: -1 | 1) {
    const currentRealKey =
      guitarKey
        ? deriveAbsoluteKey(guitarKey, capo)
        : chordChart.absoluteKey ?? (chordChart.capoKey ? deriveAbsoluteKey(chordChart.capoKey, capo) : MUSICAL_KEYS[0]);
    const nextAbsoluteKey = shiftKey(currentRealKey, delta);
    setGuitarKey(deriveCapoKey(nextAbsoluteKey, capo));
  }

  function changeCapo(delta: -1 | 1) {
    setCapo((currentCapo) => {
      const nextCapo = normalizeCapo(currentCapo + delta);
      setGuitarKey((currentGuitarKey) => {
        if (currentGuitarKey) {
          return currentGuitarKey;
        }
        if (chordChart.capoKey) {
          return chordChart.capoKey;
        }
        return chordChart.absoluteKey ? deriveCapoKey(chordChart.absoluteKey, currentCapo) : MUSICAL_KEYS[0];
      });
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

  async function toggleFullscreen() {
    const root = document.documentElement as HTMLElement & {
      webkitRequestFullscreen?: () => Promise<void> | void;
    };
    const exit = document.exitFullscreen?.bind(document) as (() => Promise<void>) | undefined;
    const request = root.requestFullscreen?.bind(root) ?? root.webkitRequestFullscreen?.bind(root);

    if (!request) {
      setMessage("This browser does not support fullscreen here. Use the browser share/menu fullscreen option if available.");
      return;
    }

    try {
      if (document.fullscreenElement) {
        await exit?.();
        return;
      }
      await request();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Use the browser fullscreen control for this display.");
    }
  }

  const lyricLinesForSlide = lyricLines(liveSlide?.text ?? "");
  const currentGuitarKey = guitarKey ?? chordChart.capoKey ?? (chordChart.absoluteKey ? deriveCapoKey(chordChart.absoluteKey, capo) : null);
  const currentAbsoluteKey = currentGuitarKey
    ? deriveAbsoluteKey(currentGuitarKey, capo)
    : chordChart.absoluteKey ?? null;
  const baseAbsoluteKey =
    chordChart.absoluteKey ?? deriveAbsoluteKey(chordChart.capoKey ?? currentGuitarKey ?? MUSICAL_KEYS[0], chordChart.capo);
  const activeKeyLabel = currentAbsoluteKey
    ? capo > 0
      ? `${currentAbsoluteKey} · Capo ${capo} · ${currentGuitarKey ?? deriveCapoKey(currentAbsoluteKey, capo)} shapes`
      : currentAbsoluteKey
    : "Unset";
  const keyControlTitle = displayMode === "absolute" ? "Key" : "Capo";
  const keyControlValue = displayMode === "absolute" ? (currentAbsoluteKey ?? "Unset") : String(capo);

  return (
    <section className="musician-live-view" aria-label="Musician live view">
      <div className="musician-live-toolbar">
        <div className="musician-live-title">
          <strong>{liveSong?.title ?? liveSlide?.sectionTitle ?? "Waiting for a song"}</strong>
          <span>Key: {activeKeyLabel}</span>
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
              Guitar
            </button>
          </div>
          <div className="musician-pill-toggle" aria-label="Chord detail">
            <button className={detailMode === "simple" ? "is-active" : ""} onClick={() => setDetailMode("simple")} type="button">
              Easy
            </button>
            <button className={detailMode === "advanced" ? "is-active" : ""} disabled onClick={() => setDetailMode("advanced")} type="button">
              Full
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
          <button className="musician-fullscreen-button" onClick={() => void toggleFullscreen()} type="button" aria-label="Toggle fullscreen">
            <Maximize size={18} aria-hidden="true" />
          </button>
        </div>
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      <div
        ref={stageRef}
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
                detailMode={detailMode}
                displayMode={displayMode}
                key={`${index}-${line}`}
                line={line}
                showChords={showChords}
                targetAbsoluteKey={currentAbsoluteKey}
              />
            ))}
          </div>
        )}
      </div>

      <div className="musician-live-transport">
        <button className="text-button" disabled={!slides.length || liveIndex <= 0} onClick={() => moveLive(-1)} type="button">
          <ChevronLeft size={16} aria-hidden="true" />
          Previous
        </button>
        <span>
          {slides.length ? liveIndex + 1 : 0} / {slides.length}
        </span>
        <button
          className="primary-button"
          disabled={!slides.length || liveIndex >= slides.length - 1}
          onClick={() => moveLive(1)}
          type="button"
        >
          Next
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
