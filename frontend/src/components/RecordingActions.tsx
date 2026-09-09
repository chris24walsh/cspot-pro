import { Download, Globe2, Link2, Share2, Volume2, X } from "lucide-react";
import { useEffect, useState } from "react";

import {
  broadcastRecordingAudioUrl, broadcastRecordingVideoUrl, getRecordingVideoStatus,
  prepareRecordingVideo, publishBroadcastRecording, unpublishBroadcastRecording,
  type BroadcastRecording, type RecordingVideoStatus,
} from "../api";

export function recordingVideoFilename(recording: BroadcastRecording) {
  return `${recording.file_name.replace(/\.[^.]+$/, "")}-with-slides.mp4`;
}

export function publicRecordingUrl(token: string) {
  const url = new URL(import.meta.env.BASE_URL || "/", window.location.origin);
  url.searchParams.set("recording", token);
  return url.toString();
}

export async function loadRecordingFile(recording: BroadcastRecording, signal?: AbortSignal) {
  const response = await fetch(broadcastRecordingVideoUrl(recording.id), { credentials: "include", signal });
  if (!response.ok) throw new Error("Could not load recording video. Please try again.");
  const blob = await response.blob();
  return new File([blob], recordingVideoFilename(recording), { type: "video/mp4" });
}

export function RecordingActions({ recording, canManage = false, onRecordingChange }: {
  recording: BroadcastRecording;
  canManage?: boolean;
  onRecordingChange?: (recording: BroadcastRecording) => void;
}) {
  const [open, setOpen] = useState(false);
  const [video, setVideo] = useState<RecordingVideoStatus>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const state = await getRecordingVideoStatus(recording.id);
        if (cancelled) return;
        setVideo(state);
        if (state.status === "preparing") timer = setTimeout(() => void check(), 3000);
      } catch { if (!cancelled) setMessage("Could not check video preparation."); }
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, recording.id]);

  async function prepare() {
    setBusy(true); setMessage("");
    try { setVideo(await prepareRecordingVideo(recording.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not prepare video."); }
    finally { setBusy(false); }
  }

  async function publish() {
    setBusy(true); setMessage("");
    try {
      const updated = await publishBroadcastRecording(recording.id);
      onRecordingChange?.(updated);
      setMessage("Public link created. Anyone with this link can play the recording.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not make recording public."); }
    finally { setBusy(false); }
  }

  async function unpublish() {
    setBusy(true); setMessage("");
    try {
      const updated = await unpublishBroadcastRecording(recording.id);
      onRecordingChange?.(updated);
      setMessage("Public access has been turned off.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not turn off public access."); }
    finally { setBusy(false); }
  }

  async function copyLink() {
    if (!recording.public_token) return;
    await navigator.clipboard.writeText(publicRecordingUrl(recording.public_token));
    setMessage("Public link copied.");
  }

  async function shareLink() {
    if (!recording.public_token) return;
    const url = publicRecordingUrl(recording.public_token);
    if (!navigator.share) { await copyLink(); return; }
    try { await navigator.share({ title: recording.title, text: recording.title, url }); }
    catch (error) { if (!(error instanceof Error && error.name === "AbortError")) setMessage("Could not open the share menu."); }
  }

  if (recording.status !== "ready") return null;
  return <>
    <button aria-label="Share or download recording" className="recording-icon-button" onClick={() => setOpen(true)} title="Share or download" type="button"><Share2 size={17} aria-hidden="true" /></button>
    {open ? <div className="app-dialog-backdrop" onMouseDown={() => setOpen(false)} role="presentation">
      <section aria-label={`Share or download ${recording.title}`} aria-modal="true" className="app-dialog recording-share-dialog" onMouseDown={(event) => event.stopPropagation()} role="dialog">
        <header><div><p className="eyebrow">Share or download</p><h2>{recording.title}</h2></div><button aria-label="Close" className="section-icon-button" onClick={() => setOpen(false)} type="button"><X size={18} /></button></header>
        <div className="recording-share-options">
          <a className="text-button icon-text-button" download={recording.file_name} href={broadcastRecordingAudioUrl(recording.id)}><Volume2 size={16} /> Download audio</a>
          {video.status === "ready" ? <a className="text-button icon-text-button" download={recordingVideoFilename(recording)} href={broadcastRecordingVideoUrl(recording.id)}><Download size={16} /> Download video with slides</a> : <button className="text-button icon-text-button" disabled={busy || video.status === "preparing"} onClick={() => void prepare()} type="button"><Download size={16} />{video.status === "preparing" ? "Preparing video…" : "Prepare video with slides"}</button>}
          {canManage ? recording.public_token ? <>
            <div className="recording-public-link"><input aria-label="Public recording link" readOnly value={publicRecordingUrl(recording.public_token)} /></div>
            <button className="primary-button icon-text-button" onClick={() => void shareLink()} type="button"><Share2 size={16} /> Share public link</button>
            <button className="text-button icon-text-button" onClick={() => void copyLink()} type="button"><Link2 size={16} /> Copy public link</button>
            <button className="text-button" disabled={busy} onClick={() => void unpublish()} type="button">Turn off public access</button>
          </> : <button className="primary-button icon-text-button" disabled={busy} onClick={() => void publish()} type="button"><Globe2 size={16} /> Make recording public</button> : null}
        </div>
        {video.status === "preparing" ? <p role="status">Video preparation can take a few minutes. You can close this dialog and return later.</p> : null}
        {video.message ? <p role="status">{video.message}</p> : null}
        {message ? <p role="status">{message}</p> : null}
      </section>
    </div> : null}
  </>;
}
