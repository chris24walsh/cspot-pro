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
  it("returns to the main view between exact two-second B-roll inserts", () => {
    const sources = [
      { id: "front", label: "Front", url: "one" },
      { id: "ptz", label: "Room", url: "two", b_roll: true, dwell_seconds: 2 },
      { id: "close", label: "Close-up", url: "one", b_roll: true, dwell_seconds: 2 },
    ];
    const start = "2026-10-07T10:00:00Z";
    const samples = Array.from({ length: 1200 }, (_, tick) => activeCameraIdAt(sources, "front", 30, start, Date.parse(start) + tick * 100));
    const runs = samples.reduce<{ id: string | null; count: number }[]>((result, id) => {
      const last = result[result.length - 1];
      if (last?.id === id) last.count += 1;
      else result.push({ id, count: 1 });
      return result;
    }, []);
    expect(runs.filter((run) => run.id !== "front").length).toBeGreaterThan(1);
    runs.slice(0, -1).forEach((run, index) => {
      if (run.id !== "front") {
        expect(run.count).toBe(20);
        expect(runs[index - 1].id).toBe("front");
        expect(runs[index + 1].id).toBe("front");
      }
    });
    expect(activeCameraIdAt(sources, "front", 0, start, Date.parse(start) + 60000)).toBe("front");
  });
  it("converts a proxied HLS camera into its low-latency websocket", () => {
    const url = "https://cspot.example/app/camera/api/stream.m3u8?src=lectern&video=h264&audio=aac";
    expect(go2RtcSourceName(url)).toBe("lectern");
    expect(go2RtcWebSocketUrl(url)).toBe("wss://cspot.example/app/camera/api/ws?src=lectern");
  });

  it("converts a go2rtc player URL into native video and audio streams", () => {
    const url = "/app/camera/stream.html?src=lectern&mode=mse";
    expect(go2RtcSourceName(url)).toBe("lectern");
    expect(go2RtcWebSocketUrl(url)).toBe("ws://localhost/app/camera/api/ws?src=lectern");
    expect(cameraAudioUrl(url)).toBe("/app/camera/api/stream.m3u8?audio=aac&src=lectern");
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

  it("uses a camera-specific dwell time when one is configured", () => {
    const sources = [
      { id: "wide", label: "Wide", url: "one", dwell_seconds: 60 },
      { id: "side", label: "Side", url: "two", dwell_seconds: 10 },
    ];
    const start = "2026-08-05T10:00:00Z";
    const startedAt = Date.parse(start);
    const samples = Array.from({ length: 3600 }, (_, second) =>
      activeCameraIdAt(sources, "wide", 30, start, startedAt + second * 1000),
    );

    expect(samples.filter((cameraId) => cameraId === "wide").length).toBeGreaterThan(2800);
  });

  it("maps live plan items to camera pacing profiles", () => {
    expect(cameraServicePhase("song", "Cornerstone")).toBe("worship");
    expect(cameraServicePhase("custom", "Prayers of intercession")).toBe("prayer");
    expect(cameraServicePhase("sermon", "Grace")).toBe("sermon");
    expect(cameraServicePhase("custom", "Church notices")).toBe("announcements");
    expect(cameraServicePhase("reading", "John 3")).toBe("general");
  });
});
