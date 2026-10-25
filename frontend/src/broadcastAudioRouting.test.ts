import { describe, expect, it } from "vitest";
import type { BroadcastAudioSource } from "./api";
import { rehearsalDeskIsIsolated, resolveBroadcastLiveAudioUrl } from "./broadcastAudioRouting";
import { go2RtcAudioStreamUrl } from "./broadcastCamera";

const desk: BroadcastAudioSource = {
  gain_db: -12, id: "desk", label: "Desk", mix_enabled: false,
  role: "desk", stream_name: null, url: "https://audio.test/desk",
};
const route = (streamName: string | null, selected = "desk") => resolveBroadcastLiveAudioUrl({
  audioSources: [desk], cameraSources: [], liveAudioSource: selected, liveAudioStreamName: streamName,
});
describe("program audio routing", () => {
  it("bypasses the per-viewer FFmpeg relay using the shared gateway", () => {
    expect(route("opaque-program")).toBe(go2RtcAudioStreamUrl("opaque-program"));
  });
  it("retains a single-feed relay when no gateway is configured", () => {
    expect(route(null)).toBe(`/api/v1/broadcast/live-audio.mp4?sources=${encodeURIComponent('["desk"]')}`);
  });
  it("does not resurrect archived mixes or muted audio", () => {
    expect(route(null, "mix")).toBeNull();
    expect(route("opaque-program", "none")).toBeNull();
  });
  it("only identifies an explicitly selected PC media feed as isolated", () => {
    const media = { ...desk, id: "pc", role: "media" as const };
    expect(rehearsalDeskIsIsolated({ sources: [desk, media], liveAudioSource: "desk" })).toBe(false);
    expect(rehearsalDeskIsIsolated({ sources: [desk, media], liveAudioSource: "pc" })).toBe(true);
  });
});
