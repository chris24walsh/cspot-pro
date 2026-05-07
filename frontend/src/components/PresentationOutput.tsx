import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getFileSlides,
  getPlan,
  getPresentationLiveState,
  getSongs,
  updatePresentationLiveState,
  type PlanDetail,
  type RenderedSlide,
  type Song,
} from "../api";
import {
  PRESENTATION_CHANNEL,
  PRESENTATION_OUTPUT_STATUS_KEY,
  PRESENTATION_STORAGE_KEY,
  buildPresentationSlides,
  presentationTypeClass,
  resolveLiveIndex,
  type PresentationLiveState,
} from "../presentation";
import { ScaledSlideImage } from "./ScaledSlideImage";

function readLiveState(): PresentationLiveState | null {
  const value = localStorage.getItem(PRESENTATION_STORAGE_KEY);
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as PresentationLiveState;
  } catch {
    return null;
  }
}

export function PresentationOutput() {
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const planId = params.get("planId");
    const index = Number(params.get("index") ?? "0");
    return planId ? { planId, index, updatedAt: Date.now() } : readLiveState();
  });
  const [message, setMessage] = useState<string | null>(null);
  const [fullscreenReady, setFullscreenReady] = useState(true);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [blanked, setBlanked] = useState(false);
  const lastLiveStateRef = useRef(0);

  const slides = useMemo(
    () => buildPresentationSlides(plan?.items ?? [], songs, renderedSlidesByFileId),
    [plan, songs, renderedSlidesByFileId],
  );
  const resolvedIndex = resolveLiveIndex(slides, liveState);
  const liveSlide = slides[resolvedIndex] ?? null;

  const writeOutputHeartbeat = useCallback(() => {
    if (!liveState?.planId) {
      return;
    }
    localStorage.setItem(
      PRESENTATION_OUTPUT_STATUS_KEY,
      JSON.stringify({ planId: liveState.planId, heartbeatAt: Date.now() }),
    );
  }, [liveState?.planId]);

  function applyLiveState(state: PresentationLiveState) {
    lastLiveStateRef.current = state.updatedAt;
    localStorage.setItem(PRESENTATION_STORAGE_KEY, JSON.stringify(state));
    setLiveState((current) => ({ ...current, ...state }));
  }

  const publishLiveState = useCallback(
    async (overrides: Partial<PresentationLiveState> = {}) => {
      if (!liveState?.planId) {
        return;
      }

      const nextState: PresentationLiveState = {
        ...liveState,
        ...overrides,
        index: overrides.index ?? resolvedIndex,
        updatedAt: Date.now(),
        planItemId: overrides.planItemId ?? liveSlide?.planItemId ?? liveState.planItemId ?? null,
        slideOffset:
          overrides.slideOffset ??
          (liveSlide
            ? Math.max(
                slides
                  .filter((candidate) => candidate.planItemId === liveSlide.planItemId)
                  .findIndex((candidate) => candidate.id === liveSlide.id),
                0,
              )
            : liveState.slideOffset ?? 0),
        theme: overrides.theme ?? liveState.theme ?? "light",
        blanked: overrides.blanked ?? blanked,
        fullscreen: overrides.fullscreen ?? Boolean(document.fullscreenElement),
      };

      applyLiveState(nextState);

      try {
        const remoteState = await updatePresentationLiveState(nextState.planId, {
          plan_id: nextState.planId,
          index: nextState.index,
          plan_item_id: nextState.planItemId ?? null,
          slide_offset: nextState.slideOffset ?? 0,
          updated_at: nextState.updatedAt,
          theme: nextState.theme ?? "light",
          blanked: Boolean(nextState.blanked),
          fullscreen: Boolean(nextState.fullscreen),
        });
        lastLiveStateRef.current = remoteState.updated_at;
      } catch {
        // Keep local control responsive even if sync fails briefly.
      }
    },
    [blanked, liveSlide, liveState, resolvedIndex, slides],
  );

  const load = useCallback(async (state: PresentationLiveState | null) => {
    if (!state?.planId) {
      return;
    }

    try {
      const [nextPlan, nextSongs] = await Promise.all([getPlan(state.planId), getSongs()]);
      setPlan(nextPlan);
      setSongs(nextSongs);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load slideshow output.");
    }
  }, []);

  async function enterFullscreen() {
    try {
      await document.documentElement.requestFullscreen();
      setFullscreenReady(false);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Use the browser fullscreen control for this display.");
    }
  }

  async function exitFullscreen() {
    if (!document.fullscreenElement) {
      setFullscreenReady(true);
      return;
    }
    try {
      await document.exitFullscreen();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not exit fullscreen.");
    } finally {
      setFullscreenReady(true);
    }
  }

  useEffect(() => {
    void load(liveState);
  }, [liveState?.planId, liveState?.updatedAt, load]);

  useEffect(() => {
    writeOutputHeartbeat();
    const timer = window.setInterval(writeOutputHeartbeat, 1500);

    function clearHeartbeat() {
      localStorage.removeItem(PRESENTATION_OUTPUT_STATUS_KEY);
    }

    window.addEventListener("beforeunload", clearHeartbeat);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("beforeunload", clearHeartbeat);
      clearHeartbeat();
    };
  }, [writeOutputHeartbeat]);

  useEffect(() => {
    setBlanked(Boolean(liveState?.blanked));
  }, [liveState?.blanked]);

  useEffect(() => {
    if (!liveState?.planId) {
      return;
    }

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const remoteState = await getPresentationLiveState(liveState.planId);
          if (remoteState.updated_at <= lastLiveStateRef.current) {
            return;
          }
          applyLiveState({
            planId: remoteState.plan_id,
            index: remoteState.index,
            updatedAt: remoteState.updated_at,
            planItemId: remoteState.plan_item_id,
            slideOffset: remoteState.slide_offset,
            theme: remoteState.theme,
            blanked: remoteState.blanked,
            fullscreen: remoteState.fullscreen,
          });
        } catch {
          // Keep showing the last known slide if remote polling drops briefly.
        }
      })();
    }, 1200);

    return () => window.clearInterval(timer);
  }, [liveState?.planId]);

  useEffect(() => {
    async function loadRenderedDecks() {
      const files = (plan?.items ?? []).flatMap((item) => item.files ?? []);
      const uniqueFiles = Array.from(new Map(files.map((file) => [file.file_id, file])).values());
      const nextSlides: Record<string, RenderedSlide[]> = {};

      await Promise.all(
        uniqueFiles.map(async (file) => {
          try {
            nextSlides[file.file_id] = await getFileSlides(file.file_id);
          } catch {
            nextSlides[file.file_id] = [];
          }
        }),
      );

      setRenderedSlidesByFileId(nextSlides);
    }

    void loadRenderedDecks();
  }, [plan]);

  useEffect(() => {
    const channel = new BroadcastChannel(PRESENTATION_CHANNEL);

    channel.onmessage = (event: MessageEvent<PresentationLiveState>) => {
      applyLiveState(event.data);
    };

    function onStorage(event: StorageEvent) {
      if (event.key === PRESENTATION_STORAGE_KEY) {
        const state = readLiveState();
        if (state) {
          applyLiveState(state);
        }
      }
    }

    window.addEventListener("storage", onStorage);
    return () => {
      channel.close();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreenReady(!document.fullscreenElement);
    }

    async function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      const editing =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        (target instanceof HTMLElement && target.isContentEditable);

      if (editing) {
        return;
      }

      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        if (document.fullscreenElement) {
          await exitFullscreen();
          void publishLiveState({ fullscreen: false });
        } else {
          await enterFullscreen();
          void publishLiveState({ fullscreen: true });
        }
        return;
      }

      if (event.key === "Escape") {
        if (blanked) {
          event.preventDefault();
          setBlanked(false);
          void publishLiveState({ blanked: false });
        }
        if (document.fullscreenElement) {
          event.preventDefault();
          await exitFullscreen();
          void publishLiveState({ fullscreen: false });
        }
        return;
      }

      if (event.key === "b" || event.key === "B") {
        event.preventDefault();
        const nextBlanked = !blanked;
        setBlanked(nextBlanked);
        void publishLiveState({ blanked: nextBlanked });
      }
    }

    document.addEventListener("fullscreenchange", onFullscreenChange);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [blanked, publishLiveState]);

  useEffect(() => {
    if (!liveState) {
      return;
    }

    if (resolvedIndex !== liveState.index) {
      setLiveState((current) => (current ? { ...current, index: resolvedIndex } : current));
    }
  }, [resolvedIndex, slides, liveState]);

  useEffect(() => {
    async function syncFullscreenMode() {
      if (liveState?.fullscreen) {
        if (!document.fullscreenElement) {
          await enterFullscreen();
        }
        return;
      }

      if (document.fullscreenElement) {
        await exitFullscreen();
      }
    }

    void syncFullscreenMode();
  }, [liveState?.fullscreen]);

  return (
    <main className="slideshow-output" aria-label="Live slideshow output">
      {fullscreenReady ? (
        <button className="slideshow-fullscreen" onClick={() => void enterFullscreen()} type="button">
          <Maximize2 size={18} aria-hidden="true" />
          Fullscreen
        </button>
      ) : null}

      {message ? <p className="slideshow-message">{message}</p> : null}

      <section
        className={`slideshow-stage ${liveSlide?.imageUrl ? "slideshow-stage-image" : ""} stage-theme-${
          liveState?.theme ?? "light"
        } ${liveSlide ? presentationTypeClass(liveSlide.itemType) : "type-generic"} ${blanked ? "stage-blanked" : ""}`}
      >
        {blanked ? null : !liveSlide?.imageUrl && liveSlide?.itemType !== "song" ? (
          <div className="stage-title">
            <span>{liveSlide?.title ?? "Ready"}</span>
          </div>
        ) : null}
        {blanked ? (
          <div className="blank-stage" aria-label="Blank live output" />
        ) : liveSlide?.imageUrl ? (
          <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
        ) : (
          <pre>{liveSlide?.text ?? "Waiting for slideshow"}</pre>
        )}
      </section>
    </main>
  );
}
