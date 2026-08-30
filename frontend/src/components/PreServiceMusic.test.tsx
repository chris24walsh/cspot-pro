// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PreServiceMusic } from "./PreServiceMusic";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];
const serviceDate = new Date(2026, 7, 30, 11).toISOString();

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

function youtubeCommands(calls: ReadonlyArray<readonly unknown[]>) {
  return calls.flatMap(([payload]) => {
    if (typeof payload !== "string") return [];
    const message = JSON.parse(payload) as { event?: string; func?: string };
    return message.event === "command" && message.func ? [message.func] : [];
  });
}

function music(outputMuted: boolean) {
  return (
    <PreServiceMusic
      outputMuted={outputMuted}
      phase="montage"
      serviceDate={serviceDate}
      url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    />
  );
}

describe("PreServiceMusic room output", () => {
  it("mutes an enabled YouTube player and restores its prior playback", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => root.render(music(false)));
    const frame = container.querySelector("iframe");
    const enableButton = container.querySelector<HTMLButtonElement>("button");
    expect(frame?.contentWindow).not.toBeNull();
    expect(enableButton?.textContent).toContain("Enable sound");
    const postMessage = vi.spyOn(frame!.contentWindow!, "postMessage").mockImplementation(() => undefined);

    await act(async () => enableButton!.click());
    expect(youtubeCommands(postMessage.mock.calls)).toEqual(expect.arrayContaining(["unMute", "playVideo"]));
    postMessage.mockClear();

    await act(async () => root.render(music(true)));
    expect(youtubeCommands(postMessage.mock.calls)).toContain("mute");
    postMessage.mockClear();

    await act(async () => root.render(music(false)));
    expect(youtubeCommands(postMessage.mock.calls)).toEqual(expect.arrayContaining(["unMute", "playVideo"]));
  });

  it("does not unmute a YouTube player that was never enabled", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => root.render(music(false)));
    const frame = container.querySelector("iframe");
    const postMessage = vi.spyOn(frame!.contentWindow!, "postMessage").mockImplementation(() => undefined);

    await act(async () => root.render(music(true)));
    expect(youtubeCommands(postMessage.mock.calls)).toContain("mute");
    postMessage.mockClear();

    await act(async () => root.render(music(false)));
    expect(youtubeCommands(postMessage.mock.calls)).not.toContain("unMute");
    expect(youtubeCommands(postMessage.mock.calls)).not.toContain("playVideo");
  });

  it("uses the viewer sound preference without rendering a second enable control", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => {
      root.render(
        <PreServiceMusic
          phase="montage"
          serviceDate={serviceDate}
          showSoundControl={false}
          soundEnabled
          url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        />,
      );
    });
    const frame = container.querySelector("iframe");
    expect(frame?.contentWindow).not.toBeNull();
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector(".pre-service-music-control")).toBeNull();
    const postMessage = vi.spyOn(frame!.contentWindow!, "postMessage").mockImplementation(() => undefined);

    await act(async () => frame!.dispatchEvent(new Event("load")));

    expect(youtubeCommands(postMessage.mock.calls)).toEqual(expect.arrayContaining(["unMute", "playVideo"]));
    expect(youtubeCommands(postMessage.mock.calls)).not.toContain("mute");
    postMessage.mockClear();

    await act(async () => {
      root.render(
        <PreServiceMusic
          phase="montage"
          serviceDate={serviceDate}
          showSoundControl={false}
          soundEnabled={false}
          url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
        />,
      );
    });
    expect(youtubeCommands(postMessage.mock.calls)).toContain("mute");
  });
});
