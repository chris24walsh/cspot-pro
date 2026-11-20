import { useEffect, useState } from "react";
import { getBibleVersions, getFiles, saveRecordingVisuals, searchBible, uploadStoredFile, type BibleSearchHit, type BibleVersion, type BroadcastRecording, type RecordingVisualSegment, type StoredFile } from "../api";
import { parseRecordingTime, recordingTime } from "./RecordingTransport";

type Kind = RecordingVisualSegment["kind"];
function exactTime(seconds: number) {
  const milliseconds = Math.max(0, Math.round(seconds * 1000));
  const minutes = Math.floor(milliseconds / 60000);
  const remainder = (milliseconds % 60000) / 1000;
  return `${minutes}:${remainder.toFixed(3).padStart(6, "0").replace(/\.?0+$/, "").replace(/^(\d)$/, "0$1")}`;
}

export function RecordingVisualEditor({ recording, currentTime, onCancel, onSaved, onPreviewChange, onPreviewFromStart }: {
  recording: BroadcastRecording; currentTime: number; onCancel: () => void; onSaved: (recording: BroadcastRecording) => void;
  onPreviewChange?: (segments: RecordingVisualSegment[]) => void; onPreviewFromStart?: (seconds: number) => void;
}) {
  const [segments, setSegments] = useState<RecordingVisualSegment[]>(() => recording.visual_segments ?? []);
  const [editing, setEditing] = useState<string | null>(null);
  const [kind, setKind] = useState<Kind>("bible");
  const [start, setStart] = useState(exactTime(currentTime));
  const [end, setEnd] = useState(exactTime((recording.visual_segments ?? []).find((item) => item.start_seconds > currentTime)?.start_seconds ?? recording.duration_seconds ?? 0));
  const [dwell, setDwell] = useState("5");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [fileIds, setFileIds] = useState<string[]>([]);
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [versions, setVersions] = useState<BibleVersion[]>([]);
  const [version, setVersion] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<BibleSearchHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const [startAuto, setStartAuto] = useState(true);
  const [endAuto, setEndAuto] = useState(true);
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void getBibleVersions().then((nextVersions) => { setVersions(nextVersions); setVersion(nextVersions[0]?.code ?? ""); })
      .catch(() => setMessage("Bible versions could not be loaded. Check library access."));
    void getFiles().then((nextFiles) => setFiles(nextFiles.filter((file) => ["image/png", "image/jpeg"].includes(file.content_type ?? ""))))
      .catch(() => setMessage("Library images could not be loaded. Check library access."));
  }, []);

  useEffect(() => { onPreviewChange?.(segments); }, [segments, onPreviewChange]);

  useEffect(() => {
    if (!editing && startAuto) {
      setStart(exactTime(currentTime));
      if (endAuto) setEnd(exactTime(segments.find((item) => item.start_seconds > currentTime)?.start_seconds ?? recording.duration_seconds ?? 0));
    }
  }, [currentTime, editing, startAuto, endAuto, segments, recording.duration_seconds]);

  function markStart(seconds: number) {
    setStart(exactTime(seconds));
    if (!editing && endAuto) setEnd(exactTime(segments.find((item) => item.start_seconds > seconds)?.start_seconds ?? recording.duration_seconds ?? 0));
  }
  function edit(segment: RecordingVisualSegment) {
    setDraftDirty(true); setStartAuto(false); setEndAuto(false); setEditing(segment.id); setKind(segment.kind); setStart(exactTime(segment.start_seconds)); setEnd(exactTime(segment.end_seconds));
    setTitle(segment.title ?? ""); setText(segment.text ?? ""); setFileIds(segment.file_ids ?? []); setDwell(String(segment.dwell_seconds ?? 5));
  }
  function reset() {
    setDraftDirty(false); setStartAuto(true); setEndAuto(true); setEditing(null); setStart(exactTime(currentTime)); setEnd(exactTime(segments.find((item) => item.start_seconds > currentTime)?.start_seconds ?? recording.duration_seconds ?? 0)); setTitle(""); setText(""); setFileIds([]); setDwell("5"); setQuery(""); setHits([]);
  }
  function addSegment(preview = false) {
    const from = startAuto && !editing ? currentTime : parseRecordingTime(start);
    const to = endAuto && !editing ? (segments.find((item) => item.start_seconds > from)?.start_seconds ?? recording.duration_seconds ?? 0) : parseRecordingTime(end);
    const interval = Number(dwell);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > (recording.duration_seconds ?? 0)) {
      setMessage("Enter valid start and end times within the recording."); return;
    }
    if (!editing && segments.some((segment) => segment.start_seconds === from)) {
      setMessage("A visual already starts here. Edit or remove it before adding another at this time."); return;
    }
    if (segments.some((segment) => segment.id !== editing && from < segment.end_seconds && to > segment.start_seconds && (editing || segment.start_seconds >= from))) {
      setMessage("This visual overlaps a later visual. End it before the next visual starts."); return;
    }
    const adjusted = segments.filter((item) => item.id !== editing).map((item) =>
      !editing && item.start_seconds < from && item.end_seconds > from ? { ...item, end_seconds: from } : item);
    if (kind === "bible" && (!title || !text)) { setMessage("Search for and select a Bible passage."); return; }
    if (kind === "bible" && text.length > 1200) { setMessage("Choose a shorter passage: Bible text must be 1,200 characters or fewer."); return; }
    if ((kind === "image" || kind === "montage") && !fileIds.length) { setMessage("Select at least one image."); return; }
    if (kind === "montage" && (!Number.isFinite(interval) || interval < 1 || interval > 3600)) { setMessage("Enter an image duration between 1 and 3,600 seconds."); return; }
    const frames = adjusted.filter((item) => item.kind === "montage").reduce((sum, item) => sum + Math.floor((item.end_seconds - item.start_seconds) / (item.dwell_seconds ?? 5)) + 1, 0) + (kind === "montage" ? Math.floor((to - from) / interval) + 1 : 0);
    if (frames > 5000) { setMessage("Montages produce too many slides. Increase the image duration or shorten the montage."); return; }
    const segment: RecordingVisualSegment = { id: editing ?? crypto.randomUUID(), start_seconds: from, end_seconds: to, kind,
      ...(kind === "bible" ? { title, text } : {}),
      ...(kind === "image" || kind === "montage" ? { file_ids: kind === "image" ? fileIds.slice(0, 1) : fileIds } : {}),
      ...(kind === "montage" ? { dwell_seconds: interval } : {}) };
    setSegments([...adjusted, segment].sort((a, b) => a.start_seconds - b.start_seconds));
    setMessage(""); reset(); if (preview) onPreviewFromStart?.(from);
  }
  async function save() {
    setBusy(true); setMessage("");
    try { const updated = await saveRecordingVisuals(recording.id, segments); setSegments(updated.visual_segments ?? segments); onSaved(updated); setMessage("Visuals saved. You can keep editing or choose Done."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save visuals."); }
    finally { setBusy(false); }
  }
  return <section className="recording-visual-editor" aria-label="Edit recording visuals">
    <header><strong>Edit visuals</strong><button type="button" className="text-button" onClick={() => { if (draftDirty || JSON.stringify(segments) !== JSON.stringify(recording.visual_segments ?? [])) setConfirmCancel(true); else onCancel(); }}>Done</button></header>
    {confirmCancel ? <p role="alert">Discard unsaved visual changes? <button type="button" className="text-button" onClick={onCancel}>Discard changes</button> <button type="button" className="text-button" onClick={() => setConfirmCancel(false)}>Keep editing</button></p> : null}
    <p>Add a visual at the playhead to end the previous visual there. It ends at the next visual or the recording end; captured slides return after it ends.</p>
    <div className="recording-visual-list">{segments.length ? segments.map((segment) => <div className="action-row" key={segment.id}>
      <span>{recordingTime(segment.start_seconds)}–{recordingTime(segment.end_seconds)} · {segment.title || segment.kind}</span>
      <button type="button" className="text-button" onClick={() => edit(segment)}>Edit</button>
      <button type="button" className="text-button" disabled={currentTime <= segment.start_seconds || currentTime >= segment.end_seconds} onClick={() => setSegments(segments.map((item) => item.id === segment.id ? { ...item, end_seconds: currentTime } : item))}>End here</button>
      <button type="button" className="text-button" onClick={() => { setSegments(segments.filter((item) => item.id !== segment.id)); if (editing === segment.id) reset(); }}>Remove</button>
    </div>) : <p>No added visuals.</p>}</div>
    <fieldset disabled={busy} onChangeCapture={() => setDraftDirty(true)}>
      <legend>{editing ? "Edit visual" : "Add visual"}</legend>
      <div className="action-row">
        <label>Type <select value={kind} onChange={(event) => { setKind(event.target.value as Kind); setFileIds([]); }}><option value="bible">Bible passage</option><option value="background">Background</option><option value="image">Image</option><option value="montage">Image montage</option></select></label>
        <label>Start (m:ss) <input value={start} onChange={(event) => { const value = event.target.value; setStartAuto(false); setStart(value); const time = parseRecordingTime(value); if (Number.isFinite(time) && !editing && endAuto) setEnd(exactTime(segments.find((item) => item.start_seconds > time)?.start_seconds ?? recording.duration_seconds ?? 0)); }} /></label><button type="button" className="text-button" onClick={() => { setDraftDirty(true); markStart(currentTime); setStartAuto(false); }}>Set start here</button>
        <label>End (m:ss) <input value={end} onChange={(event) => { setEndAuto(false); setEnd(event.target.value); }} /></label><button type="button" className="text-button" onClick={() => { setDraftDirty(true); setEndAuto(false); setEnd(exactTime(currentTime)); }}>Set end here</button>
      </div>
      {kind === "bible" ? <div>
        <div className="action-row"><label>Version <select value={version} onChange={(event) => setVersion(event.target.value)}>{versions.map((item) => <option key={item.id} value={item.code}>{item.code}</option>)}</select></label>
          <label>Passage or keywords <input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <button type="button" className="text-button" disabled={!query.trim() || !version} onClick={() => { setBusy(true); setMessage(""); void searchBible({ q: query, version_code: version, limit: 30 }).then((results) => { setHits(results); if (!results.length) setMessage("No passages found."); }).catch((error) => setMessage(error instanceof Error ? error.message : "Bible search failed.")).finally(() => setBusy(false)); }}>Search</button></div>
        <div className="recording-visual-results">{hits.map((hit, index) => <button type="button" className="text-button" key={`${hit.reference}-${index}`} onClick={() => { setDraftDirty(true); if (!editing && startAuto) { markStart(currentTime); setStartAuto(false); } setTitle(`${hit.reference} (${hit.version})`); setText(hit.text); setHits([]); }}>{hit.reference} ({hit.version}) — {hit.text}</button>)}</div>
        {title ? <p>Selected: {title} — {text} ({text.length}/1,200 characters){text.length > 1200 ? " — choose a shorter passage." : ""}</p> : null}
      </div> : null}
      {kind === "image" || kind === "montage" ? <div>
        <label>Library image <select value="" onChange={(event) => { const id = event.target.value; if (id) setFileIds((current) => kind === "image" ? [id] : [...current, id]); }}><option value="">Choose image…</option>{files.map((file) => <option key={file.id} value={file.id}>{file.display_name}</option>)}</select></label>
        <label> Upload image <input type="file" accept="image/png,image/jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (!file) return; if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 25 * 1024 * 1024) { setMessage("Choose a PNG or JPEG image no larger than 25 MB."); return; } setBusy(true); void uploadStoredFile({ file }).then((uploaded) => { setFiles((current) => [...current, uploaded]); setFileIds((current) => kind === "image" ? [uploaded.id] : [...current, uploaded.id]); }).catch((error) => setMessage(error instanceof Error ? error.message : "Upload failed.")).finally(() => setBusy(false)); }} /></label>
        <ol>{fileIds.map((id, index) => <li key={`${id}-${index}`}>{files.find((file) => file.id === id)?.display_name ?? id} <button type="button" className="text-button" disabled={index === 0} onClick={() => setFileIds((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>Move up</button> <button type="button" className="text-button" onClick={() => setFileIds((current) => current.filter((_, i) => i !== index))}>Remove</button></li>)}</ol>
        {kind === "montage" ? <label>Seconds per image <input type="number" min="1" max="3600" step="0.1" value={dwell} onChange={(event) => setDwell(event.target.value)} /></label> : null}
      </div> : null}
      <div className="action-row"><button type="button" className="text-button" onClick={() => addSegment()}>{editing ? "Update visual" : "Add visual"}</button>{onPreviewFromStart ? <button type="button" className="text-button" onClick={() => addSegment(true)}>Add &amp; preview from start</button> : null}{draftDirty ? <button type="button" className="text-button" onClick={reset}>{editing ? "Cancel edit" : "Clear draft"}</button> : null}</div>
    </fieldset>
    {message ? <p role="alert">{message}</p> : null}
    {draftDirty ? <p>Apply the current visual with {editing ? "Update visual" : "Add visual"} before saving.</p> : null}
    <button type="button" className="primary-button" disabled={busy || draftDirty} onClick={() => void save()}>{busy ? "Working…" : "Save changes"}</button>
  </section>;
}
