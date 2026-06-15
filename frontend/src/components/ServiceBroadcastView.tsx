import { Maximize2, RefreshCw } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getFileSlides,
  getPlan,
  getPlans,
  getPresentationLiveState,
  getSongs,
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
  if (!url) {
    return (
      <div className="service-broadcast-camera-placeholder">
        <strong>Camera unavailable</strong>
        <span>Set VITE_SERVICE_CAMERA_URL for the remote service view.</span>
      </div>
    );
  }

  const kind = cameraKind(url);
  if (kind === "mjpeg") {
    return <img alt="Live service camera" className="service-broadcast-camera-media" src={url} />;
  }
  if (kind === "video") {
    return (
      <video
        autoPlay
        className="service-broadcast-camera-media"
        controls
        muted
        playsInline
        src={url}
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
  const cameraUrl = import.meta.env.VITE_SERVICE_CAMERA_URL || "";
  const shellRef = useRef<HTMLElement | null>(null);
  const pollInFlightRef = useRef(false);
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
      const [plans, nextSongs] = await Promise.all([getPlans(), getSongs()]);
      const servicePlans = plans.filter((candidate) => !isWorshipSetPlan(candidate));
      const targetPlan = plan
        ? servicePlans.find((candidate) => candidate.id === plan.id) ?? servicePlans[0]
        : servicePlans[0];
      if (!targetPlan) {
        setMessage("No service is available.");
        setPlan(null);
        setWorshipSetPlan(null);
        setSongs(nextSongs);
        return;
      }

      const [nextPlan, remoteState] = await Promise.all([
        getPlan(targetPlan.id),
        getPresentationLiveState(targetPlan.id).catch(() => null),
      ]);
      const matchingWorshipSet = matchingWorshipSetForService(nextPlan, plans.filter(isWorshipSetPlan));
      const nextWorshipSetPlan = matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null;

      setPlan(nextPlan);
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
  }, [plan?.id]);

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
          <strong>{plan?.title ?? "Service"}</strong>
          <span>{liveSlide?.sectionTitle ?? "Waiting for slides"}</span>
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
