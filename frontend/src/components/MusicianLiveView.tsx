import { ChevronLeft, ChevronRight, LogOut, Music2 } from "lucide-react";
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
import {
  PRESENTATION_CHANNEL,
  PRESENTATION_STORAGE_KEY,
  buildPresentationSlides,
  resolveLiveIndex,
  type PresentationLiveState,
} from "../presentation";

interface MusicianLiveViewProps {
  controlPlanId?: string | null;
  onExit: () => void;
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

function wrapCharacterLimit(fontSize: number, stageWidth = 1120) {
  const usableWidth = Math.max(stageWidth * 0.94, 180);
  return Math.max(Math.floor(usableWidth / Math.max(fontSize * 0.6, 1)) - 2, 12);
}

function wrapLyricLine(line: string, maxCharacters: number) {
  if (line.length <= maxCharacters) {
    return [{ line, start: 0 }];
  }

  const words = Array.from(line.matchAll(/\S+/g));
  if (!words.length) {
    return [{ line, start: 0 }];
  }

  const segments: Array<{ line: string; start: number }> = [];
  let segmentStart = words[0].index ?? 0;
  let segmentEnd = segmentStart;

  function pushSegment(start: number, end: number) {
    if (end > start) {
      segments.push({ line: line.slice(start, end), start });
    }
  }

  for (const wordMatch of words) {
    const word = wordMatch[0];
    const wordStart = wordMatch.index ?? segmentEnd;
    const wordEnd = wordStart + word.length;

    if (word.length > maxCharacters) {
      pushSegment(segmentStart, segmentEnd);
      for (let index = 0; index < word.length; index += maxCharacters) {
        const chunkStart = wordStart + index;
        const chunkEnd = Math.min(chunkStart + maxCharacters, wordEnd);
        pushSegment(chunkStart, chunkEnd);
      }
      segmentStart = wordEnd;
      segmentEnd = wordEnd;
      continue;
    }

    if (segmentEnd > segmentStart && wordEnd - segmentStart > maxCharacters) {
      pushSegment(segmentStart, segmentEnd);
      segmentStart = wordStart;
    }

    segmentEnd = wordEnd;
  }

  pushSegment(segmentStart, segmentEnd);
  return segments.length ? segments : [{ line, start: 0 }];
}

function wrappedLineCount(lines: string[], maxCharacters: number) {
  return lines.reduce((total, line) => total + wrapLyricLine(line, maxCharacters).length, 0);
}

function fitFontSizeForSlide(slideText: string, stageWidth: number, stageHeight: number, showChords: boolean) {
  const lines = lyricLines(slideText);
  if (!lines.length) {
    return 40;
  }

  const usableHeight = Math.max(stageHeight * 0.88, 160);
  let low = 13;
  let high = stageWidth < 640 ? 42 : 72;
  let best = low;

  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const wrapCharacters = wrapCharacterLimit(candidate, stageWidth);
    const visualLineCount = wrappedLineCount(lines, wrapCharacters);
    const groupGapCount = Math.max(lines.length - 1, 0);
    const estimatedHeight = visualLineCount * candidate * (showChords ? 1.62 : 1.16) + groupGapCount * candidate * 0.42;
    if (estimatedHeight <= usableHeight) {
      best = candidate;
      low = candidate + 1;
    } else {
      high = candidate - 1;
    }
  }

  return best;
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

function annotationsForSegment(annotations: ChordAnnotation[], segmentStart: number, segmentLength: number) {
  const segmentEnd = segmentStart + segmentLength;
  return annotations
    .map((annotation) => {
      const lyricAnchor = annotation.anchorIndex >= LEADING_CHORD_ANCHORS ? annotation.anchorIndex - LEADING_CHORD_ANCHORS : annotation.anchorIndex;
      if (lyricAnchor < segmentStart || lyricAnchor > segmentEnd + TRAILING_CHORD_ANCHORS) {
        return null;
      }
      return {
        ...annotation,
        anchorIndex: LEADING_CHORD_ANCHORS + Math.max(lyricAnchor - segmentStart, 0),
      };
    })
    .filter((annotation): annotation is ChordAnnotation => Boolean(annotation));
}

export function MusicianLiveView({ controlPlanId, onExit, plan, songs }: MusicianLiveViewProps) {
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(null);
  const [showChords, setShowChords] = useState(true);
  const [displayMode, setDisplayMode] = useState<ChordDisplayMode>("capo");
  const [detailMode, setDetailMode] = useState<ChordDetailMode>("simple");
  const [capo, setCapo] = useState(0);
  const [guitarKey, setGuitarKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ height: 650, width: 1120 });
  const stageRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pollingRef = useRef(false);
  const liveSyncPlanId = controlPlanId ?? plan?.id ?? null;

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
    () => fitFontSizeForSlide(liveSlide?.itemType === "song" ? liveSlide.text : "", stageSize.width, stageSize.height, showChords),
    [liveSlide?.itemType, liveSlide?.text, showChords, stageSize.height, stageSize.width],
  );
  const liveWrapCharacters = useMemo(() => wrapCharacterLimit(liveFontSize, stageSize.width), [liveFontSize, stageSize.width]);
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
  }, [liveSyncPlanId, plan?.id]);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") {
      return undefined;
    }
    const channel = new BroadcastChannel(PRESENTATION_CHANNEL);
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, []);

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
    if (!liveSyncPlanId) {
      return undefined;
    }

    async function pullLiveState() {
      if (!liveSyncPlanId || pollingRef.current) {
        return;
      }
      pollingRef.current = true;
      try {
        const remoteState = await getPresentationLiveState(liveSyncPlanId);
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
  }, [liveSyncPlanId]);

  function moveLive(delta: -1 | 1) {
    const nextIndex = boundedIndex(liveIndex + delta, slides.length);
    setLocalIndex(nextIndex);
    void publishWorshipSlide(nextIndex);
  }

  async function publishWorshipSlide(nextIndex: number) {
    if (!liveSyncPlanId) {
      return;
    }
    const slide = slides[nextIndex];
    if (!slide) {
      return;
    }

    const slideOffset = Math.max(
      slides.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id),
      0,
    );
    const state: PresentationLiveState = {
      planId: liveSyncPlanId,
      index: nextIndex,
      updatedAt: Date.now(),
      planItemId: slide.planItemId,
      slideOffset,
      theme: liveState?.theme ?? "light",
      blanked: false,
      fullscreen: liveState?.fullscreen ?? false,
      videoAction: null,
    };

    setLiveState(state);
    localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state));
    channelRef.current?.postMessage(state);

    try {
      const synced = await updatePresentationLiveState(liveSyncPlanId, {
        plan_id: liveSyncPlanId,
        index: nextIndex,
        plan_item_id: slide.planItemId,
        slide_offset: slideOffset,
        updated_at: state.updatedAt,
        theme: state.theme ?? "light",
        blanked: false,
        fullscreen: Boolean(state.fullscreen),
        video_action: null,
        video_action_at: null,
      });
      setLiveState(syncStateFromApi(synced));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sync the slideshow.");
    }
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

  const lyricLinesForSlide = lyricLines(liveSlide?.text ?? "");
  const wrappedLyricLinesForSlide = useMemo(
    () => lyricLinesForSlide.map((line) => wrapLyricLine(line, liveWrapCharacters)),
    [liveWrapCharacters, lyricLinesForSlide],
  );
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
          <button className="musician-fullscreen-button" onClick={onExit} type="button" aria-label="Exit live worship">
            <LogOut size={18} aria-hidden="true" />
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
            {wrappedLyricLinesForSlide.map((segments, lineIndex) => (
              <div className="musician-lyric-line-group" key={`${lineIndex}-${lyricLinesForSlide[lineIndex]}`}>
                {segments.map((segment, segmentIndex) => (
                  <MusicianChordLine
                    annotations={annotationsForSegment(annotationsByLine.get(lineIndex) ?? [], segment.start, segment.line.length)}
                    baseAbsoluteKey={baseAbsoluteKey}
                    capo={capo}
                    detailMode={detailMode}
                    displayMode={displayMode}
                    key={`${lineIndex}-${segmentIndex}-${segment.line}`}
                    line={segment.line}
                    showChords={showChords}
                    targetAbsoluteKey={currentAbsoluteKey}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="musician-live-transport">
        <button className="text-button" disabled={!slides.length || liveIndex <= 0} onClick={() => moveLive(-1)} type="button">
          <ChevronLeft size={16} aria-hidden="true" />
        </button>
        <button
          className="primary-button"
          disabled={!slides.length || liveIndex >= slides.length - 1}
          onClick={() => moveLive(1)}
          type="button"
        >
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}
