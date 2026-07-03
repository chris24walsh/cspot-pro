import { ChevronLeft, ChevronRight, LogOut, Maximize2, Minimize2, Music2 } from "lucide-react";
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
  cappedCapoForKeys,
  deriveAbsoluteKey,
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
import { isEditableKeyboardTarget, slideKeyboardDirection, type SlideKeyboardDirection } from "../keyboardNavigation";

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
  return Math.min(Math.max(Math.trunc(value), 0), 5);
}

const PLAYABLE_SHAPE_KEYS = ["C", "G"] as const;

function keyDistance(left: string, right: string) {
  const upward = semitoneDistance(left, right);
  return Math.min(upward, 12 - upward);
}

function bestPlayableSetup(targetKey: string | null, shapeKey: string) {
  if (!targetKey) {
    return { absoluteKey: shapeKey, capo: 0, distance: 0, shapeKey };
  }
  const capo = cappedCapoForKeys(shapeKey, targetKey);
  const absoluteKey = deriveAbsoluteKey(shapeKey, capo);
  return {
    absoluteKey,
    capo,
    distance: keyDistance(absoluteKey, targetKey),
    shapeKey,
  };
}

function playableSetups(targetKey: string | null) {
  return PLAYABLE_SHAPE_KEYS.map((shapeKey) => bestPlayableSetup(targetKey, shapeKey)).sort(
    (left, right) => left.distance - right.distance || left.capo - right.capo || left.shapeKey.localeCompare(right.shapeKey),
  );
}

function setupValue(setup: { capo: number; shapeKey: string }) {
  return `${setup.shapeKey}:${setup.capo}`;
}

function uniqueKeySetups<T extends { capo: number; shapeKey: string }>(setups: T[]) {
  const seen = new Set<string>();
  return setups.filter((setup) => {
    const value = setupValue(setup);
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return true;
  });
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

function fitFontSizeForSlide(slideText: string, stageWidth: number, stageHeight: number) {
  const lines = lyricLines(slideText);
  if (!lines.length) {
    return 40;
  }

  const usableHeight = Math.max(stageHeight * 0.72, 130);
  let low = 13;
  let high = stageWidth < 640 ? 30 : 56;
  let best = low;

  while (low <= high) {
    const candidate = Math.floor((low + high) / 2);
    const wrapCharacters = wrapCharacterLimit(candidate, stageWidth);
    const visualLineCount = wrappedLineCount(lines, wrapCharacters);
    const groupGapCount = Math.max(lines.length - 1, 0);
    const estimatedHeight = visualLineCount * candidate * 2.35 + groupGapCount * candidate * 0.5;
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

function annotationsForSegment(annotations: ChordAnnotation[], segmentStart: number, segmentLength: number, isLastSegment: boolean) {
  const segmentEnd = segmentStart + segmentLength;
  return annotations
    .map((annotation) => {
      const lyricAnchor = annotation.anchorIndex >= LEADING_CHORD_ANCHORS ? annotation.anchorIndex - LEADING_CHORD_ANCHORS : annotation.anchorIndex;
      const lastAllowedAnchor = isLastSegment ? segmentEnd + TRAILING_CHORD_ANCHORS : segmentEnd - 1;
      if (lyricAnchor < segmentStart || lyricAnchor > lastAllowedAnchor) {
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
  const [capo, setCapo] = useState(0);
  const [guitarKey, setGuitarKey] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fullscreenFallbackActive, setFullscreenFallbackActive] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ height: 650, width: 1120 });
  const liveViewRef = useRef<HTMLElement | null>(null);
  const keyCaptureRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const channelRef = useRef<BroadcastChannel | null>(null);
  const pollingRef = useRef(false);
  const handledKeyboardEventsRef = useRef<WeakSet<KeyboardEvent>>(new WeakSet());
  const lastKeyboardNavigationRef = useRef<{ direction: SlideKeyboardDirection; key: string; time: number } | null>(null);
  const liveSyncPlanId = controlPlanId ?? plan?.id ?? null;
  const displayMode: ChordDisplayMode = "absolute";
  const detailMode: ChordDetailMode = "simple";

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
    () => fitFontSizeForSlide(liveSlide?.itemType === "song" ? liveSlide.text : "", stageSize.width, stageSize.height),
    [liveSlide?.itemType, liveSlide?.text, stageSize.height, stageSize.width],
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
    keyCaptureRef.current?.focus({ preventScroll: true });
  }, [liveSyncPlanId]);

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
    setCapo(nextCapo);
    setGuitarKey(chordChart.absoluteKey ?? chordChart.capoKey ?? null);
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
    window.visualViewport?.addEventListener("resize", updateStageSize);
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateStageSize);
      return () => {
        window.removeEventListener("resize", updateStageSize);
        window.visualViewport?.removeEventListener("resize", updateStageSize);
      };
    }

    const observer = new ResizeObserver(updateStageSize);
    observer.observe(element);
    window.addEventListener("resize", updateStageSize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateStageSize);
      window.visualViewport?.removeEventListener("resize", updateStageSize);
    };
  }, []);

  useEffect(() => {
    function updateFullscreenState() {
      const webkitDocument = document as Document & { webkitFullscreenElement?: Element | null };
      setIsFullscreen(Boolean(document.fullscreenElement ?? webkitDocument.webkitFullscreenElement ?? fullscreenFallbackActive));
    }

    updateFullscreenState();
    document.addEventListener("fullscreenchange", updateFullscreenState);
    document.addEventListener("webkitfullscreenchange", updateFullscreenState);
    return () => {
      document.removeEventListener("fullscreenchange", updateFullscreenState);
      document.removeEventListener("webkitfullscreenchange", updateFullscreenState);
    };
  }, [fullscreenFallbackActive]);

  useEffect(() => {
    if (!fullscreenFallbackActive) {
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setFullscreenFallbackActive(false);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [fullscreenFallbackActive]);

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
      if (event.type !== "keydown" || event.repeat) {
        return;
      }
      if (handledKeyboardEventsRef.current.has(event)) {
        return;
      }

      if (isEditableKeyboardTarget(event.target)) {
        return;
      }

      const direction = slideKeyboardDirection(event);
      if (direction) {
        const eventKey = `${event.key}:${event.code}:${event.keyCode || event.which}`;
        const now = Date.now();
        const lastNavigation = lastKeyboardNavigationRef.current;
        if (
          lastNavigation &&
          lastNavigation.direction === direction &&
          lastNavigation.key === eventKey &&
          now - lastNavigation.time < 120
        ) {
          return;
        }
        lastKeyboardNavigationRef.current = { direction, key: eventKey, time: now };
        handledKeyboardEventsRef.current.add(event);
        event.preventDefault();
        moveLive(direction);
      }
    }

    window.addEventListener("keydown", onKeyDown, { capture: true });
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => {
      window.removeEventListener("keydown", onKeyDown, { capture: true });
      document.removeEventListener("keydown", onKeyDown, { capture: true });
    };
  }, [liveIndex, slides.length]);

  async function toggleFullscreen() {
    const element = liveViewRef.current as (HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void }) | null;
    const webkitDocument = document as Document & {
      webkitExitFullscreen?: () => Promise<void> | void;
      webkitFullscreenElement?: Element | null;
    };
    const fullscreenElement = document.fullscreenElement ?? webkitDocument.webkitFullscreenElement;

    try {
      if (fullscreenElement || fullscreenFallbackActive) {
        setFullscreenFallbackActive(false);
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (fullscreenElement) {
          await webkitDocument.webkitExitFullscreen?.();
        }
      } else if (element) {
        if (element.requestFullscreen) {
          await element.requestFullscreen();
          setMessage(null);
        } else if (element.webkitRequestFullscreen) {
          await element.webkitRequestFullscreen?.();
          setMessage(null);
        } else {
          setFullscreenFallbackActive(true);
          setMessage(null);
        }
      }
    } catch (error) {
      if (element) {
        setFullscreenFallbackActive(true);
        setMessage(null);
        return;
      }
      setMessage(error instanceof Error ? error.message : "Could not enter fullscreen.");
    }
  }

  const lyricLinesForSlide = lyricLines(liveSlide?.text ?? "");
  const wrappedLyricLinesForSlide = useMemo(
    () => lyricLinesForSlide.map((line) => wrapLyricLine(line, liveWrapCharacters)),
    [liveWrapCharacters, lyricLinesForSlide],
  );
  const currentGuitarKey = guitarKey ?? chordChart.absoluteKey ?? chordChart.capoKey ?? null;
  const currentAbsoluteKey = currentGuitarKey ? deriveAbsoluteKey(currentGuitarKey, capo) : null;
  const baseAbsoluteKey = chordChart.absoluteKey ?? chordChart.capoKey ?? currentGuitarKey ?? MUSICAL_KEYS[0];
  const activeKeyLabel = currentGuitarKey
    ? capo > 0
      ? `${currentGuitarKey}c${capo}${currentAbsoluteKey ? ` (${currentAbsoluteKey})` : ""}`
      : currentGuitarKey
    : "unset";
  const originalCapo = normalizeCapo(chordChart.capo);
  const originalShapeKey = chordChart.absoluteKey ?? chordChart.capoKey ?? null;
  const originalAbsoluteKey = originalShapeKey ? deriveAbsoluteKey(originalShapeKey, originalCapo) : currentAbsoluteKey;
  const originalSetup =
    originalShapeKey && originalAbsoluteKey
      ? {
          absoluteKey: originalAbsoluteKey,
          capo: originalCapo,
          distance: 0,
          isOriginal: true,
          shapeKey: originalShapeKey,
        }
      : null;
  const absoluteOriginalSetup =
    originalAbsoluteKey && originalCapo > 0
      ? {
          absoluteKey: originalAbsoluteKey,
          capo: 0,
          distance: 0,
          isAbsolute: true,
          shapeKey: originalAbsoluteKey,
        }
      : null;
  const juniorSetups = playableSetups(originalAbsoluteKey);
  const selectedSetupValue = currentGuitarKey ? setupValue({ shapeKey: currentGuitarKey, capo }) : "";
  const currentSetup =
    currentGuitarKey && currentAbsoluteKey
      ? { absoluteKey: currentAbsoluteKey, capo, distance: 0, isCurrent: true, shapeKey: currentGuitarKey }
      : null;
  const keySetupOptions = uniqueKeySetups(
    [currentSetup, originalSetup, absoluteOriginalSetup, ...juniorSetups].filter(
      (setup): setup is {
        absoluteKey: string;
        capo: number;
        distance: number;
        isAbsolute?: boolean;
        isCurrent?: boolean;
        isOriginal?: boolean;
        shapeKey: string;
      } => Boolean(setup),
    ),
  );
  const currentSongSlides = liveSlide ? slides.filter((slide) => slide.planItemId === liveSlide.planItemId) : [];
  const currentSongSlideIndex = liveSlide ? currentSongSlides.findIndex((slide) => slide.id === liveSlide.id) : -1;
  const songCounter = currentSongSlideIndex >= 0 ? `${currentSongSlideIndex + 1} / ${currentSongSlides.length}` : slides.length ? `${liveIndex + 1} / ${slides.length}` : "0 / 0";
  const isLastSongSlide = liveSlide?.itemType === "song" && currentSongSlideIndex >= 0 && currentSongSlideIndex === currentSongSlides.length - 1;

  return (
    <section
      className={`musician-live-view ${isFullscreen ? "is-fullscreen" : ""} ${isLastSongSlide ? "is-song-end" : ""}`}
      aria-label="Musician live view"
      onPointerDownCapture={(event) => {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }
        keyCaptureRef.current?.focus({ preventScroll: true });
      }}
      ref={liveViewRef}
      tabIndex={-1}
    >
      <input
        aria-hidden="true"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="slide-key-capture"
        data-slide-key-capture="true"
        inputMode="none"
        onBlur={() => window.setTimeout(() => {
          if (!isEditableKeyboardTarget(document.activeElement)) {
            keyCaptureRef.current?.focus({ preventScroll: true });
          }
        }, 0)}
        ref={keyCaptureRef}
        spellCheck={false}
        tabIndex={-1}
      />
      <div className="musician-live-toolbar">
        <div className="musician-live-title">
          <strong>{liveSong?.title ?? liveSlide?.sectionTitle ?? "Waiting for a song"}</strong>
          <label className="musician-key-select-label">
            <span>Key</span>
            <select
              aria-label="Choose guitar key and capo"
              onChange={(event) => {
                const parts = event.target.value.split(":");
                const [shapeKey, capoValue] = parts;
                if (!shapeKey) return;
                setGuitarKey(shapeKey);
                setCapo(normalizeCapo(Number(capoValue || 0)));
              }}
              value={selectedSetupValue}
            >
              {!currentGuitarKey ? <option value="">Key</option> : null}
              {keySetupOptions.map((setup) => (
                <option key={setupValue(setup)} value={setupValue(setup)}>
                  {setup.isCurrent
                    ? activeKeyLabel
                    : setup.isAbsolute
                      ? setup.absoluteKey
                      : setup.capo > 0
                        ? `${setup.shapeKey}c${setup.capo} (${setup.absoluteKey})`
                        : setup.shapeKey}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="musician-live-controls" aria-label="Musician display controls">
          <span className="musician-song-counter">{songCounter}</span>
          <button
            aria-pressed={showChords}
            className={`chord-toggle-button ${showChords ? "is-active" : ""}`}
            onClick={() => setShowChords((current) => !current)}
            type="button"
          >
            <span aria-hidden="true" />
            Chords
          </button>
          <button className="musician-fullscreen-button" onClick={() => void toggleFullscreen()} type="button" aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
            {isFullscreen ? <Minimize2 size={18} aria-hidden="true" /> : <Maximize2 size={18} aria-hidden="true" />}
          </button>
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
                    annotations={annotationsForSegment(
                      annotationsByLine.get(lineIndex) ?? [],
                      segment.start,
                      segment.line.length,
                      segmentIndex === segments.length - 1,
                    )}
                    baseAbsoluteKey={baseAbsoluteKey}
                    capo={capo}
                    detailMode={detailMode}
                    displayMode={displayMode}
                    key={`${lineIndex}-${segmentIndex}-${segment.line}`}
                    line={segment.line}
                    showChords={showChords}
                    targetAbsoluteKey={currentGuitarKey}
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
