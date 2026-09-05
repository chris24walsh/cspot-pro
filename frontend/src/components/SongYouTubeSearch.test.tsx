// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { searchYouTubeVideos } from "../api";
import { SongYouTubeSearch } from "./SongYouTubeSearch";

vi.mock("../api", () => ({ searchYouTubeVideos: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); vi.useRealTimers(); vi.resetAllMocks(); });

it("previews search results in-page and only assigns the video when chosen", async () => {
  vi.useFakeTimers();
  vi.mocked(searchYouTubeVideos).mockResolvedValue({ items: [{ id: "dQw4w9WgXcQ", title: "Song recording", channel_title: "Choir", thumbnail_url: null }], next_page_token: null });
  const container = document.createElement("div");
  const root = createRoot(container);
  cleanups.push(() => act(() => root.unmount()));
  const onSelect = vi.fn();
  await act(async () => root.render(<SongYouTubeSearch initialQuery="Amazing Grace" value={null} canEdit onSelect={onSelect} onClose={() => {}} />));
  await act(async () => vi.advanceTimersByTimeAsync(350));
  expect(searchYouTubeVideos).toHaveBeenCalledWith("Amazing Grace");
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Preview Song recording"]')!.click());
  expect(container.querySelector("iframe")?.src).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
  expect(onSelect).not.toHaveBeenCalled();
  act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Use this video")!.click());
  expect(onSelect).toHaveBeenCalledWith("dQw4w9WgXcQ");
  act(() => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Close preview")!.click());
  expect(container.querySelector("iframe")).toBeNull();
});

it("supports pasted links without a search request and prevents read-only selection", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  cleanups.push(() => act(() => root.unmount()));
  const onSelect = vi.fn();
  await act(async () => root.render(<SongYouTubeSearch initialQuery="https://youtu.be/dQw4w9WgXcQ" value={null} canEdit={false} onSelect={onSelect} onClose={() => {}} />));
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Preview YouTube video"]')!.click());
  const choose = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Use this video")!;
  expect(choose.disabled).toBe(true);
  expect(searchYouTubeVideos).not.toHaveBeenCalled();
});
