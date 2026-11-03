import { buildAbsoluteApiUrl, type BroadcastViewerSettings } from "./api";
import { appAssetUrl } from "./paths";

export interface RemoteGuest {
  id: string;
  label: string;
  expires_at: string;
  revoked: boolean;
  connected: boolean;
  live: boolean;
  return_source_id: string | null;
}
export interface GuestStatus extends RemoteGuest {
  ice_servers: RTCIceServer[];
  relay_available: boolean;
  return_available: boolean;
  camera_source_id?: string | null;
  cue: { title: string; slide: number; blanked: boolean; item_id: string | null; revision: number } | null;
}
export interface ContributionList {
  guests: RemoteGuest[];
  ice_servers: RTCIceServer[];
  relay_available: boolean;
  gateway_configured: boolean;
  gateway_available: boolean;
}
export class ContributionError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function contributionRequest<T>(path = "", method = "GET", body?: unknown, token?: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
  const response = await fetch(buildAbsoluteApiUrl(`/api/v1/broadcast/contributions${path}`), {
    method, credentials: token ? "omit" : "include", cache: "no-store",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: controller.signal,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new ContributionError(typeof error.detail === "string" ? error.detail : "Could not complete the remote connection", response.status);
  }
  return await response.json() as T;
  } finally { clearTimeout(timeout); }
}
export function invitationUrl(token: string) {
  return new URL(`${appAssetUrl("?contribute=1")}#${encodeURIComponent(token)}`, window.location.origin).href;
}

const ICE_GATHERING_TIMEOUT_MS = 15000;

export async function completeOffer(peer: RTCPeerConnection) {
  await peer.setLocalDescription(await peer.createOffer());
  if (peer.iceGatheringState !== "complete") {
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        peer.removeEventListener("icegatheringstatechange", finished);
        peer.removeEventListener("signalingstatechange", closed);
      };
      const closed = () => {
        if (peer.signalingState === "closed") {
          cleanup(); reject(new Error("Connection was closed"));
        }
      };
      const finished = () => {
        if (peer.iceGatheringState === "complete") { cleanup(); resolve(); }
      };
      const timer = setTimeout(() => {
        cleanup();
        if (peer.signalingState === "closed") {
          reject(new Error("Connection was closed"));
        } else if (/^a=candidate:/m.test(peer.localDescription?.sdp || "")) {
          // A blocked STUN lookup can leave discovery running even though
          // host or server-reflexive addresses are already in the offer.
          // WHIP/WHEP can try those addresses without waiting for every lookup.
          resolve();
        } else {
          reject(new Error("Connection discovery found no network addresses. Try another network or check that your browser allows camera calls."));
        }
      }, ICE_GATHERING_TIMEOUT_MS);
      peer.addEventListener("icegatheringstatechange", finished);
      peer.addEventListener("signalingstatechange", closed);
      closed();
      finished();
    });
  }
  if (peer.signalingState === "closed") throw new Error("Connection was closed");
  return peer.localDescription!.sdp;
}

export async function receiveContribution(
  path: string, iceServers: RTCIceServer[], onStream: (stream: MediaStream) => void,
  token?: string, video = true,
) {
  const peer = new RTCPeerConnection({ iceServers });
  const stream = new MediaStream();
  peer.ontrack = event => { stream.addTrack(event.track); onStream(stream); };
  peer.addTransceiver("audio", { direction: "recvonly" });
  if (video) peer.addTransceiver("video", { direction: "recvonly" });
  try {
    const sdp = await completeOffer(peer);
    const answer = await contributionRequest<{ sdp: string }>(path, "POST", { sdp }, token);
    await peer.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    return peer;
  } catch (error) { peer.close(); throw error; }
}

/** Apply the temporary program source only to viewer playback, never editable settings. */
export function withRemoteContribution(settings: BroadcastViewerSettings): BroadcastViewerSettings {
  const guest = settings.remote_contribution;
  if (!guest) return settings;
  const cameraId = `guest-camera-${guest.id}`;
  const audioId = `guest-audio-${guest.id}`;
  const url = `${appAssetUrl("camera/api/stream.m3u8")}?src=${encodeURIComponent(guest.stream_name)}`;
  return {
    ...settings,
    camera_sources: [{ id: cameraId, label: guest.label, url, zoom: 1, crop_x: 50, crop_y: 50 }],
    active_camera_id: cameraId, camera_cycle_seconds: 0,
    audio_sources: [{ id: audioId, label: guest.label, url: null, stream_name: guest.stream_name, gain_db: 0, mix_enabled: true, role: "other" }],
    live_audio_source: audioId, live_audio_stream_name: guest.stream_name,
  };
}
