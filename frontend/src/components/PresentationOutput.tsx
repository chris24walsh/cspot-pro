import { Maximize2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getFileSlides,
  getBroadcastViewerSettings,
  getLivePresentationServices,
  getPlan,
  getPlans,
  getPresentationLiveState,
  getPresentationOutputStatus,
  getSongs,
  updatePresentationLiveState,
  type PlanDetail,
  type PresentationLiveService,
  type RenderedSlide,
  type Song,
} from "../api";
import { PROGRAM_AUDIO_FADE_DURATION_MS } from "../audioTransitions";
import {
  PRESENTATION_CHANNEL,
  LCF_BACKGROUND_URL,
  PRESENTATION_STORAGE_KEY,
  buildPresentationSlides,
  presentationTypeClass,
  resolveLiveIndex,
  suggestedSlideFontCap,
  type PresentationLiveState,
  type PresentationSlide,
} from "../presentation";
import { isWorshipSetPlan, matchingWorshipSetForService, mergeWorshipSetIntoService } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { CountdownSlide } from "./CountdownSlide";
import { PreServiceSlide, serviceScheduleForPlan } from "./PreServiceSlide";
import { PreServiceMusic } from "./PreServiceMusic";
import { ScaledSlideImage } from "./ScaledSlideImage";

const AUDIO_FADE_STEPS = 20;
const AUDIO_FADE_INTERVAL_MS = PROGRAM_AUDIO_FADE_DURATION_MS / AUDIO_FADE_STEPS;
const REMOTE_LIVE_STATE_POLL_INTERVAL_MS = 250;

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

export function networkDisplayState(service: PresentationLiveService): PresentationLiveState {
  return {
    planId: service.plan_id,
    index: service.index,
    updatedAt: service.updated_at,
    planItemId: service.plan_item_id,
    slideOffset: service.slide_offset,
    theme: "light",
    blanked: false,
    fullscreen: true,
    videoAction: null,
    serviceStage: service.service_stage ?? "ready",
    preServicePhase: service.pre_service_phase ?? null,
  };
}

export function presentationOutputAudioPlayerKey(
  slide: Pick<PresentationSlide, "sectionId" | "youtubeAudioUrl"> | null | undefined,
) {
  return slide?.youtubeAudioUrl ? `song-audio:${slide.sectionId}` : null;
}

export function presentationOutputAudioEnabled(networkDisplay: boolean, mediaOutput: boolean) {
  return !networkDisplay || mediaOutput;
}

export function networkOutputMediaUrl(url: string | undefined, networkDisplay: boolean) {
  if (!url || !networkDisplay) return url;
  try {
    const parsed = new URL(url);
    if (!parsed.hostname.includes("youtube")) return url;
    parsed.searchParams.set("enablejsapi", "1");
    parsed.searchParams.set("mute", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

interface PresentationOutputProps {
  mediaOutput?: boolean;
  networkDisplay?: boolean;
}

export function PresentationOutput({ mediaOutput = false, networkDisplay = false }: PresentationOutputProps) {
  const outputOwnerId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("outputId") || "standalone-output";
  }, []);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [worshipSetPlan, setWorshipSetPlan] = useState<PlanDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const planId = params.get("planId");
    const index = Number(params.get("index") ?? "0");
    if (networkDisplay) return null;
    return planId ? { planId, index, updatedAt: Date.now() } : readLiveState();
  });
  const [message, setMessage] = useState<string | null>(null);
  const [fullscreenReady, setFullscreenReady] = useState(true);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [blanked, setBlanked] = useState(false);
  const [preServiceAudioUrl, setPreServiceAudioUrl] = useState<string | null>(null);
  const [preServiceRoomAudioEnabled, setPreServiceRoomAudioEnabled] = useState(true);
  const [serviceSchedules, setServiceSchedules] = useState<import("../api").ServiceScheduleRule[]>([]);
  const lastLiveStateRef = useRef(0);
  const networkPlanIdRef = useRef<string | null>(null);
  const lastReadingRefreshRef = useRef("");
  const livePollInFlightRef = useRef(false);
  const outputHeartbeatInFlightRef = useRef(false);
  const videoFrameRef = useRef<HTMLIFrameElement | null>(null);
  const videoElementRef = useRef<HTMLVideoElement | null>(null);
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
  const liveMediaUrl = networkOutputMediaUrl(
    liveSlide?.videoUrl ?? liveSlide?.youtubeAudioUrl,
    networkDisplay,
  );
  const liveMediaProvider = liveSlide?.videoProvider ?? (liveSlide?.youtubeAudioUrl ? "youtube" : undefined);
  const liveTextFontCap = suggestedSlideFontCap(liveSlide);
  const ambientMusicStage = liveState?.serviceStage === "pre_service" || liveState?.serviceStage === "post_service";
  const outputAudioEnabled = presentationOutputAudioEnabled(networkDisplay, mediaOutput);

  const checkOutputStatus = useCallback(() => {
    if (!liveState?.planId || outputHeartbeatInFlightRef.current) {
      return;
    }
    outputHeartbeatInFlightRef.current = true;
    void getPresentationOutputStatus(liveState.planId)
      .then((status) => {
        if (!status.active || status.owner_id !== outputOwnerId) {
          window.close();
        }
      })
      .catch(() => undefined)
      .finally(() => {
        outputHeartbeatInFlightRef.current = false;
      });
  }, [liveState?.planId, outputOwnerId]);

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
        fullscreen: Boolean(document.fullscreenElement),
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
          fullscreen: Boolean(document.fullscreenElement),
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
      const [nextPlan, nextSongs, nextPlans, broadcastSettings] = await Promise.all([
        getPlan(state.planId),
        getSongs(),
        getPlans(),
        getBroadcastViewerSettings().catch(() => null),
      ]);
      const matchingWorshipSet = matchingWorshipSetForService(nextPlan, nextPlans.filter(isWorshipSetPlan));
      const nextWorshipSetPlan = matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null;
      setPlan(nextPlan);
      setWorshipSetPlan(nextWorshipSetPlan);
      setSongs(nextSongs);
      setPreServiceAudioUrl(broadcastSettings?.pre_service_audio_url ?? null);
      setPreServiceRoomAudioEnabled(broadcastSettings?.pre_service_room_audio_enabled !== false);
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
          ? "Fullscreen was blocked by this browser. Click the Fullscreen button on this output, or press F11 on this computer."
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
    let cancelled = false;
    let inFlight = false;
    const refreshRoomAudio = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const settings = await getBroadcastViewerSettings();
        if (!cancelled) {
          setPreServiceRoomAudioEnabled(settings.pre_service_room_audio_enabled !== false);
          setServiceSchedules(settings.service_schedules);
        }
      } catch { /* Keep the last known setting. */ }
      finally { inFlight = false; }
    };
    refreshRoomAudio();
    const timer = window.setInterval(refreshRoomAudio, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!liveTargetMissing) {
      return;
    }

    void load(liveState);
  }, [liveState, liveTargetMissing, load]);

  useEffect(() => {
    if (!liveState?.planId || !liveState.planItemId || liveSlide?.itemType !== "reading") {
      return;
    }

    const refreshKey = `${liveState.planId}:${liveState.planItemId}:${liveState.updatedAt}`;
    if (lastReadingRefreshRef.current === refreshKey) {
      return;
    }

    lastReadingRefreshRef.current = refreshKey;
    void load(liveState);
  }, [liveSlide?.itemType, liveState, load]);

  useEffect(() => {
    if (networkDisplay) return undefined;
    checkOutputStatus();
    const timer = window.setInterval(checkOutputStatus, 1500);
    return () => {
      window.clearInterval(timer);
    };
  }, [checkOutputStatus, networkDisplay]);

  useEffect(() => {
    if (!networkDisplay) return undefined;
    let cancelled = false;
    let inFlight = false;

    async function discoverLiveService() {
      if (inFlight) return;
      inFlight = true;
      try {
        const services = await getLivePresentationServices();
        if (cancelled) return;
        const service = services[0];
        if (!service) {
          networkPlanIdRef.current = null;
          lastLiveStateRef.current = 0;
          setLiveState(null);
          setPlan(null);
          setWorshipSetPlan(null);
          setRenderedSlidesByFileId({});
          return;
        }
        if (networkPlanIdRef.current !== service.plan_id) {
          networkPlanIdRef.current = service.plan_id;
          applyLiveState(networkDisplayState(service));
          // Force the live-state poll to hydrate theme, blanking, and media state.
          lastLiveStateRef.current = 0;
        }
      } catch {
        // Keep the last frame visible during a brief network interruption.
      } finally {
        inFlight = false;
      }
    }

    void discoverLiveService();
    const timer = window.setInterval(() => void discoverLiveService(), 1200);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [networkDisplay]);

  useEffect(() => {
    setBlanked(Boolean(liveState?.blanked));
  }, [liveState?.blanked]);

  useEffect(() => {
    if (!liveState?.videoAction || !liveState.videoActionAt || !liveMediaUrl) {
      return;
    }
    if (lastVideoActionRef.current === liveState.videoActionAt) {
      return;
    }

    lastVideoActionRef.current = liveState.videoActionAt;

    if (liveMediaProvider === "file") {
      if (liveState.videoAction === "play") {
        if (videoElementRef.current) {
          videoElementRef.current.muted = !outputAudioEnabled;
          videoElementRef.current.volume = 1;
        }
        void videoElementRef.current?.play().catch(() => {
          setMessage("This browser blocked remote video start. Click Play on the output once, then remote pause/stop will work.");
        });
      } else if (liveState.videoAction === "pause") {
        videoElementRef.current?.pause();
      } else if (liveState.videoAction === "fade-stop") {
        const video = videoElementRef.current;
        if (!video) {
          return;
        }
        const startVolume = video.volume || 1;
        let step = 0;
        const interval = window.setInterval(() => {
          step += 1;
          video.volume = Math.max(0, startVolume * (1 - step / AUDIO_FADE_STEPS));
          if (step >= AUDIO_FADE_STEPS) {
            window.clearInterval(interval);
            video.pause();
            video.currentTime = 0;
            video.volume = startVolume;
          }
        }, AUDIO_FADE_INTERVAL_MS);
      } else {
        videoElementRef.current?.pause();
        if (videoElementRef.current) {
          videoElementRef.current.currentTime = 0;
        }
      }
      return;
    }

    if (liveState.videoAction === "fade-stop") {
      let step = 0;
      const interval = window.setInterval(() => {
        step += 1;
        const volume = Math.max(0, Math.round(100 * (1 - step / AUDIO_FADE_STEPS)));
        videoFrameRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "command", func: "setVolume", args: [volume] }),
          "*",
        );
        if (step >= AUDIO_FADE_STEPS) {
          window.clearInterval(interval);
          videoFrameRef.current?.contentWindow?.postMessage(
            JSON.stringify({ event: "command", func: "pauseVideo", args: [] }),
            "*",
          );
        }
      }, AUDIO_FADE_INTERVAL_MS);
      return;
    }

    const command =
      liveState.videoAction === "play"
        ? "playVideo"
        : liveState.videoAction === "pause"
          ? "pauseVideo"
          : "stopVideo";

    if (liveState.videoAction === "play") {
      videoFrameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: "setVolume", args: [100] }),
        "*",
      );
      videoFrameRef.current?.contentWindow?.postMessage(
        JSON.stringify({ event: "command", func: outputAudioEnabled ? "unMute" : "mute", args: [] }),
        "*",
      );
    }
    videoFrameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: command, args: [] }),
      "*",
    );
  }, [liveMediaProvider, liveMediaUrl, liveState?.videoAction, liveState?.videoActionAt, outputAudioEnabled]);

  useEffect(() => {
    if (liveMediaProvider !== "youtube") return undefined;
    function handleYouTubeState(event: MessageEvent) {
      if (!event.origin.includes("youtube")) return;
      let payload: { event?: string; info?: number };
      try {
        payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch {
        return;
      }
      if (payload?.event === "onStateChange" && payload.info === 0) {
        void publishLiveState({ videoAction: "stop", videoActionAt: Date.now() });
      }
    }
    window.addEventListener("message", handleYouTubeState);
    return () => window.removeEventListener("message", handleYouTubeState);
  }, [liveMediaProvider, publishLiveState]);

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
            serviceStage: remoteState.service_stage ?? "ready",
            preServicePhase: remoteState.pre_service_phase ?? null,
          });
        } catch {
          // Keep showing the last known slide if remote polling drops briefly.
        } finally {
          livePollInFlightRef.current = false;
        }
      })();
    }, REMOTE_LIVE_STATE_POLL_INTERVAL_MS);

    return () => {
      livePollInFlightRef.current = false;
      window.clearInterval(timer);
    };
  }, [liveState?.planId]);

  useEffect(() => {
    async function loadRenderedDecks() {
      const files = (plan?.items ?? []).flatMap((item) =>
        item.item_type === "video"
          ? []
          : (item.files ?? []).filter(
              (file) => !file.content_type?.startsWith("video/") && !file.content_type?.startsWith("image/"),
            ),
      );
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
    if (networkDisplay) return undefined;
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
  }, [networkDisplay]);

  useEffect(() => {
    function onFullscreenChange() {
      setFullscreenReady(!document.fullscreenElement);
    }

    async function onKeyDown(event: KeyboardEvent) {
      if (event.repeat) {
        return;
      }
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
        } else {
          await enterFullscreen();
        }
        return;
      }

      if (event.key === "Escape") {
        if (!networkDisplay && blanked) {
          event.preventDefault();
          setBlanked(false);
          void publishLiveState({ blanked: false });
        }
        if (document.fullscreenElement) {
          event.preventDefault();
          await exitFullscreen();
        }
        return;
      }

      if (event.key === "b" || event.key === "B") {
        if (networkDisplay) return;
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
  }, [blanked, networkDisplay, publishLiveState]);

  useEffect(() => {
    if (!liveState) {
      return;
    }

    if (resolvedIndex !== liveState.index) {
      setLiveState((current) => (current ? { ...current, index: resolvedIndex } : current));
    }
  }, [resolvedIndex, slides, liveState]);

  useEffect(() => {
    if (!message) {
      return;
    }

    const timer = window.setTimeout(() => setMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [message]);

  return (
    <main className={`slideshow-output ${mediaOutput ? "media-output" : ""}`} aria-label={mediaOutput ? "Church PC media output" : "Live slideshow output"}>
      {fullscreenReady && !networkDisplay ? (
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
        className={`slideshow-stage ${liveSlide?.montageImageUrls || liveSlide?.backgroundImageUrl || liveSlide?.imageUrl || liveSlide?.videoUrl ? "slideshow-stage-image" : ""} stage-theme-${
          liveState?.theme ?? "light"
        } ${liveSlide ? presentationTypeClass(liveSlide.itemType) : "type-generic"} ${blanked ? "stage-blanked" : ""}`}
      >
        {blanked ? null : !liveSlide?.montageImageUrls && !liveSlide?.backgroundImageUrl && !liveSlide?.imageUrl && !liveSlide?.videoUrl && liveSlide?.itemType !== "song" ? (
          <div className="stage-title">
            <span>{liveSlide?.title ?? (mediaOutput ? "Church PC media receiver ready" : networkDisplay ? "TV display ready" : "Ready")}</span>
          </div>
        ) : null}
        {liveSlide?.youtubeAudioUrl ? (
          <iframe
            allow="autoplay; encrypted-media"
            aria-hidden="true"
            className="youtube-audio-frame"
            key={presentationOutputAudioPlayerKey(liveSlide)}
            onLoad={() => {
              videoFrameRef.current?.contentWindow?.postMessage(
                JSON.stringify({ event: "command", func: outputAudioEnabled ? "unMute" : "mute", args: [] }),
                "*",
              );
              if (liveState?.videoAction === "play" && liveState.videoActionAt) {
                window.setTimeout(() => {
                  videoFrameRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: "command", func: "setVolume", args: [100] }),
                    "*",
                  );
                  videoFrameRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: "command", func: outputAudioEnabled ? "unMute" : "mute", args: [] }),
                    "*",
                  );
                  videoFrameRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: "command", func: "playVideo", args: [] }),
                    "*",
                  );
                }, 350);
              }
            }}
            ref={videoFrameRef}
            src={liveMediaUrl}
            tabIndex={-1}
            title={`${liveSlide.sectionTitle} audio`}
          />
        ) : null}
        <div className="slide-visual-transition" key={blanked ? "blank" : liveSlide?.id ?? "ready"}>
        {blanked ? (
          <div
            className="blank-stage lcf-background-surface"
            aria-label="LCF background live output"
            style={{ backgroundImage: `url(${LCF_BACKGROUND_URL})` }}
          />
        ) : liveSlide?.montageImageUrls && plan ? (
          <PreServiceSlide backgroundImageUrl={LCF_BACKGROUND_URL} imageUrls={liveSlide.montageImageUrls} random={liveSlide.montageRandom} serviceDate={plan.service_date} timed={liveSlide.itemType === "pre_service"} phase={liveState?.preServicePhase} phaseStartedAt={liveState?.updatedAt} schedule={serviceScheduleForPlan(serviceSchedules, plan.service_date, plan.plan_type)} />
        ) : liveSlide?.countdownSeconds ? (
          <CountdownSlide durationSeconds={liveSlide.countdownSeconds} startAt={liveState?.updatedAt} />
        ) : liveSlide?.backgroundImageUrl ? (
          <div
            className="lcf-background-slide"
            style={{ backgroundImage: `url(${liveSlide.backgroundImageUrl})` }}
            aria-label={liveSlide.title}
          />
        ) : liveSlide?.imageUrl ? (
          <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
        ) : liveSlide?.videoUrl ? (
          <div className="stage-video-frame">
            {liveSlide.videoProvider === "file" ? (
              <video
                controls
                muted={!outputAudioEnabled}
                onEnded={() => void publishLiveState({ videoAction: "stop", videoActionAt: Date.now() })}
                ref={videoElementRef}
                src={liveMediaUrl}
                title={liveSlide.title}
              />
            ) : (
              <iframe
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                onLoad={() => {
                  videoFrameRef.current?.contentWindow?.postMessage(
                    JSON.stringify({ event: "command", func: outputAudioEnabled ? "unMute" : "mute", args: [] }),
                    "*",
                  );
                  if (liveState?.videoAction === "play" && liveState.videoActionAt) {
                    window.setTimeout(() => {
                      videoFrameRef.current?.contentWindow?.postMessage(
                        JSON.stringify({ event: "command", func: "setVolume", args: [100] }),
                        "*",
                      );
                      videoFrameRef.current?.contentWindow?.postMessage(
                        JSON.stringify({ event: "command", func: outputAudioEnabled ? "unMute" : "mute", args: [] }),
                        "*",
                      );
                      videoFrameRef.current?.contentWindow?.postMessage(
                        JSON.stringify({ event: "command", func: "playVideo", args: [] }),
                        "*",
                      );
                    }, 350);
                  }
                }}
                ref={videoFrameRef}
                src={liveMediaUrl}
                title={liveSlide.title}
              />
            )}
          </div>
        ) : (
          <>
            <AutoFitSlideText
              className={liveSlide?.slideKind === "title" ? "is-title-slide" : undefined}
              maxFontSize={liveTextFontCap}
              text={liveSlide?.text ?? (mediaOutput ? "Waiting for remote media playback" : networkDisplay ? "Waiting for the presenter to start TV output" : "Waiting for slideshow")}
            />
          </>
        )}
        </div>
      </section>
      {preServiceAudioUrl && plan ? (
        <PreServiceMusic
          active={ambientMusicStage}
          continuous={liveState?.serviceStage === "post_service"}
          label={liveState?.serviceStage === "post_service" ? "Post-service music" : "Pre-service music"}
          outputMuted={!outputAudioEnabled || !preServiceRoomAudioEnabled}
          phase={liveState?.preServicePhase}
          phaseStartedAt={liveState?.updatedAt}
          serviceDate={plan.service_date}
          showSoundControl={!networkDisplay}
          soundEnabled={outputAudioEnabled}
          url={preServiceAudioUrl}
        />
      ) : null}
    </main>
  );
}
