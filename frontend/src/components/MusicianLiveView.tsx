import { BookOpen, ChevronLeft, ChevronRight, Guitar, LogOut, Music2, Pencil, ScrollText } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  resolveChordAnnotations,
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
  splitOversizedLyricSlide,
  type PresentationLiveState,
} from "../presentation";
import { isEditableKeyboardTarget, slideKeyboardDirection, type SlideKeyboardDirection } from "../keyboardNavigation";
import { isMobileOrTabletDevice } from "../presentationDevice";
import { worshipSequenceBlocks } from "../worshipText";
import { mergeWorshipSetIntoService } from "../worshipSets";

interface MusicianLiveViewProps {
  controlPlanId?: string | null;
  onEditSong: (song: Song) => void;
  onExit: () => void;
  plan: PlanDetail | null;
  servicePlan?: PlanDetail | null;
  songs: Song[];
  topbarSlot: HTMLElement | null;
}

const WORSHIP_LIVE_POLL_INTERVAL_MS = 400;

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

export function findSlideLineOffset(sourceLyrics: string, slideText: string, slideKind?: "title" | "content") {
  if (slideKind === "title") {
    return -1;
  }
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

export function keySetupLabel(setup: { absoluteKey: string; capo: number; shapeKey: string }, expanded: boolean) {
  if (setup.capo <= 0) return expanded ? `${setup.shapeKey} (no capo)` : setup.shapeKey;
  return expanded
    ? `${setup.shapeKey} capo ${setup.capo} (${setup.absoluteKey})`
    : `${setup.shapeKey}${setup.capo}`;
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
  // The edge controls float over the lyrics, so reserve only the page's real
  // padding here rather than narrowing the text to avoid those controls.
  const horizontalInsets = stageWidth < 480 ? 12 : 24;
  const usableWidth = Math.max(stageWidth - horizontalInsets, 180);
  const chordAnchorSlots = LEADING_CHORD_ANCHORS + TRAILING_CHORD_ANCHORS;
  return Math.max(
    Math.floor(usableWidth / Math.max(fontSize * 0.6, 1)) - chordAnchorSlots - 1,
    12,
  );
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

function chordAnnotationsBySlideLine(
  sourceLyrics: string,
  slideText: string,
  slideKind: "title" | "content" | undefined,
  annotations: ChordAnnotation[],
) {
  const grouped = new Map<number, ChordAnnotation[]>();
  const lineOffset = findSlideLineOffset(sourceLyrics, slideText, slideKind);
  if (lineOffset < 0) return grouped;

  for (const annotation of resolveChordAnnotations(annotations, sourceLyrics)) {
    const slideLineIndex = annotation.absoluteLineIndex - lineOffset;
    if (slideLineIndex < 0) continue;
    const existing = grouped.get(slideLineIndex) ?? [];
    existing.push(annotation);
    grouped.set(slideLineIndex, existing);
  }
  for (const lineAnnotations of grouped.values()) {
    lineAnnotations.sort((left, right) => left.anchorIndex - right.anchorIndex);
  }
  return grouped;
}

export function MusicianLiveView({ controlPlanId, onEditSong, onExit, plan, servicePlan, songs, topbarSlot }: MusicianLiveViewProps) {
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(null);
  const [showChords, setShowChords] = useState(true);
  const [capo, setCapo] = useState(0);
  const [guitarKey, setGuitarKey] = useState<string | null>(null);
  const [keySelectExpanded, setKeySelectExpanded] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ height: 650, width: 1120 });
  const [readerMode, setReaderMode] = useState<"pages" | "scroll">(() =>
    isMobileOrTabletDevice() && window.matchMedia("(orientation: portrait)").matches ? "scroll" : "pages",
  );
  const keyCaptureRef = useRef<HTMLInputElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const fullSongRef = useRef<HTMLDivElement | null>(null);
  const activeSongPartRef = useRef<HTMLDivElement | null>(null);
  const swipeStartRef = useRef<{ x: number; y: number } | null>(null);
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
  const presentationSlides = useMemo(() => buildPresentationSlides(worshipItems, songs), [songs, worshipItems]);
  const serviceSlides = useMemo(
    () => servicePlan
      ? buildPresentationSlides(mergeWorshipSetIntoService(servicePlan.items, worshipItems), songs)
      : presentationSlides,
    [presentationSlides, servicePlan, songs, worshipItems],
  );
  const lastWorshipServiceIndex = serviceSlides.reduce(
    (lastIndex, slide, index) => worshipItems.some((item) => item.id === slide.planItemId) ? index : lastIndex,
    -1,
  );
  const nextServiceSlide = lastWorshipServiceIndex >= 0 ? serviceSlides[lastWorshipServiceIndex + 1] ?? null : null;
  // Worship Live controls the congregation slideshow, so song title slides must
  // remain in its navigation as useful transitions between songs.
  const slides = useMemo(() => nextServiceSlide ? [
    ...presentationSlides,
    {
      id: "worship-live:end",
      planItemId: "worship-live:end",
      sectionId: "worship-live:end",
      sectionTitle: "End of worship",
      title: "End of worship",
      text: "",
      slideKind: "content" as const,
      itemType: "worship_end",
      sequence: "999999",
    },
  ] : presentationSlides, [nextServiceSlide, presentationSlides]);
  const [localIndex, setLocalIndex] = useState(0);
  const remoteWorshipIndex = useMemo(() => {
    if (!liveState?.planItemId || !worshipItems.some((item) => item.id === liveState.planItemId)) {
      return -1;
    }
    const remoteSlide = presentationSlides[resolveLiveIndex(presentationSlides, liveState)];
    if (!remoteSlide) return -1;
    const exactIndex = slides.findIndex((slide) => slide.id === remoteSlide.id);
    return exactIndex >= 0 ? exactIndex : slides.findIndex((slide) => slide.planItemId === remoteSlide.planItemId);
  }, [liveState, presentationSlides, slides, worshipItems]);
  const syncedIndex = remoteWorshipIndex >= 0 ? remoteWorshipIndex : boundedIndex(localIndex, slides.length);
  const liveIndex = syncedIndex;
  const liveSlide = slides[liveIndex] ?? null;
  const isWorshipEndSlide = liveSlide?.itemType === "worship_end";
  const pageLeadIndex = liveSlide?.slideKind === "title"
    ? slides.findIndex((slide, index) => index > liveIndex && slide.planItemId === liveSlide.planItemId && slide.slideKind === "content")
    : liveIndex;
  const pageLeadSlide = slides[pageLeadIndex] ?? liveSlide;
  const pageNextSlide = slides[pageLeadIndex + 1] ?? null;
  const pagePreviousSlide = [...slides.slice(0, pageLeadIndex)].reverse().find((slide) => slide.slideKind === "content") ?? null;
  const previousPageLeadIndexRef = useRef(pageLeadIndex);
  const pageTurnDirection = pageLeadIndex < previousPageLeadIndexRef.current ? "backward" : "forward";
  useEffect(() => {
    previousPageLeadIndexRef.current = pageLeadIndex;
  }, [pageLeadIndex]);
  const liveItem = worshipItems.find((item) => item.id === liveSlide?.planItemId) ?? null;
  const liveSong = liveItem?.song_id ? songs.find((song) => song.id === liveItem.song_id) ?? null : null;
  const chordChart = useMemo(
    () => parseChordChart(liveSong?.chords ?? null, liveSong?.lyrics ?? null).document,
    [liveSong?.chords, liveSong?.lyrics],
  );
  const pageColumnWidth = stageSize.width >= 700 ? stageSize.width / 2 : stageSize.width;
  const pageContentWidth = pageColumnWidth;
  const pageContentHeight = stageSize.height;
  const pageFontSizesByPlanItem = useMemo(() => {
    const contentSlides = slides.filter(
      (slide) => slide.itemType === "song" && slide.slideKind === "content",
    );
    const baselineFit = Math.min(
      ...contentSlides.map((slide) => fitFontSizeForSlide(slide.text, pageContentWidth, pageContentHeight)),
      56,
    );
    const groupedFits = new Map<string, number>();
    for (const slide of contentSlides) {
      const slideFit = fitFontSizeForSlide(slide.text, pageContentWidth, pageContentHeight);
      groupedFits.set(slide.planItemId, Math.min(groupedFits.get(slide.planItemId) ?? 56, slideFit));
    }
    for (const [planItemId, songFit] of groupedFits) {
      const discreetUplift = songFit >= baselineFit + 6 ? 6 : songFit >= baselineFit + 3 ? 3 : 0;
      groupedFits.set(planItemId, Math.min(songFit, baselineFit + discreetUplift));
    }
    return groupedFits;
  }, [pageContentHeight, pageContentWidth, slides]);
  const liveFontSize = readerMode === "pages"
    ? pageFontSizesByPlanItem.get(pageLeadSlide?.planItemId ?? "") ?? 40
    : fitFontSizeForSlide(
        liveSlide?.itemType === "song" ? liveSlide.text : "",
        stageSize.width,
        stageSize.height,
      );
  const nextFontSize = pageFontSizesByPlanItem.get(pageNextSlide?.planItemId ?? "") ?? liveFontSize;
  const liveWrapCharacters = useMemo(
    () => wrapCharacterLimit(liveFontSize, readerMode === "pages" ? pageContentWidth : stageSize.width),
    [liveFontSize, pageContentWidth, readerMode, stageSize.width],
  );
  const nextWrapCharacters = wrapCharacterLimit(nextFontSize, pageContentWidth);
  const songModeColumnWidth = Math.min(stageSize.width, 1180);
  const songModeFontSize = clampNumber(songModeColumnWidth / 21, 20, 38);
  const songModeWrapCharacters = wrapCharacterLimit(songModeFontSize, songModeColumnWidth);
  const annotationsByLine = useMemo(
    () => chordAnnotationsBySlideLine(
      liveSong?.lyrics ?? "",
      pageLeadSlide?.text ?? "",
      pageLeadSlide?.slideKind,
      chordChart.annotations,
    ),
    [chordChart.annotations, liveSong?.lyrics, pageLeadSlide?.slideKind, pageLeadSlide?.text],
  );
  const pageNextSlideUsesCurrentSong = Boolean(
    pageNextSlide
    && pageNextSlide.planItemId === pageLeadSlide?.planItemId,
  );
  const pageNextItem = worshipItems.find((item) => item.id === pageNextSlide?.planItemId) ?? null;
  const pageNextSong = pageNextItem?.song_id ? songs.find((song) => song.id === pageNextItem.song_id) ?? null : null;
  const pageNextChordChart = useMemo(
    () => parseChordChart(pageNextSong?.chords ?? null, pageNextSong?.lyrics ?? null).document,
    [pageNextSong?.chords, pageNextSong?.lyrics],
  );
  const pageNextShapeKey = pageNextChordChart.capo > 0
    ? pageNextChordChart.capoKey ?? pageNextChordChart.absoluteKey
    : pageNextChordChart.absoluteKey ?? pageNextChordChart.capoKey;
  const pageNextAbsoluteKey = pageNextChordChart.absoluteKey
    ?? (pageNextShapeKey ? deriveAbsoluteKey(pageNextShapeKey, pageNextChordChart.capo) : null);
  const pageNextKeyLabel = pageNextShapeKey && pageNextAbsoluteKey
    ? keySetupLabel({ absoluteKey: pageNextAbsoluteKey, capo: pageNextChordChart.capo, shapeKey: pageNextShapeKey }, true)
    : null;
  const nextLyricLines = pageNextSlideUsesCurrentSong ? lyricLines(pageNextSlide?.text ?? "") : [];
  const nextWrappedLyricLines = nextLyricLines.map((line) => wrapLyricLine(line, nextWrapCharacters));
  const nextAnnotationsByLine = useMemo(
    () => chordAnnotationsBySlideLine(
      liveSong?.lyrics ?? "",
      pageNextSlide?.text ?? "",
      pageNextSlide?.slideKind,
      chordChart.annotations,
    ),
    [chordChart.annotations, liveSong?.lyrics, pageNextSlide?.slideKind, pageNextSlide?.text],
  );

  useEffect(() => {
    setLiveState(null);
    setLocalIndex(0);
    setMessage(null);
  }, [liveSyncPlanId, plan?.id]);

  useEffect(() => {
    if (!isMobileOrTabletDevice()) return undefined;
    const portraitQuery = window.matchMedia("(orientation: portrait)");
    const applyOrientationMode = () => setReaderMode(portraitQuery.matches ? "scroll" : "pages");
    applyOrientationMode();
    portraitQuery.addEventListener("change", applyOrientationMode);
    return () => portraitQuery.removeEventListener("change", applyOrientationMode);
  }, []);

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
    const timer = window.setInterval(() => void pullLiveState(), WORSHIP_LIVE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [liveSyncPlanId]);

  function moveLive(delta: -1 | 1) {
    const nextIndex = boundedIndex(liveIndex + delta, slides.length);
    setLocalIndex(nextIndex);
    void publishWorshipSlide(nextIndex);
  }

  function moveSong(delta: -1 | 1) {
    const currentItemIndex = worshipItems.findIndex((item) => item.id === liveSlide?.planItemId);
    const nextItem = worshipItems[currentItemIndex + delta];
    const nextIndex = slides.findIndex((slide) => slide.planItemId === nextItem?.id);
    if (nextIndex >= 0) {
      setLocalIndex(nextIndex);
      void publishWorshipSlide(nextIndex);
    }
  }

  async function publishWorshipSlide(nextIndex: number) {
    if (!liveSyncPlanId) {
      return;
    }
    const slide = slides[nextIndex];
    if (!slide) {
      return;
    }
    if (slide.itemType === "worship_end") {
      if (nextServiceSlide) await publishServiceSlide(nextServiceSlide);
      return;
    }

    const presentationIndex = presentationSlides.findIndex((candidate) => candidate.id === slide.id);
    const slideOffset = Math.max(
      presentationSlides.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id),
      0,
    );
    const state: PresentationLiveState = {
      planId: liveSyncPlanId,
      index: presentationIndex,
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
        index: presentationIndex,
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

  async function publishServiceSlide(slide: (typeof serviceSlides)[number]) {
    if (!liveSyncPlanId) return;
    const presentationIndex = serviceSlides.findIndex((candidate) => candidate.id === slide.id);
    const slideOffset = Math.max(
      serviceSlides.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id),
      0,
    );
    const state: PresentationLiveState = {
      planId: liveSyncPlanId,
      index: presentationIndex,
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
        index: presentationIndex,
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
      setMessage(error instanceof Error ? error.message : "Could not move to the next service section.");
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
  }, [liveIndex, nextServiceSlide, slides.length]);

  const lyricLinesForSlide = lyricLines(pageLeadSlide?.text ?? "");
  const wrappedLyricLinesForSlide = useMemo(
    () => lyricLinesForSlide.map((line) => wrapLyricLine(line, liveWrapCharacters)),
    [liveWrapCharacters, lyricLinesForSlide],
  );
  const currentGuitarKey = guitarKey ?? chordChart.absoluteKey ?? chordChart.capoKey ?? null;
  const currentAbsoluteKey = currentGuitarKey ? deriveAbsoluteKey(currentGuitarKey, capo) : null;
  const baseAbsoluteKey = chordChart.absoluteKey ?? chordChart.capoKey ?? currentGuitarKey ?? MUSICAL_KEYS[0];
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
  const currentSongContentSlides = currentSongSlides.filter((slide) => slide.slideKind !== "title");
  const currentSongSlideIndex = liveSlide ? currentSongSlides.findIndex((slide) => slide.id === liveSlide.id) : -1;
  const isSongTitleSlide = liveSlide?.itemType === "song" && liveSlide.slideKind === "title";
  const currentSongContentSlideIndex = liveSlide
    ? currentSongContentSlides.findIndex((slide) => slide.id === liveSlide.id)
    : -1;
  const isFirstLyricSlide = currentSongContentSlideIndex === 0;
  const sequenceBlocks = liveSong
    ? worshipSequenceBlocks(liveSong.lyrics, liveSong.sequence).map((block, blockIndex, blocks) => {
        const precedingSlideCount = blocks
          .slice(0, blockIndex)
          .reduce((total, preceding) => total + splitOversizedLyricSlide(preceding.content).length, 0);
        const parts = splitOversizedLyricSlide(block.content);
        const slideCount = parts.length;
        return {
          ...block,
          endSlideIndex: precedingSlideCount + slideCount,
          parts,
          slideIndex: precedingSlideCount,
        };
      })
    : [];
  const currentSequenceBlockIndex = sequenceBlocks.findIndex(
    (block) => currentSongContentSlideIndex >= block.slideIndex && currentSongContentSlideIndex < block.endSlideIndex,
  );
  const currentSequencePartIndex = currentSequenceBlockIndex >= 0
    ? currentSongContentSlideIndex - sequenceBlocks[currentSequenceBlockIndex].slideIndex
    : -1;

  function navigateToSequenceBlock(blockIndex: number, partIndex = 0) {
    const block = sequenceBlocks[blockIndex];
    const firstContentIndex = slides.findIndex(
      (slide) => slide.planItemId === liveSlide?.planItemId && slide.slideKind !== "title",
    );
    if (!block || firstContentIndex < 0) return;
    const safePartIndex = boundedIndex(partIndex, block.parts.length);
    const targetIndex = firstContentIndex + block.slideIndex + safePartIndex;
    setLocalIndex(targetIndex);
    void publishWorshipSlide(targetIndex);
  }

  function navigateToSongTitle() {
    const titleIndex = slides.findIndex(
      (slide) => slide.planItemId === liveSlide?.planItemId && slide.slideKind === "title",
    );
    if (titleIndex < 0) return;
    setLocalIndex(titleIndex);
    void publishWorshipSlide(titleIndex);
  }

  function navigateToWorshipEnd() {
    const endIndex = slides.findIndex((slide) => slide.itemType === "worship_end");
    if (endIndex < 0) return;
    setLocalIndex(endIndex);
    void publishWorshipSlide(endIndex);
  }

  useEffect(() => {
    if (readerMode !== "scroll" || !fullSongRef.current || !activeSongPartRef.current) {
      return undefined;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const container = fullSongRef.current;
        const activePart = activeSongPartRef.current;
        if (!container || !activePart) return;
        container.scrollTo({
          behavior: "smooth",
          left: Math.max(activePart.offsetLeft - (container.clientWidth - activePart.clientWidth) / 2, 0),
          top: Math.max(activePart.offsetTop - (container.clientHeight - activePart.clientHeight) / 2, 0),
        });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [currentSequenceBlockIndex, currentSequencePartIndex, liveSlide?.id, readerMode, showChords]);
  const currentSongIndex = worshipItems.findIndex((item) => item.id === liveSlide?.planItemId);
  const isLastSongSlide = liveSlide?.itemType === "song" && currentSongSlideIndex >= 0 && currentSongSlideIndex === currentSongSlides.length - 1;
  const toolbar = (
    <div className="musician-live-toolbar">
      <div className="musician-live-title">
        <strong>{isWorshipEndSlide ? "Worship finished" : liveSong?.title ?? liveSlide?.sectionTitle ?? "Waiting for a song"}</strong>
        <label className="musician-key-select-label">
          <select
            aria-label="Choose guitar key and capo"
            onBlur={() => setKeySelectExpanded(false)}
            onChange={(event) => {
              const parts = event.target.value.split(":");
              const [shapeKey, capoValue] = parts;
              if (!shapeKey) return;
              setGuitarKey(shapeKey);
              setCapo(normalizeCapo(Number(capoValue || 0)));
              setKeySelectExpanded(false);
            }}
            onFocus={() => setKeySelectExpanded(true)}
            onPointerDown={() => setKeySelectExpanded(true)}
            value={selectedSetupValue}
          >
            {!currentGuitarKey ? <option value="">{keySelectExpanded ? "Choose key" : "–"}</option> : null}
            {keySetupOptions.map((setup) => (
              <option key={setupValue(setup)} value={setupValue(setup)}>
                {keySetupLabel(setup, keySelectExpanded)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="musician-live-controls" aria-label="Musician display controls">
        <button
          aria-label={`Switch to ${readerMode === "pages" ? "Scroll" : "Pages"} view`}
          className="musician-reader-toggle"
          onClick={() => setReaderMode((current) => current === "pages" ? "scroll" : "pages")}
          title={`Switch to ${readerMode === "pages" ? "Scroll" : "Pages"} view`}
          type="button"
        >
          {readerMode === "pages"
            ? <ScrollText size={16} aria-hidden="true" />
            : <BookOpen size={16} aria-hidden="true" />}
          <span className="musician-control-text">{readerMode === "pages" ? "Scroll" : "Pages"}</span>
        </button>
        <button
          aria-label="Edit song"
          className="musician-edit-button"
          disabled={!liveSong}
          onClick={() => liveSong && onEditSong(liveSong)}
          title="Edit song"
          type="button"
        >
          <Pencil size={14} aria-hidden="true" />
          <span className="musician-control-text">Edit</span>
        </button>
        <button
          aria-pressed={showChords}
          className={`chord-toggle-button ${showChords ? "is-active" : ""}`}
          onClick={() => setShowChords((current) => !current)}
          title={showChords ? "Hide chords" : "Show chords"}
          type="button"
        >
          <span className="chord-toggle-indicator" aria-hidden="true" />
          <Guitar className="chord-toggle-icon" size={16} aria-hidden="true" />
          <span className="musician-control-text">Chords</span>
        </button>
        <button className="musician-fullscreen-button" onClick={onExit} type="button" aria-label="Exit live worship">
          <LogOut size={18} aria-hidden="true" />
        </button>
      </div>
    </div>
  );

  return (
    <section
      className={`musician-live-view musician-reader-mode-${readerMode} ${isLastSongSlide ? "is-song-end" : ""}`}
      aria-label="Musician live view"
      onPointerDownCapture={(event) => {
        if (isEditableKeyboardTarget(event.target)) {
          return;
        }
        keyCaptureRef.current?.focus({ preventScroll: true });
      }}
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
      {topbarSlot ? createPortal(toolbar, topbarSlot) : null}

      <div className="musician-song-navigation">
        <button aria-label="Previous song" className="musician-song-step-button" disabled={currentSongIndex <= 0} onClick={() => moveSong(-1)} title="Previous song" type="button">
          <ChevronLeft size={16} aria-hidden="true" />
          <span className="musician-song-step-label">Previous</span>
        </button>
        <nav className="musician-sequence-strip" aria-label="Song sequence">
          {liveSong ? <button
            aria-current={isSongTitleSlide ? "step" : undefined}
            aria-label="Song title slide"
            className={`musician-sequence-title ${isSongTitleSlide ? "is-active" : ""}`}
            onClick={navigateToSongTitle}
            title="Song title slide"
            type="button"
          >
            <Music2 size={13} aria-hidden="true" />
          </button> : null}
          {sequenceBlocks.map((block, blockIndex) => (
            <button
              aria-current={blockIndex === currentSequenceBlockIndex ? "step" : undefined}
              className={blockIndex === currentSequenceBlockIndex ? "is-active" : ""}
              key={`${block.label}-${blockIndex}`}
              onClick={() => {
                const nextPartIndex = blockIndex === currentSequenceBlockIndex
                  ? (currentSequencePartIndex + 1) % block.parts.length
                  : 0;
                navigateToSequenceBlock(blockIndex, nextPartIndex);
              }}
              style={blockIndex === currentSequenceBlockIndex ? {
                "--sequence-active-end": `${((currentSequencePartIndex + 1) / block.parts.length) * 100}%`,
                "--sequence-active-start": `${(currentSequencePartIndex / block.parts.length) * 100}%`,
              } as CSSProperties : undefined}
              type="button"
            >
              {block.label}
            </button>
          ))}
        </nav>
        <button aria-label="Next song" className="musician-song-step-button" disabled={currentSongIndex < 0 || currentSongIndex >= worshipItems.length - 1} onClick={() => moveSong(1)} title="Next song" type="button">
          <span className="musician-song-step-label">Next</span>
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      <div
        ref={stageRef}
        className={`musician-live-stage musician-reader-${readerMode}`}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId);
          swipeStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          swipeStartRef.current = null;
        }}
        onPointerUp={(event) => {
          const start = swipeStartRef.current;
          swipeStartRef.current = null;
          if (!start) return;
          const horizontal = event.clientX - start.x;
          const vertical = event.clientY - start.y;
          if (Math.abs(horizontal) >= 48 && Math.abs(horizontal) > Math.abs(vertical) * 1.25) {
            moveLive(horizontal < 0 ? 1 : -1);
          }
        }}
        style={{
          "--musician-content-width": "100%",
          "--musician-live-font-size": `${liveFontSize}px`,
        } as CSSProperties & Record<"--musician-content-width" | "--musician-live-font-size", string>}
      >
        {!liveSlide ? (
          <p className="empty-state compact-empty">
            <Music2 size={18} aria-hidden="true" />
            Select a service with worship songs to start.
          </p>
        ) : isWorshipEndSlide ? (
          <div className="musician-live-waiting musician-worship-end">
            <p className="eyebrow">Worship finished</p>
            <h3>{nextServiceSlide?.sectionTitle ?? "End of worship"}</h3>
            <p>The service has moved to the next section.</p>
          </div>
        ) : liveSlide.itemType !== "song" ? (
          <div className="musician-live-waiting">
            <p className="eyebrow">Current service item</p>
            <h3>{liveSlide.sectionTitle}</h3>
            <p>The congregation view is not on a song right now.</p>
          </div>
        ) : readerMode === "scroll" ? (
          <div className="musician-full-song" aria-label="Full song lyrics" ref={fullSongRef}>
            <button
              aria-current={isSongTitleSlide ? "step" : undefined}
              aria-label={`Go to ${liveSong?.title ?? liveSlide.sectionTitle} title cue`}
              className={`musician-song-title-cue ${isSongTitleSlide ? "is-current" : ""}`}
              onClick={navigateToSongTitle}
              type="button"
            >
              <Music2 size={20} aria-hidden="true" />
              <span>{liveSong?.title ?? liveSlide.sectionTitle}</span>
            </button>
            {sequenceBlocks.map((block, blockIndex) => (
              <section
                aria-current={blockIndex === currentSequenceBlockIndex ? "step" : undefined}
                key={`${block.label}-${blockIndex}`}
              >
                <button
                  aria-label={`Go to ${block.label}`}
                  className="musician-scroll-section-heading"
                  onClick={() => navigateToSequenceBlock(blockIndex)}
                  type="button"
                >
                  <strong>{block.label}</strong>
                </button>
                {block.parts.map((part, partIndex) => {
                  const isCurrent = blockIndex === currentSequenceBlockIndex && partIndex === currentSequencePartIndex;
                  const partLines = lyricLines(part);
                  const partAnnotations = chordAnnotationsBySlideLine(
                    liveSong?.lyrics ?? "",
                    part,
                    "content",
                    chordChart.annotations,
                  );
                  return (
                    <div
                      aria-label={block.parts.length > 1 ? `Go to ${block.label}, part ${partIndex + 1}` : `Go to ${block.label}`}
                      className={`musician-song-part ${isCurrent ? "is-current" : ""}`}
                      key={`${block.label}-${blockIndex}-${partIndex}`}
                      onClick={() => navigateToSequenceBlock(blockIndex, partIndex)}
                      onKeyDown={(event) => {
                        if (event.key !== "Enter" && event.key !== " ") return;
                        event.preventDefault();
                        navigateToSequenceBlock(blockIndex, partIndex);
                      }}
                      ref={isCurrent || (isSongTitleSlide && blockIndex === 0 && partIndex === 0) ? activeSongPartRef : undefined}
                      role="button"
                      style={{ "--musician-live-font-size": `${songModeFontSize}px` } as CSSProperties}
                      tabIndex={0}
                    >
                      {showChords ? (
                        <div className="musician-song-chord-sheet">
                          {partLines.map((line, lineIndex) => {
                            const segments = wrapLyricLine(line, songModeWrapCharacters);
                            return (
                              <div className="musician-lyric-line-group" key={`${lineIndex}-${line}`}>
                                {segments.map((segment, segmentIndex) => (
                                  <MusicianChordLine
                                    annotations={annotationsForSegment(partAnnotations.get(lineIndex) ?? [], segment.start, segment.line.length, segmentIndex === segments.length - 1)}
                                    baseAbsoluteKey={baseAbsoluteKey}
                                    capo={capo}
                                    detailMode={detailMode}
                                    displayMode={displayMode}
                                    key={`${lineIndex}-${segmentIndex}-${segment.line}`}
                                    line={segment.line}
                                    showChords
                                    targetAbsoluteKey={currentGuitarKey}
                                  />
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      ) : <p>{part}</p>}
                    </div>
                  );
                })}
              </section>
            ))}
            {nextServiceSlide ? (
              <button
                aria-label="Finish worship and move to the next service section"
                className="musician-song-title-cue musician-worship-end-cue"
                onClick={navigateToWorshipEnd}
                type="button"
              >
                <span>End of worship</span>
              </button>
            ) : null}
          </div>
        ) : (
          <div
            className={`musician-page-spread page-turn-${pageTurnDirection} ${isSongTitleSlide ? "is-title-selected" : ""} ${isFirstLyricSlide ? "is-first-lyric-selected" : ""}`}
            key={pageLeadSlide?.id ?? "empty-page"}
          >
            {pagePreviousSlide ? (
              <div aria-hidden="true" className="musician-previous-page-leaf">
                <span>{pagePreviousSlide.text}</span>
              </div>
            ) : null}
            <button
              aria-label={isSongTitleSlide ? "Start first lyrics" : "Current lyrics"}
              className="musician-page is-current"
              disabled={!isSongTitleSlide || !pageLeadSlide}
              onClick={() => {
                if (!isSongTitleSlide || !pageLeadSlide) return;
                const firstLyricIndex = slides.findIndex((slide) => slide.id === pageLeadSlide.id);
                if (firstLyricIndex < 0) return;
                setLocalIndex(firstLyricIndex);
                void publishWorshipSlide(firstLyricIndex);
              }}
              type="button"
            >
              <span className="musician-page-label">{isSongTitleSlide ? "Title cue" : "Now"}</span>
              {isSongTitleSlide ? (
                <div className="musician-page-title-cue">
                  <Music2 size={34} aria-hidden="true" />
                  <strong>{liveSong?.title ?? liveSlide.sectionTitle}</strong>
                  <span>Tap to start lyrics</span>
                </div>
              ) : <div className="musician-chord-sheet" aria-label="Lyrics with chords">
                {wrappedLyricLinesForSlide.map((segments, lineIndex) => (
                  <div className="musician-lyric-line-group" key={`${lineIndex}-${lyricLinesForSlide[lineIndex]}`}>
                    {segments.map((segment, segmentIndex) => (
                      <MusicianChordLine
                        annotations={annotationsForSegment(annotationsByLine.get(lineIndex) ?? [], segment.start, segment.line.length, segmentIndex === segments.length - 1)}
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
              </div>}
            </button>
            <button
              className={`musician-page is-next ${pageNextSlide?.slideKind === "title" ? "is-song-title" : ""}`}
              disabled={!pageNextSlide}
              aria-label={pageNextSlide?.itemType === "worship_end" ? "End worship" : pageNextSlide?.slideKind === "title" ? `Next song: ${pageNextSlide.text}` : "Next lyrics"}
              onClick={() => {
                if (!pageNextSlide) return;
                const nextIndex = slides.findIndex((slide) => slide.id === pageNextSlide.id);
                if (nextIndex < 0) return;
                setLocalIndex(nextIndex);
                void publishWorshipSlide(nextIndex);
              }}
              style={{ "--musician-live-font-size": `${nextFontSize}px` } as CSSProperties}
              type="button"
            >
              <span className="musician-page-label">Next</span>
              {pageNextSlide?.itemType === "worship_end" ? (
                <div className="musician-next-lyrics is-end"><span>Finish worship</span></div>
              ) : pageNextSlide?.slideKind === "title" ? (
                <div className="musician-next-song-preview">
                  <Music2 size={26} aria-hidden="true" />
                  <strong>{pageNextSlide.text}</strong>
                  {pageNextKeyLabel ? <span>{pageNextKeyLabel}</span> : null}
                </div>
              ) : pageNextSlide && showChords && pageNextSlideUsesCurrentSong ? (
                <div className="musician-chord-sheet musician-next-chord-sheet" aria-label="Next lyrics with chords">
                  {nextWrappedLyricLines.map((segments, lineIndex) => (
                    <div className="musician-lyric-line-group" key={`${lineIndex}-${nextLyricLines[lineIndex]}`}>
                      {segments.map((segment, segmentIndex) => (
                        <MusicianChordLine
                          annotations={annotationsForSegment(nextAnnotationsByLine.get(lineIndex) ?? [], segment.start, segment.line.length, segmentIndex === segments.length - 1)}
                          baseAbsoluteKey={baseAbsoluteKey}
                          capo={capo}
                          detailMode={detailMode}
                          displayMode={displayMode}
                          key={`${lineIndex}-${segmentIndex}-${segment.line}`}
                          line={segment.line}
                          showChords
                          targetAbsoluteKey={currentGuitarKey}
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ) : pageNextSlide ? (
                <div className="musician-next-lyrics">{pageNextSlide.text}</div>
              ) : (
                <div className="musician-next-lyrics is-end">
                  End of set
                </div>
              )}
            </button>
          </div>
        )}
        {liveSlide ? (
          <>
            <button aria-label="Previous slide" className="musician-edge-nav is-previous" disabled={liveIndex <= 0} onClick={() => moveLive(-1)} type="button"><ChevronLeft aria-hidden="true" /></button>
            <button aria-label="Next slide" className="musician-edge-nav is-next" disabled={liveIndex >= slides.length - 1} onClick={() => moveLive(1)} type="button"><ChevronRight aria-hidden="true" /></button>
          </>
        ) : null}
      </div>
    </section>
  );
}
