import { X } from "lucide-react";
import { useState } from "react";
import { broadcastRecordingSlideUrl, broadcastRecordingAudioUrl, type BroadcastRecording, type PlanDetail, type PlanItem } from "../api";
import { RecordingTransport } from "./RecordingTransport";
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
          {eventIndex < 0 ? <p className="muted-copy">No recorded slides available.</p> : failedSlide === slideKey ? <p role="alert">Could not load this recorded slide.</p> : <img alt="Recorded sermon slide" src={broadcastRecordingSlideUrl(recording.id, eventIndex, String(slideRevision))} onError={() => setFailedSlide(slideKey)} />}
        </div>
        <RecordingActions key={recording.id} recording={recording} canManage={canManage} onRecordingChange={(updated) => updateRecording(updated, true)} />
        <RecordingTransport key={`${recording.id}:${audioRevision}`} recording={recording} canManage={canManage && !editorOpen} onTimeChange={setCurrentTime} audioUrl={`${broadcastRecordingAudioUrl(recording.id)}?v=${audioRevision}`} onTrimmed={(updated, replaced) => { updateRecording(updated, replaced); if (replaced) { setCurrentTime(0); setAudioRevision((value) => value + 1); } }} onEditVisuals={() => setEditorOpen(true)} />
        {editorOpen ? <RecordingVisualEditor recording={recording} currentTime={currentTime} onCancel={() => setEditorOpen(false)} onSaved={(updated) => { updateRecording(updated, true); setEditorOpen(false); }} /> : null}
      </section>
    </div>
  );
}
