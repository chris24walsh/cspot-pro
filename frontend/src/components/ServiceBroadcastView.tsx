import { Maximize2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getFileSlides,
  getLivePresentationServices,
  getPlan,
  getPlans,
  getPresentationLiveState,
  getSongs,
  type PresentationLiveService,
  type PlanDetail,
  type RenderedSlide,
  type Song,
} from "../api";
import {
  buildPresentationSlides,
  presentationTypeClass,
  resolveLiveIndex,
  suggestSlideGroupFontCap,
  type PresentationLiveState,
} from "../presentation";
import { isWorshipSetPlan, matchingWorshipSetForService, mergeWorshipSetIntoService } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { ScaledSlideImage } from "./ScaledSlideImage";

const POLL_INTERVAL_MS = 3000;
const DEFAULT_TEST_CAMERA_URL = "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

function liveStateFromApi(state: Awaited<ReturnType<typeof getPresentationLiveState>>): PresentationLiveState {
  return {
    planId: state.plan_id,
    index: state.index,
    updatedAt: state.updated_at,
    planItemId: state.plan_item_id,
    slideOffset: state.slide_offset,
    theme: state.theme,
    blanked: state.blanked,
    fullscreen: state.fullscreen,
    videoAction: state.video_action,
    videoActionAt: state.video_action_at ?? undefined,
  };
}

function cameraKind(url: string) {
  const lower = url.toLowerCase();
  if (/\.(mjpg|mjpeg)(?:[?#]|$)/.test(lower) || lower.includes("mjpeg") || lower.includes("mjpg")) {
    return "mjpeg";
  }
  if (/\.(mp4|webm|ogg|m3u8)(?:[?#]|$)/.test(lower)) {
    return "video";
  }
  return "frame";
}

function CameraPane({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const kind = url ? cameraKind(url) : "frame";
  const isHls = url.toLowerCase().includes(".m3u8");

  useEffect(() => {
    if (kind !== "video" || !isHls || !videoRef.current) {
      return undefined;
    }
    const video = videoRef.current;
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      return undefined;
    }
    let cancelled = false;
    let hls: InstanceType<typeof import("hls.js").default> | null = null;
    void import("hls.js").then(({ default: Hls }) => {
      if (cancelled || !Hls.isSupported()) {
        return;
      }
      hls = new Hls();
      hls.loadSource(url);
      hls.attachMedia(video);
    });
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [isHls, kind, url]);

  if (!url) {
    return (
      <div className="service-broadcast-camera-placeholder">
        <strong>Camera unavailable</strong>
        <span>Set VITE_SERVICE_CAMERA_URL for the remote service view.</span>
      </div>
    );
  }

  if (kind === "mjpeg") {
    return <img alt="Live service camera" className="service-broadcast-camera-media" src={url} />;
  }
  if (kind === "video") {
    return (
      <video
        className="service-broadcast-camera-media"
        controls
        playsInline
        ref={videoRef}
        src={isHls ? undefined : url}
      />
    );
  }
  return (
    <iframe
      allow="autoplay; fullscreen; picture-in-picture"
      className="service-broadcast-camera-media"
      src={url}
      title="Live service camera"
    />
  );
}

export function ServiceBroadcastView() {
  const cameraUrl = import.meta.env.VITE_SERVICE_CAMERA_URL || DEFAULT_TEST_CAMERA_URL;
  const shellRef = useRef<HTMLElement | null>(null);
  const pollInFlightRef = useRef(false);
  const [liveServices, setLiveServices] = useState<PresentationLiveService[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [worshipSetPlan, setWorshipSetPlan] = useState<PlanDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(null);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  const slides = useMemo(
    () => buildPresentationSlides(mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []), songs, renderedSlidesByFileId),
    [plan, worshipSetPlan, renderedSlidesByFileId, songs],
  );
  const resolvedIndex = resolveLiveIndex(slides, liveState);
  const liveSlide = liveState?.blanked ? null : slides[resolvedIndex] ?? null;
  const theme = liveState?.theme ?? "dark";
  const textFontCap = useMemo(
    () => suggestSlideGroupFontCap(slides.filter((slide) => !slide.imageUrl && slide.text.trim()).map((slide) => slide.text)),
    [slides],
  );

  async function loadBroadcast() {
    if (pollInFlightRef.current) {
      return;
    }
    pollInFlightRef.current = true;
    try {
      const [nextLiveServices, plans, nextSongs] = await Promise.all([
        getLivePresentationServices(),
        getPlans(),
        getSongs(),
      ]);
      setLiveServices(nextLiveServices);
      const targetService =
        nextLiveServices.find((service) => service.plan_id === selectedPlanId) ?? nextLiveServices[0] ?? null;
      if (!targetService) {
        setMessage("No service is live right now.");
        setPlan(null);
        setWorshipSetPlan(null);
        setLiveState(null);
        setSelectedPlanId(null);
        setSongs(nextSongs);
        return;
      }

      const [nextPlan, remoteState] = await Promise.all([
        getPlan(targetService.plan_id),
        getPresentationLiveState(targetService.plan_id).catch(() => null),
      ]);
      const matchingWorshipSet = matchingWorshipSetForService(nextPlan, plans.filter(isWorshipSetPlan));
      const nextWorshipSetPlan = matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null;

      setPlan(nextPlan);
      setSelectedPlanId(nextPlan.id);
      setWorshipSetPlan(nextWorshipSetPlan);
      setSongs(nextSongs);
      setLiveState(remoteState ? liveStateFromApi(remoteState) : { planId: nextPlan.id, index: 0, updatedAt: Date.now(), theme: "dark" });
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the live service.");
    } finally {
      pollInFlightRef.current = false;
    }
  }

  useEffect(() => {
    void loadBroadcast();
    const timer = window.setInterval(() => void loadBroadcast(), POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId]);

  useEffect(() => {
    const files = mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []).flatMap((item) => item.files ?? []);
    const deckFiles = files.filter((file) => !file.content_type?.startsWith("video/"));
    if (!deckFiles.length) {
      setRenderedSlidesByFileId({});
      return;
    }

    let cancelled = false;
    void Promise.all(
      deckFiles.map(async (file) => {
        try {
          return [file.file_id, await getFileSlides(file.file_id)] as const;
        } catch {
          return [file.file_id, []] as const;
        }
      }),
    ).then((entries) => {
      if (!cancelled) {
        setRenderedSlidesByFileId(Object.fromEntries(entries));
      }
    });
    return () => {
      cancelled = true;
    };
  }, [plan?.items, worshipSetPlan?.items]);

  useEffect(() => {
    function handleFullscreenChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
      return;
    }
    void shellRef.current?.requestFullscreen();
  }

  return (
    <section className={`service-broadcast-view ${fullscreen ? "is-fullscreen" : ""}`} ref={shellRef} aria-label="Remote service broadcast">
      <header className="service-broadcast-toolbar">
        <div className="service-broadcast-title">
          <strong>{plan?.title ?? "Waiting for a live service"}</strong>
          <span>{liveSlide?.sectionTitle ?? (liveServices.length ? "Preparing slides" : "Start the slideshow to publish this view")}</span>
        </div>
        <div className="service-broadcast-actions">
          <button className="text-button icon-text-button" onClick={() => void loadBroadcast()} type="button">
            <RefreshCw size={16} aria-hidden="true" />
            Refresh
          </button>
          <button className="primary-button icon-text-button" onClick={toggleFullscreen} type="button">
            <Maximize2 size={16} aria-hidden="true" />
            Fullscreen
          </button>
        </div>
      </header>

      {message ? <p className="form-message service-broadcast-message">{message}</p> : null}

      {liveServices.length > 1 ? (
        <div className="service-broadcast-service-list" aria-label="Live services">
          {liveServices.map((service) => (
            <button
              className={service.plan_id === selectedPlanId ? "is-active" : ""}
              key={service.plan_id}
              onClick={() => setSelectedPlanId(service.plan_id)}
              type="button"
            >
              <strong>{service.title}</strong>
              <span>{service.subtitle ?? service.plan_type}</span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="service-broadcast-grid">
        <div className="service-broadcast-slide-pane">
          <div className={`service-broadcast-slide ${presentationTypeClass(liveSlide?.itemType ?? "generic")} stage-theme-${theme}`}>
            {!liveSlide ? (
              <div className="blank-stage" />
            ) : liveSlide.imageUrl ? (
              <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
            ) : liveSlide.videoUrl ? (
              <div className="stage-video-frame">
                {liveSlide.videoProvider === "file" ? (
                  <video controls src={liveSlide.videoUrl} title={liveSlide.title} />
                ) : (
                  <iframe
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                    allowFullScreen
                    src={liveSlide.videoUrl}
                    title={liveSlide.title}
                  />
                )}
              </div>
            ) : (
              <div className="presentation-stage">
                <div className="stage-title">{liveSlide.slideKind === "title" ? "" : liveSlide.sectionTitle}</div>
                <AutoFitSlideText text={liveSlide.text} maxFontSize={textFontCap} />
              </div>
            )}
          </div>
        </div>

        <aside className="service-broadcast-camera-pane">
          <CameraPane url={cameraUrl} />
        </aside>
      </div>
    </section>
  );
}
