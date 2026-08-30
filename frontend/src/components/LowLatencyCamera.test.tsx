// @vitest-environment jsdom

import { act, useRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LiveStreamAudio } from "./LowLatencyCamera";
import { PreServiceMusic, type PreServiceMusicHandle } from "./PreServiceMusic";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cleanups: Array<() => void> = [];

function installGo2RtcMseSupport() {
  class FakeMediaSource extends EventTarget {
    static isTypeSupported = vi.fn(() => true);
  }
  class FakeWebSocket extends EventTarget {
    binaryType = "";
    close = vi.fn();
    send = vi.fn();
  }
  const BrowserUrl = URL;
  class FakeUrl extends BrowserUrl {
    static createObjectURL = vi.fn(() => "blob:go2rtc-audio");
    static revokeObjectURL = vi.fn();
  }
  vi.stubGlobal("MediaSource", FakeMediaSource);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal("URL", FakeUrl);
  return { FakeUrl };
}

function mp4Box(type: string, payload: number[]) {
  const result = new Uint8Array(8 + payload.length);
  new DataView(result.buffer).setUint32(0, result.byteLength);
  for (let index = 0; index < 4; index += 1) result[4 + index] = type.charCodeAt(index);
  result.set(payload, 8);
  return result;
}

function joinedBytes(...parts: Uint8Array[]) {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function installHttpMseSupport() {
  class FakeSourceBuffer extends EventTarget {
    mode = "segments";
    updating = false;
    buffered = { length: 0, start: vi.fn(), end: vi.fn() };
    appendBuffer = vi.fn(() => queueMicrotask(() => this.dispatchEvent(new Event("updateend"))));
    remove = vi.fn(() => queueMicrotask(() => this.dispatchEvent(new Event("updateend"))));
    abort = vi.fn(() => this.dispatchEvent(new Event("abort")));
  }
  class FakeMediaSource extends EventTarget {
    static instances: FakeMediaSource[] = [];
    static isTypeSupported = vi.fn(() => true);
    readyState = "open";
    sourceBuffer = new FakeSourceBuffer();
    addSourceBuffer = vi.fn(() => this.sourceBuffer);
    setLiveSeekableRange = vi.fn();
    constructor() {
      super();
      FakeMediaSource.instances.push(this);
    }
  }
  const BrowserUrl = URL;
  class FakeUrl extends BrowserUrl {
    static createObjectURL = vi.fn(() => "blob:http-mse-audio");
    static revokeObjectURL = vi.fn();
  }
  let requestSignal: AbortSignal | null = null;
  const bytes = joinedBytes(
    mp4Box("ftyp", [1]),
    mp4Box("moov", [2]),
    mp4Box("moof", [3]),
    mp4Box("mdat", [4]),
  );
  let readCount = 0;
  const fetchMock = vi.fn((_url: string, options: RequestInit) => {
    requestSignal = options.signal as AbortSignal;
    return Promise.resolve({
      body: {
        getReader: () => ({
          read: () => {
            readCount += 1;
            return readCount === 1
              ? Promise.resolve({ done: false, value: bytes })
              : new Promise<never>(() => undefined);
          },
        }),
      },
      ok: true,
      status: 200,
    } as Response);
  });
  vi.stubGlobal("MediaSource", FakeMediaSource);
  vi.stubGlobal("URL", FakeUrl);
  vi.stubGlobal("fetch", fetchMock);
  return { FakeMediaSource, fetchMock, requestSignal: () => requestSignal };
}

function youtubeCommands(calls: ReadonlyArray<readonly unknown[]>) {
  return calls.flatMap(([payload]) => {
    if (typeof payload !== "string") return [];
    const message = JSON.parse(payload) as { event?: string; func?: string };
    return message.event === "command" && message.func ? [message.func] : [];
  });
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("LiveStreamAudio", () => {
  it("fetches authenticated fragmented MP4, appends complete segments, and aborts on unmount", async () => {
    const { FakeMediaSource, fetchMock, requestSignal } = installHttpMseSupport();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<LiveStreamAudio label="Live mix" url="/api/v1/broadcast/live-audio.mp4" />);
    });
    await act(async () => {
      FakeMediaSource.instances[0].dispatchEvent(new Event("sourceopen"));
      await Promise.resolve();
      await Promise.resolve();
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/broadcast/live-audio.mp4",
      expect.objectContaining({ cache: "no-store", credentials: "include" }),
    );
    expect(FakeMediaSource.instances[0].sourceBuffer.appendBuffer).toHaveBeenCalledTimes(2);

    act(() => root.unmount());
    expect(requestSignal()?.aborted).toBe(true);
    container.remove();
  });

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

  it("keeps sound enabled when the live audio URL changes", async () => {
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
      root.render(<LiveStreamAudio label="Live service audio" onSoundEnabledChange={onSoundEnabledChange} url="/audio/desk.mp3" />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Turn on sound"]')!.click();
      await Promise.resolve();
    });
    expect(container.querySelector("audio")!.muted).toBe(false);

    play.mockClear();
    await act(async () => {
      root.render(<LiveStreamAudio label="Live service audio" onSoundEnabledChange={onSoundEnabledChange} url="/audio/media.mp3" />);
      await Promise.resolve();
    });

    const audio = container.querySelector("audio")!;
    expect(audio.getAttribute("src")).toBe("/audio/media.mp3");
    expect(audio.muted).toBe(false);
    expect(play).toHaveBeenCalled();
    expect(container.querySelector('button[aria-label="Mute sound"]')).not.toBeNull();
    expect(onSoundEnabledChange.mock.calls).toEqual([[true]]);
  });

  it("keeps sound enabled when a native stream switches to go2rtc MSE", async () => {
    const { FakeUrl } = installGo2RtcMseSupport();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
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
      root.render(<LiveStreamAudio label="Live service audio" onSoundEnabledChange={onSoundEnabledChange} url="/api/v1/broadcast/live-audio" />);
    });
    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Turn on sound"]')!.click();
      await Promise.resolve();
    });

    await act(async () => {
      root.render(
        <LiveStreamAudio
          label="Live service audio"
          onSoundEnabledChange={onSoundEnabledChange}
          url="/camera/api/stream.m3u8?audio=aac&src=source-mix"
        />,
      );
      await Promise.resolve();
    });

    expect(FakeUrl.createObjectURL).toHaveBeenCalled();
    expect(container.querySelector("audio")!.muted).toBe(false);
    expect(container.querySelector('button[aria-label="Mute sound"]')).not.toBeNull();
    expect(onSoundEnabledChange.mock.calls).toEqual([[true]]);
  });

  it("commands pre-service YouTube sound synchronously from the MSE overlay click", async () => {
    installGo2RtcMseSupport();
    const pendingPlay = new Promise<void>(() => undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => pendingPlay);
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const onSoundEnabledChange = vi.fn();

    function ViewerAudioHarness() {
      const musicRef = useRef<PreServiceMusicHandle | null>(null);
      return (
        <>
          <LiveStreamAudio
            label="Live service audio"
            onSoundEnabledChange={(enabled) => {
              musicRef.current?.setSoundEnabled(enabled);
              onSoundEnabledChange(enabled);
            }}
            url="/camera/api/stream.m3u8?audio=aac&src=source-mix"
          />
          <PreServiceMusic
            phase="montage"
            ref={musicRef}
            serviceDate="2026-08-30T11:00:00.000Z"
            showSoundControl={false}
            soundEnabled={false}
            url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"
          />
        </>
      );
    }

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    await act(async () => root.render(<ViewerAudioHarness />));
    const frame = container.querySelector("iframe")!;
    const postMessage = vi.spyOn(frame.contentWindow!, "postMessage").mockImplementation(() => undefined);

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Turn on sound"]')!.click());

    expect(onSoundEnabledChange).toHaveBeenCalledWith(true);
    expect(youtubeCommands(postMessage.mock.calls)).toEqual(expect.arrayContaining(["unMute", "playVideo"]));
    expect(container.querySelector("audio")!.muted).toBe(false);
  });

  it("reports Retry when live-only playback fails", async () => {
    vi.stubGlobal("MediaSource", undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("bridge down"));
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const onSoundEnabledChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    await act(async () => root.render(<LiveStreamAudio label="Live mix" onSoundEnabledChange={onSoundEnabledChange} url="/api/v1/broadcast/live-audio" />));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Turn on sound"]')!.click();
      await Promise.resolve();
    });

    expect(onSoundEnabledChange.mock.calls).toEqual([[true], [false]]);
    expect(container.querySelector('button[aria-label="Retry sound"]')).not.toBeNull();
  });

  it("keeps global sound enabled for local music when the bridge playback fails", async () => {
    vi.stubGlobal("MediaSource", undefined);
    vi.spyOn(HTMLMediaElement.prototype, "play").mockRejectedValue(new Error("bridge down"));
    vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
    const onSoundEnabledChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    cleanups.push(() => {
      act(() => root.unmount());
      container.remove();
    });
    await act(async () => root.render(
      <LiveStreamAudio
        label="Live mix"
        onSoundEnabledChange={onSoundEnabledChange}
        preserveSoundOnPlaybackFailure
        url="/api/v1/broadcast/live-audio"
      />,
    ));

    await act(async () => {
      container.querySelector<HTMLButtonElement>('button[aria-label="Turn on sound"]')!.click();
      await Promise.resolve();
    });

    expect(onSoundEnabledChange.mock.calls).toEqual([[true]]);
    expect(container.querySelector('button[aria-label="Mute sound"]')).not.toBeNull();
  });
});
