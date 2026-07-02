import { Maximize2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getBroadcastViewerSettings,
  getFileSlides,
  getLivePresentationServices,
  getPlan,
  getPlans,
  getPresentationLiveState,
  getSongs,
  type BroadcastViewerSettings,
  type PlanDetail,
  type PlanSummary,
  type PresentationLiveService,
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
import { isBroadcastStartingSoon } from "../broadcastTiming";
import { isWorshipSetPlan, matchingWorshipSetForService, mergeWorshipSetIntoService } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { ScaledSlideImage } from "./ScaledSlideImage";

const POLL_INTERVAL_MS = 3000;
const DEFAULT_SETTINGS: BroadcastViewerSettings = {
  camera_url: null,
  offline_message: "No service is streaming right now",
  pre_service_audio_url: null,
  pre_service_minutes: 60,
  starting_soon_message: "Our service will begin shortly",
  stream_description: null,
  stream_title: "Sunday Service",
};

function liveStateFromApi(state: Awaited<ReturnType<typeof getPresentationLiveState>>): PresentationLiveState {
  return {
    blanked: state.blanked,
    fullscreen: state.fullscreen,
    index: state.index,
    planId: state.plan_id,
    planItemId: state.plan_item_id,
    slideOffset: state.slide_offset,
    theme: state.theme,
    updatedAt: state.updated_at,
    videoAction: state.video_action,
    videoActionAt: state.video_action_at ?? undefined,
  };
}

function cameraKind(url: string) {
  const lower = url.toLowerCase();
  if (/\.(mjpg|mjpeg)(?:[?#]|$)/.test(lower) || lower.includes("mjpeg") || lower.includes("mjpg")) return "mjpeg";
  if (/\.(mp4|webm|ogg|m3u8)(?:[?#]|$)/.test(lower)) return "video";
  return "frame";
}

function CameraPane({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const kind = cameraKind(url);
  const isHls = url.toLowerCase().includes(".m3u8");

  useEffect(() => {
    if (kind !== "video" || !videoRef.current) return undefined;
    const video = videoRef.current;
    let cancelled = false;
    let hls: InstanceType<typeof import("hls.js").default> | null = null;
    const play = async () => {
      try {
        await video.play();
        if (!cancelled) setPlaybackBlocked(false);
      } catch {
        if (!cancelled) setPlaybackBlocked(true);
      }
    };
    video.muted = true;
    video.defaultMuted = true;
    video.autoplay = true;
    video.playsInline = true;

    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      void play();
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls({ enableWorker: true, lowLatencyMode: true });
        hls.on(Hls.Events.MANIFEST_PARSED, () => void play());
        hls.loadSource(url);
        hls.attachMedia(video);
      });
    }
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [isHls, kind, url]);

  if (kind === "mjpeg") return <img alt="Live service camera" className="service-broadcast-camera-media" src={url} />;
  if (kind === "video") {
    return (
      <div className="service-broadcast-camera-player">
        <video autoPlay className="service-broadcast-camera-media" controls muted playsInline ref={videoRef} src={isHls ? undefined : url} />
        {playbackBlocked ? (
          <button
            className="service-broadcast-camera-overlay"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                void videoRef.current.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
              }
            }}
            type="button"
          >
            Start camera audio
          </button>
        ) : null}
      </div>
    );
  }
  return <iframe allow="autoplay; fullscreen; picture-in-picture" className="service-broadcast-camera-media" src={url} title="Live service camera" />;
}

function HoldingPane({ message, startingSoon }: { message: string; startingSoon: boolean }) {
  return (
    <div
      aria-label={message}
      className={`service-broadcast-holding-slide ${startingSoon ? "is-starting-soon" : "is-offline"}`}
      title={message}
    >
      <span className="service-broadcast-holding-mark">{startingSoon ? "Starting soon" : "Offline"}</span>
    </div>
  );
}

export function ServiceBroadcastView() {
  const shellRef = useRef<HTMLElement | null>(null);
  const pollInFlightRef = useRef(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [liveServices, setLiveServices] = useState<PresentationLiveService[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [nextService, setNextService] = useState<PlanSummary | null>(null);
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
  const liveSlide = liveState?.blanked ? null : slides[resolveLiveIndex(slides, liveState)] ?? null;
  const hasLiveService = Boolean(plan && liveState);
  const upcomingService = plan ?? nextService;
  const startingSoon = !hasLiveService && isBroadcastStartingSoon(upcomingService?.service_date, Date.now(), settings.pre_service_minutes);
  const holdingMessage = startingSoon ? settings.starting_soon_message : settings.offline_message;
  const textFontCap = useMemo(
    () => suggestSlideGroupFontCap(slides.filter((slide) => !slide.imageUrl && slide.text.trim()).map((slide) => slide.text)),
    [slides],
  );

  async function loadBroadcast() {
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      const [nextLiveServices, plans, nextSongs, nextSettings] = await Promise.all([
        getLivePresentationServices(),
        getPlans(),
        getSongs(),
        getBroadcastViewerSettings(),
      ]);
      const servicePlans = plans.filter((candidate) => !isWorshipSetPlan(candidate));
      const nextPlanned = servicePlans
        .filter((candidate) => new Date(candidate.service_date).getTime() >= Date.now() - 30 * 60000)
        .sort((left, right) => new Date(left.service_date).getTime() - new Date(right.service_date).getTime())[0] ?? null;
      setSettings(nextSettings);
      setLiveServices(nextLiveServices);
      setNextService(nextPlanned);
      setSongs(nextSongs);

      const target = nextLiveServices.find((service) => service.plan_id === selectedPlanId) ?? nextLiveServices[0] ?? null;
      if (!target) {
        setPlan(null);
        setWorshipSetPlan(null);
        setLiveState(null);
        setSelectedPlanId(null);
        setMessage(null);
        return;
      }

      const [nextPlan, remoteState] = await Promise.all([
        getPlan(target.plan_id),
        getPresentationLiveState(target.plan_id).catch(() => null),
      ]);
      const matchingWorshipSet = matchingWorshipSetForService(nextPlan, plans.filter(isWorshipSetPlan));
      setPlan(nextPlan);
      setSelectedPlanId(nextPlan.id);
      setWorshipSetPlan(matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null);
      setLiveState(remoteState ? liveStateFromApi(remoteState) : null);
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load the service stream.");
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
    void Promise.all(deckFiles.map(async (file) => [file.file_id, await getFileSlides(file.file_id).catch(() => [])] as const)).then((entries) => {
      if (!cancelled) setRenderedSlidesByFileId(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [plan?.items, worshipSetPlan?.items]);

  useEffect(() => {
    const handler = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  return (
    <section className={`service-broadcast-view ${fullscreen ? "is-fullscreen" : ""}`} ref={shellRef} aria-label="Service broadcast">
      <header className="service-broadcast-toolbar">
        <button
          aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          className="service-broadcast-fullscreen-button"
          onClick={() => (document.fullscreenElement ? void document.exitFullscreen() : void shellRef.current?.requestFullscreen())}
          title={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          type="button"
        >
          <Maximize2 size={18} aria-hidden="true" />
        </button>
      </header>

      {message ? <p className="form-message service-broadcast-message">{message}</p> : null}

      {liveServices.length > 1 ? (
        <div className="service-broadcast-service-list" aria-label="Live services">
          {liveServices.map((service) => (
            <button className={service.plan_id === selectedPlanId ? "is-active" : ""} key={service.plan_id} onClick={() => setSelectedPlanId(service.plan_id)} type="button">
              {service.title}
            </button>
          ))}
        </div>
      ) : null}

      <div className="service-broadcast-grid">
        <section className="service-broadcast-slide-pane" aria-label="Live presentation">
          <div className={`service-broadcast-slide ${presentationTypeClass(liveSlide?.itemType ?? "generic")} stage-theme-${liveState?.theme ?? "dark"}`}>
            {!hasLiveService ? (
              <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
            ) : !liveSlide ? (
              <HoldingPane message="The presentation is live" startingSoon />
            ) : liveSlide.imageUrl ? (
              <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
            ) : liveSlide.videoUrl ? (
              <div className="stage-video-frame">
                {liveSlide.videoProvider === "file" ? <video controls src={liveSlide.videoUrl} /> : <iframe allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen src={liveSlide.videoUrl} title={liveSlide.title} />}
              </div>
            ) : (
              <div className="presentation-stage">
                <div className="stage-title">{liveSlide.slideKind === "title" ? "" : liveSlide.sectionTitle}</div>
                <AutoFitSlideText text={liveSlide.text} maxFontSize={textFontCap} />
              </div>
            )}
          </div>
        </section>

        <section className="service-broadcast-camera-pane" aria-label="Live camera">
          {hasLiveService && settings.camera_url ? (
            <CameraPane url={settings.camera_url} />
          ) : hasLiveService ? (
            <HoldingPane message="Camera stream is not configured" startingSoon={false} />
          ) : (
            <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
          )}
        </section>
      </div>

      {startingSoon && settings.pre_service_audio_url ? (
        <div className="service-broadcast-preservice-audio">
          <span>Pre-service worship</span>
          <audio autoPlay controls loop src={settings.pre_service_audio_url} />
        </div>
      ) : null}
    </section>
  );
}
