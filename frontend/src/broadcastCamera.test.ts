import { describe, expect, it } from "vitest";

import {
  activeCameraIdAt,
  cameraAudioUrl,
  cameraServicePhase,
  go2RtcAudioStreamUrl,
  go2RtcSourceName,
  go2RtcWebSocketUrl,
} from "./broadcastCamera";

describe("broadcast camera helpers", () => {
  it("converts a proxied HLS camera into its low-latency websocket", () => {
    const url = "https://cspot.example/app/camera/api/stream.m3u8?src=lectern&video=h264&audio=aac";
    expect(go2RtcSourceName(url)).toBe("lectern");
    expect(go2RtcWebSocketUrl(url)).toBe("wss://cspot.example/app/camera/api/ws?src=lectern");
  });

  it("builds an audio-only camera playlist", () => {
    expect(cameraAudioUrl("/app/camera/api/stream.m3u8?src=ptz&video=h264&audio=aac"))
      .toBe("/app/camera/api/stream.m3u8?audio=aac&src=ptz");
  });

  it("builds a same-origin audio playlist for an opaque go2rtc source name", () => {
    expect(go2RtcAudioStreamUrl("live audio/desk?private"))
      .toBe("/camera/api/stream.m3u8?audio=aac&src=live+audio%2Fdesk%3Fprivate");
    expect(go2RtcAudioStreamUrl("   ")).toBeNull();
  });

  it("keeps seeded automatic camera changes synchronized from the saved start time", () => {
    const sources = [
      { id: "lectern", label: "Lectern", url: "one" },
      { id: "ptz", label: "Room", url: "two" },
    ];
    const start = "2026-08-05T10:00:00Z";
    const startedAt = Date.parse(start);
    const firstViewer = Array.from({ length: 120 }, (_, step) =>
      activeCameraIdAt(sources, "lectern", 30, start, startedAt + step * 5000, "sermon"));
    const secondViewer = Array.from({ length: 120 }, (_, step) =>
      activeCameraIdAt(sources, "lectern", 30, start, startedAt + step * 5000, "sermon"));
    expect(firstViewer).toEqual(secondViewer);
    expect(new Set(firstViewer)).toEqual(new Set(["lectern", "ptz"]));
    const now = Date.parse("2026-08-05T10:07:13Z");
    expect(activeCameraIdAt(sources, "lectern", 0, start, now, "sermon")).toBe("lectern");
  });

  it("gives the lectern more airtime and strengthens that bias for a sermon", () => {
    const sources = [
      { id: "lectern", label: "Lectern", url: "one" },
      { id: "ptz", label: "Room", url: "two" },
    ];
    const start = "2026-08-05T10:00:00Z";
    const startedAt = Date.parse(start);
    function lecternSamples(phase: "worship" | "sermon") {
      return Array.from({ length: 3600 }, (_, second) =>
        activeCameraIdAt(sources, "lectern", 30, start, startedAt + second * 1000, phase),
      ).filter((cameraId) => cameraId === "lectern").length;
    }

    const worshipLecternSamples = lecternSamples("worship");
    const sermonLecternSamples = lecternSamples("sermon");
    expect(worshipLecternSamples).toBeGreaterThan(1800);
    expect(sermonLecternSamples).toBeGreaterThan(worshipLecternSamples);
  });

  it("maps live plan items to camera pacing profiles", () => {
    expect(cameraServicePhase("song", "Cornerstone")).toBe("worship");
    expect(cameraServicePhase("custom", "Prayers of intercession")).toBe("prayer");
    expect(cameraServicePhase("sermon", "Grace")).toBe("sermon");
    expect(cameraServicePhase("custom", "Church notices")).toBe("announcements");
    expect(cameraServicePhase("reading", "John 3")).toBe("general");
  });
});
