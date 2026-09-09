import { Download, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  broadcastRecordingAudioUrl, broadcastRecordingVideoUrl, getRecordingVideoStatus,
  prepareRecordingVideo, type BroadcastRecording, type RecordingVideoStatus,
} from "../api";

export function recordingVideoFilename(recording: BroadcastRecording) {
  return `${recording.file_name.replace(/\.[^.]+$/, "")}-with-slides.mp4`;
}

export async function loadRecordingFile(recording: BroadcastRecording, signal?: AbortSignal) {
  const response = await fetch(broadcastRecordingVideoUrl(recording.id), { credentials: "include", signal });
  if (!response.ok) throw new Error("Could not load recording video. Please try again.");
  const blob = await response.blob();
  return new File([blob], recordingVideoFilename(recording), { type: "video/mp4" });
}

export function RecordingActions({ recording }: { recording: BroadcastRecording }) {
  const [file, setFile] = useState<File | null>(null);
  const [preparingShare, setPreparingShare] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [video, setVideo] = useState<RecordingVideoStatus>({ status: "idle" });
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (recording.status !== "ready") return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const check = async () => {
      try {
        const state = await getRecordingVideoStatus(recording.id);
        if (cancelled) return;
        setVideo(state);
        if (state.status === "preparing") timer = setTimeout(() => void check(), 3000);
      } catch {
        if (!cancelled) setVideo({ status: "failed", message: "Could not check video preparation. Try Prepare video again." });
      }
    };
    void check();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [recording.id, recording.status, requesting]);

  useEffect(() => {
    if (!preparingShare) return;
    const controller = new AbortController();
    void loadRecordingFile(recording, controller.signal).then((nextFile) => {
      if (controller.signal.aborted) return;
      if (!navigator.canShare?.({ files: [nextFile] })) {
        setMessage("This browser cannot share this video file. Download it, then attach it in WhatsApp, email or another app.");
      } else {
        setFile(nextFile);
        setMessage("Video ready. Choose Share video to select WhatsApp or another app.");
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load video.");
    }).finally(() => {
      if (!controller.signal.aborted) setPreparingShare(false);
    });
    return () => controller.abort();
  }, [preparingShare, recording.id, recording.file_name]);

  async function prepare() {
    setRequesting(true);
    setMessage("");
    try { setVideo(await prepareRecordingVideo(recording.id)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not prepare video."); }
    finally { setRequesting(false); }
  }

  async function share() {
    setMessage("");
    if (!navigator.share || !navigator.canShare) {
      setMessage("Download the video, then attach it in WhatsApp, email or another app. Direct sharing is unavailable in this browser.");
      return;
    }
    if (!file) { setPreparingShare(true); return; }
    setSharing(true);
    try {
      await navigator.share({ files: [file], title: recording.title });
      setFile(null);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setMessage("Could not share video. Try again, or download it and attach it in your messaging app.");
      }
    } finally { setSharing(false); }
  }

  if (recording.status !== "ready") return null;
  return (
    <div className="recording-export-actions">
      <div className="action-row">
        {video.status === "ready" ? <>
          <a className="text-button icon-text-button" download={recordingVideoFilename(recording)} href={broadcastRecordingVideoUrl(recording.id)}>
            <Download size={15} aria-hidden="true" /> Download video
          </a>
          <button className="text-button icon-text-button" disabled={preparingShare || sharing} onClick={() => void share()} type="button">
            <Share2 size={15} aria-hidden="true" /> {preparingShare ? "Loading video…" : "Share video"}
          </button>
        </> : <button className="text-button icon-text-button" disabled={requesting || video.status === "preparing"} onClick={() => void prepare()} type="button">
          <Download size={15} aria-hidden="true" /> {requesting || video.status === "preparing" ? "Preparing video…" : "Prepare video (audio + slides)"}
        </button>}
        <a className="text-button" download={recording.file_name} href={broadcastRecordingAudioUrl(recording.id)}>Audio only</a>
      </div>
      {video.status === "preparing" ? <p className="recording-export-message" role="status">Combining audio and slides. This can take a few minutes; you can leave this page and return later.</p> : null}
      {video.message ? <p className="recording-export-message" role="status">{video.message}</p> : null}
      {message ? <p className="recording-export-message" role="status">{message}</p> : null}
    </div>
  );
}
