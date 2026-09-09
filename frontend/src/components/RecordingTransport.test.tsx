// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type BroadcastRecording, trimBroadcastRecording } from "../api";
import { parseRecordingTime, recordingTime, RecordingTransport } from "./RecordingTransport";

vi.mock("../api", async (original) => ({ ...await original<typeof import("../api")>(), trimBroadcastRecording: vi.fn() }));
const recording = { id: "recording", duration_seconds: 90, status: "ready" } as BroadcastRecording;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function mount(canManage = false) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  const host = document.createElement("div");
  const root = createRoot(host);
  const onTimeChange = vi.fn();
  const onTrimmed = vi.fn();
  await act(async () => root.render(<RecordingTransport recording={recording} canManage={canManage} onTimeChange={onTimeChange} onTrimmed={onTrimmed} />));
  const click = async (label: string) => {
    const button = [...host.querySelectorAll("button")].find((candidate) => candidate.textContent === label)!;
    await act(async () => button.click());
  };
  return { host, click, onTimeChange, onTrimmed, close: async () => act(async () => root.unmount()) };
}

describe("recording transport", () => {
  it("parses exact trim times and rejects invalid seconds", () => {
    expect(parseRecordingTime("65:12.5")).toBe(3912.5);
    expect(parseRecordingTime("1:65")).toBeNaN();
    expect(parseRecordingTime("-1:00")).toBeNaN();
    expect(recordingTime(3912)).toBe("65:12");
  });

  it("clamps 30-second skips and keeps slide time synchronized", async () => {
    const view = await mount();
    try {
      await view.click("−30s");
      expect(view.onTimeChange).toHaveBeenLastCalledWith(0);
      for (let i = 0; i < 4; i++) await view.click("+30s");
      expect(view.host.querySelector("audio")!.currentTime).toBe(90);
      expect(view.onTimeChange).toHaveBeenLastCalledWith(90);
      expect(view.host.textContent).not.toContain("Trim recording");
    } finally { await view.close(); }
  });

  it("previews only the selection and saves marked boundaries as a copy", async () => {
    const copy = { ...recording, id: "copy" };
    vi.mocked(trimBroadcastRecording).mockResolvedValue(copy);
    const view = await mount(true);
    try {
      await view.click("Trim recording");
      await view.click("+30s");
      await view.click("Set start here");
      await view.click("+30s");
      await view.click("Set end here");
      await view.click("Preview selection");
      const audio = view.host.querySelector("audio")!;
      expect(audio.currentTime).toBe(30);
      await act(async () => { audio.currentTime = 61; audio.dispatchEvent(new Event("timeupdate")); });
      expect(audio.currentTime).toBe(60);
      expect(audio.pause).toHaveBeenCalled();
      await view.click("Save trimmed copy");
      expect(trimBroadcastRecording).toHaveBeenCalledWith("recording", 30, 60);
      expect(view.onTrimmed).toHaveBeenCalledWith(copy);
    } finally { await view.close(); }
  });
});
