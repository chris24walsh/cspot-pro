// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BroadcastRecording } from "../api";
import { loadRecordingFile, RecordingActions } from "./RecordingActions";

const recording = { id: "recording-1", title: "Sermon", status: "ready", file_name: "sermon.m4a", content_type: "audio/mp4" } as BroadcastRecording;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("recording exports", () => {
  it("fetches authenticated audio and preserves its filename and type", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["audio"], { type: "audio/mp4" }) });
    vi.stubGlobal("fetch", fetch);
    const file = await loadRecordingFile(recording);
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/recordings/recording-1/audio"), { credentials: "include", signal: undefined });
    expect([file.name, file.type, file.size]).toEqual(["sermon.m4a", "audio/mp4", 5]);
  });

  it("rejects failed downloads instead of sharing error responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(loadRecordingFile(recording)).rejects.toThrow("Could not load recording");
  });

  it("prepares on first click and shares the file on a fresh user click", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const share = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { share, canShare: vi.fn().mockReturnValue(true) });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => new Blob(["audio"], { type: "audio/mp4" }) }));
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<RecordingActions recording={recording} />));
      expect(host.querySelector("a")?.download).toBe("sermon.m4a");
      await act(async () => host.querySelector("button")!.click());
      expect(share).not.toHaveBeenCalled();
      expect(host.textContent).toContain("Audio ready");
      await act(async () => host.querySelector("button")!.click());
      expect(share).toHaveBeenCalledWith({ files: [expect.any(File)], title: "Sermon" });
    } finally {
      await act(async () => root.unmount());
    }
  });
});
