// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRecordingVideoStatus, prepareRecordingVideo, type BroadcastRecording } from "../api";
import { loadRecordingFile, RecordingActions } from "./RecordingActions";

vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  prepareRecordingVideo: vi.fn(),
  getRecordingVideoStatus: vi.fn().mockResolvedValue({ status: "ready" }),
}));

const recording = { id: "recording-1", title: "Sermon", status: "ready", file_name: "sermon.m4a", content_type: "audio/mp4" } as BroadcastRecording;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("recording exports", () => {
  it("prepares a combined video before offering its download", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getRecordingVideoStatus).mockResolvedValue({ status: "idle" });
    vi.mocked(prepareRecordingVideo).mockResolvedValue({ status: "preparing" });
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<RecordingActions recording={recording} />));
      expect(host.textContent).toContain("Prepare video (audio + slides)");
      vi.mocked(getRecordingVideoStatus).mockResolvedValue({ status: "ready" });
      await act(async () => host.querySelector("button")!.click());
      expect(prepareRecordingVideo).toHaveBeenCalledWith(recording.id);
      expect(host.textContent).toContain("Download video");
      expect(host.textContent).toContain("Audio only");
    } finally { await act(async () => root.unmount()); }
  });

  it("fetches authenticated video with both audio and slides", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["video"], { type: "video/mp4" }) });
    vi.stubGlobal("fetch", fetch);
    const file = await loadRecordingFile(recording);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/recordings/recording-1/video"), { credentials: "include", signal: undefined });
    expect([file.name, file.type, file.size]).toEqual(["sermon-with-slides.mp4", "video/mp4", 5]);
  });

  it("rejects failed downloads instead of sharing error responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(loadRecordingFile(recording)).rejects.toThrow("Could not load recording video");
  });

  it("prepares on first click and shares the file on a fresh user click", async () => {
    vi.mocked(getRecordingVideoStatus).mockResolvedValue({ status: "ready" });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: vi.fn().mockReturnValue(true) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["video"], { type: "video/mp4" }) }));
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<RecordingActions recording={recording} />));
      expect(host.querySelector("a")?.download).toBe("sermon-with-slides.mp4");
      await act(async () => host.querySelector("button")!.click());
      expect(share).not.toHaveBeenCalled();
      expect(host.textContent).toContain("Video ready");
      await act(async () => host.querySelector("button")!.click());
      expect(share).toHaveBeenCalledWith({ files: [expect.any(File)], title: "Sermon" });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
