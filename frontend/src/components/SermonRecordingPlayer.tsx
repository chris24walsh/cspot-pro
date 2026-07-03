import { X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  broadcastRecordingAudioUrl,
  getFileSlides,
  getPlan,
  getSongs,
  type BroadcastRecording,
  type PlanDetail,
  type RenderedSlide,
  type Song,
} from "../api";
import {
  buildPresentationSlides,
  presentationTypeClass,
  suggestSlideGroupFontCap,
} from "../presentation";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { ScaledSlideImage } from "./ScaledSlideImage";

interface SermonRecordingPlayerProps {
  recording: BroadcastRecording;
  onClose: () => void;
}

export function recordingTimestampTitle(recording: BroadcastRecording) {
  if (!recording.recorded_at) return recording.title;
  const recordedAt = new Date(recording.recorded_at);
  return Number.isNaN(recordedAt.getTime())
    ? recording.title
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

export function SermonRecordingPlayer({ recording, onClose }: SermonRecordingPlayerProps) {
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [songs, setSongs] = useState<Song[]>([]);
  const [renderedSlidesByFileId, setRenderedSlidesByFileId] = useState<Record<string, RenderedSlide[]>>({});
  const [currentTime, setCurrentTime] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!recording.plan_id) {
      setMessage("The original service plan is no longer available.");
      return;
    }
    let cancelled = false;
    void Promise.all([getPlan(recording.plan_id), getSongs()])
      .then(async ([nextPlan, nextSongs]) => {
        const recordedItemIds = new Set(recording.timeline.map((event) => event.plan_item_id));
        const files = nextPlan.items
          .filter((item) => recordedItemIds.has(item.id))
          .flatMap((item) => item.files ?? []);
        const entries = await Promise.all(
          files.map(async (file) => [file.file_id, await getFileSlides(file.file_id).catch(() => [])] as const),
        );
        if (!cancelled) {
          setPlan(nextPlan);
          setSongs(nextSongs);
          setRenderedSlidesByFileId(Object.fromEntries(entries));
        }
      })
      .catch((error) => {
        if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load sermon slides.");
      });
    return () => {
      cancelled = true;
    };
  }, [recording.plan_id, recording.timeline]);

  const slides = useMemo(
    () => buildPresentationSlides(plan?.items ?? [], songs, renderedSlidesByFileId),
    [plan?.items, renderedSlidesByFileId, songs],
  );
  const event = useMemo(() => {
    return recordingTimelineEventAt(recording.timeline, currentTime);
  }, [currentTime, recording.timeline]);
  const matchingSlides = event ? slides.filter((slide) => slide.planItemId === event.plan_item_id) : [];
  const slide = matchingSlides[Math.min(Math.max(event?.slide_offset ?? 0, 0), matchingSlides.length - 1)] ?? null;
  const fontCap = useMemo(
    () => suggestSlideGroupFontCap(slides.filter((candidate) => candidate.text.trim()).map((candidate) => candidate.text)),
    [slides],
  );

  return (
    <div className="app-dialog-backdrop" onMouseDown={onClose} role="presentation">
      <section
        aria-label={`Play ${recordingTimestampTitle(recording)}`}
        aria-modal="true"
        className="sermon-recording-player"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
      >
        <header>
          <div>
            <span>Recorded sermon</span>
            <strong>{recordingTimestampTitle(recording)}</strong>
          </div>
          <button aria-label="Close recording" className="section-icon-button" onClick={onClose} type="button">
            <X size={18} aria-hidden="true" />
          </button>
        </header>
        <div className={`sermon-recording-stage stage-theme-light ${presentationTypeClass(slide?.itemType ?? "sermon")}`}>
          {message ? <p className="form-message">{message}</p> : !slide ? (
            <p className="muted-copy">Loading sermon slides…</p>
          ) : slide.imageUrl ? (
            <ScaledSlideImage alt={slide.title} src={slide.imageUrl} />
          ) : (
            <div className="presentation-stage">
              <div className="stage-title">{slide.slideKind === "title" ? "" : slide.sectionTitle}</div>
              <AutoFitSlideText maxFontSize={fontCap} text={slide.text} />
            </div>
          )}
        </div>
        <audio
          autoPlay
          controls
          onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
          preload="metadata"
          src={broadcastRecordingAudioUrl(recording.id)}
        />
      </section>
    </div>
  );
}
