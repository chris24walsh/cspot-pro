import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { broadcastRecordingSlideUrl, broadcastRecordingAudioUrl, previewRecordingVisuals, type RecordingVisualSegment, type BroadcastRecording, type PlanDetail, type PlanItem } from "../api";
import { RecordingTransport, type RecordingTransportHandle } from "./RecordingTransport";
import { RecordingActions } from "./RecordingActions";
import { RecordingVisualEditor } from "./RecordingVisualEditor";
import { useEscapeClose } from "./useEscapeClose";

interface SermonRecordingPlayerProps {
  recording: BroadcastRecording;
  onClose: () => void;
  canManage?: boolean;
  onTrimmed?: (recording: BroadcastRecording, replaced: boolean) => void;
}

export function recordingTimestampTitle(recording: BroadcastRecording) {
  return recording.title;
}

export function recordingTimestamp(recording: BroadcastRecording) {
  if (!recording.recorded_at) return "Date unavailable";
  const recordedAt = new Date(recording.recorded_at);
  return Number.isNaN(recordedAt.getTime())
    ? "Date unavailable"
    : recordedAt.toLocaleString(undefined, {
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        month: "short",
        second: "2-digit",
        year: "numeric",
      });
}

export function recordingTimelineEventAt(
  timeline: BroadcastRecording["timeline"],
  currentTime: number,
  slideDelaySeconds = 1.5,
) {
  const ordered = [...timeline].sort((left, right) => left.at - right.at);
  const synchronizedTime = Math.max(0, currentTime - slideDelaySeconds);
  return [...ordered].reverse().find((candidate) => candidate.at <= synchronizedTime) ?? ordered[0] ?? null;
}

export function recordedPlanItems(recording: BroadcastRecording, plan: PlanDetail): PlanItem[] {
  const currentItemIds = new Set(plan.items.map((item) => item.id));
  return recording.timeline.reduce<PlanItem[]>((items, event) => {
    if (currentItemIds.has(event.plan_item_id) || items.some((item) => item.id === event.plan_item_id) || !event.files?.length) {
      return items;
    }
    items.push({
      id: event.plan_item_id,
      plan_id: recording.plan_id ?? plan.id,
      parent_item_id: null,
      song_id: null,
      item_type: event.item_type ?? "sermon",
      sequence: String(plan.items.length + items.length + 1),
      title: event.item_title ?? "Recorded slides",
      planned_start: null,
      comment: null,
      key_signature: null,
      files: event.files.map((file, index) => ({
        id: `recording:${recording.id}:${event.plan_item_id}:${file.file_id}`,
        ...file,
        sort_order: file.sort_order ?? index,
        persistent: false,
      })),
      teacher_notes: null,
    });
    return items;
  }, []);
}

export function SermonRecordingPlayer({ recording: initialRecording, onClose, canManage, onTrimmed }: SermonRecordingPlayerProps) {
  const [recording, setRecording] = useState(initialRecording);
  const [currentTime, setCurrentTime] = useState(0);
  const [editorOpen, setEditorOpen] = useState(false);
  const [slideRevision, setSlideRevision] = useState(0);
  const [audioRevision, setAudioRevision] = useState(0);
  const [failedSlide, setFailedSlide] = useState("");
  const transportRef = useRef<RecordingTransportHandle>(null);
  const [previewSegments, setPreviewSegments] = useState<RecordingVisualSegment[]>([]);
  const previewSignature = JSON.stringify(previewSegments);
  const [previewUrl, setPreviewUrl] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [previewTick, setPreviewTick] = useState(0);
  const previewUrlRef = useRef("");
  const previewBounds = useRef<{ start: number; end: number } | null>(null);
  const previewRequest = useRef<AbortController | null>(null);
  const timeRef = useRef(currentTime);
  timeRef.current = currentTime;
  useEffect(() => {
    previewRequest.current?.abort(); previewRequest.current = null; previewBounds.current = null;
    if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    previewUrlRef.current = ""; setPreviewUrl(""); setPreviewError("");
    return () => { previewRequest.current?.abort(); previewRequest.current = null; if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current); previewUrlRef.current = ""; };
  }, [editorOpen, previewSignature, recording.id]);
  useEffect(() => {
    const previewTime = Math.min(currentTime, recording.duration_seconds ?? currentTime);
    if (!editorOpen || previewRequest.current || previewError || (previewBounds.current && previewTime >= previewBounds.current.start && previewTime < previewBounds.current.end)) return;
    const controller = new AbortController(); previewRequest.current = controller;
    void previewRecordingVisuals(recording.id, previewSegments, previewTime, controller.signal).then((frame) => {
      if (controller.signal.aborted) return;
      previewBounds.current = { start: frame.start, end: frame.end };
      const url = URL.createObjectURL(frame.blob);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = url; setPreviewUrl(url);

    }).catch((error) => { if (!controller.signal.aborted) setPreviewError(error instanceof Error ? error.message : "Could not load visual preview."); })
      .finally(() => { if (previewRequest.current === controller) { previewRequest.current = null; const latest = Math.min(timeRef.current, recording.duration_seconds ?? timeRef.current); if (!controller.signal.aborted && previewBounds.current && (latest < previewBounds.current.start || latest >= previewBounds.current.end)) setPreviewTick((tick) => tick + 1); } });
  }, [editorOpen, previewSignature, currentTime, previewError, previewTick, recording.id, recording.duration_seconds]);
  useEscapeClose(!editorOpen, onClose);
  const event = recordingTimelineEventAt(recording.timeline, currentTime, 0);
  const eventIndex = event ? recording.timeline.indexOf(event) : -1;
  const slideKey = `${slideRevision}:${eventIndex}`;
  function updateRecording(updated: BroadcastRecording, replaced: boolean) {
    if (replaced) { setRecording(updated); setSlideRevision((value) => value + 1); }
    onTrimmed?.(updated, replaced);
  }
  return (
    <div className="app-dialog-backdrop" onMouseDown={() => { if (!editorOpen) onClose(); }} role="presentation">
      <section aria-label={`Play ${recordingTimestampTitle(recording)}`} aria-modal="true" className={`sermon-recording-player${editorOpen ? " editing-visuals" : ""}`}
        onMouseDown={(event) => event.stopPropagation()} onKeyDown={(event) => {
          if (event.key === "Enter" && event.target instanceof HTMLInputElement) event.preventDefault();
          event.stopPropagation();
        }} role="dialog">
        <header><div><span>Recorded sermon</span><strong>{recordingTimestampTitle(recording)}</strong><small>{recordingTimestamp(recording)}</small></div>
          <button aria-label="Close recording" className="section-icon-button" disabled={editorOpen} onClick={onClose} type="button"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="sermon-recording-stage">
          {editorOpen ? previewError ? <div role="alert"><p>{previewError}</p><button type="button" className="text-button" onClick={() => setPreviewError("")}>Retry preview</button></div> : previewUrl ? <img alt="Unsaved visual preview" src={previewUrl} /> : <p>Loading preview…</p> : eventIndex < 0 ? <p className="muted-copy">No recorded slides available.</p> : failedSlide === slideKey ? <p role="alert">Could not load this recorded slide.</p> : <img alt="Recorded sermon slide" src={broadcastRecordingSlideUrl(recording.id, eventIndex, String(slideRevision))} onError={() => setFailedSlide(slideKey)} />}
        </div>
        {!editorOpen ? <div className="action-row"><RecordingActions key={recording.id} recording={recording} canManage={canManage} onRecordingChange={(updated) => updateRecording(updated, true)} /></div> : null}
        <RecordingTransport ref={transportRef} key={`${recording.id}:${audioRevision}`} recording={recording} canManage={canManage && !editorOpen} onTimeChange={setCurrentTime} audioUrl={`${broadcastRecordingAudioUrl(recording.id)}?v=${audioRevision}`} onTrimmed={(updated, replaced) => { updateRecording(updated, replaced); if (replaced) { setCurrentTime(0); setAudioRevision((value) => value + 1); } }} onEditVisuals={() => { setPreviewSegments(recording.visual_segments ?? []); setEditorOpen(true); }} />
        {editorOpen ? <RecordingVisualEditor recording={recording} currentTime={currentTime} onCancel={() => setEditorOpen(false)} onPreviewChange={setPreviewSegments} onPreviewFromStart={(seconds) => transportRef.current?.seekAndPlay(seconds)} onSaved={(updated) => updateRecording(updated, true)} /> : null}
      </section>
    </div>
  );
}
