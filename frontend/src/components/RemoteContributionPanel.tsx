import { useEffect, useRef, useState } from "react";
import { Camera, Headphones, Radio, Square } from "lucide-react";
import { contributionRequest, receiveContribution, type ContributionList, type RemoteGuest } from "../remoteContribution";

function GuestPreview({ guest, iceServers }: { guest: RemoteGuest; iceServers: RTCIceServer[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [monitor, setMonitor] = useState(false);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let peer: RTCPeerConnection | null = null;
    setError("");
    void receiveContribution(`/${guest.id}/preview`, iceServers, stream => {
      if (!cancelled && video.current) video.current.srcObject = stream;
    }).then(pc => {
      if (cancelled) pc.close();
      else { peer = pc; pc.onconnectionstatechange = () => { if (pc.connectionState === "failed") setError("Preview disconnected. Close and reopen the preview to retry."); }; }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; peer?.close(); if (video.current) video.current.srcObject = null; };
    // Keep an open preview across status refreshes and short-lived TURN credentials.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, guest.id]);
  return <div>
    <div className="remote-guest-actions">
      <button type="button" className="secondary-button icon-text-button" disabled={!guest.connected} onClick={() => setOpen(!open)}><Camera size={15} />{open ? "Close preview" : "Preview"}</button>
      {open && <button type="button" className="secondary-button icon-text-button" aria-pressed={monitor} onClick={() => {
        const next = !monitor; setMonitor(next);
        if (video.current) { video.current.muted = !next; if (next) void video.current.play().catch(() => setError("Press Play on the preview to hear audio.")); }
      }}><Headphones size={15} />{monitor ? "Mute monitor" : "Listen"}</button>}
    </div>
    {open && <video ref={video} className="remote-operator-preview" muted={!monitor} autoPlay playsInline controls aria-label={`${guest.label} preview`} />}
    {error && <p role="alert">{error}</p>}
  </div>;
}

export function RemoteContributionPanel() {
  const [data, setData] = useState<ContributionList | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => contributionRequest<ContributionList>().then(next => { if (!cancelled) setData(next); }).catch(error => { if (!cancelled) setMessage(error.message); });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  async function switchCamera(guest: RemoteGuest) {
    setBusy(true);
    try {
      await contributionRequest(`/${guest.id}/on-air`, "POST", {live: !guest.live});
      setData(await contributionRequest<ContributionList>());
      setMessage("");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not switch service camera"); }
    finally { setBusy(false); }
  }
  const cameras = data?.guests.filter(guest => guest.self_managed) ?? [];
  return <section className="remote-contribution-panel" aria-label="Service cameras">
    {message && <p role="alert">{message}</p>}
    {!cameras.length && <p>No service cameras connected. Signed-in users can enable Camera &amp; mic in the Service view.</p>}
    {cameras.map(guest => <article key={guest.id} className="remote-contribution-card">
      <strong>{guest.label}</strong><span>{guest.live ? "On air" : guest.connected ? "Backstage" : "Disconnected"}</span>
      <GuestPreview guest={guest} iceServers={data?.ice_servers ?? []}/>
      <button type="button" className="primary-button icon-text-button" disabled={busy || (!guest.connected && !guest.live)} onClick={() => void switchCamera(guest)}>{guest.live ? <Square size={15}/> : <Radio size={15}/>} {guest.live ? "Take off air" : "Bring on air"}</button>
    </article>)}
  </section>;
}
