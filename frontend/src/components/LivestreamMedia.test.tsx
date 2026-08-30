// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LivestreamMedia } from "./LivestreamMedia";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

function youtubeCommands(calls: ReadonlyArray<readonly unknown[]>) {
  return calls.flatMap(([payload]) => {
    if (typeof payload !== "string") return [];
    const message = JSON.parse(payload) as { event?: string; func?: string };
    return message.event === "command" && message.func ? [message.func] : [];
  });
}

function youtubeCommandMessages(calls: ReadonlyArray<readonly unknown[]>) {
  return calls.flatMap(([payload]) => {
    if (typeof payload !== "string") return [];
    const message = JSON.parse(payload) as { args?: unknown[]; event?: string; func?: string };
    return message.event === "command" ? [message] : [];
  });
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("LivestreamMedia", () => {
  it("keeps file media muted and follows the delayed playback actions without controls", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(10_000);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => root.render(
      <LivestreamMedia action="play" actionAt={8_000} provider="file" title="Notices" url="/media/notices.mp4" />,
    ));

    const video = container.querySelector("video")!;
    expect(video.muted).toBe(true);
    expect(video.controls).toBe(false);
    expect(video.playsInline).toBe(true);
    expect(video.style.pointerEvents).toBe("none");
    expect(play).toHaveBeenCalledOnce();
    expect(video.currentTime).toBeCloseTo(1.75);

    now.mockReturnValue(10_350);
    await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
    expect(video.currentTime).toBeCloseTo(2.1);

    now.mockReturnValue(11_000);
    await act(async () => root.render(
      <LivestreamMedia action="pause" actionAt={9_000} provider="file" title="Notices" url="/media/notices.mp4" />,
    ));
    expect(pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBeCloseTo(1);

    now.mockReturnValue(12_000);
    await act(async () => root.render(
      <LivestreamMedia action="play" actionAt={10_000} provider="file" title="Notices" url="/media/notices.mp4" />,
    ));
    expect(video.currentTime).toBeCloseTo(2.75);

    video.currentTime = 12;
    await act(async () => root.render(
      <LivestreamMedia action="stop" actionAt={12_000} provider="file" title="Notices" url="/media/notices.mp4" />,
    ));
    expect(pause).toHaveBeenCalledTimes(2);
    expect(video.currentTime).toBe(0);
  });

  it("keeps YouTube media muted, non-interactive, and follows delayed playback actions", async () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => root.render(
      <LivestreamMedia
        action="play"
        actionAt={8_000}
        provider="youtube"
        title="Notices"
        url="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1"
      />,
    ));

    const frame = container.querySelector("iframe")!;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);
    await act(async () => frame.dispatchEvent(new Event("load")));

    const src = new URL(frame.src);
    expect(src.searchParams.get("controls")).toBe("0");
    expect(src.searchParams.get("disablekb")).toBe("1");
    expect(src.searchParams.get("fs")).toBe("0");
    expect(src.searchParams.get("mute")).toBe("1");
    expect(frame.tabIndex).toBe(-1);
    expect(frame.style.pointerEvents).toBe("none");
    expect(youtubeCommands(postMessage.mock.calls)).toEqual(expect.arrayContaining(["mute", "playVideo"]));
    expect(youtubeCommandMessages(postMessage.mock.calls)).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: [1.75, true], func: "seekTo" }),
    ]));

    postMessage.mockClear();
    await act(async () => root.render(
      <LivestreamMedia
        action="pause"
        actionAt={9_000}
        provider="youtube"
        title="Notices"
        url="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1"
      />,
    ));
    expect(youtubeCommands(postMessage.mock.calls)).toEqual(expect.arrayContaining(["mute", "pauseVideo"]));
    expect(youtubeCommandMessages(postMessage.mock.calls)).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: [1, true], func: "seekTo" }),
    ]));

    postMessage.mockClear();
    vi.mocked(Date.now).mockReturnValue(12_000);
    await act(async () => root.render(
      <LivestreamMedia
        action="play"
        actionAt={10_000}
        provider="youtube"
        title="Notices"
        url="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?enablejsapi=1"
      />,
    ));
    expect(youtubeCommandMessages(postMessage.mock.calls)).toEqual(expect.arrayContaining([
      expect.objectContaining({ args: [2.75, true], func: "seekTo" }),
    ]));
  });

  it("uses only the remaining presenter fade time before stopping the delayed visual", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => root.render(
      <LivestreamMedia action="fade-stop" actionAt={9_000} provider="file" title="Notices" url="/media/notices.mp4" />,
    ));
    const video = container.querySelector("video")!;
    video.currentTime = 12;

    expect(pause).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1249));
    expect(pause).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(pause).toHaveBeenCalledOnce();
    expect(video.currentTime).toBe(0);
  });
});
