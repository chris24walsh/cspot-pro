import { useServiceCameraAlerts } from "./useServiceCameraAlerts";
import { BroadcastAccordionSummary, contractOtherBroadcastControls } from "./BroadcastAccordion";
import { withRemoteContribution } from "../remoteContribution";
import { RemoteContributionPanel } from "./RemoteContributionPanel";
import { LiveCameraMovement } from "./LiveCameraMovement";
import { CameraFraming } from "./CameraFraming";
import { withCountdownTiming } from "../countdown";
import { Maximize2, Minimize2, Minus, Radio, Settings2, Volume2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  getBroadcastViewerSettings,
  getLivestreamViewership,
  type LivestreamEvent,
  getFileSlides,
  getLivePresentationServices,
  getPlan,
  getPlans,
  getPresentationLiveState,
  getSongs,
  sendLivestreamHeartbeat,
  updateBroadcastViewerSettings,
  type BroadcastViewerSettings,
  type PlanDetail,
  type PlanSummary,
  type PresentationLiveService,
  type RenderedSlide,
  type Song,
} from "../api";
import { rehearsalDeskIsIsolated, resolveBroadcastLiveAudioUrl } from "../broadcastAudioRouting";
import { activeCameraIdAt, cameraServicePhase } from "../broadcastCamera";
import {
  buildPresentationSlides,
  LCF_BACKGROUND_URL,
  presentationTypeClass,
  resolveLiveIndex,
  suggestedSlideFontCap,
  type PresentationLiveState,
} from "../presentation";
import { isBroadcastStartingSoon } from "../broadcastTiming";
import { isFirefoxDevice, isMobileOrTabletDevice } from "../presentationDevice";
import { isWorshipSetPlan, matchingWorshipSetForService, mergeWorshipSetIntoService } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { CountdownSlide } from "./CountdownSlide";
import { PreServiceSlide, serviceScheduleForPlan } from "./PreServiceSlide";
import { LiveStreamAudio, LowLatencyCamera } from "./LowLatencyCamera";
import { LivestreamMedia } from "./LivestreamMedia";
import { ScaledSlideImage } from "./ScaledSlideImage";
import { SlideOverlay } from "./SlideOverlay";

const POLL_INTERVAL_MS = 2000;
const LIVE_STATE_POLL_INTERVAL_MS = 500;
const DEFAULT_SETTINGS: BroadcastViewerSettings = {
  auto_record_sermons: true,
  recording_grace_seconds: 60,
  active_camera_id: null,
  camera_cycle_seconds: 0,
  camera_cycle_started_at: null,
  camera_fade_ms: 1200,
  camera_sources: [],
  audio_sources: [],
  audio_scenes: [],
  active_audio_scene: "pastor",
  audio_scene_automation: true,
  camera_url: null,
  live_audio_url: null,
  live_audio_source: "none",
  live_audio_stream_name: null,
  manual_live_audience: "off",
  mixer_name: null,
  mixer_protocol: "none",
  mixer_control_url: null,
  mixer_notes: null,
  offline_message: "No service is streaming right now",
  pre_service_audio_url: null,
  pre_service_room_audio_enabled: true,
  pre_service_minutes: 60,
  service_schedules: [],
  starting_soon_message: "Our service will begin shortly",
  slide_delay_ms: 800,
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
    countdownStartedAt: state.countdown_started_at,
    videoAction: state.video_action,
    videoActionAt: state.video_action_at ?? undefined,
    serviceStage: state.service_stage ?? "ready",
    preServicePhase: state.pre_service_phase ?? null,
  };
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

export function ServiceBroadcastView({ canControl = false, onOpenSettings }: { canControl?: boolean; onOpenSettings?: () => void }) {
  const cameraAlerts = useServiceCameraAlerts(canControl);
  const [panelModes, setPanelModes] = useState<Record<string, "normal" | "minimized" | "maximized">>({});
  const [serviceCameraStatus, setServiceCameraStatus] = useState("Connecting…");
  const [panStatus, setPanStatus] = useState("Connecting…");
  const [viewership, setViewership] = useState<LivestreamEvent[]>([]);
  const shellRef = useRef<HTMLElement | null>(null);
  const pollInFlightRef = useRef(false);
  const [baseSettings, setSettings] = useState(DEFAULT_SETTINGS);
  const settings = useMemo(() => withRemoteContribution(baseSettings), [baseSettings]);
  const [liveServices, setLiveServices] = useState<PresentationLiveService[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const [nextService, setNextService] = useState<PlanSummary | null>(null);
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [worshipSetPlan, setWorshipSetPlan] = useState<PlanDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [remoteLiveState, setRemoteLiveState] = useState<PresentationLiveState | null>(null);
  const [liveState, setLiveState] = useState<PresentationLiveState | null>(null);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [cameraClock, setCameraClock] = useState(() => Date.now());
  const [controlBusy, setControlBusy] = useState(false);
  const [viewerSoundEnabled, setViewerSoundEnabled] = useState(false);
  const lastCameraCycleSecondsRef = useRef(30);
  const viewerSessionIdRef = useRef<string | null>(null);

  const slides = useMemo(
    () => buildPresentationSlides(mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []), songs, renderedSlidesByFileId),
    [plan, worshipSetPlan, renderedSlidesByFileId, songs],
  );
  // Blanking is a visual overlay, not the end of the underlying live slide.
  // Keeping the slide selected also keeps its camera/audio routing alive.
  const liveSlide = withCountdownTiming(!liveState ? null : slides[resolveLiveIndex(slides, liveState)] ?? null, slides, liveState, plan?.service_date ?? "", plan?.service_start);
  const selectedLiveService = liveServices.find((service) => service.plan_id === selectedPlanId) ?? liveServices[0] ?? null;
  const adminRehearsal = Boolean(canControl && selectedLiveService?.rehearsal);
  const hasLiveBroadcast = Boolean((plan && remoteLiveState && !selectedLiveService?.rehearsal) || settings.manual_live_audience !== "off");
  const hasVisibleSlideshow = hasLiveBroadcast || adminRehearsal;
  const upcomingService = plan ?? nextService;
  const startingSoon = !hasLiveBroadcast && isBroadcastStartingSoon(upcomingService?.service_date, Date.now(), settings.pre_service_minutes);
  const holdingMessage = startingSoon ? settings.starting_soon_message : settings.offline_message;
  const currentCameraPhase = cameraServicePhase(liveSlide?.itemType, liveSlide?.sectionTitle);
  const activeCameraId = activeCameraIdAt(
    settings.camera_sources,
    settings.active_camera_id,
    settings.camera_cycle_seconds,
    settings.camera_cycle_started_at,
    cameraClock,
    currentCameraPhase,
  );
  const selectedAudioCamera = settings.camera_sources.find((source) => source.id === settings.live_audio_source) ?? null;
  const selectedIndependentAudio = settings.audio_sources.find((source) => source.id === settings.live_audio_source) ?? null;
  const rehearsalIsolated = rehearsalDeskIsIsolated({
    liveAudioSource: settings.live_audio_source,
    sources: settings.audio_sources,
  });
  const resolvedLiveAudioUrl = resolveBroadcastLiveAudioUrl({
    audioSources: settings.audio_sources,
    cameraSources: settings.camera_sources,
    liveAudioSource: settings.live_audio_source,
    liveAudioStreamName: settings.live_audio_stream_name,
  });
  const liveAudioUrl = (
    (isMobileOrTabletDevice() || isFirefoxDevice())
    && (settings.live_audio_source === "mix" || Boolean(selectedIndependentAudio))
  ) ? resolvedLiveAudioUrl?.replace("/live-audio.mp4", "/live-audio") ?? null : resolvedLiveAudioUrl;
  const textFontCap = suggestedSlideFontCap(liveSlide);
  const todaysEvents = viewership.filter(event => new Date(event.started_at).toLocaleDateString() === new Date().toLocaleDateString() || !event.ended_at);
  const todaysViewers = new Set(todaysEvents.flatMap(event => event.viewers.map(viewer => viewer.user_id)));
  const currentViewers = new Set(todaysEvents.flatMap(event => event.viewers.filter(viewer => viewer.watching_now).map(viewer => viewer.user_id)));
  const cameraStatus = activeCameraId
    ? `${settings.camera_sources.find(source => source.id === activeCameraId)?.label ?? "Camera"} · ${settings.camera_sources.filter(source => source.enabled !== false).length}/${settings.camera_sources.length} enabled`
    : "Off air";
  const audioStatus = settings.live_audio_source === "none" ? "Muted" : selectedIndependentAudio?.label ?? selectedAudioCamera?.label ?? "Program feed";
  const sceneStatus = settings.audio_scenes.find(scene => scene.id === settings.active_audio_scene)?.label;


  useEffect(() => {
    if (!canControl) return;
    const refresh = () => void getLivestreamViewership().then(setViewership).catch(() => undefined);
    refresh();
    const timer = window.setInterval(refresh, 15000);
    return () => window.clearInterval(timer);
  }, [canControl]);

  useEffect(() => {
    if (!hasLiveBroadcast) return undefined;
    if (!viewerSessionIdRef.current) {
      const storageKey = "cspot-livestream-viewer-session";
      viewerSessionIdRef.current = window.sessionStorage.getItem(storageKey)
        ?? (typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
      window.sessionStorage.setItem(storageKey, viewerSessionIdRef.current);
    }
    const payload = (viewing = document.visibilityState === "visible" || viewerSoundEnabled) => ({
      client_session_id: viewerSessionIdRef.current as string,
      plan_id: selectedLiveService?.plan_id ?? null,
      viewing,
      playback_active: viewerSoundEnabled,
    });
    const heartbeat = () => {
      if (document.visibilityState === "visible" || viewerSoundEnabled) {
        void sendLivestreamHeartbeat(payload()).catch(() => undefined);
      }
    };
    const visibilityChanged = () => {
      void sendLivestreamHeartbeat(payload()).catch(() => undefined);
    };
    const leave = () => void sendLivestreamHeartbeat({
      ...payload(false),
      playback_active: false,
    }).catch(() => undefined);
    heartbeat();
    const timer = window.setInterval(heartbeat, 15000);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("pagehide", leave);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", visibilityChanged);
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [hasLiveBroadcast, selectedLiveService?.plan_id, viewerSoundEnabled]);

  useEffect(() => {
    if (settings.camera_cycle_seconds > 0) lastCameraCycleSecondsRef.current = settings.camera_cycle_seconds;
  }, [settings.camera_cycle_seconds]);

  function setLivestreamSound(enabled: boolean) {
    setViewerSoundEnabled(enabled);
  }

  async function updateLiveControls(patch: Partial<BroadcastViewerSettings>) {
    setControlBusy(true);
    try {
      setSettings(await updateBroadcastViewerSettings(patch));
      setMessage(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not update livestream controls.");
    } finally {
      setControlBusy(false);
    }
  }

  function panelButtons(id: string, label: string) {
    const mode = panelModes[id] ?? "normal";
    return <div className="broadcast-panel-actions">
      <span>{label}</span>
      <button type="button" title={mode === "minimized" ? `Restore ${label}` : `Minimize ${label}`} aria-label={mode === "minimized" ? `Restore ${label}` : `Minimize ${label}`} onClick={() => setPanelModes(current => ({...current, [id]: mode === "minimized" ? "normal" : "minimized"}))}><Minus size={14} /></button>
      <button type="button" title={mode === "maximized" ? `Restore ${label}` : `Maximize ${label}`} aria-label={mode === "maximized" ? `Restore ${label}` : `Maximize ${label}`} onClick={() => setPanelModes({[id]: mode === "maximized" ? "normal" : "maximized"})}>{mode === "maximized" ? <Minimize2 size={14}/> : <Maximize2 size={14}/>}</button>
    </div>;
  }

  function putCameraOnAir(cameraId: string) {
    void updateLiveControls({
      active_camera_id: cameraId,
      camera_sources: settings.camera_sources.map(source => source.id === cameraId ? {...source, enabled: true} : source),
      camera_cycle_started_at: settings.camera_cycle_seconds > 0 ? new Date().toISOString() : settings.camera_cycle_started_at,
    });
  }

  function putAudioOnAir(sourceId: string) {
    void updateLiveControls({
      live_audio_source: sourceId,
      ...(sourceId === "none" ? {} : {mixer_program_source_id: settings.audio_sources.some(source => source.id === sourceId) ? sourceId : null}),
    });
  }

  function setCameraCycleMode(mode: "manual" | "automatic") {
    const cycleSeconds = mode === "automatic" ? lastCameraCycleSecondsRef.current : 0;
    void updateLiveControls({
      camera_cycle_seconds: cycleSeconds,
      camera_cycle_started_at: cycleSeconds > 0 ? new Date().toISOString() : null,
    });
  }

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
        setRemoteLiveState(null);
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
      // Do not expose edits to the current plan before their corresponding
      // live-state transition has passed through the configured slide delay.
      // This matters for Bible navigation, which edits the current plan item
      // in place rather than moving to a differently indexed slide.
      setPlan((current) => current?.id === nextPlan.id ? current : nextPlan);
      setSelectedPlanId(nextPlan.id);
      const nextWorshipSetPlan = matchingWorshipSet ? await getPlan(matchingWorshipSet.id) : null;
      setWorshipSetPlan((current) => current?.id === nextWorshipSetPlan?.id ? current : nextWorshipSetPlan);
      if (remoteState) {
        const nextState = liveStateFromApi(remoteState);
        setRemoteLiveState((current) => current?.updatedAt === nextState.updatedAt ? current : nextState);
      } else {
        setRemoteLiveState(null);
      }
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
    if (!plan) return undefined;
    let cancelled = false;
    let inFlight = false;
    async function pollLiveState() {
      if (inFlight || !plan) return;
      inFlight = true;
      try {
        const nextState = liveStateFromApi(await getPresentationLiveState(plan.id));
        if (!cancelled) {
          setRemoteLiveState((current) => current?.updatedAt === nextState.updatedAt ? current : nextState);
        }
      } catch {
        // The slower session poll owns offline/session error state.
      } finally {
        inFlight = false;
      }
    }
    void pollLiveState();
    const timer = window.setInterval(() => void pollLiveState(), LIVE_STATE_POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [plan]);

  useEffect(() => {
    if (!remoteLiveState) {
      setLiveState(null);
      return undefined;
    }
    // Fetch the matching plan snapshot now, but reveal it atomically with the
    // delayed state. Otherwise the service poll can show an edited Bible verse
    // immediately while its navigation state is still waiting on the delay.
    const delayedPlan = getPlan(remoteLiveState.planId).catch(() => null);
    const timer = window.setTimeout(() => {
      void delayedPlan.then((nextPlan) => {
        if (nextPlan) setPlan(nextPlan);
        setLiveState(remoteLiveState);
      });
    }, settings.slide_delay_ms);
    return () => window.clearTimeout(timer);
  }, [remoteLiveState, settings.slide_delay_ms]);

  useEffect(() => {
    if (settings.camera_cycle_seconds <= 0 || settings.camera_sources.length < 2) return undefined;
    const timer = window.setInterval(() => setCameraClock(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [settings.camera_cycle_seconds, settings.camera_sources.length]);

  useEffect(() => {
    const deckFiles = mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []).flatMap((item) =>
      item.item_type === "video"
        ? []
        : (item.files ?? []).filter(
            (file) => !file.content_type?.startsWith("video/") && !file.content_type?.startsWith("image/"),
          ),
    );
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
    <section className={`service-broadcast-view ${canControl ? "has-admin-controls" : ""} ${fullscreen ? "is-fullscreen" : ""}`} ref={shellRef} aria-label="Service broadcast">
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

      <div className={`service-broadcast-grid ${panelModes.slides === "minimized" ? "slides-minimized" : ""} ${panelModes.camera === "minimized" ? "camera-minimized" : ""} ${Object.values(panelModes).includes("maximized") ? "has-maximized-panel" : ""}`}>
        <section className={`service-broadcast-slide-pane panel-${panelModes.slides ?? "normal"}`} aria-label="Live presentation">
          {panelButtons("slides", "Slides")}
          <div className={`service-broadcast-slide ${presentationTypeClass(liveSlide?.itemType ?? "generic")} stage-theme-${liveState?.theme ?? "dark"}`}>
            <div className="slide-visual-transition" key={!hasVisibleSlideshow ? "offline" : liveState?.blanked ? "blank" : liveSlide?.id ?? "live"}>
            {!hasVisibleSlideshow ? (
              <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
            ) : liveState?.blanked ? (
              <div
                className="lcf-background-surface"
                aria-label="LCF background"
                style={{ backgroundImage: `url(${LCF_BACKGROUND_URL})` }}
              />
            ) : liveSlide?.displayTargets && !liveSlide.displayTargets.includes("livestream") ? (
              <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
            ) : !liveSlide ? (
              <HoldingPane message="The livestream is live" startingSoon />
            ) : liveSlide.montageImageUrls && plan ? (
              <PreServiceSlide backgroundImageUrl={LCF_BACKGROUND_URL} countdownEndsAt={liveSlide.overlayCountdownDeadline} countdownUntil={liveSlide.overlayCountdownUntil} dwellSeconds={liveSlide.dwellSeconds} fontScale={liveSlide.overlayFontScale} imageUrls={liveSlide.montageImageUrls} random={liveSlide.montageRandom} serviceDate={plan.service_date} timed={Boolean(liveSlide.preServiceTimed)} phase={liveSlide.preServiceStage ?? liveState?.preServicePhase} phaseStartedAt={liveState?.countdownStartedAt?.[liveSlide.planItemId] ?? liveState?.updatedAt} schedule={serviceScheduleForPlan(settings.service_schedules, plan.service_date, plan.plan_type)} />
            ) : liveSlide.countdownSeconds ? (
              <CountdownSlide durationSeconds={liveSlide.countdownSeconds} running={hasVisibleSlideshow} startAt={liveState?.countdownStartedAt?.[liveSlide.planItemId] ?? liveState?.updatedAt} />
            ) : liveSlide.backgroundImageUrl ? (
              <div
                className="lcf-background-slide"
                style={{ backgroundImage: `url(${liveSlide.backgroundImageUrl})` }}
                aria-label={liveSlide.title}
              />
            ) : liveSlide.imageUrl ? (
              <ScaledSlideImage alt={liveSlide.title} fitMode={liveSlide.fitMode} src={liveSlide.imageUrl} />
            ) : liveSlide.videoUrl ? (
              <div className="stage-video-frame">
                <LivestreamMedia
                  action={liveState?.videoAction}
                  actionAt={liveState?.videoActionAt}
                  provider={liveSlide.videoProvider ?? "youtube"}
                  title={liveSlide.title}
                  url={liveSlide.videoUrl}
                />
              </div>
            ) : (
              <div className="presentation-stage service-broadcast-presentation-stage">
                {liveSlide.slideKind !== "title" && liveSlide.sectionTitle ? <div className="stage-title">{liveSlide.sectionTitle}</div> : null}
                <AutoFitSlideText
                  className={liveSlide.slideKind === "title" ? "is-title-slide" : undefined}
                  text={liveSlide.text}
                  maxFontSize={textFontCap}
                />
              </div>
            )}
            {hasVisibleSlideshow && !liveState?.blanked && liveSlide ? <SlideOverlay running={hasVisibleSlideshow} slide={liveSlide} serviceDate={plan?.service_date} startAt={liveState?.countdownStartedAt?.[liveSlide.planItemId] ?? liveState?.updatedAt} /> : null}
            </div>
          </div>
        </section>

        <section className={`service-broadcast-camera-pane panel-${panelModes.camera ?? "normal"}`} aria-label="Live camera">
          {panelButtons("camera", "Camera")}
          <div className="service-broadcast-camera-visual">
            {hasLiveBroadcast && activeCameraId ? (
              <div
                className="service-broadcast-camera-switcher"
                style={{ "--camera-fade-duration": `${settings.camera_fade_ms}ms` } as CSSProperties}
              >
                {settings.camera_sources.map((source) => (
                  <div
                    aria-hidden={source.id !== activeCameraId}
                    className={`service-broadcast-camera-layer ${source.id === activeCameraId ? "is-active" : ""}`}
                    key={source.id}
                  >
                    <CameraFraming source={source} startedAt={settings.camera_cycle_started_at}>
                      <LowLatencyCamera label={`${source.label} camera`} url={source.url} />
                    </CameraFraming>
                    <span className="service-broadcast-camera-label">{source.label}</span>
                  </div>
                ))}
              </div>
            ) : hasLiveBroadcast ? (
              <HoldingPane message="Camera off air" startingSoon={false} />
            ) : (
              <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
            )}
            {hasLiveBroadcast && liveAudioUrl ? (
              <LiveStreamAudio label={selectedAudioCamera ? `${selectedAudioCamera.label} audio` : selectedIndependentAudio?.label ?? "Live service audio"} onSoundEnabledChange={setLivestreamSound} preserveSoundOnPlaybackFailure={false} soundEnabled={viewerSoundEnabled} url={liveAudioUrl} />
            ) : null}
          </div>
        </section>
      </div>

      {canControl ? (
        <div className={`service-broadcast-viewer-controls ${canControl ? "has-admin-controls" : ""}`}>
          {canControl ? (
            <div className="service-broadcast-admin-live-controls" aria-label="Quick livestream controls">
              {!cameraAlerts.soundReady && <button type="button" className="text-button icon-text-button" title="Enable camera request sounds on this device" onClick={cameraAlerts.enableSound}><Volume2 size={14}/> Enable alert sound</button>}
              <span className="camera-request-announcement" role="status">{cameraAlerts.requests.length ? `Camera request: ${cameraAlerts.requests.map(camera => camera.label).join(", ")}` : ""}</span>

              {[
                <details key="cameras" onToggle={contractOtherBroadcastControls} open className="broadcast-control-category"><BroadcastAccordionSummary status={cameraStatus}><Radio size={14}/> Cameras &amp; framing</BroadcastAccordionSummary><div className="broadcast-control-fields">
              <label className="service-broadcast-live-select">
                <span><Radio size={13} aria-hidden="true" /> Camera</span>
                <select
                  aria-label="Camera on air"
                  disabled={controlBusy || Boolean(settings.remote_contribution) || !settings.camera_sources.length}
                  onChange={(event) => putCameraOnAir(event.target.value)}
                  value={activeCameraId ?? ""}
                >
                  <option value="" disabled>{activeCameraId ? "Select camera" : "Cameras off air"}</option>
                  {settings.camera_sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                </select>
              </label>
              <button type="button" className="text-button" disabled={controlBusy || !activeCameraId || Boolean(settings.remote_contribution)} onClick={() => void updateLiveControls({camera_sources: settings.camera_sources.map(source => ({...source, enabled: false}))})}>Cameras off air</button>
              {settings.camera_sources.map(source => <fieldset key={source.id} disabled={controlBusy || Boolean(settings.remote_contribution)}><legend>{source.label}{source.id === activeCameraId ? " · On air" : ""}</legend>
                <label><input type="checkbox" checked={source.enabled !== false} onChange={event => void updateLiveControls({camera_sources: settings.camera_sources.map(camera => camera.id === source.id ? {...camera, enabled: event.target.checked} : camera)})}/> Include on air</label>
                <label><input type="checkbox" checked={source.digital_pan ?? false} onChange={event => void updateLiveControls({camera_sources: settings.camera_sources.map(camera => camera.id === source.id ? {...camera, digital_pan: event.target.checked} : camera)})}/> Digital pan</label>
                {([["zoom", "Zoom", 1, 4, 0.1], ["crop_x", "Pan", 0, 100, 1], ["crop_y", "Tilt", 0, 100, 1]] as const).map(([field, label, min, max, step]) => <label key={field}>{label}<input aria-label={`${source.label} ${label}`} type="number" min={min} max={max} step={step} value={source[field] ?? (field === "zoom" ? 1 : 50)} onChange={event => void updateLiveControls({camera_sources: settings.camera_sources.map(camera => camera.id === source.id ? {...camera, [field]: Math.max(min, Math.min(max, Number(event.target.value)))} : camera)})}/></label>)}
              </fieldset>)}
              </div></details>,
                <details key="audio" onToggle={contractOtherBroadcastControls} className="broadcast-control-category"><BroadcastAccordionSummary status={`${audioStatus}${sceneStatus ? ` · ${sceneStatus}` : ""} · ${settings.audio_scene_automation ? "Auto" : "Manual"}`}>Program audio</BroadcastAccordionSummary><div className="broadcast-control-fields">
              <label className="service-broadcast-live-select">
                <span>Audio</span>
                <select
                  aria-label="Live audio source"
                  disabled={controlBusy || Boolean(settings.remote_contribution)}
                  onChange={(event) => putAudioOnAir(event.target.value)}
                  value={settings.live_audio_source}
                >
                  <option value="none">No audio</option>
                  {settings.audio_sources.length ? <optgroup label="Independent audio">
                    {settings.audio_sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                  </optgroup> : null}
                  {settings.camera_sources.length ? <optgroup label="Camera audio">
                    {settings.camera_sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                  </optgroup> : null}
                </select>
              </label>
              <label>Audio scene<select aria-label="Live audio scene" disabled={controlBusy || settings.audio_scene_automation} value={settings.active_audio_scene} onChange={event => void updateLiveControls({active_audio_scene: event.target.value})}>{settings.audio_scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
              <label><input type="checkbox" checked={settings.audio_scene_automation} disabled={controlBusy} onChange={event => void updateLiveControls({audio_scene_automation: event.target.checked})}/> Follow presentation audio scenes</label>
              </div></details>,
                <details key="service-cameras" onToggle={event => { contractOtherBroadcastControls(event); if (event.target === event.currentTarget && event.currentTarget.open) cameraAlerts.acknowledge(); }} className={`broadcast-control-category ${cameraAlerts.requests.length ? "has-camera-request" : ""}`}>
                <BroadcastAccordionSummary status={cameraAlerts.requests.length ? `${cameraAlerts.requests.length} camera request${cameraAlerts.requests.length === 1 ? "" : "s"} · ${serviceCameraStatus}` : serviceCameraStatus}>Service cameras</BroadcastAccordionSummary>
                {cameraAlerts.requests.length > 0 && <div className="service-camera-request-alert" role="status">Camera request: {cameraAlerts.requests.map(camera => camera.label).join(", ")}<button type="button" className="text-button" onClick={cameraAlerts.acknowledge}>Acknowledge</button></div>}
                <RemoteContributionPanel onStatusChange={setServiceCameraStatus} onCamerasChange={cameraAlerts.reportCameras}/>
              </details>,
                <details key="watchers" onToggle={contractOtherBroadcastControls} className="broadcast-control-category"><BroadcastAccordionSummary status={`${currentViewers.size}/${todaysViewers.size} watching`} statusLabel={`${currentViewers.size} watching now / ${todaysViewers.size} unique viewers today`}>Today’s watchers</BroadcastAccordionSummary><div className="broadcast-control-fields">
                {todaysEvents.map(event => <div key={event.id}><strong>{event.title}</strong>{event.viewers.map(viewer => <p key={viewer.user_id}>{viewer.name} · {viewer.watching_now ? "Watching now" : "Finished"} · {Math.ceil(viewer.duration_seconds / 60)} min</p>)}</div>)}
                {!todaysEvents.length && <p>No viewers recorded today.</p>}
              </div></details>,
                <details key="pan" onToggle={contractOtherBroadcastControls} className="broadcast-control-category"><BroadcastAccordionSummary status={panStatus}>Physical pan</BroadcastAccordionSummary><LiveCameraMovement onStatusChange={setPanStatus}/></details>,
                <details key="sync" onToggle={contractOtherBroadcastControls} className="broadcast-control-category"><BroadcastAccordionSummary status={`${settings.camera_cycle_seconds > 0 ? "Auto" : "Manual"} · fade ${(settings.camera_fade_ms / 1000).toFixed(1)}s · slides +${(settings.slide_delay_ms / 1000).toFixed(1)}s`}>Switching &amp; sync</BroadcastAccordionSummary><div className="broadcast-control-fields">
              {settings.camera_sources.length > 1 ? (
                <label className="service-broadcast-live-select">
                  <span>Switching</span>
                  <select
                    aria-label="Camera switching mode"
                    disabled={controlBusy}
                    onChange={(event) => setCameraCycleMode(event.target.value as "manual" | "automatic")}
                    value={settings.camera_cycle_seconds > 0 ? "automatic" : "manual"}
                  >
                    <option value="manual">Manual</option>
                    <option value="automatic">Auto · {currentCameraPhase}</option>
                  </select>
                </label>
              ) : null}
              {rehearsalIsolated ? (
                <span className="service-broadcast-audio-isolation" role="status">
                  Desk isolated · rehearsal stays in-room
                </span>
              ) : null}
              <span className="service-broadcast-timing-summary">
                Fade {(settings.camera_fade_ms / 1000).toFixed(1)}s · slides +{(settings.slide_delay_ms / 1000).toFixed(1)}s
              </span>
              {([ ["camera_fade_ms", "Camera fade"], ["slide_delay_ms", "Slide delay"] ] as const).map(([field, label]) => <label key={field}>{label} (seconds)<input type="number" min={0} max={10} step={0.1} disabled={controlBusy} value={settings[field] / 1000} onChange={event => void updateLiveControls({[field]: Math.max(0, Math.min(10000, Number(event.target.value) * 1000))})}/></label>)}
              </div></details>,
                <details key="stream" onToggle={contractOtherBroadcastControls} className="broadcast-control-category"><BroadcastAccordionSummary status={adminRehearsal ? "Rehearsal" : hasLiveBroadcast ? "Live" : "Offline"}>Stream status</BroadcastAccordionSummary><div className="broadcast-control-fields">
                <label>Camera &amp; audio feed<select aria-label="Manual broadcast audience" disabled={controlBusy} value={settings.manual_live_audience} onChange={event => void updateLiveControls({manual_live_audience: event.target.value as BroadcastViewerSettings["manual_live_audience"]})}><option value="off">Follow presenter</option><option value="admins">Admin test</option><option value="public">Live for everyone</option></select></label>
                <span>The presenter also starts the stream automatically.</span>
              </div></details>
              ].sort((a, b) => Number(b.key === "service-cameras" && cameraAlerts.requests.length > 0) - Number(a.key === "service-cameras" && cameraAlerts.requests.length > 0))}
              {onOpenSettings ? (
                <button className="text-button icon-text-button" onClick={onOpenSettings} type="button">
                  <Settings2 size={14} aria-hidden="true" /> Configure
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

    </section>
  );
}
