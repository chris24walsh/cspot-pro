import { afterEach, expect, it, vi } from "vitest";
import { switchRemoteCamera } from "./switchRemoteCamera";

const track = (kind = "video") => ({ kind, enabled: true, stop: vi.fn() });
function capture() {
  const video = track();
  return { video, stream: { getVideoTracks: () => [video], getTracks: () => [video] } };
}
function connection() {
  const audio = track("audio"), video = track();
  let members = [audio, video];
  const sender = { track: video, replaceTrack: vi.fn<[typeof video], Promise<void>>(async next => { sender.track = next; }) };
  const stream = {
    getVideoTracks: () => members.filter(t => t.kind === "video"),
    getAudioTracks: () => members.filter(t => t.kind === "audio"),
    removeTrack: (old: typeof video) => { members = members.filter(t => t !== old); },
    addTrack: (next: typeof video) => { members.push(next); },
  };
  return { audio, video, stream, sender, peer: { getSenders: () => [sender] } };
}
function switchFrom(current: ReturnType<typeof connection>, extra = {}) {
  return switchRemoteCamera({
    peer: current.peer as unknown as RTCPeerConnection,
    stream: current.stream as unknown as MediaStream,
    from: "user", to: "environment", enabled: () => true, isCurrent: () => true, ...extra,
  });
}
afterEach(() => { vi.unstubAllGlobals(); });
it("restores video and stops the rejected camera when track replacement fails", async () => {
  const current = connection(), rejected = capture(), restored = capture();
  current.sender.replaceTrack.mockRejectedValueOnce(new Error("Negotiation required"));
  const getUserMedia = vi.fn().mockResolvedValueOnce(rejected.stream).mockResolvedValueOnce(restored.stream);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  await expect(switchFrom(current)).rejects.toThrow("previous camera has been restored");
  expect(rejected.video.stop).toHaveBeenCalled();
  expect(current.stream.getVideoTracks()).toEqual([restored.video]);
  expect(current.audio.stop).not.toHaveBeenCalled();
  expect(current.stream.getAudioTracks()).toEqual([current.audio]);
});
it("keeps microphone capture if both cameras fail", async () => {
  const current = connection();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockRejectedValue(new Error("Camera unavailable")) } });
  await expect(switchFrom(current)).rejects.toThrow("microphone connection was kept");
  expect(current.audio.stop).not.toHaveBeenCalled();
  expect(current.sender.replaceTrack).not.toHaveBeenCalled();
});
it("uses the latest camera mute setting for the replacement track", async () => {
  const current = connection(), replacement = capture();
  let enabled = true;
  let resolve!: (value: typeof replacement.stream) => void;
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise<typeof replacement.stream>(r => { resolve = r; }) } });
  const changing = switchFrom(current, { enabled: () => enabled });
  enabled = false;
  resolve(replacement.stream);
  await expect(changing).resolves.toBe("environment");
  expect(replacement.video.enabled).toBe(false);
  expect(current.audio.stop).not.toHaveBeenCalled();
});
it("releases a replacement if the page closes while replaceTrack is pending", async () => {
  const current = connection(), replacement = capture();
  let valid = true;
  let finish!: () => void;
  let started!: () => void;
  const attaching = new Promise<void>(resolve => { started = resolve; });
  current.sender.replaceTrack.mockImplementation(() => { started(); return new Promise<void>(r => { finish = r; }); });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValue(replacement.stream) } });
  const changing = switchFrom(current, { isCurrent: () => valid });
  await attaching;
  valid = false; finish();
  await expect(changing).resolves.toBeNull();
  expect(replacement.video.stop).toHaveBeenCalled();
  expect(current.stream.getVideoTracks()).toEqual([current.video]);
});
it("prepares camera privacy effects before transmission and restores the old camera if preparation fails", async () => {
  const current = connection(), rejected = capture(), restored = capture();
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: vi.fn().mockResolvedValueOnce(rejected.stream).mockResolvedValueOnce(restored.stream) } });
  const prepareTrack = vi.fn().mockRejectedValueOnce(new Error("Blur unsupported")).mockResolvedValueOnce(undefined);
  await expect(switchFrom(current, { prepareTrack })).rejects.toThrow("previous camera has been restored");
  expect(rejected.video.stop).toHaveBeenCalled();
  expect(current.sender.replaceTrack).toHaveBeenCalledTimes(1);
  expect(current.sender.replaceTrack).toHaveBeenCalledWith(restored.video);
  expect(prepareTrack).toHaveBeenCalledWith(restored.video);
  expect(current.audio.stop).not.toHaveBeenCalled();
});
