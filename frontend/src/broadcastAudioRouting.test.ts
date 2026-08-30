import { describe, expect, it } from "vitest";

import type { BroadcastAudioSource } from "./api";
import { mediaCaptureUsesLiveRoute, programAudioUsesLiveRoute, rehearsalDeskIsIsolated, resolveBroadcastLiveAudioUrl, viewerAmbientMusicUsesLocalPlayback } from "./broadcastAudioRouting";

function source(
  id: string,
  role: BroadcastAudioSource["role"],
  mixEnabled: boolean,
): BroadcastAudioSource {
  return {
    gain_db: 0,
    id,
    label: id,
    mix_enabled: mixEnabled,
    role,
    stream_name: null,
    url: `https://audio.test/${id}`,
  };
}

describe("broadcast audio routing", () => {
  it("recognizes program audio already present in direct and mixed desk/media routes", () => {
    const sources = [source("desk", "desk", true), source("pc-media", "media", true)];

    expect(programAudioUsesLiveRoute({ liveAudioSource: "mix", sources })).toBe(true);
    expect(programAudioUsesLiveRoute({ liveAudioSource: "desk", sources })).toBe(true);
    expect(programAudioUsesLiveRoute({ liveAudioSource: "pc-media", sources })).toBe(true);
    expect(programAudioUsesLiveRoute({
      liveAudioSource: "mix",
      sources: [source("room", "room", true), source("desk", "desk", false), source("pc-media", "media", false)],
    })).toBe(false);
    expect(programAudioUsesLiveRoute({ liveAudioSource: "room", sources: [source("room", "room", true)] })).toBe(false);
  });

  it("detects a media capture without treating a desk-only route as one", () => {
    const sources = [source("desk", "desk", true), source("pc-media", "media", false)];

    expect(mediaCaptureUsesLiveRoute({ liveAudioSource: "pc-media", sources })).toBe(true);
    expect(mediaCaptureUsesLiveRoute({ liveAudioSource: "desk", sources })).toBe(false);
    expect(mediaCaptureUsesLiveRoute({ liveAudioSource: "mix", sources })).toBe(false);
    expect(mediaCaptureUsesLiveRoute({
      liveAudioSource: "mix",
      sources: [source("desk", "desk", false), source("pc-media", "media", true)],
    })).toBe(true);
  });

  it("uses viewer-local ambient music unless enabled room playback is already captured", () => {
    const mediaMix = [source("desk", "desk", false), source("pc-media", "media", true)];

    expect(viewerAmbientMusicUsesLocalPlayback({
      liveAudioSource: "mix",
      presentationOutputActive: true,
      preServiceRoomAudioEnabled: true,
      sources: mediaMix,
    })).toBe(false);
    expect(viewerAmbientMusicUsesLocalPlayback({
      liveAudioSource: "mix",
      presentationOutputActive: true,
      preServiceRoomAudioEnabled: false,
      sources: mediaMix,
    })).toBe(true);
    expect(viewerAmbientMusicUsesLocalPlayback({
      liveAudioSource: "desk",
      presentationOutputActive: true,
      preServiceRoomAudioEnabled: true,
      sources: [source("desk", "desk", true), source("pc-media", "media", false)],
    })).toBe(true);
    expect(viewerAmbientMusicUsesLocalPlayback({
      liveAudioSource: "mix",
      presentationOutputActive: false,
      preServiceRoomAudioEnabled: true,
      sources: mediaMix,
    })).toBe(true);
  });

  it("recognizes both a direct media route and a media-only source mix as desk-isolated", () => {
    expect(rehearsalDeskIsIsolated({
      liveAudioSource: "pc-media",
      sources: [source("desk", "desk", true), source("pc-media", "media", false)],
    })).toBe(true);
    expect(rehearsalDeskIsIsolated({
      liveAudioSource: "mix",
      sources: [source("desk", "desk", false), source("room", "room", false), source("pc-media", "media", true)],
    })).toBe(true);
  });

  it("does not claim isolation while a desk or room feed remains in the source mix", () => {
    expect(rehearsalDeskIsIsolated({
      liveAudioSource: "mix",
      sources: [source("desk", "desk", true), source("pc-media", "media", true)],
    })).toBe(false);
    expect(rehearsalDeskIsIsolated({
      liveAudioSource: "mix",
      sources: [source("room", "room", true), source("pc-media", "media", true)],
    })).toBe(false);
  });

  it("prefers the normalized go2rtc stream for a singleton source mix", () => {
    expect(resolveBroadcastLiveAudioUrl({
      audioSources: [source("pc-media", "media", true)],
      cameraSources: [],
      liveAudioSource: "mix",
      liveAudioStreamName: "opaque-media-stream",
    })).toBe("/camera/api/stream.m3u8?audio=aac&src=opaque-media-stream");
  });

  it("keeps relay fallback and direct camera audio routing", () => {
    expect(resolveBroadcastLiveAudioUrl({
      audioSources: [source("desk", "desk", true), source("room", "room", true)],
      cameraSources: [],
      liveAudioSource: "mix",
      liveAudioStreamName: null,
    })).toBe("/api/v1/broadcast/live-audio.mp4");
    expect(resolveBroadcastLiveAudioUrl({
      audioSources: [source("desk", "desk", false)],
      cameraSources: [],
      liveAudioSource: "desk",
      liveAudioStreamName: "opaque-desk-stream",
    })).toBe("/camera/api/stream.m3u8?audio=aac&src=opaque-desk-stream");
    expect(resolveBroadcastLiveAudioUrl({
      audioSources: [],
      cameraSources: [{ id: "lectern", label: "Lectern", url: "/camera/stream.html?src=lectern&mode=mse" }],
      liveAudioSource: "lectern",
      liveAudioStreamName: null,
    })).toBe("/camera/api/stream.m3u8?audio=aac&src=lectern");
  });
});
