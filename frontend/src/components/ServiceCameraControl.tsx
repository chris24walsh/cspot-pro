import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, CameraOff, Minimize2, ScanEye, X } from "lucide-react";
import { contributionRequest } from "../remoteContribution";
import { RemoteGuest } from "./RemoteGuest";

type DeviceSession = { id: string; token: string };

export function ServiceCameraControl() {
  const [session, setSession] = useState<DeviceSession | null>(null);
  const [previewOpen, setPreviewOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const current = useRef<DeviceSession | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const previous = current.current; current.current = null;
      if (previous) void contributionRequest(`/self/${previous.id}`, "DELETE").catch(() => {});
    };
  }, []);
  async function stop() {
    const previous = current.current;
    current.current = null; setSession(null);
    if (!previous) return;
    setBusy(true); setError("");
    try { await contributionRequest(`/self/${previous.id}`, "DELETE"); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not end the camera connection"); }
    finally { if (mounted.current) setBusy(false); }
  }
  async function start() {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const next = await contributionRequest<DeviceSession>("/self", "POST");
      if (!mounted.current) { await contributionRequest(`/self/${next.id}`, "DELETE"); return; }
      current.current = next; setPreviewOpen(true); setSession(next);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "Could not enable camera and microphone"); }
    finally { if (mounted.current) setBusy(false); }
  }
  return <>
    <button type="button" className="secondary-button icon-text-button" aria-label={session ? "Stop camera and microphone" : "Enable camera and microphone"} aria-pressed={Boolean(session)} title={session ? "Stop camera and microphone" : "Enable camera and microphone"} disabled={busy} onClick={() => void (session ? stop() : start())}>
      {session ? <CameraOff size={16} aria-hidden="true" /> : <Camera size={16} aria-hidden="true" />}<span>{session ? "Stop camera & mic" : "Camera & mic"}</span>
    </button>
    {session && !previewOpen && <button type="button" className="secondary-button icon-button" aria-label="Show camera controls" title="Show camera controls" onClick={() => setPreviewOpen(true)}><ScanEye size={16} aria-hidden="true" /></button>}
    {error && <span className="form-message" role="alert">{error}</span>}
    {session && createPortal(<aside hidden={!previewOpen} className="service-camera-panel" aria-label="Your service camera and microphone">
      <header><strong>Your camera & mic</strong><button type="button" className="icon-button" aria-label="Hide camera controls" title="Hide camera controls — keep streaming" onClick={() => setPreviewOpen(false)}><Minimize2 size={17} aria-hidden="true" /></button><button type="button" className="icon-button" aria-label="Stop camera and microphone" title="Stop camera and microphone" onClick={() => void stop()}><X size={17} /></button></header>
      <p>Use headphones. The broadcast operator chooses when to put you on air.</p>
      <RemoteGuest key={session.id} token={session.token} embedded autoJoin onLeave={() => void stop()} />
    </aside>, document.body)}
  </>;
}
