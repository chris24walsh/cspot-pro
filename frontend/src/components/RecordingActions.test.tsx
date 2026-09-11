// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getRecordingVideoStatus, prepareRecordingVideo, renameBroadcastRecording, type BroadcastRecording } from "../api";
import { loadRecordingFile, loadRecordingMp3, RecordingActions } from "./RecordingActions";

vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  prepareRecordingVideo: vi.fn(),
  getRecordingVideoStatus: vi.fn().mockResolvedValue({ status: "ready" }),
  renameBroadcastRecording: vi.fn(),
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
      await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Share or download recording']")!.click());
      expect(host.textContent).toContain("Prepare video with slides");
      vi.mocked(getRecordingVideoStatus).mockResolvedValue({ status: "ready" });
      const prepare = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Prepare video"))!;
      await act(async () => prepare.click());
      expect(prepareRecordingVideo).toHaveBeenCalledWith(recording.id);
      expect(host.textContent).toContain("Preparing video");
      expect(host.textContent).toContain("Download MP3");
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

  it("keeps one icon-only row action and opens the combined menu", async () => {
    vi.mocked(getRecordingVideoStatus).mockResolvedValue({ status: "ready" });
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<RecordingActions recording={recording} />));
      expect(host.querySelectorAll("button")).toHaveLength(1);
      expect(host.querySelector("button")?.textContent).toBe("");
      await act(async () => host.querySelector("button")!.click());
      expect(host.textContent).toContain("Download video with slides");
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("closes the combined menu with Escape", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getRecordingVideoStatus).mockResolvedValue({ status: "ready" });
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<RecordingActions recording={recording} />));
      await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Share or download recording']")!.click());
      expect(host.querySelector("[role='dialog']")).not.toBeNull();
      await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
      expect(host.querySelector("[role='dialog']")).toBeNull();
    } finally {
      await act(async () => root.unmount());
    }
  });

  it("rejects an MP3 error response instead of saving it as audio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    await expect(loadRecordingMp3(recording)).rejects.toThrow("Could not prepare the MP3 download");
  });

  it("lets admins rename a recording from the combined menu", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.mocked(getRecordingVideoStatus).mockResolvedValue({ status: "ready" });
    vi.mocked(renameBroadcastRecording).mockResolvedValue({ ...recording, title: "Grace for Today", custom_title: "Grace for Today" });
    const onRecordingChange = vi.fn();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => root.render(<RecordingActions canManage recording={recording} onRecordingChange={onRecordingChange} />));
      await act(async () => host.querySelector<HTMLButtonElement>("[aria-label='Share or download recording']")!.click());
      const input = host.querySelector<HTMLInputElement>("[aria-label='Recording name']")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Grace for Today");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const save = [...host.querySelectorAll("button")].find((button) => button.textContent?.includes("Save name"))!;
      await act(async () => save.click());
      expect(renameBroadcastRecording).toHaveBeenCalledWith(recording.id, "Grace for Today");
      expect(onRecordingChange).toHaveBeenCalledWith(expect.objectContaining({ title: "Grace for Today" }));
    } finally { await act(async () => root.unmount()); }
  });
});
