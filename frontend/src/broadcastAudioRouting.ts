import { broadcastLiveAudioMseUrl, type BroadcastAudioSource, type BroadcastCameraSource } from "./api";
import { cameraAudioUrl, go2RtcAudioStreamUrl } from "./broadcastCamera";

interface BroadcastAudioRouteState {
  liveAudioSource: string;
  sources: BroadcastAudioSource[];
}

function liveRouteHasRole({
  liveAudioSource,
  sources,
}: BroadcastAudioRouteState, roles: ReadonlySet<BroadcastAudioSource["role"]>) {
  const selectedSource = sources.find((source) => source.id === liveAudioSource);
  if (selectedSource) return roles.has(selectedSource.role);
  return liveAudioSource === "mix" && sources.some((source) => source.mix_enabled && roles.has(source.role));
}

export function programAudioUsesLiveRoute(route: BroadcastAudioRouteState) {
  return liveRouteHasRole(route, new Set(["desk", "media"]));
}

export function mediaCaptureUsesLiveRoute(route: BroadcastAudioRouteState) {
  return liveRouteHasRole(route, new Set(["media"]));
}

export function viewerAmbientMusicUsesLocalPlayback({
  presentationOutputActive,
  preServiceRoomAudioEnabled,
  ...route
}: BroadcastAudioRouteState & {
  presentationOutputActive: boolean;
  preServiceRoomAudioEnabled: boolean;
}) {
  return !presentationOutputActive
    || !preServiceRoomAudioEnabled
    || !mediaCaptureUsesLiveRoute(route);
}

export function rehearsalDeskIsIsolated({
  liveAudioSource,
  sources,
}: BroadcastAudioRouteState) {
  const selectedSource = sources.find((source) => source.id === liveAudioSource);
  if (selectedSource?.role === "media") return true;
  if (liveAudioSource !== "mix") return false;

  const enabledSources = sources.filter((source) => source.mix_enabled);
  return enabledSources.some((source) => source.role === "media")
    && !enabledSources.some((source) => source.role === "desk" || source.role === "room");
}

export function resolveBroadcastLiveAudioUrl({
  audioSources,
  cameraSources,
  liveAudioSource,
  liveAudioStreamName,
}: {
  audioSources: BroadcastAudioSource[];
  cameraSources: BroadcastCameraSource[];
  liveAudioSource: string;
  liveAudioStreamName: string | null;
}) {
  if (liveAudioSource === "mix") {
    return (liveAudioStreamName ? go2RtcAudioStreamUrl(liveAudioStreamName) : null) ?? broadcastLiveAudioMseUrl();
  }

  if (audioSources.some((source) => source.id === liveAudioSource)) {
    return (liveAudioStreamName ? go2RtcAudioStreamUrl(liveAudioStreamName) : null) ?? broadcastLiveAudioMseUrl();
  }

  const camera = cameraSources.find((source) => source.id === liveAudioSource);
  return camera ? cameraAudioUrl(camera.url) : null;
}
