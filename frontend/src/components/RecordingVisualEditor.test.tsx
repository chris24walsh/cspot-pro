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

it("inserts consecutive passages at the playhead without losing later visuals", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(getBibleVersions).mockResolvedValue([{ id: "v", code: "KJV", name: "King James", language: "en", license: null }]);
  vi.mocked(getFiles).mockResolvedValue([]);
  vi.mocked(searchBible).mockResolvedValue([{ version: "KJV", reference: "John 1:1", text: "In the beginning", book: "John", chapter: 1, verse_from: 1, verse_to: 1 }]);
  const recording = { id: "rec", duration_seconds: 90, timeline: [], visual_segments: [{ id: "later", kind: "background", start_seconds: 70, end_seconds: 80 }] } as unknown as BroadcastRecording;
  vi.mocked(saveRecordingVisuals).mockResolvedValue(recording);
  const host = document.createElement("div"), root = createRoot(host);
  const render = (time: number) => root.render(<RecordingVisualEditor recording={recording} currentTime={time} onCancel={() => {}} onSaved={() => {}} />);
  await act(async () => render(10));
  async function click(label: string) { await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith(label))!.click(); }); }
  async function passage() {
    const input = [...host.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Passage or keywords"))!.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "John 1:1"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("Search"); await click("John 1:1"); await click("Add visual");
  }
  await passage(); await act(async () => render(30)); await passage(); await click("Save changes");
  expect(saveRecordingVisuals).toHaveBeenLastCalledWith("rec", [
    expect.objectContaining({ kind: "bible", start_seconds: 10, end_seconds: 30 }),
    expect.objectContaining({ kind: "bible", start_seconds: 30, end_seconds: 70 }),
    expect.objectContaining({ id: "later", start_seconds: 70, end_seconds: 80 }),
  ]);
  await act(async () => root.unmount()); vi.unstubAllGlobals();
});

it("honors a manually entered start when selecting a passage and caps its end", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(getBibleVersions).mockResolvedValue([{ id: "v", code: "KJV", name: "King James", language: "en", license: null }]);
  vi.mocked(getFiles).mockResolvedValue([]);
  vi.mocked(searchBible).mockResolvedValue([{ version: "KJV", reference: "John 1:1", text: "In the beginning", book: "John", chapter: 1, verse_from: 1, verse_to: 1 }]);
  const recording = { id: "rec", duration_seconds: 90, timeline: [], visual_segments: [{ id: "later", kind: "background", start_seconds: 50, end_seconds: 70 }] } as unknown as BroadcastRecording;
  vi.mocked(saveRecordingVisuals).mockResolvedValue(recording);
  const host = document.createElement("div"), root = createRoot(host);
  await act(async () => root.render(<RecordingVisualEditor recording={recording} currentTime={10} onCancel={() => {}} onSaved={() => {}} />));
  async function enter(label: string, value: string) {
    const input = [...host.querySelectorAll("label")].find((item) => item.textContent?.startsWith(label))!.querySelector("input")!;
    await act(async () => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); });
  }
  async function click(label: string) { await act(async () => { [...host.querySelectorAll("button")].find((button) => button.textContent?.startsWith(label))!.click(); }); }
  await enter("Start (m:ss)", "0:30"); await enter("Passage or keywords", "John 1:1"); await click("Search"); await click("John 1:1"); await click("Add visual"); await click("Save changes");
  expect(saveRecordingVisuals).toHaveBeenLastCalledWith("rec", [expect.objectContaining({ kind: "bible", start_seconds: 30, end_seconds: 50 }), expect.objectContaining({ id: "later" })]);
  await act(async () => root.unmount()); vi.unstubAllGlobals();
});
