import { broadcastLiveAudioMseUrl, type BroadcastAudioSource, type BroadcastCameraSource } from "./api";
import { cameraAudioUrl, go2RtcAudioStreamUrl } from "./broadcastCamera";

interface BroadcastAudioRouteState {
  liveAudioSource: string;
  sources: BroadcastAudioSource[];
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
