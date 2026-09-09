// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { getPublicRecording } from "../api";
import { PublicRecordingView } from "./PublicRecordingView";

vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  getPublicRecording: vi.fn(),
}));

describe("public recording player", () => {
  it("loads without authentication and follows public slide timing", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getPublicRecording).mockResolvedValue({
      title: "Grace Under Pressure",
      recorded_at: "2026-09-06T10:00:00Z",
      duration_seconds: 120,
      audio_url: "/api/v1/broadcast/public-recordings/token/audio",
      slides: [{ at: 0, image_url: "/first.png" }, { at: 30, image_url: "/second.png" }],
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<PublicRecordingView token="token" />));
      expect(getPublicRecording).toHaveBeenCalledWith("token");
      expect(host.textContent).toContain("Grace Under Pressure");
      expect(host.querySelector("img")?.src).toContain("first.png");
      const audio = host.querySelector("audio")!;
      await act(async () => {
        audio.currentTime = 31;
        audio.dispatchEvent(new Event("timeupdate"));
      });
      expect(host.querySelector("img")?.src).toContain("second.png");
    } finally { await act(async () => root.unmount()); }
  });
});
