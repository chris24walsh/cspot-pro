export type CameraFacing = "user" | "environment";

export const remoteCameraConstraints = (facingMode: CameraFacing): MediaTrackConstraints => ({
  facingMode, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 24, max: 24 },
});

/** Keep the microphone, return audio and publishing lease while changing video. */
export async function switchRemoteCamera({
  peer, stream, from, to, enabled, isCurrent, prepareTrack,
}: {
  peer: RTCPeerConnection; stream: MediaStream; from: CameraFacing; to: CameraFacing;
  enabled: () => boolean; isCurrent: () => boolean; prepareTrack?: (track: MediaStreamTrack) => Promise<void>;
}): Promise<CameraFacing | null> {
  if (!isCurrent()) return null;
  const sender = peer.getSenders().find(item => item.track?.kind === "video");
  if (!sender) throw new Error("The camera is not connected. Stop camera & mic, then enable it again.");
  const oldTracks = stream.getVideoTracks();
  // Phones may not allow both cameras to be open. Release video only; the
  // microphone and the established WebRTC connection must keep running.
  oldTracks.forEach(track => track.stop());

  async function attach(facing: CameraFacing) {
    const capture = await navigator.mediaDevices.getUserMedia({
      audio: false, video: remoteCameraConstraints(facing),
    });
    let attached = false;
    try {
      if (!isCurrent()) return false;
      const track = capture.getVideoTracks()[0];
      if (!track || track.readyState === "ended") throw new Error("No camera video was available");
      if (prepareTrack) await prepareTrack(track);
      if (!isCurrent()) return false;
      track.enabled = enabled();
      await sender!.replaceTrack(track);
      if (!isCurrent()) return false;
      stream.getVideoTracks().forEach(previous => stream.removeTrack(previous));
      stream.addTrack(track);
      attached = true;
      return true;
    } finally {
      capture.getTracks().forEach(track => {
        if (!attached || track.kind !== "video" || track !== capture.getVideoTracks()[0]) track.stop();
      });
    }
  }

  try {
    if (await attach(to)) return to;
    return null;
  } catch {
    if (!isCurrent()) return null;
    try {
      if (!await attach(from)) return null;
    } catch {
      if (!isCurrent()) return null;
      throw new Error("Neither camera could be opened. Your microphone connection was kept. Try switching again, or stop camera & mic and enable it again.");
    }
    throw new Error("Could not switch cameras. The previous camera has been restored.");
  }
}
