import { remoteCameraConstraints, switchRemoteCamera } from "../switchRemoteCamera";
import { useCallback, useEffect, useRef, useState } from "react";
import { RemoteServiceSlide } from "./RemoteServiceSlide";
import { Camera, CameraOff, LogOut, Mic, MicOff, Radio, RefreshCw } from "lucide-react";
import {
  completeOffer, ContributionError, contributionRequest, receiveContribution, type GuestStatus,
} from "../remoteContribution";

export function RemoteGuest({ token: suppliedToken, embedded = false, autoJoin = false, onLeave }: {
  token?: string; embedded?: boolean; autoJoin?: boolean; onLeave?: () => void;
} = {}) {
  const [token] = useState(() => {
    if (suppliedToken !== undefined) return suppliedToken;
    try { return decodeURIComponent(window.location.hash.slice(1)); } catch { return ""; }
  });
  const [status, setStatus] = useState<GuestStatus | null>(null);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState("Not connected");
  const [joining, setJoining] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [joined, setJoined] = useState(false);
  const [mic, setMic] = useState(true);
  const [camera, setCamera] = useState(true);
  const [facing, setFacing] = useState<"user" | "environment">("user");
  const [volume, setVolume] = useState(1);
  const [returnError, setReturnError] = useState("");
  const localVideo = useRef<HTMLVideoElement>(null);
  const returnAudio = useRef<HTMLAudioElement>(null);
  const audioGain = useRef<{ context: AudioContext; gain: GainNode } | null>(null);
  useEffect(() => () => { void audioGain.current?.context.close(); audioGain.current = null; }, []);

  function changeChurchVolume(value: number) {
    setVolume(value);
    const audio = returnAudio.current;
    if (!audio) return;
    // iPad Safari fixes element volume at hardware level. A gain node makes
    // this slider work there as well as on desktop browsers.
    if (!audioGain.current && typeof AudioContext !== "undefined") {
      const context = new AudioContext();
      try {
        const gain = context.createGain();
        context.createMediaElementSource(audio).connect(gain).connect(context.destination);
        audioGain.current = { context, gain };
      } catch { void context.close(); }
    }
    if (audioGain.current) {
      audioGain.current.gain.gain.value = value;
      void audioGain.current.context.resume().catch(() => {});
      audio.volume = 1;
    } else audio.volume = value;
    void audio.play().then(() => setReturnError("")).catch(() => setReturnError("Could not play church audio. Try the volume control again."));
  }
  const localStream = useRef<MediaStream | null>(null);
  const peer = useRef<RTCPeerConnection | null>(null);
  const returnPeer = useRef<RTCPeerConnection | null>(null);
  const publisher = useRef<string | null>(null);
  const wanted = useRef(false);
  const busy = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const micEnabled = useRef(true);
  const cameraEnabled = useRef(true);

  const closePeers = useCallback(() => {
    peer.current?.close(); peer.current = null;
    returnPeer.current?.close(); returnPeer.current = null;
    if (returnAudio.current) returnAudio.current.srcObject = null;
  }, []);

  const leave = useCallback(() => {
    wanted.current = false; generation.current += 1;
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    const session = publisher.current; publisher.current = null;
    closePeers();
    localStream.current?.getTracks().forEach(track => track.stop()); localStream.current = null;
    if (localVideo.current) localVideo.current.srcObject = null;
    if (session) void contributionRequest("/guest/leave", "POST", { publisher_session: session }, token).catch(() => {});
    setJoined(false); setConnection("Not connected");
  }, [closePeers, token]);

  const connect = useCallback(async function connectDevice(direction: "user" | "environment") {
    if (busy.current || !wanted.current) return;
    busy.current = true;
    const run = generation.current;
    setJoining(true); setError(""); setReturnError(""); setConnection("Connecting…");
    closePeers();
    let connectionPeer: RTCPeerConnection | null = null;
    try {
      const current = await contributionRequest<GuestStatus>("/guest", "GET", undefined, token);
      if (!wanted.current || run !== generation.current) return;
      setStatus(current);
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Open this invitation over HTTPS in Safari or Chrome to use your camera and microphone.");
      if (!localStream.current) {
        const capture = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: remoteCameraConstraints(direction),
        });
        if (!wanted.current || run !== generation.current) { capture.getTracks().forEach(t => t.stop()); return; }
        localStream.current = capture;
      }
      localStream.current.getAudioTracks().forEach(track => { track.enabled = micEnabled.current; });
      localStream.current.getVideoTracks().forEach(track => { track.enabled = cameraEnabled.current; });
      if (localVideo.current) localVideo.current.srcObject = localStream.current;
      connectionPeer = new RTCPeerConnection({ iceServers: current.ice_servers });
      peer.current = connectionPeer;
      const pc = connectionPeer;
      localStream.current.getTracks().forEach(track => pc.addTrack(track, localStream.current!));
      // Prefer H.264 so iPads and the church playback pipeline share a codec.
      const codecs = RTCRtpSender.getCapabilities?.("video")?.codecs;
      const videoTransceiver = pc.getTransceivers().find(t => t.sender.track?.kind === "video");
      if (codecs && videoTransceiver?.setCodecPreferences) {
        videoTransceiver.setCodecPreferences([...codecs.filter(c => c.mimeType.toLowerCase() === "video/h264"), ...codecs.filter(c => c.mimeType.toLowerCase() !== "video/h264")]);
      }
      const sdp = await completeOffer(pc);
      const answer = await contributionRequest<{ sdp: string; publisher_session: string }>("/guest/publish", "POST", { sdp }, token);
      if (!wanted.current || run !== generation.current) {
        void contributionRequest("/guest/leave", "POST", { publisher_session: answer.publisher_session }, token).catch(() => {});
        pc.close(); return;
      }
      publisher.current = answer.publisher_session;
      const reportConnection = () => {
        if (peer.current !== pc || !wanted.current) return;
        const good = pc.connectionState === "connected";
        setConnection(good ? "Connected — waiting for the church operator" : `Connection: ${pc.connectionState}`);
        if (good && publisher.current) void contributionRequest("/guest/heartbeat", "POST", {
          publisher_session: publisher.current, connected: true,
        }, token).catch(() => {});
        if (["failed", "disconnected"].includes(pc.connectionState)) {
          if (publisher.current) void contributionRequest("/guest/heartbeat", "POST", { publisher_session: publisher.current, connected: false }, token).catch(() => {});
          if (!reconnectTimer.current) reconnectTimer.current = setTimeout(() => {
            reconnectTimer.current = null;
            if (wanted.current && peer.current === pc && pc.connectionState !== "connected") void connectDevice(direction);
          }, 5000);
        }
      };
      pc.onconnectionstatechange = reportConnection;
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
      setJoined(true);
      reportConnection();
      // Some networks never emit failed promptly; bound the initial handshake.
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        if (wanted.current && peer.current === pc && pc.connectionState !== "connected") void connectDevice(direction);
      }, 20000);
      if (current.return_available) {
        try {
          const returned = await receiveContribution("/guest/return", current.ice_servers, stream => {
            if (returnAudio.current && wanted.current && run === generation.current) {
              returnAudio.current.srcObject = stream;
              void returnAudio.current.play().catch(() => setReturnError("Adjust Church audio volume below to enable sound."));
            }
          }, token, false);
          if (!wanted.current || run !== generation.current) returned.close();
          else returnPeer.current = returned;
        } catch (e) { if (wanted.current) setReturnError(e instanceof Error ? e.message : "Church audio is unavailable. Tap Retry church audio."); }
      }
    } catch (e) {
      connectionPeer?.close();
      if (!alive.current || !wanted.current || run !== generation.current) return;
      setError(e instanceof Error ? e.message : "Could not connect");
      setConnection("Connection interrupted");
      if (e instanceof ContributionError && [401, 409].includes(e.status)) { leave(); return; }
      // Permission errors need a deliberate retry, rather than repeated prompts.
      if (e instanceof DOMException && ["NotAllowedError", "NotFoundError"].includes(e.name)) { wanted.current = false; return; }
      reconnectTimer.current = setTimeout(() => { reconnectTimer.current = null; void connectDevice(direction); }, 8000);
    } finally { busy.current = false; if (alive.current) setJoining(false); }
  }, [closePeers, leave, token]);

  useEffect(() => {
    alive.current = true;
    const meta = document.createElement("meta"); meta.name = "referrer"; meta.content = "no-referrer";
    // Embedded capture has no invitation in its URL. Preserve the Service
    // page's policy so its existing third-party media keeps working.
    if (!embedded) document.head.append(meta);
    const poll = async () => {
      try {
        const next = await contributionRequest<GuestStatus>("/guest", "GET", undefined, token);
        if (alive.current) setStatus(next);
        if (publisher.current && peer.current?.connectionState === "connected") {
          await contributionRequest("/guest/heartbeat", "POST", { publisher_session: publisher.current, connected: true }, token);
        }
      } catch (e) {
        if (!alive.current) return;
        setError(e instanceof Error ? e.message : "Could not contact church");
        if (e instanceof ContributionError && [401, 409].includes(e.status)) leave();
      }
    };
    void poll();
    const interval = setInterval(() => void poll(), 5000);
    const pagehide = () => leave();
    window.addEventListener("pagehide", pagehide);
    return () => { alive.current = false; clearInterval(interval); window.removeEventListener("pagehide", pagehide); meta.remove(); leave(); };
  }, [leave, token, embedded]);

  useEffect(() => {
    if (!autoJoin) return;
    // Deferring one tick makes StrictMode's setup/cleanup pass cancel cleanly.
    const timer = setTimeout(() => { wanted.current = true; void connect("user"); }, 0);
    return () => clearTimeout(timer);
  }, [autoJoin, connect]);

  async function switchCamera() {
    if (busy.current || !wanted.current || !localStream.current || !peer.current) return;
    const pc = peer.current;
    const stream = localStream.current;
    const run = generation.current;
    const isCurrent = () => alive.current && wanted.current && generation.current === run && peer.current === pc && pc.signalingState !== "closed";
    busy.current = true; setSwitching(true); setError("");
    try {
      const selected = await switchRemoteCamera({
        peer: pc, stream, from: facing, to: facing === "user" ? "environment" : "user",
        enabled: () => cameraEnabled.current, isCurrent,
      });
      if (selected && isCurrent()) {
        setFacing(selected);
      }
    } catch (e) {
      if (isCurrent()) setError(e instanceof Error ? e.message : "Could not switch camera");
    } finally {
      busy.current = false;
      if (isCurrent() && localVideo.current) {
        localVideo.current.srcObject = null; localVideo.current.srcObject = stream;
      }
      if (alive.current) setSwitching(false);
    }
  }

  const Container = embedded ? "section" : "main";
  return <Container className={embedded ? "remote-guest-embedded" : "remote-guest-page"}>
    {!embedded && <header><h1>{status?.label || "Join the church service"}</h1>
      <p>Use headphones. Keep this page open and your device powered while contributing.</p></header>}
    <div className={`remote-guest-status ${status?.live ? "is-live" : ""}`} role="status">
      <Radio size={18} aria-hidden="true" /> {status?.live ? "You are LIVE on the church broadcast" : connection}
    </div>
    {error && <p role="alert" className="form-message">{error}</p>}
    <div className="remote-guest-cameras">
      <div><span className="remote-camera-label">Your camera</span><video ref={localVideo} className="remote-guest-video" autoPlay muted playsInline aria-label="Your camera preview" /></div>
      {embedded && <ChurchCamera token={token} sourceId={status?.camera_source_id} iceServers={status?.ice_servers} />}
    </div>
    <div className="remote-guest-actions">
      {!joined ? <button type="button" className="primary-button icon-text-button" disabled={joining || !status} onClick={() => { wanted.current = true; void connect(facing); }}><Camera size={18} />{joining ? "Connecting…" : "Join with camera and microphone"}</button> : <>
        <button type="button" className="secondary-button icon-text-button" aria-pressed={!mic} onClick={() => { const value = !mic; setMic(value); micEnabled.current = value; localStream.current?.getAudioTracks().forEach(t => { t.enabled = value; }); }}>{mic ? <Mic size={18} /> : <MicOff size={18} />}{mic ? "Mute microphone" : "Unmute microphone"}</button>
        <button type="button" className="secondary-button icon-text-button" aria-pressed={!camera} onClick={() => { const value = !camera; setCamera(value); cameraEnabled.current = value; localStream.current?.getVideoTracks().forEach(t => { t.enabled = value; }); }}>{camera ? <Camera size={18} /> : <CameraOff size={18} />}{camera ? "Camera off" : "Camera on"}</button>
        <button type="button" className="secondary-button icon-text-button" disabled={joining || switching} onClick={() => void switchCamera()}><RefreshCw size={18} />{switching ? "Switching…" : "Switch camera"}</button>
        {!embedded && <button type="button" className="secondary-button icon-text-button" onClick={() => { leave(); onLeave?.(); }}><LogOut size={18} />Leave</button>}
      </>}
    </div>
    <section className="remote-guest-return"><h2>Church audio</h2>
      <audio ref={returnAudio} hidden autoPlay aria-label="Church return audio" />
      {status?.return_available && <label className="church-audio-volume">Volume<input type="range" min="0" max="1" step="0.05" value={volume} aria-label="Church audio volume" onChange={event => changeChurchVolume(Number(event.target.value))} /></label>}
      {!status?.return_available && <p>The church operator has not assigned a return audio feed.</p>}
      {returnError && <p role="status">{returnError}</p>}
      {joined && status?.return_available && returnError && <button type="button" className="secondary-button" onClick={() => {
        returnPeer.current?.close(); setReturnError("");
        void receiveContribution("/guest/return", status.ice_servers, stream => {
          if (returnAudio.current) { returnAudio.current.srcObject = stream; void returnAudio.current.play().catch(() => setReturnError("Adjust Church audio volume to enable sound.")); }
        }, token, false).then(pc => { if (wanted.current) returnPeer.current = pc; else pc.close(); }).catch(e => setReturnError(e.message));
      }}>Retry church audio</button>}
    </section>
    {!embedded && <RemoteServiceSlide token={token} cue={status?.cue || null} />}
    {!embedded && <p className="muted">Invitation expires {status ? new Date(status.expires_at).toLocaleString() : "…"}. Only the church operator can put you on air.</p>}
  </Container>;
}

function ChurchCamera({ token, sourceId, iceServers }: { token: string; sourceId?: string | null; iceServers?: RTCIceServer[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const servers = useRef(iceServers); servers.current = iceServers;
  useEffect(() => {
    if (!sourceId) return;
    let active = true;
    let peer: RTCPeerConnection | undefined;
    setError("");
    void receiveContribution("/guest/camera", servers.current || [], stream => {
      if (active && video.current) video.current.srcObject = stream;
    }, token).then(connection => {
      if (active) peer = connection; else connection.close();
    }).catch(reason => { if (active) setError(reason instanceof Error ? reason.message : "Camera unavailable"); });
    return () => { active = false; peer?.close(); if (video.current) video.current.srcObject = null; };
  }, [token, sourceId, retry]);
  return <div className="church-camera-preview"><span className="remote-camera-label">Livestream camera</span>
    <video ref={video} className="remote-guest-video" autoPlay muted playsInline aria-label="Livestream camera preview" />
    {!sourceId && <p>No church camera configured.</p>}
    {error && <p role="status">{error}<button type="button" className="secondary-button" onClick={() => setRetry(value => value + 1)}>Retry camera</button></p>}
  </div>;
}
