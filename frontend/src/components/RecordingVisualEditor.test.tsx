// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { getBibleVersions, getFiles, saveRecordingVisuals, searchBible, type BroadcastRecording } from "../api";
import { RecordingVisualEditor } from "./RecordingVisualEditor";
vi.mock("../api", async (original) => ({ ...await original<typeof import("../api")>(), getBibleVersions: vi.fn(), getFiles: vi.fn(), saveRecordingVisuals: vi.fn(), searchBible: vi.fn() }));
it("saves a background segment even when library resources are unavailable", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(getBibleVersions).mockRejectedValue(new Error("Forbidden"));
  vi.mocked(getFiles).mockRejectedValue(new Error("Forbidden"));
  const recording = { id: "rec", duration_seconds: 90, timeline: [], visual_segments: [] } as unknown as BroadcastRecording;
  vi.mocked(saveRecordingVisuals).mockResolvedValue(recording);
  const saved = vi.fn();
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<RecordingVisualEditor recording={recording} currentTime={30} onCancel={() => {}} onSaved={saved} />));
  const type = host.querySelector("select")!;
  await act(async () => { type.value = "background"; type.dispatchEvent(new Event("change", { bubbles: true })); });
  async function click(label: string) { await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent === label)!.click(); }); }
  expect([...host.querySelectorAll("button")].find((button) => button.textContent === "Save changes")!.disabled).toBe(true);
  await click("Add visual"); await click("Save changes");
  expect(saveRecordingVisuals).toHaveBeenCalledWith("rec", [expect.objectContaining({ kind: "background", start_seconds: 30, end_seconds: 90 })]);
  expect(saved).toHaveBeenCalledWith(recording);
  await act(async () => root.unmount()); vi.unstubAllGlobals();
});

it("searches and snapshots the selected Bible passage", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(getBibleVersions).mockResolvedValue([{ id: "v", code: "KJV", name: "King James", language: "en", license: null }]);
  vi.mocked(getFiles).mockResolvedValue([]);
  vi.mocked(searchBible).mockResolvedValue([{ version: "KJV", reference: "John 1:1", text: "In the beginning", book: "John", chapter: 1, verse_from: 1, verse_to: 1 }]);
  const recording = { id: "rec", duration_seconds: 90, timeline: [], visual_segments: [] } as unknown as BroadcastRecording;
  vi.mocked(saveRecordingVisuals).mockResolvedValue(recording);
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<RecordingVisualEditor recording={recording} currentTime={30} onCancel={() => {}} onSaved={() => {}} />));
  const query = [...host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Passage or keywords"))!.querySelector("input")!;
  await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(query, "John 1:1"); query.dispatchEvent(new Event("input", { bubbles: true })); });
  async function click(label: string) { await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith(label))!.click(); }); }
  await click("Search"); await click("John 1:1"); await click("Add visual"); await click("Save changes");
  expect(searchBible).toHaveBeenCalledWith(expect.objectContaining({ q: "John 1:1", version_code: "KJV" }));
  expect(saveRecordingVisuals).toHaveBeenCalledWith("rec", [expect.objectContaining({ kind: "bible", title: "John 1:1 (KJV)", text: "In the beginning" })]);
  await act(async () => root.unmount()); vi.unstubAllGlobals();
});
