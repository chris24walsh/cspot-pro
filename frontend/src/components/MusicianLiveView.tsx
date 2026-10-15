import { BookOpen, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Guitar, Link2, LogOut, Music2, Pencil, ListMusic, AudioLines, ScrollText, Unlink2 } from "lucide-react";
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
  type PresentationLiveState,
} from "../presentation";
import { isEditableKeyboardTarget, slideKeyboardDirection, type SlideKeyboardDirection } from "../keyboardNavigation";
import { isMobileOrTabletDevice } from "../presentationDevice";
import { PROGRAM_AUDIO_FADE_DURATION_MS } from "../audioTransitions";
import { songLyricPageBlocks } from "../lyricPages";
import { mergeWorshipSetIntoService } from "../worshipSets";

import { lyricHighlightPulse, lyricHighlightDistance, lyricHighlightTrail, lyricBarHighlightFill, timelineWithEntry, lyricBarLayout, lyricColumnWidths, wrapTimedLine, lyricCursorAt, lyricPlaybackBars, musicalSectionKey, type LyricBar, type LyricCursor } from "../lyricTiming";
import { LyricMusicControls, TimingDot } from "./LyricMusicControls";
import { playbackScrollTarget } from "../playbackScroll";
import { playbackPageMotion } from "../playbackPages";
import type { MusicTimingProgress } from "./LyricMusicControls";
import { BeatKeeper } from "./BeatKeeper";
import { useBandSync } from "./useBandSync";
import { useSharedMusicTiming } from "./useSharedMusicTiming";
import { MusicianDisplayChoice, musicianDisplayVisible, readMusicianDisplayMode, type MusicianDisplayMode } from "./MusicianDisplayChoice";
import { CompactControlMenu } from "./CompactControlMenu";
import { SongRhythmDisplay } from "./SongRhythmDisplay";

interface MusicianLiveViewProps {
  canControlAudio?: boolean;
  canUseMusic?: boolean;
  canShareTiming?: boolean;
  controlPlanId?: string | null;
  onSaveRhythm?: (song: Song, rhythm: Song["rhythm"]) => Promise<void>;
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
    countdownStartedAt: state.countdown_started_at,
    planItemId: state.plan_item_id,
    slideOffset: state.slide_offset,
    theme: state.theme,
    blanked: state.blanked,
    fullscreen: state.fullscreen,
    videoAction: state.video_action,
    videoActionAt: state.video_action_at ?? undefined,
    worshipCoupled: Boolean(state.worship_coupled),
  };
}

function compactLine(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function isInteractivePointerTarget(target: EventTarget | null) {
  return target instanceof Element && Boolean(target.closest("button, a, input, select, textarea, [role='button']"));
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

export function isWorshipSyncOverridden(
  worshipCoupled: boolean,
  hasLiveState: boolean,
  remoteWorshipIndex: number,
) {
  return worshipCoupled && hasLiveState && remoteWorshipIndex < 0;
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

function fitFontSizeForSlide(slideText: string, stageWidth: number, stageHeight: number, sourceLyrics?: string, bars: LyricBar[] = [], sourceOffset?: number) {
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
    const offset = sourceOffset ?? (sourceLyrics ? findSlideLineOffset(sourceLyrics, slideText, 'content') : -1);
    const visualLineCount = bars.length && offset >= 0 ? lines.reduce((sum, line, index) => sum + wrapTimedLine(line, wrapCharacters, lyricColumnWidths(sourceLyrics, bars, offset + index, LEADING_CHORD_ANCHORS, line.length)).length, 0) : wrappedLineCount(lines, wrapCharacters);
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
  timing,
}: {
  timing?: { lyrics: string; bars: LyricBar[]; sourceLine: number; segmentStart: number; lastSegment: boolean; showBars: boolean; showDot: boolean; highlight: boolean; downbeat: boolean; pulseStrength: number; barStart: { lineIndex: number; anchorIndex: number } | null; cursor: LyricCursor | null };
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
  const textCharacters = Array.from(line);
  const characters = Array.from({ length: totalSlots }, (_, slot) => textCharacters[slot - LEADING_CHORD_ANCHORS] ?? " ");
  const widths = useMemo(() => timing && timing.sourceLine >= 0 ? lyricColumnWidths(timing.lyrics, timing.bars, timing.sourceLine, timing.segmentStart, totalSlots) : Array.from({ length: totalSlots }, () => 1), [timing?.lyrics, timing?.bars, timing?.sourceLine, timing?.segmentStart, totalSlots]);
  const rangeStart = timing?.segmentStart ? timing.segmentStart + LEADING_CHORD_ANCHORS : 0;
  const rangeEnd = (timing?.segmentStart ?? 0) + LEADING_CHORD_ANCHORS + line.length + (timing?.lastSegment ? TRAILING_CHORD_ANCHORS : 0);
  const boundaries = timing?.showBars ? timing.bars.flatMap(bar => [bar.start, bar.end]).filter(position => position.lineIndex === timing.sourceLine && position.anchorIndex >= rangeStart && position.anchorIndex < rangeEnd) : [];
  const cursor = timing && timing.cursor && timing.cursor.lineIndex === timing.sourceLine && timing.cursor.anchorIndex >= rangeStart && timing.cursor.anchorIndex < rangeEnd ? timing.cursor : null;

  const trailDistance = timing?.highlight && timing.cursor ? lyricHighlightDistance(timing.lyrics, timing.cursor, timing.sourceLine, timing.segmentStart + LEADING_CHORD_ANCHORS) : 0;
  return (
    <div className={`musician-chord-line${cursor && timing?.highlight ? " is-lyric-current" : ""}`} style={{ gridTemplateColumns: widths.map(width => `${width}ch`).join(" ") }}>
      {boundaries.map((position, index) => <span aria-hidden="true" className="lyric-bar-line" key={`${position.anchorIndex}-${index}`} style={{ gridColumn: Math.floor(position.anchorIndex - timing!.segmentStart) + 1, gridRow: '1 / 3' }} />)}
      {cursor && timing?.showDot ? <span className="lyric-timing-track" style={{ gridColumn: '1 / -1', gridRow: 2 }}><TimingDot widths={widths} anchor={cursor.anchorIndex - timing!.segmentStart} pulse={cursor.pulse} /></span> : null}
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
      {characters.map((character, index) => {
        const sourceSlot = index >= LEADING_CHORD_ANCHORS && index < LEADING_CHORD_ANCHORS + line.length || timing?.segmentStart === 0 && index < LEADING_CHORD_ANCHORS || timing?.lastSegment && index >= LEADING_CHORD_ANCHORS + line.length;
        const fill = timing?.highlight && sourceSlot ? lyricBarHighlightFill({ lineIndex: 0, anchorIndex: 0 }, timing.cursor, timing.sourceLine, timing.segmentStart + index) : 0;
        const amber = fill > 0 && timing?.downbeat && lyricBarHighlightFill(timing.barStart, timing.cursor, timing.sourceLine, timing.segmentStart + index) > 0;
        return <span
          className={`${character.trim() ? "musician-lyric-character" : "musician-lyric-space"}${fill > 0 ? ` lyric-highlight-character${amber ? " is-downbeat" : ""}` : ""} lyric-highlight-slot`}
          key={`${index}-${character}`}
          style={{ gridColumn: index + 1, gridRow: 2,
          }}
        >
          <span aria-hidden="true" className="lyric-highlight-fill" style={{ opacity: fill > 0 && timing?.cursor ? lyricHighlightTrail(trailDistance + LEADING_CHORD_ANCHORS - index) * timing.pulseStrength : 0, width: `${fill > 0 ? fill * 100 : 100}%`, backgroundColor: amber ? '#f2cf7f' : '#b9dfd0', transitionProperty: fill > 0 && timing?.downbeat && !amber ? 'opacity' : undefined }} />
          {character === " " ? "\u00a0" : character}
        </span>;
      })}
    </div>
  );
}

function annotationsForSegment(annotations: ChordAnnotation[], segmentStart: number, segmentLength: number, isLastSegment: boolean) {
  const segmentEnd = segmentStart + segmentLength;
  return annotations
    .map((annotation) => {
      const lyricAnchor = annotation.anchorIndex - LEADING_CHORD_ANCHORS;
      // The leading slots belong only to the first wrapped segment. Preserve
      // their position before the words rather than shifting them onto lyrics.
      if (lyricAnchor < 0) return segmentStart === 0 ? { ...annotation } : null;
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
  sourceOffset?: number,
) {
  const grouped = new Map<number, ChordAnnotation[]>();
  const lineOffset = slideKind === "title" ? -1 : sourceOffset ?? findSlideLineOffset(sourceLyrics, slideText, slideKind);
  if (lineOffset < 0) return grouped;

  for (const annotation of resolveChordAnnotations(annotations, sourceLyrics)) {
    const slideLineIndex = annotation.absoluteLineIndex - lineOffset;
    if (slideLineIndex < 0 || slideLineIndex >= lyricLines(slideText).length) continue;
    const existing = grouped.get(slideLineIndex) ?? [];
    existing.push(annotation);
    grouped.set(slideLineIndex, existing);
  }
  for (const lineAnnotations of grouped.values()) {
    lineAnnotations.sort((left, right) => left.anchorIndex - right.anchorIndex);
  }
  return grouped;
}

export function MusicianLiveView({ canUseMusic = false, canShareTiming = canUseMusic, canControlAudio = false, controlPlanId, onEditSong, onSaveRhythm, onExit, plan, servicePlan, songs, topbarSlot }: MusicianLiveViewProps) {
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(null);
  const [chordDisplay, setChordDisplay] = useState(() => readMusicianDisplayMode("worship-chords-display"));
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
  const lastLiveStateAtRef = useRef(0);
  const navigationGenerationRef = useRef(0);
  const handledKeyboardEventsRef = useRef<WeakSet<KeyboardEvent>>(new WeakSet());
  const lastKeyboardNavigationRef = useRef<{ direction: SlideKeyboardDirection; key: string; time: number } | null>(null);
  const liveSyncPlanId = controlPlanId ?? plan?.id ?? null;
  const keyboardCaptureEnabled = !isMobileOrTabletDevice();
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
  const [beatKeeperEnabled, setBeatKeeperEnabled] = useState(() => { try { return localStorage.getItem("worship-beat-keeper") !== "off"; } catch { return true; } });
  const [barDisplay, setBarDisplay] = useState(() => readMusicianDisplayMode("worship-bars-display"));
  const [localMusicCursor, setMusicCursor] = useState<LyricCursor | null>(null);
  const [localTiming, setLocalTiming] = useState<MusicTimingProgress | null>(null);
  const [autoScroll, setAutoScroll] = useState(() => { try { return localStorage.getItem("worship-auto-scroll") !== "off"; } catch { return true; } });
  const manualScrollPaused = useRef(false);
  const lastManualScrollAt = useRef(0);
  const playbackScrollTargetRef = useRef<number | null>(null);
  const [scrollCatchUp, setScrollCatchUp] = useState<'up' | 'down' | null>(null);
  function updateScrollCatchUp() {
    const container = fullSongRef.current, target = playbackScrollTargetRef.current;
    setScrollCatchUp(manualScrollPaused.current && container && target !== null && Math.abs(target - container.scrollTop) > 4 ? target < container.scrollTop ? 'up' : 'down' : null);
  }
  function catchUpLyrics() {
    const container = fullSongRef.current, target = playbackScrollTargetRef.current;
    if (!container || target === null) return;
    manualScrollPaused.current = false;
    manualScrollDestination.current = null;
    container.scrollTop = target;
    setScrollCatchUp(null);
  }
  const scrollTouchStart = useRef<number | null>(null);
  const [playbackContext, setPlaybackContext] = useState<{ songId: string; itemId: string } | null>(null);
  const [jumpPending, setJumpPending] = useState(false);
  const [playFrom, setPlayFrom] = useState<{ revision: number; slideId: string } | null>(null);
  const playFromCounter = useRef(0);
  const jumpHoldRef = useRef(false);
  const automaticSlideRef = useRef<string | null>(null);
  const previousRemoteIndex = useRef(-1);
  const [localPlaybackActive, setLocalPlaybackActive] = useState(false);
  const [lyricHighlight, setLyricHighlight] = useState(() => { try { return localStorage.getItem("worship-lyric-highlight") === "on"; } catch { return false; } });
  const [dotDisplay, setDotDisplay] = useState(() => readMusicianDisplayMode("worship-dot-display", "worship-timing-dot"));
  const [followSharedTiming, setFollowSharedTiming] = useState(() => { try { return localStorage.getItem('worship-follow-timing') === 'on'; } catch { return false; } });
  const [shareTiming, setShareTiming] = useState(() => { try { return localStorage.getItem("worship-share-timing") === "on"; } catch { return false; } });
  const remoteWorshipIndex = useMemo(() => {
    if (!liveState?.planItemId || !worshipItems.some((item) => item.id === liveState.planItemId)) {
      return -1;
    }
    const remoteSlide = presentationSlides[resolveLiveIndex(presentationSlides, liveState)];
    if (!remoteSlide) return -1;
    const exactIndex = slides.findIndex((slide) => slide.id === remoteSlide.id);
    return exactIndex >= 0 ? exactIndex : slides.findIndex((slide) => slide.planItemId === remoteSlide.planItemId);
  }, [liveState, presentationSlides, slides, worshipItems]);
  const worshipCoupled = Boolean(liveState?.worshipCoupled);
  const [bandSyncEnabled, setBandSyncEnabled] = useState(() => { try { return localStorage.getItem("worship-band-sync") !== "off"; } catch { return true; } });
  const bandSync = useBandSync(plan?.id ?? null, bandSyncEnabled && !worshipCoupled);
  const bandIndex = bandSync.selection ? slides.findIndex(slide => slide.id === bandSync.selection?.slide_id) : -1;
  useEffect(() => {
    if (!worshipCoupled && bandSyncEnabled && bandIndex >= 0) {
      setLocalIndex(bandIndex);
    }
  }, [bandIndex, bandSync.selection?.updated_at, bandSyncEnabled, worshipCoupled]);
  useEffect(() => {
    const old = previousRemoteIndex.current;
    previousRemoteIndex.current = remoteWorshipIndex;
    if (!localPlaybackActive || !worshipCoupled || old === remoteWorshipIndex || remoteWorshipIndex < 0) return;
    const slide = slides[remoteWorshipIndex];
    if (!slide) return;
    if (slide.id === automaticSlideRef.current) { automaticSlideRef.current = null; return; }
    automaticSlideRef.current = null;
    if (jumpPending && slide.id === playFrom?.slideId) return;
    jumpHoldRef.current = true; setJumpPending(true);
    setPlayFrom({ revision: ++playFromCounter.current, slideId: slide.id });
  }, [remoteWorshipIndex, worshipCoupled]);
  useEffect(() => {
    const selection = bandSync.selection;
    if (!localPlaybackActive || worshipCoupled || !selection || selection.slide_id === liveSlideIdForBand()) return;
    jumpHoldRef.current = true; setJumpPending(true);
    setPlayFrom({ revision: ++playFromCounter.current, slideId: selection.slide_id });
  }, [bandSync.selection?.updated_at]);
  function liveSlideIdForBand() { return slides[boundedIndex(localIndex, slides.length)]?.id; }
  const worshipSyncOverridden = isWorshipSyncOverridden(worshipCoupled, Boolean(liveState), remoteWorshipIndex);
  const syncedIndex = worshipCoupled && remoteWorshipIndex >= 0 ? remoteWorshipIndex : boundedIndex(localIndex, slides.length);
  const sharedTiming = useSharedMusicTiming({ planId: liveSyncPlanId, songId: playbackContext?.songId ?? null, itemId: playbackContext?.itemId ?? null, share: canShareTiming && shareTiming, follow: followSharedTiming });
  const sharedSlideIndex = useMemo(() => {
    const remote = !localPlaybackActive && followSharedTiming ? sharedTiming.remote : null;
    if (!remote) return -1;
    const song = songs.find(candidate => candidate.id === remote.timing.song_id);
    const first = slides.findIndex(slide => slide.planItemId === remote.timing.plan_item_id && slide.slideKind === 'content');
    if (!song?.rhythm || first < 0) return -1;
    const annotations = parseChordChart(song.chords, song.lyrics).document.annotations;
    const timeline = timelineWithEntry(lyricPlaybackBars(song.lyrics, song.sequence, lyricBarLayout(song.lyrics, song.rhythm, annotations)), remote.timing.start_index, remote.timing.first_bar_stop ?? 0);
    const cursor = lyricCursorAt(song.lyrics, timeline, remote.timing.start_index + Math.max(0, remote.position), song.rhythm.numerator, song.rhythm.denominator);
    if (!cursor) return first;
    const block = songLyricPageBlocks(song.lyrics, song.sequence)[cursor.occurrence];
    if (!block) return first;
    const part = block.parts.findIndex((text, index) => cursor.lineIndex >= block.partLineOffsets[index] && cursor.lineIndex < block.partLineOffsets[index] + lyricLines(text).length);
    return first + block.slideIndex + Math.max(0, part);
  }, [localPlaybackActive, followSharedTiming, sharedTiming.remote, songs, slides]);
  const liveIndex = sharedSlideIndex >= 0 ? sharedSlideIndex : syncedIndex;
  const liveSlide = slides[liveIndex] ?? null;

  useEffect(() => {
    if (worshipCoupled && remoteWorshipIndex >= 0) {
      setLocalIndex(remoteWorshipIndex);
    }
  }, [remoteWorshipIndex, worshipCoupled]);
  const isWorshipEndSlide = liveSlide?.itemType === "worship_end";
  const pageLeadIndex = liveSlide?.slideKind === "title"
    ? slides.findIndex((slide, index) => index > liveIndex && slide.planItemId === liveSlide.planItemId && slide.slideKind === "content")
    : liveIndex;
  const pageLeadSlide = slides[pageLeadIndex] ?? liveSlide;
  const pageNextSlide = liveSlide?.slideKind === "title"
    ? pageLeadSlide
    : slides[pageLeadIndex + 1] ?? null;
  const pagePreviousSlide = [...slides.slice(0, pageLeadIndex)].reverse().find((slide) => slide.slideKind === "content") ?? null;
  const previousPageLeadIndexRef = useRef(pageLeadIndex);
  const pageTurnDirection = pageLeadIndex < previousPageLeadIndexRef.current ? "backward" : "forward";
  useEffect(() => {
    previousPageLeadIndexRef.current = pageLeadIndex;
  }, [pageLeadIndex]);
  const liveItem = worshipItems.find((item) => item.id === liveSlide?.planItemId) ?? null;
  const backingAudioAvailable = Boolean(liveSlide?.youtubeAudioUrl);
  const backingAudioPlaying = Boolean(backingAudioAvailable && liveState?.planItemId === liveItem?.id && liveState?.videoAction === "play");
  const liveSong = liveItem?.song_id ? songs.find((song) => song.id === liveItem.song_id) ?? null : null;
  const chordChart = useMemo(
    () => parseChordChart(liveSong?.chords ?? null, liveSong?.lyrics ?? null).document,
    [liveSong?.chords, liveSong?.lyrics],
  );
  const sequenceBlocks = useMemo(() => songLyricPageBlocks(liveSong?.lyrics, liveSong?.sequence), [liveSong?.lyrics, liveSong?.sequence]);
  function pageContext(slide: (typeof slides)[number] | null) {
    const contentIndex = slide?.slideKind === 'content' && slide.planItemId === liveItem?.id
      ? slides.filter(candidate => candidate.planItemId === slide.planItemId && candidate.slideKind === 'content').findIndex(candidate => candidate.id === slide.id)
      : -1;
    const occurrence = sequenceBlocks.findIndex(block => contentIndex >= block.slideIndex && contentIndex < block.endSlideIndex);
    return { occurrence, sourceOffset: occurrence < 0 ? -1 : sequenceBlocks[occurrence].partLineOffsets[contentIndex - sequenceBlocks[occurrence].slideIndex] };
  }
  const leadPageContext = pageContext(pageLeadSlide);
  const nextPageContext = pageContext(pageNextSlide);
  const timingBars = useMemo(() => lyricBarLayout(liveSong?.lyrics, liveSong?.rhythm, chordChart.annotations), [liveSong?.lyrics, liveSong?.rhythm, chordChart.annotations]);
  const remoteTimeline = useMemo(() => lyricPlaybackBars(liveSong?.lyrics, liveSong?.sequence, timingBars), [liveSong?.lyrics, liveSong?.sequence, timingBars]);

  const remoteSongMatches = sharedTiming.remote?.timing.song_id === liveSong?.id && sharedTiming.remote?.timing.plan_item_id === liveItem?.id;
  const remoteCursor = remoteSongMatches && sharedTiming.remote && sharedTiming.remote.position >= 0 && liveSong?.rhythm
    ? lyricCursorAt(liveSong.lyrics, timelineWithEntry(remoteTimeline, sharedTiming.remote.timing.start_index, sharedTiming.remote.timing.first_bar_stop ?? 0), sharedTiming.remote.timing.start_index + sharedTiming.remote.position, liveSong.rhythm.numerator, liveSong.rhythm.denominator) : null;
  const musicCursor = jumpPending ? null : localPlaybackActive ? localMusicCursor : remoteCursor ?? localMusicCursor;
  const playbackActive = localPlaybackActive || Boolean(localMusicCursor) || Boolean(remoteSongMatches && sharedTiming.remote) || backingAudioPlaying;
  const showChords = musicianDisplayVisible(chordDisplay, playbackActive, true);
  const musicMode = musicianDisplayVisible(barDisplay, playbackActive);
  const showTimingDot = dotDisplay !== 'off' && playbackActive;
  const idleBar = remoteTimeline.find(bar => bar.occurrence === leadPageContext.occurrence && bar.start.lineIndex >= leadPageContext.sourceOffset && bar.start.lineIndex < leadPageContext.sourceOffset + lyricLines(pageLeadSlide?.text ?? '').length);
  const displayCursor = lyricHighlight && playbackActive ? musicCursor : showTimingDot ? musicCursor ?? (leadPageContext.sourceOffset < 0 ? null : { ...(idleBar?.start ?? { lineIndex: leadPageContext.sourceOffset, anchorIndex: LEADING_CHORD_ANCHORS }), occurrence: leadPageContext.occurrence, barStartLine: idleBar?.start.lineIndex ?? leadPageContext.sourceOffset, pulse: 0 }) : null;
  function chooseDisplay(key: string, setter: (mode: MusicianDisplayMode) => void, mode: MusicianDisplayMode) {
    setter(mode); try { localStorage.setItem(key, mode); } catch {}
  }
  const followingRemote = !localPlaybackActive && Boolean(remoteCursor);
  useEffect(() => {
    if (!followSharedTiming || localPlaybackActive || !sharedTiming.remote || remoteSongMatches) return;
    // A synced slide selection wins while the old song finishes its bar.
    if (worshipCoupled || (bandSyncEnabled && bandSync.selection)) return;
    const index = slides.findIndex(slide => slide.planItemId === sharedTiming.remote?.timing.plan_item_id && slide.slideKind === 'content');
    if (index >= 0) { setLocalIndex(index); }
  }, [sharedTiming.remote?.timing.song_id, sharedTiming.remote?.timing.plan_item_id, followSharedTiming, localPlaybackActive, remoteSongMatches, worshipCoupled, bandSyncEnabled, bandSync.selection?.slide_id]);
  function wrapMusicLine(line: string, limit: number, offset: number, lineIndex: number) {
    return timingBars.length && offset >= 0 ? wrapTimedLine(line, limit, lyricColumnWidths(liveSong?.lyrics, timingBars, offset + lineIndex, LEADING_CHORD_ANCHORS, line.length)) : wrapLyricLine(line, limit);
  }
  const pageColumnWidth = stageSize.width >= 700 ? stageSize.width / 2 : stageSize.width;
  const pageContentWidth = pageColumnWidth;
  const pageContentHeight = stageSize.height;
  const pageFontSizesByPlanItem = useMemo(() => {
    if (readerMode !== "pages") return new Map<string, number>();
    const contentSlides = slides.filter(
      (slide) => slide.itemType === "song" && slide.slideKind === "content",
    );
    const baselineFit = Math.min(
      ...contentSlides.map((slide) => fitFontSizeForSlide(slide.text, pageContentWidth, pageContentHeight, slide.planItemId === liveItem?.id ? liveSong?.lyrics ?? undefined : undefined, slide.planItemId === liveItem?.id ? timingBars : [], pageContext(slide).sourceOffset)),
      56,
    );
    const groupedFits = new Map<string, number>();
    for (const slide of contentSlides) {
      const slideFit = fitFontSizeForSlide(slide.text, pageContentWidth, pageContentHeight, slide.planItemId === liveItem?.id ? liveSong?.lyrics ?? undefined : undefined, slide.planItemId === liveItem?.id ? timingBars : [], pageContext(slide).sourceOffset);
      groupedFits.set(slide.planItemId, Math.min(groupedFits.get(slide.planItemId) ?? 56, slideFit));
    }
    for (const [planItemId, songFit] of groupedFits) {
      const discreetUplift = songFit >= baselineFit + 6 ? 6 : songFit >= baselineFit + 3 ? 3 : 0;
      groupedFits.set(planItemId, Math.min(songFit, baselineFit + discreetUplift));
    }
    return groupedFits;
  }, [pageContentHeight, pageContentWidth, readerMode, slides, liveItem?.id, liveSong?.lyrics, timingBars, sequenceBlocks]);
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
      leadPageContext.sourceOffset,
    ),
    [chordChart.annotations, liveSong?.lyrics, pageLeadSlide?.slideKind, pageLeadSlide?.text, leadPageContext.sourceOffset],
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
  const nextWrappedLyricLines = nextLyricLines.map((line, lineIndex) => wrapMusicLine(line, nextWrapCharacters, nextPageContext.sourceOffset, lineIndex));
  const nextAnnotationsByLine = useMemo(
    () => chordAnnotationsBySlideLine(
      liveSong?.lyrics ?? "",
      pageNextSlide?.text ?? "",
      pageNextSlide?.slideKind,
      chordChart.annotations,
      nextPageContext.sourceOffset,
    ),
    [chordChart.annotations, liveSong?.lyrics, pageNextSlide?.slideKind, pageNextSlide?.text, nextPageContext.sourceOffset],
  );

  useEffect(() => {
    setLiveState(null);
    setLocalIndex(0);
    setMessage(null);
    lastLiveStateAtRef.current = 0;
    navigationGenerationRef.current += 1;
  }, [liveSyncPlanId, plan?.id]);

  useEffect(() => {
    if (!isMobileOrTabletDevice()) return undefined;
    const portraitQuery = window.matchMedia("(orientation: portrait)");
    const applyOrientationMode = () => setReaderMode(portraitQuery.matches ? "scroll" : "pages");
    applyOrientationMode();
    if (!portraitQuery.addEventListener) {
      portraitQuery.addListener(applyOrientationMode);
      return () => portraitQuery.removeListener(applyOrientationMode);
    }
    portraitQuery.addEventListener("change", applyOrientationMode);
    return () => portraitQuery.removeEventListener("change", applyOrientationMode);
  }, []);

  useEffect(() => {
    if (keyboardCaptureEnabled) keyCaptureRef.current?.focus({ preventScroll: true });
  }, [keyboardCaptureEnabled, liveSyncPlanId]);

  function nextLiveUpdateAt() {
    return Math.max(Date.now(), lastLiveStateAtRef.current + 1);
  }

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

    let disposed = false;
    let polling = false;
    async function pullLiveState() {
      if (!liveSyncPlanId || polling) {
        return;
      }
      polling = true;
      const generation = navigationGenerationRef.current;
      try {
        const remoteState = await getPresentationLiveState(liveSyncPlanId);
        if (disposed || generation !== navigationGenerationRef.current) return;
        if (remoteState.updated_at > lastLiveStateAtRef.current) {
          lastLiveStateAtRef.current = remoteState.updated_at;
          setLiveState(syncStateFromApi(remoteState));
        }
        setMessage(null);
      } catch (error) {
        if (!disposed && generation === navigationGenerationRef.current) {
          setMessage(error instanceof Error ? error.message : "Could not sync live slide.");
        }
      } finally {
        polling = false;
      }
    }

    void pullLiveState();
    const timer = window.setInterval(
      () => void pullLiveState(),
      isMobileOrTabletDevice() ? 1000 : WORSHIP_LIVE_POLL_INTERVAL_MS,
    );
    return () => { disposed = true; window.clearInterval(timer); };
  }, [liveSyncPlanId]);

  function moveLive(delta: -1 | 1) {
    navigationGenerationRef.current += 1;
    const nextIndex = boundedIndex(liveIndex + delta, slides.length);
    setLocalIndex(nextIndex);
    void publishWorshipSlide(nextIndex, navigationGenerationRef.current);
  }

  function moveSong(delta: -1 | 1) {
    const currentItemIndex = worshipItems.findIndex((item) => item.id === liveSlide?.planItemId);
    const nextItem = worshipItems[currentItemIndex + delta];
    const nextIndex = slides.findIndex((slide) => slide.planItemId === nextItem?.id);
    if (nextIndex >= 0) {
      navigationGenerationRef.current += 1;
      setLocalIndex(nextIndex);
      void publishWorshipSlide(nextIndex, navigationGenerationRef.current);
    }
  }

  async function publishWorshipSlide(nextIndex: number, navigationGeneration = navigationGenerationRef.current, automatic = false) {
    if (!automatic) manualScrollPaused.current = false;
    if (!automatic && localPlaybackActive && slides[nextIndex]?.itemType === "song") {
      jumpHoldRef.current = true;
      setJumpPending(true);
      setPlayFrom({ revision: ++playFromCounter.current, slideId: slides[nextIndex].id });
    }
    if (!liveSyncPlanId) {
      return;
    }
    const slide = slides[nextIndex];
    if (!slide) {
      return;
    }
    // Rehearsal navigation uses its own channel and never changes service output.
    if (!worshipCoupled) {
      await bandSync.publish(slide.id);
      return;
    }
    if (slide.itemType === "worship_end") {
      if (nextServiceSlide) await publishServiceSlide(nextServiceSlide, false);
      return;
    }

    if (
      liveState?.planItemId !== slide.planItemId
      && (liveState?.videoAction === "play" || liveState?.videoAction === "pause")
    ) {
      await publishAudioFade();
      window.setTimeout(() => {
        if (navigationGenerationRef.current === navigationGeneration) {
          void publishWorshipSlide(nextIndex, navigationGeneration, true);
        }
      }, PROGRAM_AUDIO_FADE_DURATION_MS);
      return;
    }

    const presentationIndex = serviceSlides.findIndex((candidate) => candidate.id === slide.id);
    const slideOffset = Math.max(
      presentationSlides.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id),
      0,
    );
    const state: PresentationLiveState = {
      planId: liveSyncPlanId,
      index: presentationIndex,
      updatedAt: nextLiveUpdateAt(),
      planItemId: slide.planItemId,
      slideOffset,
      theme: liveState?.theme ?? "light",
      blanked: false,
      fullscreen: liveState?.fullscreen ?? false,
      videoAction: liveState?.planItemId === slide.planItemId ? liveState.videoAction : null,
      videoActionAt: liveState?.planItemId === slide.planItemId ? liveState.videoActionAt : undefined,
      worshipCoupled,
    };

    setLiveState(state);
    lastLiveStateAtRef.current = state.updatedAt;
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
        video_action: state.videoAction ?? null,
        video_action_at: state.videoActionAt ?? null,
        worship_coupled: true,
      });
      if (navigationGenerationRef.current === navigationGeneration) {
        lastLiveStateAtRef.current = synced.updated_at;
        setLiveState(syncStateFromApi(synced));
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not sync the slideshow.");
    }
  }

  async function publishServiceSlide(
    slide: (typeof serviceSlides)[number],
    coupled = worshipCoupled,
    navigationGeneration = navigationGenerationRef.current,
  ) {
    if (!liveSyncPlanId) return;
    if (
      liveState?.planItemId !== slide.planItemId
      && (liveState?.videoAction === "play" || liveState?.videoAction === "pause")
    ) {
      await publishAudioFade();
      window.setTimeout(() => {
        if (navigationGenerationRef.current === navigationGeneration) {
          void publishServiceSlide(slide, coupled, navigationGeneration);
        }
      }, PROGRAM_AUDIO_FADE_DURATION_MS);
      return;
    }
    const presentationIndex = serviceSlides.findIndex((candidate) => candidate.id === slide.id);
    const slideOffset = Math.max(
      serviceSlides.filter((candidate) => candidate.planItemId === slide.planItemId).findIndex((candidate) => candidate.id === slide.id),
      0,
    );
    const state: PresentationLiveState = {
      planId: liveSyncPlanId,
      index: presentationIndex,
      updatedAt: nextLiveUpdateAt(),
      planItemId: slide.planItemId,
      slideOffset,
      theme: liveState?.theme ?? "light",
      blanked: false,
      fullscreen: liveState?.fullscreen ?? false,
      videoAction: null,
      worshipCoupled: coupled,
    };
    setLiveState(state);
    lastLiveStateAtRef.current = state.updatedAt;
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
        worship_coupled: coupled,
      });
      if (navigationGenerationRef.current === navigationGeneration) {
        lastLiveStateAtRef.current = synced.updated_at;
        setLiveState(syncStateFromApi(synced));
      }
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not move to the next service section.");
    }
  }

  async function toggleBackingAudio() {
    if (!worshipCoupled || !liveSyncPlanId || !liveItem || !backingAudioAvailable) return;
    const action = backingAudioPlaying ? "fade-stop" : "play";
    const now = nextLiveUpdateAt();
    const state = { ...liveState, planId: liveSyncPlanId, index: liveIndex, planItemId: liveItem.id, updatedAt: now, videoAction: action as "play" | "fade-stop", videoActionAt: now };
    setLiveState(state);
    lastLiveStateAtRef.current = state.updatedAt;
    channelRef.current?.postMessage(state);
    try {
      const synced = await updatePresentationLiveState(liveSyncPlanId, {
        plan_id: liveSyncPlanId,
        index: serviceSlides.findIndex((slide) => slide.id === liveSlide?.id),
        plan_item_id: liveItem.id,
        slide_offset: Math.max(serviceSlides.filter((slide) => slide.planItemId === liveItem.id).findIndex((slide) => slide.id === liveSlide?.id), 0),
        updated_at: now,
        theme: liveState?.theme ?? "light",
        blanked: false,
        fullscreen: Boolean(liveState?.fullscreen),
        video_action: action,
        video_action_at: now,
        worship_coupled: worshipCoupled,
      });
      if (synced.updated_at >= lastLiveStateAtRef.current) {
        lastLiveStateAtRef.current = synced.updated_at;
        setLiveState(syncStateFromApi(synced));
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not control backing audio.");
    }
  }

  async function publishAudioFade() {
    if (!liveSyncPlanId || !liveState?.planItemId) return;
    const now = nextLiveUpdateAt();
    const state = { ...liveState, updatedAt: now, videoAction: "fade-stop" as const, videoActionAt: now };
    setLiveState(state);
    lastLiveStateAtRef.current = state.updatedAt;
    localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state));
    channelRef.current?.postMessage(state);
    await updatePresentationLiveState(liveSyncPlanId, {
      plan_id: liveSyncPlanId,
      index: liveState.index,
      plan_item_id: liveState.planItemId,
      slide_offset: liveState.slideOffset ?? 0,
      updated_at: now,
      theme: liveState.theme ?? "light",
      blanked: Boolean(liveState.blanked),
      fullscreen: Boolean(liveState.fullscreen),
      video_action: "fade-stop",
      video_action_at: now,
      worship_coupled: worshipCoupled,
    });
  }

  async function toggleServiceCoupling() {
    navigationGenerationRef.current += 1;
    if (worshipCoupled) {
      if (worshipSyncOverridden && liveState && liveSyncPlanId) {
        const navigationGeneration = navigationGenerationRef.current;
        const updatedAt = nextLiveUpdateAt();
        const state: PresentationLiveState = {
          ...liveState,
          updatedAt,
          worshipCoupled: false,
        };
        setLiveState(state);
        lastLiveStateAtRef.current = updatedAt;
        localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state));
        channelRef.current?.postMessage(state);
        try {
          const synced = await updatePresentationLiveState(liveSyncPlanId, {
            plan_id: liveSyncPlanId,
            index: liveState.index,
            plan_item_id: liveState.planItemId ?? null,
            slide_offset: liveState.slideOffset ?? 0,
            updated_at: updatedAt,
            theme: liveState.theme ?? "light",
            blanked: Boolean(liveState.blanked),
            fullscreen: Boolean(liveState.fullscreen),
            video_action: liveState.videoAction ?? null,
            video_action_at: liveState.videoActionAt ?? null,
            worship_coupled: false,
          });
          if (
            navigationGenerationRef.current === navigationGeneration
            && synced.updated_at >= lastLiveStateAtRef.current
          ) {
            lastLiveStateAtRef.current = synced.updated_at;
            setLiveState(syncStateFromApi(synced));
          }
          setMessage(null);
        } catch (error) {
          setMessage(error instanceof Error ? error.message : "Could not stop worship sync.");
        }
        return;
      }
      if (nextServiceSlide) await publishServiceSlide(nextServiceSlide, false);
      return;
    }
    const selectedWorshipSlide = slides[boundedIndex(localIndex, slides.length)];
    const targetSlide = selectedWorshipSlide?.itemType === "song"
      ? serviceSlides.find((slide) => slide.id === selectedWorshipSlide.id)
      : serviceSlides.find((slide) => worshipItems.some((item) => item.id === slide.planItemId));
    if (targetSlide) await publishServiceSlide(targetSlide, true);
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.type !== "keydown" || event.repeat) {
        return;
      }
      if (handledKeyboardEventsRef.current.has(event)) {
        return;
      }

      if (isEditableKeyboardTarget(event.target) || event.target instanceof Element && Boolean(event.target.closest('[role="menu"], [aria-haspopup="menu"]'))) {
        return;
      }

      if (document.querySelector('[data-pedal-enabled="true"]')) return;
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
  }, [
    liveIndex,
    liveState,
    liveSyncPlanId,
    nextServiceSlide,
    presentationSlides,
    serviceSlides,
    slides,
    worshipCoupled,
  ]);

  const lyricLinesForSlide = lyricLines(pageLeadSlide?.text ?? "");
  const wrappedLyricLinesForSlide = useMemo(
    () => lyricLinesForSlide.map((line, lineIndex) => wrapMusicLine(line, liveWrapCharacters, leadPageContext.sourceOffset, lineIndex)),
    [liveWrapCharacters, lyricLinesForSlide, timingBars, leadPageContext.sourceOffset, liveSong?.lyrics],
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
  const currentSequenceBlockIndex = sequenceBlocks.findIndex(
    (block) => currentSongContentSlideIndex >= block.slideIndex && currentSongContentSlideIndex < block.endSlideIndex,
  );
  const currentSequencePartIndex = currentSequenceBlockIndex >= 0
    ? currentSongContentSlideIndex - sequenceBlocks[currentSequenceBlockIndex].slideIndex
    : -1;

  const beatPosition = localPlaybackActive ? localTiming?.position ?? null : remoteSongMatches ? sharedTiming.remote?.position ?? null : null;
  const beatRhythm = localPlaybackActive && playbackContext ? songs.find(song => song.id === playbackContext.songId)?.rhythm : liveSong?.rhythm;
  const beatCount = beatRhythm?.visual_beats || (beatRhythm?.denominator === 8 && beatRhythm.numerator % 3 === 0 ? beatRhythm.numerator / 3 : beatRhythm?.numerator ?? 4);
  const showBeatKeeper = beatKeeperEnabled && (localPlaybackActive || Boolean(remoteSongMatches && sharedTiming.remote));
  const playbackPosition = localPlaybackActive && localTiming && localTiming.position >= 0
    ? localTiming.startIndex + localTiming.position
    : !localPlaybackActive && remoteSongMatches && sharedTiming.remote && sharedTiming.remote.position >= 0 ? sharedTiming.remote.timing.start_index + sharedTiming.remote.position : null;
  const playbackPages = useMemo(() => {
    const first = slides.findIndex(slide => slide.planItemId === liveItem?.id && slide.slideKind === "content");
    return sequenceBlocks.flatMap((block, occurrence) => block.parts.flatMap((part, index) => {
      const start = block.partLineOffsets[index];
      const firstBar = remoteTimeline.findIndex(bar => bar.occurrence === occurrence && bar.start.lineIndex >= start && bar.start.lineIndex < start + lyricLines(part).length);
      return first >= 0 && firstBar >= 0 ? [{ slideIndex: first + block.slideIndex + index, firstBar }] : [];
    }));
  }, [slides, liveItem?.id, sequenceBlocks, remoteTimeline]);
  // Starting on a later page must never lead back into the preceding page.
  const startedAt = localPlaybackActive ? localTiming?.startIndex : sharedTiming.remote?.timing.start_index;
  const startingPage = playbackPages.filter(page => page.firstBar <= (startedAt ?? 0)).slice(-1)[0];
  const playbackMotion = playbackPosition === null ? null : playbackPageMotion(playbackPages.filter(page => page === startingPage || page.firstBar >= (startedAt ?? 0)), playbackPosition);
  const lastScrollSlide = useRef<string | null>(null);
  const manualScrollDestination = useRef<string | null>(null);
  const lastMusicPageRef = useRef<string | null>(null);
  useEffect(() => { setMusicCursor(null); }, [liveSong?.id]);
  useEffect(() => {
    if (jumpPending || jumpHoldRef.current) return;
    if (manualScrollDestination.current && !(musicCursor?.occurrence === leadPageContext.occurrence && musicCursor.lineIndex >= leadPageContext.sourceOffset && musicCursor.lineIndex < leadPageContext.sourceOffset + lyricLines(pageLeadSlide?.text ?? "").length)) return;
    if (!playbackMotion) { lastMusicPageRef.current = null; return; }
    const targetIndex = playbackMotion.slideIndex;
    const pageKey = `${liveSyncPlanId}:${liveItem?.id}:${targetIndex}:${worshipCoupled}`;
    if (lastMusicPageRef.current === pageKey) return;
    lastMusicPageRef.current = pageKey;
    automaticSlideRef.current = worshipCoupled && targetIndex !== remoteWorshipIndex ? slides[targetIndex]?.id ?? null : null;
    setLocalIndex(targetIndex);
    if (!followingRemote && (worshipCoupled || bandSyncEnabled)) {
      navigationGenerationRef.current += 1;
      void publishWorshipSlide(targetIndex, navigationGenerationRef.current, true);
    }
  }, [playbackMotion?.slideIndex, liveItem?.id, worshipCoupled, liveSyncPlanId, followingRemote, bandSyncEnabled, jumpPending, musicCursor?.occurrence, musicCursor?.lineIndex]);
  useEffect(() => {
    const changed = lastScrollSlide.current !== null && lastScrollSlide.current !== liveSlide?.id;
    lastScrollSlide.current = liveSlide?.id ?? null;
    if (readerMode !== "scroll" || !autoScroll || !playbackMotion || !liveSlide) { manualScrollDestination.current = null; return; }
    if (manualScrollPaused.current || !(jumpPending || changed && liveIndex !== playbackMotion.slideIndex)) return;
    const container = fullSongRef.current, part = activeSongPartRef.current;
    if (!container || !part) return;
    manualScrollDestination.current = liveSlide.id;
    const firstLine = part.querySelector<HTMLElement>("[data-playback-line]") ?? part;
    const bounds = firstLine.getBoundingClientRect();
    container.scrollTop = Math.max(0, container.scrollTop + bounds.top - container.getBoundingClientRect().top + bounds.height / 2 - container.clientHeight / 2);
  }, [liveSlide?.id, jumpPending, readerMode, autoScroll]);
  useEffect(() => {
    manualScrollPaused.current = false;
    playbackScrollTargetRef.current = null;
    setScrollCatchUp(null);
  }, [liveSong?.id, playbackActive, autoScroll, readerMode, playFrom?.revision, jumpPending]);
  useEffect(() => {
    if (readerMode !== "scroll" || !autoScroll || !playbackMotion) return;
    const container = fullSongRef.current;
    if (!container) return;
    if (!musicCursor || jumpPending || jumpHoldRef.current) return;
    if (manualScrollDestination.current) {
      const onDestination = manualScrollDestination.current === liveSlide?.id && musicCursor.occurrence === leadPageContext.occurrence && musicCursor.lineIndex >= leadPageContext.sourceOffset && musicCursor.lineIndex < leadPageContext.sourceOffset + lyricLines(pageLeadSlide?.text ?? "").length;
      if (!onDestination) return;
      manualScrollDestination.current = null;
    }
    const lines = Array.from(container.querySelectorAll<HTMLElement>("[data-playback-line]"));
    const index = lines.findIndex(line => Number(line.dataset.playbackOccurrence) === musicCursor.occurrence && Number(line.dataset.playbackLine) === musicCursor.lineIndex);
    const active = lines[index];
    if (!active) return;
    const containerTop = container.getBoundingClientRect().top;
    const lineY = (element: HTMLElement) => {
      const bounds = element.getBoundingClientRect();
      return container.scrollTop + bounds.top - containerTop + bounds.height / 2;
    };
    const points = remoteTimeline.flatMap((bar, barIndex) => {
      if (barIndex < (startedAt ?? 0)) return [];
      const index = lines.findIndex(line => Number(line.dataset.playbackOccurrence) === bar.occurrence && Number(line.dataset.playbackLine) === bar.start.lineIndex);
      if (index < 0) return [];
      const y = lineY(lines[index]);
      const nextY = lines[index + 1] ? lineY(lines[index + 1]) : y;
      const length = lyricLines(liveSong?.lyrics ?? "")[bar.start.lineIndex]?.length ?? 1;
      const fraction = Math.max(0, Math.min(1, (bar.start.anchorIndex - LEADING_CHORD_ANCHORS) / Math.max(1, length)));
      return [{ bar: barIndex, y: y + (nextY - y) * fraction }];
    });
    if (points.length) points.push({ bar: remoteTimeline.length, y: lineY(lines[lines.length - 1]) });
    const target = playbackScrollTarget(points, playbackPosition ?? 0, lineY(active), container.clientHeight);
    playbackScrollTargetRef.current = Math.max(0, Math.min(target, Math.max(0, container.scrollHeight - container.clientHeight)));
    if (manualScrollPaused.current) {
      const closeEnough = Math.abs(playbackScrollTargetRef.current - container.scrollTop) <= Math.min(64, Math.max(12, container.clientHeight * 0.12));
      if (!closeEnough || scrollTouchStart.current !== null || performance.now() - lastManualScrollAt.current < 1200) { updateScrollCatchUp(); return; }
      manualScrollPaused.current = false;
    }
    setScrollCatchUp(null);
    container.scrollTop += (target - container.scrollTop) * 0.2;
  }, [readerMode, autoScroll, playbackPosition, playbackMotion?.slideIndex, liveSlide?.id, showChords, musicCursor?.lineIndex, musicCursor?.anchorIndex, jumpPending]);

  function timingFor(offset: number, lineIndex: number, segmentStart: number, occurrence: number, lastSegment: boolean) {
    const barIndex = playbackPosition === null ? -1 : Math.floor(playbackPosition);
    const bar = remoteTimeline[barIndex];
    const entryStop = (localPlaybackActive ? localTiming?.firstBarStop : sharedTiming.remote?.timing.first_bar_stop) ?? 0;
    const barStart = bar ? bar.stops[barIndex === startedAt ? entryStop : 0] ?? bar.start : null;
    return { barStart, pulseStrength: lyricHighlightPulse(beatPosition, beatCount), lyrics: liveSong?.lyrics ?? '', bars: timingBars, sourceLine: offset < 0 ? -1 : offset + lineIndex, segmentStart, lastSegment, showBars: musicMode, showDot: showTimingDot, highlight: lyricHighlight, downbeat: beatPosition !== null && ((beatPosition % 1 + 1) % 1) * beatCount < Math.min(beatCount, 1.5), cursor: displayCursor?.occurrence === occurrence ? displayCursor : null };
  }

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
    if (readerMode !== "scroll" || (autoScroll && playbackMotion) || !fullSongRef.current || !activeSongPartRef.current) {
      return undefined;
    }
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const container = fullSongRef.current;
        const activePart = activeSongPartRef.current;
        if (!container || !activePart) return;
        const left = Math.max(activePart.offsetLeft - (container.clientWidth - activePart.clientWidth) / 2, 0);
        const top = Math.max(activePart.offsetTop - (container.clientHeight - activePart.clientHeight) / 2, 0);
        if (isMobileOrTabletDevice()) {
          container.scrollLeft = left;
          container.scrollTop = top;
        } else {
          container.scrollTo({ behavior: "smooth", left, top });
        }
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [currentSequenceBlockIndex, currentSequencePartIndex, liveSlide?.id, readerMode, showChords, autoScroll, Boolean(playbackMotion)]);
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
        <CompactControlMenu label="Musician" icon={<Guitar size={16} aria-hidden="true" />} active={showChords || musicMode}>
          {close => <>
            <SongRhythmDisplay menuItem onSaveRhythm={onSaveRhythm && liveSong ? rhythm => onSaveRhythm(liveSong, rhythm) : undefined} annotations={chordChart.annotations} onPosition={canUseMusic ? (position, mode, section) => {
              const timeline = lyricPlaybackBars(liveSong?.lyrics, liveSong?.sequence, timingBars);
              const part = timeline.filter(bar => musicalSectionKey(bar.section) === musicalSectionKey(section));
              const occurrence = part.some(bar => bar.occurrence === currentSequenceBlockIndex) ? currentSequenceBlockIndex : part[0]?.occurrence;
              const selected = mode === "part" ? part.filter(bar => bar.occurrence === occurrence) : timeline;
              const cursor = position === null || mode === "strum" || !liveSong?.rhythm ? null : lyricCursorAt(liveSong.lyrics, selected, position, liveSong.rhythm.numerator, liveSong.rhythm.denominator);
              setMusicCursor(cursor);
            } : undefined} key={liveSong?.id} rhythm={liveSong?.rhythm} section={sequenceBlocks[currentSequenceBlockIndex]?.label} lyrics={liveSong?.lyrics} sequence={liveSong?.sequence} previewChord={baseAbsoluteKey} transpose={currentAbsoluteKey ? semitoneDistance(baseAbsoluteKey, currentAbsoluteKey) : 0} title={liveSong?.title} />
            <hr />
            <MusicianDisplayChoice label="Chords" binary icon={<Guitar size={16} aria-hidden="true" />} value={chordDisplay} onChange={mode => chooseDisplay('worship-chords-display', setChordDisplay, mode)} />
            <MusicianDisplayChoice label="Bars" icon={<ListMusic size={16} aria-hidden="true" />} value={barDisplay} onChange={mode => chooseDisplay('worship-bars-display', setBarDisplay, mode)} />
            <MusicianDisplayChoice label="Beat keeper" binary description="Show during playback" icon={<Music2 size={16} aria-hidden="true" />} value={beatKeeperEnabled ? "on" : "off"} onChange={mode => { setBeatKeeperEnabled(mode === "on"); try { localStorage.setItem("worship-beat-keeper", mode); } catch {} }} />
            <MusicianDisplayChoice label="Lyric highlight" binary description="Follow sung words during playback" icon={<Music2 size={16} aria-hidden="true" />} value={lyricHighlight ? "on" : "off"} onChange={mode => { setLyricHighlight(mode === "on"); try { localStorage.setItem("worship-lyric-highlight", mode); } catch {} }} />
            <MusicianDisplayChoice label="Dot" binary description="Show during playback" icon={<Music2 size={16} aria-hidden="true" />} value={dotDisplay} onChange={mode => chooseDisplay('worship-dot-display', setDotDisplay, mode)} />
            <MusicianDisplayChoice label="Band sync" binary description={worshipCoupled ? "Service Sync takes priority" : "Share pages with musicians"} icon={<Link2 size={16} aria-hidden="true" />} value={bandSyncEnabled ? "on" : "off"} onChange={mode => { setBandSyncEnabled(mode === "on"); try { localStorage.setItem("worship-band-sync", mode); } catch {} }} />
            {bandSync.error ? <small role="status">{bandSync.error}</small> : null}
            <MusicianDisplayChoice label="Follow shared timing" binary description="Follow lyric timing and page turns · no audio" icon={<Link2 size={16} aria-hidden="true" />} value={followSharedTiming ? "on" : "off"} onChange={mode => { setFollowSharedTiming(mode === "on"); try { localStorage.setItem("worship-follow-timing", mode); } catch {} }} />
            {canShareTiming ? <MusicianDisplayChoice label="Share timing" binary description="Let other devices follow" icon={<Music2 size={16} aria-hidden="true" />} value={shareTiming ? "on" : "off"} onChange={mode => { setShareTiming(mode === "on"); try { localStorage.setItem("worship-share-timing", mode); } catch {} }} /> : null}
            {sharedTiming.error ? <small role="alert">{sharedTiming.error}</small> : null}
            <MusicianDisplayChoice label="Dynamics" binary disabled description="Not available yet" icon={<AudioLines size={16} aria-hidden="true" />} value="off" onChange={() => {}} />

            <hr />
            {readerMode === "scroll" ? <MusicianDisplayChoice label="Auto-scroll" binary description="Follow playback smoothly" icon={<ScrollText size={16} aria-hidden="true" />} value={autoScroll ? "on" : "off"} onChange={mode => { setAutoScroll(mode === "on"); try { localStorage.setItem("worship-auto-scroll", mode); } catch {} }} /> : null}
            <button role="menuitem" aria-label={`Switch to ${readerMode === 'pages' ? 'Scroll' : 'Pages'} view`} onClick={() => { setReaderMode(value => value === 'pages' ? 'scroll' : 'pages'); close(); }} type="button">{readerMode === 'pages' ? <ScrollText size={16} /> : <BookOpen size={16} />}<span>{readerMode === 'pages' ? 'Scroll view' : 'Page view'}</span></button>
          </>}
        </CompactControlMenu>
        {canUseMusic || canControlAudio ? <LyricMusicControls onPedalNavigate={direction => { if (direction) moveLive(direction); else { navigationGenerationRef.current += 1; void publishWorshipSlide(liveIndex, navigationGenerationRef.current); } }} startAt={leadPageContext.occurrence >= 0 ? { occurrence: leadPageContext.occurrence, lineStart: leadPageContext.sourceOffset, lineEnd: leadPageContext.sourceOffset + lyricLines(pageLeadSlide?.text ?? "").length } : undefined} jumpRevision={playFrom?.revision ?? 0} onJumpPending={pending => { jumpHoldRef.current = pending; setJumpPending(pending); if (!pending) { lastMusicPageRef.current = null; manualScrollDestination.current = null; manualScrollPaused.current = false; } }} rhythm={liveSong?.rhythm} lyrics={liveSong?.lyrics} sequence={liveSong?.sequence} annotations={chordChart.annotations} bars={timingBars} transpose={currentAbsoluteKey ? semitoneDistance(baseAbsoluteKey, currentAbsoluteKey) : 0} canPractice={canUseMusic} onStarted={() => { setLocalPlaybackActive(true); if (liveSong && liveItem) setPlaybackContext({ songId: liveSong.id, itemId: liveItem.id }); }} onJumpCommitted={() => { if (liveSong && liveItem) { sharedTiming.setLocalSource(liveSong.id, liveItem.id); setPlaybackContext({ songId: liveSong.id, itemId: liveItem.id }); } }} onTiming={timing => { setLocalPlaybackActive(Boolean(timing)); setLocalTiming(timing); sharedTiming.setLocalTiming(timing); }} onCursor={setMusicCursor} backing={canControlAudio ? { playing: backingAudioPlaying, disabledReason: !worshipCoupled ? 'Sync with the service first' : !backingAudioAvailable ? 'No backing track for this song' : undefined, toggle: toggleBackingAudio } : undefined} /> : null}
        {servicePlan ? <button aria-label={worshipSyncOverridden ? "Worship sync is enabled but the service view has moved outside worship" : worshipCoupled ? "Stop syncing Worship Live with service and move after worship" : "Sync Worship Live with service"} aria-pressed={worshipCoupled} className={`musician-service-couple-button ${worshipCoupled ? "is-active" : ""} ${worshipSyncOverridden ? "is-overridden" : ""}`} onClick={() => void toggleServiceCoupling()} title={worshipSyncOverridden ? "Service view moved outside worship. Change a worship slide to resync." : worshipCoupled ? "Stop syncing and go after worship" : "Sync with service"} type="button">{worshipCoupled ? <Unlink2 size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}<span className="musician-control-text">Sync</span></button> : null}
        <button aria-label="Edit song" className="musician-edit-button" disabled={!liveSong} onClick={() => { if (liveSong) onEditSong(liveSong); }} title="Edit song" type="button"><Pencil size={16} aria-hidden="true" /><span className="musician-control-text">Edit</span></button>
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
        if (!keyboardCaptureEnabled) return;
        if (isEditableKeyboardTarget(event.target) || isInteractivePointerTarget(event.target)) {
          return;
        }
        keyCaptureRef.current?.focus({ preventScroll: true });
      }}
      tabIndex={-1}
    >
      {keyboardCaptureEnabled ? <input
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
      /> : null}
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
          // Scroll mode is a native vertical scroller. Capturing its pointer at
          // the stage level prevents touch scrolling on some Android browsers.
          if (readerMode === "scroll") {
            swipeStartRef.current = null;
            return;
          }
          if (isInteractivePointerTarget(event.target)) {
            swipeStartRef.current = null;
            return;
          }
          event.currentTarget.setPointerCapture(event.pointerId);
          swipeStartRef.current = { x: event.clientX, y: event.clientY };
        }}
        onPointerCancel={() => {
          swipeStartRef.current = null;
        }}
        onPointerUp={(event) => {
          if (readerMode === "scroll") {
            swipeStartRef.current = null;
            return;
          }
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
        {showBeatKeeper && liveSlide?.itemType === "song" ? <BeatKeeper position={beatPosition} count={beatCount} /> : null}
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
          <div className="musician-scroll-reader">
          {scrollCatchUp ? <button type="button" className={`sorter-catch-up sorter-catch-up-${scrollCatchUp}`} aria-label="Catch up to current lyrics" title="Catch up to current lyrics and resume auto-scroll" onClick={catchUpLyrics}>
            {scrollCatchUp === 'up' ? <ChevronUp size={18} aria-hidden="true" /> : <ChevronDown size={18} aria-hidden="true" />}
          </button> : null}
          <div className="musician-full-song" aria-label="Full song lyrics" ref={fullSongRef} onScroll={() => { if (manualScrollPaused.current) lastManualScrollAt.current = performance.now(); updateScrollCatchUp(); }} onWheel={() => { manualScrollPaused.current = true; lastManualScrollAt.current = performance.now(); updateScrollCatchUp(); }} onTouchStart={event => { scrollTouchStart.current = event.touches[0]?.clientY ?? null; }} onTouchMove={event => { const y = event.touches[0]?.clientY; if (y !== undefined && scrollTouchStart.current !== null && Math.abs(y - scrollTouchStart.current) > 8) { manualScrollPaused.current = true; lastManualScrollAt.current = performance.now(); updateScrollCatchUp(); } }} onTouchEnd={() => { scrollTouchStart.current = null; }} onTouchCancel={() => { scrollTouchStart.current = null; }}>
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
                    block.partLineOffsets[partIndex],
                  );
                  return (
                    <div
                      aria-label={block.parts.length > 1 ? `Go to ${block.label}, part ${partIndex + 1}` : `Go to ${block.label}`}
                      data-playback-slide={slides.findIndex(slide => slide.planItemId === liveItem?.id && slide.slideKind === "content") + block.slideIndex + partIndex}
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
                      {showChords || musicMode || showTimingDot || timingBars.length > 0 ? (
                        <div className="musician-song-chord-sheet">
                          {partLines.map((line, lineIndex) => {
                            const segments = wrapMusicLine(line, songModeWrapCharacters, block.partLineOffsets[partIndex], lineIndex);
                            return (
                              <div className="musician-lyric-line-group" data-playback-occurrence={blockIndex} data-playback-line={block.partLineOffsets[partIndex] + lineIndex} key={`${lineIndex}-${line}`}>
                                {segments.map((segment, segmentIndex) => (
                                  <MusicianChordLine
                                    timing={timingFor(block.partLineOffsets[partIndex], lineIndex, segment.start, blockIndex, segmentIndex === segments.length - 1)}
                                    annotations={annotationsForSegment(partAnnotations.get(lineIndex) ?? [], segment.start, segment.line.length, segmentIndex === segments.length - 1)}
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
                            );
                          })}
                        </div>
                      ) : <p>{part}</p>}
                    </div>
                  );
                })}
              </section>
            ))}
            {nextServiceSlide && currentSongIndex === worshipItems.length - 1 ? (
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
              disabled={(!isSongTitleSlide && !localPlaybackActive) || !pageLeadSlide}
              title={!isSongTitleSlide && localPlaybackActive ? "Restart this slide on the next bar" : undefined}
              onClick={() => {
                if (!pageLeadSlide || (!isSongTitleSlide && !localPlaybackActive)) return;
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
                        timing={timingFor(leadPageContext.sourceOffset, lineIndex, segment.start, leadPageContext.occurrence, segmentIndex === segments.length - 1)}
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
              ) : pageNextSlide && (showChords || musicMode || showTimingDot || timingBars.length > 0) && pageNextSlideUsesCurrentSong ? (
                <div className="musician-chord-sheet musician-next-chord-sheet" aria-label="Next lyrics with chords">
                  {nextWrappedLyricLines.map((segments, lineIndex) => (
                    <div className="musician-lyric-line-group" key={`${lineIndex}-${nextLyricLines[lineIndex]}`}>
                      {segments.map((segment, segmentIndex) => (
                        <MusicianChordLine
                          timing={timingFor(nextPageContext.sourceOffset, lineIndex, segment.start, nextPageContext.occurrence, segmentIndex === segments.length - 1)}
                          annotations={annotationsForSegment(nextAnnotationsByLine.get(lineIndex) ?? [], segment.start, segment.line.length, segmentIndex === segments.length - 1)}
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
