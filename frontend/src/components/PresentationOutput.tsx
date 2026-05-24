import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getFileSlides,
  getPlan,
  getPlans,
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
  suggestSlideGroupFontCap,
  type PresentationLiveState,
} from "../presentation";
import { isWorshipSetPlan, matchingWorshipSetForService, mergeWorshipSetIntoService } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
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
  const [worshipSetPlan, setWorshipSetPlan] = useState<PlanDetail | null>(null);
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
  const livePollInFlightRef = useRef(false);
  const videoFrameRef = useRef<HTMLIFrameElement | null>(null);
  const lastVideoActionRef = useRef<number | null>(null);

  const slides = useMemo(
    () => buildPresentationSlides(mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []), songs, renderedSlidesByFileId),
    [plan, worshipSetPlan, songs, renderedSlidesByFileId],
  );
  const resolvedIndex = resolveLiveIndex(slides, liveState);
  const liveTargetMissing = Boolean(
    liveState?.planItemId && slides.length && !slides.some((slide) => slide.planItemId === liveState.planItemId),
  );
  const liveSlide = liveTargetMissing ? null : slides[resolvedIndex] ?? null;
  const liveTextFontCap = useMemo(
    () => suggestSlideGroupFontCap(slides.filter((slide) => !slide.imageUrl && slide.text.trim()).map((slide) => slide.text)),
    [slides],
  );

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
        videoAction: overrides.videoAction ?? liveState.videoAction ?? null,
        videoActionAt: overrides.videoActionAt ?? liveState.videoActionAt,
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
          video_action: nextState.videoAction ?? null,
          video_action_at: nextState.videoActionAt ?? null,
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
      const [nextPlan, nextSongs, nextPlans] = await Promise.all([getPlan(state.planId), getSongs(), getPlans()]);
      const matchingWorshipSet = matchingWorshipSetForService(nextPlan, nextPlans.filter(isWorshipSetPlan));
      const nextWorshipSetPlan = matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null;
      setPlan(nextPlan);
      setWorshipSetPlan(nextWorshipSetPlan);
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
      const browserMessage = error instanceof Error ? error.message : "";
      setMessage(
        browserMessage.toLowerCase().includes("permission")
          ? "Fullscreen was blocked by this browser. Use the Fullscreen button again after clicking the slide, or press F11 on this computer."
          : browserMessage || "Use the browser fullscreen control for this display.",
      );
      setFullscreenReady(true);
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
  }, [liveState?.planId, load]);

  useEffect(() => {
    if (!liveTargetMissing) {
      return;
    }

    void load(liveState);
  }, [liveState, liveTargetMissing, load]);

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
    if (!liveState?.videoAction || !liveState.videoActionAt || !liveSlide?.videoUrl) {
      return;
    }
    if (lastVideoActionRef.current === liveState.videoActionAt) {
      return;
    }

    const command =
      liveState.videoAction === "play"
        ? "playVideo"
        : liveState.videoAction === "pause"
          ? "pauseVideo"
          : "stopVideo";

    lastVideoActionRef.current = liveState.videoActionAt;
    videoFrameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: command, args: [] }),
      "*",
    );
  }, [liveSlide?.videoUrl, liveState?.videoAction, liveState?.videoActionAt]);

  useEffect(() => {
    if (!liveState?.planId) {
      return;
    }

    const timer = window.setInterval(() => {
      if (livePollInFlightRef.current) {
        return;
      }
      livePollInFlightRef.current = true;
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
            videoAction: remoteState.video_action,
            videoActionAt: remoteState.video_action_at ?? undefined,
          });
        } catch {
          // Keep showing the last known slide if remote polling drops briefly.
        } finally {
          livePollInFlightRef.current = false;
        }
      })();
    }, 2000);

    return () => {
      livePollInFlightRef.current = false;
      window.clearInterval(timer);
    };
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

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <main className="slideshow-output" aria-label="Live slideshow output">
      {fullscreenReady ? (
        <button className="slideshow-fullscreen" onClick={() => void enterFullscreen()} type="button">
          <Maximize2 size={18} aria-hidden="true" />
          Fullscreen
        </button>
      ) : null}

      {message ? (
        <div className="slideshow-message" role="status">
          <span>{message}</span>
          <button aria-label="Dismiss message" onClick={() => setMessage(null)} type="button">
            ×
          </button>
        </div>
      ) : null}

      <section
        className={`slideshow-stage ${liveSlide?.imageUrl || liveSlide?.videoUrl ? "slideshow-stage-image" : ""} stage-theme-${
          liveState?.theme ?? "light"
        } ${liveSlide ? presentationTypeClass(liveSlide.itemType) : "type-generic"} ${blanked ? "stage-blanked" : ""}`}
      >
        {blanked ? null : !liveSlide?.imageUrl && !liveSlide?.videoUrl && liveSlide?.itemType !== "song" ? (
          <div className="stage-title">
            <span>{liveSlide?.title ?? "Ready"}</span>
          </div>
        ) : null}
        {blanked ? (
          <div className="blank-stage" aria-label="Blank live output" />
        ) : liveSlide?.imageUrl ? (
          <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
        ) : liveSlide?.videoUrl ? (
          <div className="stage-video-frame">
            <iframe
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              ref={videoFrameRef}
              src={liveSlide.videoUrl}
              title={liveSlide.title}
            />
          </div>
        ) : (
          <AutoFitSlideText maxFontSize={liveTextFontCap} text={liveSlide?.text ?? "Waiting for slideshow"} />
        )}
      </section>
    </main>
  );
}
