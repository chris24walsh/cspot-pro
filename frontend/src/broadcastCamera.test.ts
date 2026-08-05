import { describe, expect, it } from "vitest";

import { activeCameraIdAt, cameraAudioUrl, go2RtcSourceName, go2RtcWebSocketUrl } from "./broadcastCamera";

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

  it("keeps automatic camera changes synchronized from the saved start time", () => {
    const sources = [
      { id: "lectern", label: "Lectern", url: "one" },
      { id: "ptz", label: "Room", url: "two" },
    ];
    expect(activeCameraIdAt(sources, "lectern", 30, "2026-08-05T10:00:00Z", Date.parse("2026-08-05T10:00:29Z"))).toBe("lectern");
    expect(activeCameraIdAt(sources, "lectern", 30, "2026-08-05T10:00:00Z", Date.parse("2026-08-05T10:00:31Z"))).toBe("ptz");
    expect(activeCameraIdAt(sources, "lectern", 30, "2026-08-05T10:00:00Z", Date.parse("2026-08-05T10:01:01Z"))).toBe("lectern");
  });
});
