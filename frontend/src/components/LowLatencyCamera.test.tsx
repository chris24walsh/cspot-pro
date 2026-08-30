// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveStreamAudio } from "./LowLatencyCamera";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LiveStreamAudio", () => {
  it("turns fallback stream sound on and back off across two clicks", async () => {
    vi.stubGlobal("MediaSource", undefined);
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const onSoundEnabledChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });

    await act(async () => {
      root.render(
        <LiveStreamAudio
          label="Live service audio"
          onSoundEnabledChange={onSoundEnabledChange}
          url="/camera/audio.mp3"
        />,
      );
    });

    const audio = container.querySelector("audio");
    const turnOnButton = container.querySelector<HTMLButtonElement>('button[aria-label="Turn on sound"]');
    expect(audio).not.toBeNull();
    expect(turnOnButton).not.toBeNull();
    expect(audio!.muted).toBe(true);
    expect(turnOnButton!.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      turnOnButton!.click();
      await Promise.resolve();
    });

    const muteButton = container.querySelector<HTMLButtonElement>('button[aria-label="Mute sound"]');
    expect(play).toHaveBeenCalledOnce();
    expect(audio!.muted).toBe(false);
    expect(muteButton).not.toBeNull();
    expect(muteButton!.getAttribute("aria-pressed")).toBe("true");
    expect(onSoundEnabledChange).toHaveBeenLastCalledWith(true);

    act(() => muteButton!.click());

    expect(audio!.muted).toBe(true);
    expect(container.querySelector('button[aria-label="Turn on sound"]')).not.toBeNull();
    expect(onSoundEnabledChange.mock.calls).toEqual([[true], [false]]);
  });
});
