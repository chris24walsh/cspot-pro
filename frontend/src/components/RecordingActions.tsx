import { Download, Share2 } from "lucide-react";
import { useEffect, useState } from "react";

import { broadcastRecordingAudioUrl, type BroadcastRecording } from "../api";

export async function loadRecordingFile(recording: BroadcastRecording, signal?: AbortSignal) {
  const response = await fetch(broadcastRecordingAudioUrl(recording.id), { credentials: "include", signal });
  if (!response.ok) throw new Error("Could not load recording. Please try again.");
  const blob = await response.blob();
  return new File([blob], recording.file_name, { type: blob.type || recording.content_type || "audio/mp4" });
}

export function RecordingActions({ recording }: { recording: BroadcastRecording }) {
  const [file, setFile] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!preparing) return;
    const controller = new AbortController();
    void loadRecordingFile(recording, controller.signal).then((nextFile) => {
      if (controller.signal.aborted) return;
      if (!navigator.canShare?.({ files: [nextFile] })) {
        setMessage("This browser cannot share this audio file. Download it, then attach it in WhatsApp, email or another app.");
      } else {
        setFile(nextFile);
        setMessage("Audio ready. Choose Share audio to select WhatsApp or another app.");
      }
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not prepare recording.");
    }).finally(() => {
      if (!controller.signal.aborted) setPreparing(false);
    });
    return () => controller.abort();
  }, [preparing, recording]);

  async function share() {
    setMessage("");
    if (!navigator.share || !navigator.canShare) {
      setMessage("Download the audio, then attach it in WhatsApp, email or another app. Direct sharing is unavailable in this browser.");
      return;
    }
    if (!file) {
      setPreparing(true);
      return;
    }
    setSharing(true);
    try {
      await navigator.share({ files: [file], title: recording.title });
      setFile(null);
    } catch (error) {
      if (!(error instanceof Error && error.name === "AbortError")) {
        setMessage("Could not share audio. Try again, or download it and attach it in your messaging app.");
      }
    } finally {
      setSharing(false);
    }
  }

  if (recording.status !== "ready") return null;
  return (
    <div className="recording-export-actions">
      <div className="action-row">
        <a className="text-button icon-text-button" download={recording.file_name} href={broadcastRecordingAudioUrl(recording.id)}>
          <Download size={15} aria-hidden="true" /> Download audio
        </a>
        <button className="text-button icon-text-button" disabled={preparing || sharing} onClick={() => void share()} type="button">
          <Share2 size={15} aria-hidden="true" /> {preparing ? "Preparing audio…" : "Share audio"}
        </button>
      </div>
      {message ? <p className="recording-export-message" role="status">{message}</p> : null}
    </div>
  );
}
