// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RemoteGuest } from "./RemoteGuest";

const { request, receive, placeholder, nativeBlur, supportsBlur } = vi.hoisted(() => ({ request: vi.fn(), receive: vi.fn(), placeholder: vi.fn(), nativeBlur: vi.fn(), supportsBlur: vi.fn(() => false) }));
vi.mock("../remoteContribution", () => ({
  contributionRequest: request,
  completeOffer: vi.fn(async () => "offer"),
  receiveContribution: receive,
  ContributionError: class ContributionError extends Error { status = 500; },
}));
vi.mock("../cameraPrivacy", () => ({ cameraOffImage: () => "/images/camera-off.svg", createCameraPlaceholder: placeholder, setNativeBlur: nativeBlur, supportsNativeBlur: supportsBlur }));
vi.mock("./RemoteServiceSlide", () => ({ RemoteServiceSlide: () => <div>Church confidence slide</div> }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let captures: Array<{ audio: { kind: string; enabled: boolean; stop: ReturnType<typeof vi.fn> }; video: { kind: string; enabled: boolean; stop: ReturnType<typeof vi.fn> } }>;
let getUserMedia: ReturnType<typeof vi.fn<[MediaStreamConstraints], Promise<ReturnType<typeof stream>>>>;
type FakeSender = { track: { kind: string }; replaceTrack: ReturnType<typeof vi.fn<[replacement: { kind: string }], Promise<void>>> };
let peers: Array<{ close: ReturnType<typeof vi.fn>; connectionState: string; getSenders: () => FakeSender[] }>;

function stream() {
  const tracks = { audio: { kind: "audio", enabled: true, stop: vi.fn() }, video: { kind: "video", enabled: true, stop: vi.fn() } };
  captures.push(tracks);
  let members = [tracks.audio, tracks.video];
  return {
    getTracks: () => members, getAudioTracks: () => members.filter(t => t.kind === "audio"),
    getVideoTracks: () => members.filter(t => t.kind === "video"),
    removeTrack: (track: typeof tracks.video) => { members = members.filter(t => t !== track); },
    addTrack: (track: typeof tracks.video) => { members.push(track); },
  };
}
function button(text: string) {
  const match = [...host.querySelectorAll("button")].find(b => b.textContent?.includes(text));
  if (!match) throw new Error(`Missing button: ${text}; ${host.textContent}`);
  return match;
}

beforeEach(() => {
  captures = []; peers = [];
  window.location.hash = "invitation-secret";
  request.mockReset(); receive.mockReset(); placeholder.mockReset(); nativeBlur.mockReset(); nativeBlur.mockResolvedValue(undefined); supportsBlur.mockReturnValue(false);
  placeholder.mockImplementation(async () => { const track = { kind: "video", enabled: true, stop: vi.fn() }; return { track, stop: () => track.stop() }; });
  request.mockImplementation(async (path: string) => path === "/guest/publish" ? { sdp: "answer", publisher_session: "device-session" } : {
    id: "guest", label: "Pastor", expires_at: new Date(Date.now() + 3600000).toISOString(),
    live: false, connected: false, ice_servers: [], return_available: false, cue: null,
  });
  getUserMedia = vi.fn<[MediaStreamConstraints], Promise<ReturnType<typeof stream>>>(async constraints => { const captured = stream(); if (constraints.video === false) captured.removeTrack(captured.getVideoTracks()[0]); if (constraints.audio === false) captured.removeTrack(captured.getAudioTracks()[0]); return captured; });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  vi.stubGlobal("RTCRtpSender", { getCapabilities: () => ({ codecs: [] }) });
  vi.stubGlobal("RTCPeerConnection", vi.fn(() => {
    const senders: FakeSender[] = [];
    const peer = { connectionState: "connected", addTrack: vi.fn((track: { kind: string }) => {
      const sender = { track, replaceTrack: vi.fn(async (replacement: { kind: string }) => { sender.track = replacement; }) };
      senders.push(sender); return sender;
    }), getSenders: () => senders, getTransceivers: () => [],
      setRemoteDescription: vi.fn(async () => {}), close: vi.fn(), onconnectionstatechange: null };
    peers.push(peer); return peer;
  }));
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount()); host.remove();
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});

describe("remote tablet capture", () => {
  it("starts with no camera access, sends a picture, and releases camera hardware when turned off", async () => {
    await act(async () => root.render(<RemoteGuest />));
    await act(async () => button("Join with").click());
    expect(getUserMedia.mock.calls[0][0].video).toBe(false);
    expect(host.querySelector('img[alt*="Camera off"]')).not.toBeNull();
    expect(button("Switch camera").disabled).toBe(true);
    supportsBlur.mockReturnValue(true);
    await act(async () => button("Camera on").click());
    expect(host.querySelector('img[alt*="Camera off"]')).toBeNull();
    expect(getUserMedia.mock.calls[1][0]).toMatchObject({ audio: false, video: { facingMode: "user" } });
    const blur = host.querySelector<HTMLInputElement>('.native-blur-toggle input')!;
    await act(async () => blur.click());
    expect(nativeBlur).toHaveBeenCalledWith(captures[1].video, true);
    await act(async () => button("Camera off").click());
    expect(captures[1].video.stop).toHaveBeenCalled();
    expect(captures[0].audio.stop).not.toHaveBeenCalled();
    expect(peers[0].close).not.toHaveBeenCalled();
    expect(request.mock.calls.filter(call => call[0] === "/guest/publish")).toHaveLength(1);
    expect(host.querySelector('img[alt*="Camera off"]')).not.toBeNull();
  });

  it("shows two cameras with muted church video and a volume-only audio control", async () => {
    const close = vi.fn();
    receive.mockImplementation(async (_path, _servers, onStream) => { onStream({ id: "church" }); return { close }; });
    request.mockResolvedValue({ id: "guest", ice_servers: [], return_available: true, camera_source_id: "lectern" });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    await act(async () => root.render(<RemoteGuest token="secret" embedded />));
    const videos = host.querySelectorAll("video");
    expect(videos).toHaveLength(2);
    expect([...host.querySelectorAll("button")].some(button => button.textContent?.includes("Switch camera"))).toBe(false);
    expect(videos[1].muted).toBe(true);
    expect(receive).toHaveBeenCalledWith("/guest/camera", [], expect.any(Function), "secret");
    const audio = host.querySelector("audio")!;
    expect(audio.controls).toBe(false);
    expect(audio.hidden).toBe(true);
    const volume = host.querySelector<HTMLInputElement>('input[aria-label="Church audio volume"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(volume, "0.35");
      volume.dispatchEvent(new Event("input", { bubbles: true }));
      volume.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(audio.volume).toBe(0.35);
    expect(audio.play).toHaveBeenCalled();
    await act(async () => root.render(<div />));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("does not capture devices until the guest explicitly joins, and stops them on Leave", async () => {
    await act(async () => root.render(<RemoteGuest />));
    expect(getUserMedia).not.toHaveBeenCalled();
    await act(async () => button("Join with").click());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(host.textContent).toContain("Connected — waiting for the church operator");
    await act(async () => button("Leave").click());
    expect(captures[0].audio.stop).toHaveBeenCalled();
    expect(getUserMedia.mock.calls[0][0].video).toBe(false);
    expect(peers[0].close).toHaveBeenCalled();
    expect(request).toHaveBeenCalledWith("/guest/leave", "POST", { publisher_session: "device-session" }, "invitation-secret");
  });
  it("uses audio gain for tablet volume controls and closes the audio context on exit", async () => {
    const gain = { gain: { value: 1 }, connect: vi.fn() };
    const context = { createGain: () => gain, createMediaElementSource: vi.fn(() => ({ connect: () => gain })), destination: {}, resume: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    vi.stubGlobal("AudioContext", vi.fn(() => context));
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
    request.mockResolvedValue({ id: "guest", ice_servers: [], return_available: true });
    await act(async () => root.render(<RemoteGuest token="secret" embedded />));
    const volume = host.querySelector<HTMLInputElement>('input[type="range"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(volume, "0.2");
      volume.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(gain.gain.value).toBe(0.2);
    expect(context.resume).toHaveBeenCalled();
    await act(async () => root.render(<div />));
    expect(context.close).toHaveBeenCalledTimes(1);
  });
  it("starts embedded camera capture once after the Service button is clicked", async () => {
    await act(async () => root.render(<StrictMode><RemoteGuest token="account-camera-token" embedded autoJoin /></StrictMode>));
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith("/guest", "GET", undefined, "account-camera-token");
    expect(host.querySelector("main")).toBeNull();
    expect(host.textContent).not.toContain("Invitation expires");
    expect(host.textContent).not.toContain("Church confidence slide");
    expect(document.head.querySelector('meta[name="referrer"]')).toBeNull();
  });
  it("preserves microphone mute when switching cameras", async () => {
    await act(async () => root.render(<RemoteGuest />));
    await act(async () => button("Join with").click());
    await act(async () => button("Camera on").click());
    await act(async () => button("Mute microphone").click());
    expect(captures[0].audio.enabled).toBe(false);
    await act(async () => button("Switch camera").click());
    expect(getUserMedia).toHaveBeenCalledTimes(3);
    expect(captures[1].video.stop).toHaveBeenCalled();
    expect(captures[0].audio.enabled).toBe(false);
    expect(getUserMedia.mock.calls[2][0]).toMatchObject({ audio: false, video: { facingMode: "environment" } });
    expect(captures[0].audio.stop).not.toHaveBeenCalled();
    expect(peers).toHaveLength(1);
    expect(peers[0].close).not.toHaveBeenCalled();
    expect(peers[0].getSenders().find(sender => sender.track.kind === "video")!.replaceTrack).toHaveBeenCalledWith(captures[2].video);
    expect(request.mock.calls.filter(call => call[0] === "/guest/publish")).toHaveLength(1);
  });
  it("restores the original camera if opening the other camera fails", async () => {
    await act(async () => root.render(<RemoteGuest />));
    await act(async () => button("Join with").click());
    await act(async () => button("Camera on").click());
    getUserMedia.mockRejectedValueOnce(new DOMException("Rear camera unavailable", "NotReadableError"));
    await act(async () => button("Switch camera").click());
    expect(captures[0].audio.stop).not.toHaveBeenCalled();
    expect(peers[0].close).not.toHaveBeenCalled();
    expect(getUserMedia.mock.calls[3][0]).toMatchObject({ audio: false, video: { facingMode: "user" } });
    expect(host.textContent).toContain("previous camera has been restored");
    expect(button("Switch camera").disabled).toBe(false);
  });
  it("stops a late camera-switch result when the guest leaves", async () => {
    await act(async () => root.render(<RemoteGuest />));
    await act(async () => button("Join with").click());
    await act(async () => button("Camera on").click());
    let finish!: (value: ReturnType<typeof stream>) => void;
    getUserMedia.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => button("Switch camera").click());
    await act(async () => button("Leave").click());
    const late = stream();
    await act(async () => finish(late));
    expect(captures[2].video.stop).toHaveBeenCalled();
    expect(peers[0].getSenders().find(sender => sender.track.kind === "video")!.replaceTrack).toHaveBeenCalledTimes(1);
  });
  it("stops late camera permission results after the page has closed", async () => {
    let finish!: (value: ReturnType<typeof stream>) => void;
    getUserMedia.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    await act(async () => root.render(<RemoteGuest />));
    await act(async () => button("Join with").click());
    await act(async () => root.unmount());
    const captured = stream();
    await act(async () => finish(captured));
    expect(captures[0].audio.stop).toHaveBeenCalled();
    expect(captures[0].video.stop).toHaveBeenCalled();
    expect(peers).toHaveLength(0);
  });
});
