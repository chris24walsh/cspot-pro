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
  extractYouTubeId,
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

function cameraMjpegFallback(url: string) {
  try {
    const parsed = new URL(url, window.location.origin);
    const source = parsed.searchParams.get("src");
    if (!source || !parsed.pathname.endsWith("/api/stream.m3u8")) return null;
    parsed.pathname = parsed.pathname.replace(/\/api\/stream\.m3u8$/, "/api/stream.mjpeg");
    parsed.search = new URLSearchParams({ src: source }).toString();
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function CameraPane({ url }: { url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);
  const kind = cameraKind(url);
  const isHls = url.toLowerCase().includes(".m3u8");

  useEffect(() => {
    if (kind !== "video" || !videoRef.current) return undefined;
    const video = videoRef.current;
    let cancelled = false;
    let fallbackSelected = false;
    let hls: InstanceType<typeof import("hls.js").default> | null = null;
    const mjpegUrl = cameraMjpegFallback(url);
    const useFallback = () => {
      if (!cancelled && !fallbackSelected && mjpegUrl) {
        fallbackSelected = true;
        hls?.destroy();
        video.pause();
        setFallbackUrl(mjpegUrl);
      }
    };
    const updateSoundState = () => {
      if (!cancelled) setPlaybackBlocked(video.paused || video.muted || video.volume === 0);
    };
    setFallbackUrl(null);
    const play = async () => {
      try {
        video.muted = false;
        video.volume = 1;
        await video.play();
        updateSoundState();
      } catch {
        if (!cancelled) setPlaybackBlocked(true);
      }
    };
    video.muted = false;
    video.defaultMuted = false;
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
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) useFallback();
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      });
    }
    video.addEventListener("error", useFallback);
    video.addEventListener("volumechange", updateSoundState);
    video.addEventListener("playing", updateSoundState);
    const decodeTimer = window.setTimeout(() => {
      if (video.videoWidth === 0 || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        useFallback();
      }
    }, 6000);
    return () => {
      cancelled = true;
      window.clearTimeout(decodeTimer);
      video.removeEventListener("error", useFallback);
      video.removeEventListener("volumechange", updateSoundState);
      video.removeEventListener("playing", updateSoundState);
      hls?.destroy();
    };
  }, [isHls, kind, url]);

  if (fallbackUrl) {
    return <img alt="Live service camera" className="service-broadcast-camera-media" src={fallbackUrl} />;
  }
  if (kind === "mjpeg") return <img alt="Live service camera" className="service-broadcast-camera-media" src={url} />;
  if (kind === "video") {
    return (
      <div className="service-broadcast-camera-player">
        <video autoPlay className="service-broadcast-camera-media" controls playsInline ref={videoRef} src={isHls ? undefined : url} />
        {playbackBlocked ? (
          <button
            className="service-broadcast-camera-overlay"
            onClick={() => {
              if (videoRef.current) {
                videoRef.current.muted = false;
                videoRef.current.volume = 1;
                void videoRef.current.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
              }
            }}
            type="button"
          >
            Turn on camera sound
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
    >
      <span className="service-broadcast-holding-mark">{startingSoon ? "Starting soon" : "Offline"}</span>
      <strong>{message}</strong>
      {startingSoon ? <p>Welcome. We’re glad you’re here.</p> : null}
    </div>
  );
}

function preServiceYouTubeUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
}

function PreServiceYouTubePane({ videoId }: { videoId: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [muted, setMuted] = useState(true);

  function enableSound() {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
    setMuted(false);
  }

  return (
    <div className="service-broadcast-camera-player">
      <iframe
        allow="autoplay; encrypted-media; picture-in-picture"
        allowFullScreen
        className="service-broadcast-camera-media service-broadcast-preservice-video"
        ref={frameRef}
        src={preServiceYouTubeUrl(videoId)}
        title="Pre-service worship"
      />
      {muted ? (
        <button className="service-broadcast-camera-overlay" onClick={enableSound} type="button">
          Turn on sound
        </button>
      ) : null}
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
  const preServiceYouTubeId = extractYouTubeId(settings.pre_service_audio_url);
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
          ) : startingSoon && preServiceYouTubeId ? (
            <PreServiceYouTubePane videoId={preServiceYouTubeId} />
          ) : (
            <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
          )}
        </section>
      </div>

      {startingSoon && settings.pre_service_audio_url && !preServiceYouTubeId ? (
        <div className="service-broadcast-preservice-audio">
          <span>Pre-service worship</span>
          <audio autoPlay controls loop src={settings.pre_service_audio_url} />
        </div>
      ) : null}
    </section>
  );
}
