// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getBibleVersions, getFiles, previewRecordingVisuals, saveRecordingVisuals, type BroadcastRecording } from "../api";
import { SermonRecordingPlayer } from "./SermonRecordingPlayer";
vi.mock("../api", async (original) => ({ ...await original<typeof import("../api")>(), getBibleVersions: vi.fn(), getFiles: vi.fn(), previewRecordingVisuals: vi.fn(), saveRecordingVisuals: vi.fn() }));
it("previews unsaved changes during playback and catches up after a slow frame", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:preview"), revokeObjectURL: vi.fn() }));
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.mocked(getBibleVersions).mockResolvedValue([]); vi.mocked(getFiles).mockResolvedValue([]);
  let resolveFrame!: (value: { blob: Blob; start: number; end: number }) => void;
  vi.mocked(previewRecordingVisuals).mockImplementationOnce(() => new Promise((resolve) => { resolveFrame = resolve; })).mockResolvedValue({ blob: new Blob(), start: 10, end: 91 });
  const recording = { id: "rec", title: "Sermon", file_name: "sermon.mp3", duration_seconds: 90, visual_segments: [], timeline: [{ at: 0, plan_item_id: "s", slide_offset: 0 }] } as unknown as BroadcastRecording;
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<SermonRecordingPlayer recording={recording} canManage onClose={() => {}} />));
  async function click(label: string) { await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent?.trim() === label)!.click(); }); }
  await click("Edit visuals"); expect(pause).toHaveBeenCalled();
  await click("+30s");
  await act(async () => { resolveFrame({ blob: new Blob(), start: 0, end: 10 }); await Promise.resolve(); });
  expect(vi.mocked(previewRecordingVisuals).mock.calls.some((call) => call[2] === 30)).toBe(true);
  const type = [...host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Type"))!.querySelector("select")!;
  await act(async () => { type.value = "background"; type.dispatchEvent(new Event("change", { bubbles: true })); });
  await click("Add & preview from start");
  expect(play).toHaveBeenCalled();
  expect(vi.mocked(previewRecordingVisuals).mock.calls.some((call) => call[1].some((item) => item.kind === "background" && item.start_seconds === 30))).toBe(true);
  expect(saveRecordingVisuals).not.toHaveBeenCalled();
  await act(async () => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals();
});
