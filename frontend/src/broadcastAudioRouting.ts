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
  return sources.find((source) => source.id === liveAudioSource)?.role === "media";
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
  if (audioSources.some((source) => source.id === liveAudioSource)) {
    if (liveAudioStreamName) return go2RtcAudioStreamUrl(liveAudioStreamName);
    // Compatibility relay when the shared camera gateway is unavailable.
    return `${broadcastLiveAudioMseUrl()}?sources=${encodeURIComponent(JSON.stringify([liveAudioSource]))}`;
  }

  const camera = cameraSources.find((source) => source.id === liveAudioSource);
  return camera ? cameraAudioUrl(camera.url) : null;
}
