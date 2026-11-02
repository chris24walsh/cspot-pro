import { useEffect, useRef, useState } from "react";
import { Camera, Copy, Headphones, Link, Radio, Square, X } from "lucide-react";
import type { BroadcastAudioSource } from "../api";
import { contributionRequest, invitationUrl, receiveContribution, type ContributionList, type RemoteGuest } from "../remoteContribution";

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

export function RemoteContributionPanel({ sources }: { sources: BroadcastAudioSource[] }) {
  const [data, setData] = useState<ContributionList | null>(null);
  const [label, setLabel] = useState("Remote pastor");
  const [hours, setHours] = useState(12);
  const [returnSource, setReturnSource] = useState("");
  const [link, setLink] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => contributionRequest<ContributionList>().then(next => { if (!cancelled) setData(next); }).catch(e => { if (!cancelled) setMessage(e.message); });
    void refresh(); const timer = setInterval(() => void refresh(), 5000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  async function act(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setMessage("");
    try { await action(); setData(await contributionRequest<ContributionList>()); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not update remote contribution"); }
    finally { setBusy(false); }
  }

  return <section className="broadcast-source-settings remote-contribution-panel" aria-label="Remote speakers" onKeyDown={event => { if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault(); }}>
    <h3>Remote speaker</h3>
    <p>Invite a pastor joining from home or while travelling. Preview their camera and microphone, then bring them on air. This replaces broadcast video and audio; it does not start the livestream.</p>
    {data && !data.relay_available && <p className="form-message" role="status">TURN relay is not configured. Some hotel, mobile, and restricted networks may fail to connect.</p>}
    {data && !data.gateway_configured && <p role="alert">Configure the camera gateway before inviting a speaker.</p>}
    {data?.gateway_configured && !data.gateway_available && <p role="alert">The camera gateway’s WebRTC listener is unavailable. An administrator must enable it before remote speakers can connect.</p>}
    <div className="remote-invite-fields">
      <label>Speaker name<input value={label} maxLength={120} onChange={e => setLabel(e.target.value)} /></label>
      <label>Invitation expires<select value={hours} onChange={e => setHours(Number(e.target.value))}><option value={2}>In 2 hours</option><option value={12}>In 12 hours</option><option value={24}>In 24 hours</option><option value={168}>In 7 days</option></select></label>
      <label>Church audio sent to speaker<select value={returnSource} onChange={e => setReturnSource(e.target.value)}><option value="">No return audio</option>{sources.filter(s => !s.id.startsWith("guest-")).map(source => <option key={source.id} value={source.id}>{source.label}</option>)}</select></label>
    </div>
    <p className="muted">Use a church feed that excludes the remote speaker’s voice. Their own feed is always excluded by CSpot; any desk routing must exclude it too. Use Listen with headphones for sound checks, or route that monitor through the church sound system with an appropriate return mix.</p>
    <button type="button" className="secondary-button icon-text-button" disabled={busy || !label.trim() || !data?.gateway_available} onClick={() => void act(async () => {
      const guest = await contributionRequest<RemoteGuest & { token: string }>("", "POST", { label, hours, return_source_id: returnSource || null });
      setLink(invitationUrl(guest.token));
    })}><Link size={15} />Create invitation</button>
    {link && <div className="remote-invitation-link"><label>Private invitation — copy and share with the speaker<input ref={input} readOnly value={link} onFocus={e => e.target.select()} /></label><button type="button" className="secondary-button icon-text-button" onClick={() => {
      void navigator.clipboard?.writeText(link).then(() => setMessage("Invitation copied")).catch(() => { input.current?.focus(); input.current?.select(); setMessage("Copy the selected invitation link"); });
      if (!navigator.clipboard) { input.current?.focus(); input.current?.select(); setMessage("Copy the selected invitation link"); }
    }}><Copy size={15} />Copy link</button></div>}
    {message && <p className="form-message" role="status">{message}</p>}
    <div className="remote-contribution-list">{data?.guests.map(guest => <article key={guest.id} className={`remote-contribution-card ${guest.live ? "is-live" : ""}`}>
      <div><strong>{guest.label}</strong> <span role="status">{guest.live ? "On air" : guest.connected ? "Connected · backstage" : "Waiting for speaker"}</span><small>Expires {new Date(guest.expires_at).toLocaleString()} · Return: {sources.find(s => s.id === guest.return_source_id)?.label || "None"}</small></div>
      <GuestPreview guest={guest} iceServers={data.ice_servers} />
      <div className="remote-guest-actions">
        <button type="button" className="primary-button icon-text-button" disabled={busy || !guest.connected} onClick={() => void act(() => contributionRequest(`/${guest.id}/on-air`, "POST", { live: !guest.live }))}>{guest.live ? <Square size={15} /> : <Radio size={15} />}{guest.live ? "Take off air" : "Bring on air"}</button>
        <button type="button" className="secondary-button icon-text-button" disabled={busy} onClick={() => void act(async () => { await contributionRequest(`/${guest.id}`, "DELETE"); setLink(""); })}><X size={15} />End invitation</button>
      </div>
    </article>)}</div>
  </section>;
}
