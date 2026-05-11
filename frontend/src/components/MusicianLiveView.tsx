import { ChevronLeft, ChevronRight, Maximize2, Music2 } from "lucide-react";
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
  TRAILING_CHORD_ANCHORS,
  displayChord,
  lyricLines,
  parseChordChart,
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
  capo,
  detailMode,
  displayMode,
  line,
  transposeBy,
}: {
  annotations: ChordAnnotation[];
  capo: number;
  detailMode: ChordDetailMode;
  displayMode: ChordDisplayMode;
  line: string;
  transposeBy: number;
}) {
  const totalSlots = Math.max(LEADING_CHORD_ANCHORS + line.length + TRAILING_CHORD_ANCHORS, 16);
  const characters = Array.from(line);

  return (
    <div className="musician-chord-line" style={{ gridTemplateColumns: `repeat(${totalSlots}, minmax(0, 1ch))` }}>
      {annotations.map((annotation) => {
        const shiftedChord = transposeChordSymbol(annotation.chord, transposeBy, { detailMode });
        const label = displayChord(shiftedChord, {
          capo,
          detailMode,
          displayMode,
          preferFlats: shiftedChord.includes("b"),
        });
        return (
          <span
            className="musician-chord-token"
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
  const [transposeBy, setTransposeBy] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const pollingRef = useRef(false);

  const slides = useMemo(() => buildPresentationSlides(plan?.items ?? [], songs), [plan?.items, songs]);
  const liveIndex = useMemo(() => resolveLiveIndex(slides, liveState), [liveState, slides]);
  const liveSlide = slides[liveIndex] ?? null;
  const liveItem = plan?.items.find((item) => item.id === liveSlide?.planItemId) ?? null;
  const liveSong = liveItem?.song_id ? songs.find((song) => song.id === liveItem.song_id) ?? null : null;
  const chordChart = useMemo(() => parseChordChart(liveSong?.chords ?? null).document, [liveSong?.chords]);
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
    setCapo(chordChart.capo);
    setTransposeBy(0);
  }, [chordChart.capo, liveSong?.id]);

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

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
    } catch {
      setMessage("Fullscreen is blocked by this browser.");
    }
  }

  const lyricLinesForSlide = lyricLines(liveSlide?.text ?? "");
  const hasChordAnnotations = chordChart.annotations.length > 0;

  return (
    <section className="musician-live-view" aria-label="Musician live view">
      <div className="musician-live-toolbar">
        <div>
          <p className="eyebrow">Live Worship</p>
          <h2>{liveSong?.title ?? liveSlide?.sectionTitle ?? "Waiting for a song"}</h2>
        </div>
        <div className="musician-live-controls">
          <div className="segmented-control compact-toggle" aria-label="Chord visibility">
            <button className={showChords ? "is-active" : ""} onClick={() => setShowChords(true)} type="button">
              Chords
            </button>
            <button className={!showChords ? "is-active" : ""} onClick={() => setShowChords(false)} type="button">
              Lyrics
            </button>
          </div>
          <div className="segmented-control compact-toggle" aria-label="Chord display mode">
            <button className={displayMode === "absolute" ? "is-active" : ""} onClick={() => setDisplayMode("absolute")} type="button">
              Abs
            </button>
            <button className={displayMode === "capo" ? "is-active" : ""} onClick={() => setDisplayMode("capo")} type="button">
              Capo
            </button>
          </div>
          <div className="segmented-control compact-toggle" aria-label="Chord detail">
            <button className={detailMode === "simple" ? "is-active" : ""} onClick={() => setDetailMode("simple")} type="button">
              Simple
            </button>
            <button className={detailMode === "advanced" ? "is-active" : ""} onClick={() => setDetailMode("advanced")} type="button">
              Adv
            </button>
          </div>
          <label className="compact-number-field">
            Transpose
            <input
              max={12}
              min={-12}
              onChange={(event) => setTransposeBy(Number(event.target.value) || 0)}
              type="number"
              value={transposeBy}
            />
          </label>
          <label className="compact-number-field">
            Capo
            <input
              max={12}
              min={0}
              onChange={(event) => setCapo(Math.max(0, Number(event.target.value) || 0))}
              type="number"
              value={capo}
            />
          </label>
          <button className="text-button icon-text-button" onClick={() => void enterFullscreen()} type="button">
            <Maximize2 size={16} aria-hidden="true" />
            Fullscreen
          </button>
        </div>
      </div>

      {message ? <p className="form-message">{message}</p> : null}

      <div className="musician-live-stage">
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
        ) : showChords && hasChordAnnotations ? (
          <div className="musician-chord-sheet" aria-label="Lyrics with chords">
            {lyricLinesForSlide.map((line, index) => (
              <MusicianChordLine
                annotations={annotationsByLine.get(index) ?? []}
                capo={capo}
                detailMode={detailMode}
                displayMode={displayMode}
                key={`${index}-${line}`}
                line={line}
                transposeBy={transposeBy}
              />
            ))}
          </div>
        ) : (
          <div className="musician-lyrics-only">
            {lyricLinesForSlide.map((line, index) => (
              <p key={`${index}-${line}`}>{line}</p>
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
