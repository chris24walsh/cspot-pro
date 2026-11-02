// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BroadcastViewerSettings } from "./api";
import { completeOffer, contributionRequest, invitationUrl, receiveContribution, withRemoteContribution } from "./remoteContribution";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe("remote contribution playback", () => {
  const base = {
    active_camera_id: "church", camera_cycle_seconds: 30,
    camera_sources: [{ id: "church", label: "Church", url: "/church.m3u8" }],
    audio_sources: [{ id: "desk", label: "Desk", url: "http://private/desk", stream_name: "desk" }],
    live_audio_source: "desk",
    remote_contribution: { id: "remote", label: "Pastor", stream_name: "cspot-guest-remote" },
  } as BroadcastViewerSettings;
  it("uses only the on-air remote video and audio without changing saved settings", () => {
    const result = withRemoteContribution(base);
    expect(result.active_camera_id).toBe("guest-camera-remote");
    expect(result.camera_cycle_seconds).toBe(0);
    expect(result.camera_sources).toHaveLength(1);
    expect(result.audio_sources).toHaveLength(1);
    expect(result.live_audio_source).toBe("guest-audio-remote");
    expect(result.live_audio_stream_name).toBe("cspot-guest-remote");
    expect(base.active_camera_id).toBe("church");
    expect(base.audio_sources[0].id).toBe("desk");
  });
  it("restores the exact church configuration when the remote override disappears", () => {
    const ordinary = { ...base, remote_contribution: null };
    expect(withRemoteContribution(ordinary)).toBe(ordinary);
  });
  it("puts invitation secrets in the fragment rather than a query parameter", () => {
    const url = new URL(invitationUrl("private-token"));
    expect(url.searchParams.get("contribute")).toBe("1");
    expect(url.search).not.toContain("private-token");
    expect(url.hash).toBe("#private-token");
  });
});

describe("remote signaling", () => {
  it("sends guest authorization only in headers and omits church cookies", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: "guest" }) });
    vi.stubGlobal("fetch", fetch);
    await contributionRequest("/guest", "GET", undefined, "private-token");
    expect(fetch.mock.calls[0][0]).not.toContain("private-token");
    expect(fetch.mock.calls[0][1].credentials).toBe("omit");
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer private-token");
  });
  it("reports expired invitations without logging in or redirecting", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({ detail: "Invitation expired" }) }));
    await expect(contributionRequest("/guest", "GET", undefined, "expired")).rejects.toMatchObject({ message: "Invitation expired", status: 401 });
  });
  it("waits for all ICE candidates before publishing", async () => {
    const listeners = new Set<() => void>();
    const peer = {
      createOffer: async () => ({ sdp: "initial-offer" }),
      setLocalDescription: vi.fn(), iceGatheringState: "gathering", signalingState: "stable",
      localDescription: { sdp: "complete-offer-with-relay" },
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    };
    const offer = completeOffer(peer as unknown as RTCPeerConnection);
    await Promise.resolve(); await Promise.resolve();
    peer.iceGatheringState = "complete";
    listeners.forEach(fn => fn());
    expect(await offer).toBe("complete-offer-with-relay");
    expect(listeners.size).toBe(0);
  });
  it("times out gathering instead of sending an offer without relay candidates", async () => {
    vi.useFakeTimers();
    const peer = {
      createOffer: async () => ({}), setLocalDescription: vi.fn(), iceGatheringState: "gathering",
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
    };
    const offer = completeOffer(peer as unknown as RTCPeerConnection);
    const rejection = expect(offer).rejects.toThrow("Connection discovery timed out");
    await vi.advanceTimersByTimeAsync(15001);
    await rejection;
    expect(peer.removeEventListener).toHaveBeenCalled();
  });
  it("closes a failed receive peer and never requests a camera for return audio", async () => {
    const peer = {
      addTransceiver: vi.fn(), close: vi.fn(),
      createOffer: async () => ({}), setLocalDescription: vi.fn(),
      iceGatheringState: "complete", signalingState: "stable", localDescription: { sdp: "offer" },
    };
    vi.stubGlobal("RTCPeerConnection", vi.fn(() => peer));
    vi.stubGlobal("MediaStream", vi.fn());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 409, json: async () => ({ detail: "No church audio" }) }));
    await expect(receiveContribution("/guest/return", [], vi.fn(), "token", false)).rejects.toThrow("No church audio");
    expect(peer.close).toHaveBeenCalled();
    expect(peer.addTransceiver).toHaveBeenCalledTimes(1);
    expect(peer.addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
  });
});
