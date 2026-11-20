// @vitest-environment jsdom
import { act, Profiler } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getBroadcastRecordings, getBroadcastViewerSettings, type BroadcastRecording, type BroadcastViewerSettings } from "../api";
import { BroadcastManager } from "./BroadcastManager";

vi.mock("../api", async (original) => ({
  ...await original<typeof import("../api")>(),
  getBroadcastRecordings: vi.fn(),
  getBroadcastViewerSettings: vi.fn(),
}));
vi.mock("./SermonRecordingPlayer", async (original) => ({
  ...await original<typeof import("./SermonRecordingPlayer")>(),
  SermonRecordingPlayer: ({ onClose }: { onClose: () => void }) =>
    <button type="button" onClick={onClose}>Close player</button>,
}));

it("pauses list polling and countdown rerenders during playback, then refreshes on close", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.mocked(getBroadcastViewerSettings).mockResolvedValue({
    camera_sources: [], audio_sources: [], audio_scenes: [], service_schedules: [],
  } as unknown as BroadcastViewerSettings);
  vi.mocked(getBroadcastRecordings).mockResolvedValue([
    { id: "saved", title: "Saved", status: "ready", timeline: [], duration_seconds: 90 },
    { id: "live", title: "Live", status: "recording", timeline: [], pending_stop_at: new Date(Date.now() + 60000).toISOString() },
  ] as unknown as BroadcastRecording[]);
  const host = document.createElement("div");
  const root = createRoot(host);
  const commits = vi.fn();
  try {
    await act(async () => root.render(<Profiler id="manager" onRender={commits}>
      <BroadcastManager activeTab="recordings" canManage={false} onSelectTab={() => {}} />
    </Profiler>));
    expect(getBroadcastRecordings).toHaveBeenCalledTimes(1);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Play sermon"]')!.click());
    const calls = vi.mocked(getBroadcastRecordings).mock.calls.length;
    commits.mockClear();
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(getBroadcastRecordings).toHaveBeenCalledTimes(calls);
    expect(commits).not.toHaveBeenCalled();
    await act(async () => [...host.querySelectorAll("button")].find((button) => button.textContent === "Close player")!.click());
    expect(getBroadcastRecordings).toHaveBeenCalledTimes(calls + 1);
  } finally {
    await act(async () => root.unmount());
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
