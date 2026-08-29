import { Maximize2, Radio, Settings2 } from "lucide-react";
import type { CSSProperties } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  broadcastLiveAudioUrl,
  getBroadcastViewerSettings,
  getFileSlides,
  getLivePresentationServices,
  getPlan,
  getPlans,
  getPresentationLiveState,
  getSongs,
  updateBroadcastViewerSettings,
  type BroadcastViewerSettings,
  type PlanDetail,
  type PlanSummary,
  type PresentationLiveService,
  type RenderedSlide,
  type Song,
} from "../api";
import { activeCameraIdAt, cameraAudioUrl, cameraServicePhase, go2RtcAudioStreamUrl } from "../broadcastCamera";
import {
  buildPresentationSlides,
  LCF_BACKGROUND_URL,
  presentationTypeClass,
  resolveLiveIndex,
  suggestedSlideFontCap,
  type PresentationLiveState,
} from "../presentation";
import { isBroadcastStartingSoon } from "../broadcastTiming";
import { isWorshipSetPlan, matchingWorshipSetForService, mergeWorshipSetIntoService } from "../worshipSets";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { AudioMixerPanel } from "./AudioMixerPanel";
import { CountdownSlide } from "./CountdownSlide";
import { PreServiceSlide } from "./PreServiceSlide";
import { PreServiceMusic } from "./PreServiceMusic";
import { LiveStreamAudio, LowLatencyCamera } from "./LowLatencyCamera";
import { ScaledSlideImage } from "./ScaledSlideImage";

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
  const shellRef = useRef<HTMLElement | null>(null);
  const backingAudioFrameRef = useRef<HTMLIFrameElement | null>(null);
  const pollInFlightRef = useRef(false);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
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
  const lastCameraCycleSecondsRef = useRef(30);

  const slides = useMemo(
    () => buildPresentationSlides(mergeWorshipSetIntoService(plan?.items ?? [], worshipSetPlan?.items ?? []), songs, renderedSlidesByFileId),
    [plan, worshipSetPlan, renderedSlidesByFileId, songs],
  );
  // Blanking is a visual overlay, not the end of the underlying live slide.
  // Keeping the slide selected also keeps its camera/audio routing alive.
  const liveSlide = !liveState ? null : slides[resolveLiveIndex(slides, liveState)] ?? null;
  const ambientMusicStage = liveState?.serviceStage === "pre_service" || liveState?.serviceStage === "post_service";
  const hasLiveBroadcast = Boolean((plan && remoteLiveState) || settings.manual_live_audience !== "off");
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
  const mixedAudioSources = settings.audio_sources.filter((source) => source.mix_enabled);
  const singleMixedAudioStreamName = settings.live_audio_source === "mix" && mixedAudioSources.length === 1
    ? mixedAudioSources[0].stream_name
    : null;
  const rehearsalIsolated = selectedIndependentAudio?.role === "media";
  const useMixedRelay = (settings.live_audio_source === "mix" && !singleMixedAudioStreamName) || Boolean(selectedIndependentAudio);
  const liveAudioUrl = useMixedRelay
    ? broadcastLiveAudioUrl()
    : singleMixedAudioStreamName
    ? go2RtcAudioStreamUrl(singleMixedAudioStreamName)
    : selectedIndependentAudio
    ? (settings.live_audio_stream_name ? go2RtcAudioStreamUrl(settings.live_audio_stream_name) : null) ?? broadcastLiveAudioUrl()
    : selectedAudioCamera
      ? cameraAudioUrl(selectedAudioCamera.url)
      : null;
  const textFontCap = suggestedSlideFontCap(liveSlide);

  useEffect(() => {
    if (settings.camera_cycle_seconds > 0) lastCameraCycleSecondsRef.current = settings.camera_cycle_seconds;
  }, [settings.camera_cycle_seconds]);

  function controlBackingAudio(command: "playVideo" | "pauseVideo" | "stopVideo" | "unMute" | "mute") {
    backingAudioFrameRef.current?.contentWindow?.postMessage(
      JSON.stringify({ event: "command", func: command, args: [] }),
      "*",
    );
  }

  function setLivestreamSound(enabled: boolean) {
    controlBackingAudio(enabled ? "unMute" : "mute");
    if (enabled && liveState?.videoAction === "play") controlBackingAudio("playVideo");
  }

  useEffect(() => {
    if (!liveSlide?.youtubeAudioUrl) return;
    if (liveState?.videoAction === "play") controlBackingAudio("playVideo");
    else if (liveState?.videoAction === "pause") controlBackingAudio("pauseVideo");
    else if (liveState?.videoAction === "stop" || liveState?.videoAction === "fade-stop") controlBackingAudio("stopVideo");
  }, [liveSlide?.youtubeAudioUrl, liveState?.videoAction, liveState?.videoActionAt]);

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

  function putCameraOnAir(cameraId: string) {
    void updateLiveControls({
      active_camera_id: cameraId,
      camera_cycle_started_at: settings.camera_cycle_seconds > 0 ? new Date().toISOString() : settings.camera_cycle_started_at,
    });
  }

  function putAudioOnAir(sourceId: string) {
    void updateLiveControls({ live_audio_source: sourceId });
  }

  function commitAudioMix(
    audioSources: BroadcastViewerSettings["audio_sources"],
    liveAudioSource: string,
  ) {
    return updateLiveControls({ audio_sources: audioSources, live_audio_source: liveAudioSource });
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
            <div className="slide-visual-transition" key={!hasLiveBroadcast ? "offline" : liveState?.blanked ? "blank" : liveSlide?.id ?? "live"}>
            {!hasLiveBroadcast ? (
              <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
            ) : liveState?.blanked ? (
              <div
                className="lcf-background-surface"
                aria-label="LCF background"
                style={{ backgroundImage: `url(${LCF_BACKGROUND_URL})` }}
              />
            ) : !liveSlide ? (
              <HoldingPane message="The livestream is live" startingSoon />
            ) : liveSlide.montageImageUrls && plan ? (
              <PreServiceSlide backgroundImageUrl={LCF_BACKGROUND_URL} imageUrls={liveSlide.montageImageUrls} serviceDate={plan.service_date} timed={liveSlide.itemType === "pre_service"} phase={liveState?.preServicePhase} phaseStartedAt={liveState?.updatedAt} />
            ) : liveSlide.countdownSeconds ? (
              <CountdownSlide durationSeconds={liveSlide.countdownSeconds} startAt={liveState?.updatedAt} />
            ) : liveSlide.backgroundImageUrl ? (
              <div
                className="lcf-background-slide"
                style={{ backgroundImage: `url(${liveSlide.backgroundImageUrl})` }}
                aria-label={liveSlide.title}
              />
            ) : liveSlide.imageUrl ? (
              <ScaledSlideImage alt={liveSlide.title} src={liveSlide.imageUrl} />
            ) : liveSlide.videoUrl ? (
              <div className="stage-video-frame">
                {liveSlide.videoProvider === "file" ? <video controls src={liveSlide.videoUrl} /> : <iframe allow="autoplay; encrypted-media; picture-in-picture" allowFullScreen src={liveSlide.videoUrl} title={liveSlide.title} />}
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
            </div>
          </div>
        </section>

        <section className="service-broadcast-camera-pane" aria-label="Live camera">
          <div className="service-broadcast-camera-visual">
            {hasLiveBroadcast && settings.camera_sources.length ? (
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
                    <LowLatencyCamera label={`${source.label} camera`} url={source.url} />
                    <span className="service-broadcast-camera-label">{source.label}</span>
                  </div>
                ))}
              </div>
            ) : hasLiveBroadcast ? (
              <HoldingPane message="Camera stream is not configured" startingSoon={false} />
            ) : (
              <HoldingPane message={holdingMessage} startingSoon={startingSoon} />
            )}
            {hasLiveBroadcast && liveAudioUrl ? (
              <LiveStreamAudio label={selectedAudioCamera ? `${selectedAudioCamera.label} audio` : selectedIndependentAudio?.label ?? "Live service audio"} onSoundEnabledChange={setLivestreamSound} url={liveAudioUrl} />
            ) : null}
          </div>
          {canControl && settings.audio_sources.length ? (
            <AudioMixerPanel
              activeScene={settings.active_audio_scene}
              automation={settings.audio_scene_automation}
              compact
              disabled={controlBusy}
              liveAudioSource={settings.live_audio_source}
              onChange={(audio_sources) => setSettings((current) => ({ ...current, audio_sources }))}
              onCommit={commitAudioMix}
              onAutomationChange={(audio_scene_automation) => updateLiveControls({ audio_scene_automation })}
              onSceneChange={(active_audio_scene) => updateLiveControls({ active_audio_scene })}
              scenes={settings.audio_scenes}
              sources={settings.audio_sources}
            />
          ) : null}
        </section>
      </div>

      {hasLiveBroadcast && settings.pre_service_audio_url && plan ? (
        <PreServiceMusic
          active={ambientMusicStage}
          continuous={liveState?.serviceStage === "post_service"}
          label={liveState?.serviceStage === "post_service" ? "Post-service music" : "Pre-service music"}
          phase={liveState?.preServicePhase}
          phaseStartedAt={liveState?.updatedAt}
          serviceDate={plan.service_date}
          url={settings.pre_service_audio_url}
        />
      ) : null}

      {hasLiveBroadcast && (canControl || Boolean(liveSlide?.youtubeAudioUrl)) ? (
        <div className={`service-broadcast-viewer-controls ${canControl ? "has-admin-controls" : ""}`}>
          {liveSlide?.youtubeAudioUrl ? (
            <iframe
              allow="autoplay; encrypted-media"
              aria-hidden="true"
              className="youtube-audio-frame"
              onLoad={() => {
                if (liveState?.videoAction === "play") controlBackingAudio("playVideo");
              }}
              ref={backingAudioFrameRef}
              src={liveSlide.youtubeAudioUrl}
              tabIndex={-1}
              title={`${liveSlide.title} livestream backing audio`}
            />
          ) : null}
          {canControl ? (
            <div className="service-broadcast-admin-live-controls" aria-label="Quick livestream controls">
              <label className="service-broadcast-live-select">
                <span><Radio size={13} aria-hidden="true" /> Camera</span>
                <select
                  aria-label="Camera on air"
                  disabled={controlBusy || !settings.camera_sources.length}
                  onChange={(event) => putCameraOnAir(event.target.value)}
                  value={activeCameraId ?? ""}
                >
                  {!settings.camera_sources.length ? <option value="">No cameras</option> : null}
                  {settings.camera_sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                </select>
              </label>
              <label className="service-broadcast-live-select">
                <span>Audio</span>
                <select
                  aria-label="Live audio source"
                  disabled={controlBusy}
                  onChange={(event) => putAudioOnAir(event.target.value)}
                  value={settings.live_audio_source}
                >
                  <option value="none">No audio</option>
                  {settings.audio_sources.some((source) => source.mix_enabled) ? <option value="mix">Source mix</option> : null}
                  {settings.audio_sources.length ? <optgroup label="Independent audio">
                    {settings.audio_sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                  </optgroup> : null}
                  {settings.camera_sources.length ? <optgroup label="Camera audio">
                    {settings.camera_sources.map((source) => <option key={source.id} value={source.id}>{source.label}</option>)}
                  </optgroup> : null}
                </select>
              </label>
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
              {ambientMusicStage || rehearsalIsolated ? (
                <button
                  aria-pressed={!settings.pre_service_room_audio_enabled}
                  className={!settings.pre_service_room_audio_enabled ? "primary-button" : "text-button"}
                  disabled={controlBusy}
                  onClick={() => void updateLiveControls({ pre_service_room_audio_enabled: !settings.pre_service_room_audio_enabled })}
                  title="Mute only the church PC presentation output; livestream audio is unaffected"
                  type="button"
                >
                  PC line-out {settings.pre_service_room_audio_enabled ? "on" : "muted"}
                </button>
              ) : null}
              <span className="service-broadcast-timing-summary">
                Fade {(settings.camera_fade_ms / 1000).toFixed(1)}s · slides +{(settings.slide_delay_ms / 1000).toFixed(1)}s
              </span>
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
