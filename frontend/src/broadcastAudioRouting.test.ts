import { describe, expect, it } from "vitest";

import type { BroadcastAudioSource } from "./api";
import { rehearsalDeskIsIsolated, resolveBroadcastLiveAudioUrl } from "./broadcastAudioRouting";

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

  it("uses the authenticated CSpot relay for a source mix", () => {
    expect(resolveBroadcastLiveAudioUrl({
      audioSources: [source("pc-media", "media", true)],
      cameraSources: [],
      liveAudioSource: "mix",
      liveAudioStreamName: "opaque-media-stream",
    })).toBe("/api/v1/broadcast/live-audio.mp4");
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
    })).toBe("/api/v1/broadcast/live-audio.mp4");
    expect(resolveBroadcastLiveAudioUrl({
      audioSources: [],
      cameraSources: [{ id: "lectern", label: "Lectern", url: "/camera/stream.html?src=lectern&mode=mse" }],
      liveAudioSource: "lectern",
      liveAudioStreamName: null,
    })).toBe("/camera/api/stream.m3u8?audio=aac&src=lectern");
  });
});
