import { ArrowLeft, ArrowRight, CircleStop, Eye, EyeOff, MonitorUp, Play } from "lucide-react";
import { useEffect } from "react";
import type { SundaySchoolBoardItem } from "../api";
import { presentationForItem, verseNextLabel, versePhase } from "../sundaySchoolPresentation";
import { SchoolPresentationContent } from "./SundaySchoolDisplay";
import { SCHOOL_STORIES, storyFrame, storyLength } from "../sundaySchoolStories";
import { useSundaySchoolRoom } from "./useSundaySchoolRoom";

export function SundaySchoolPresenter({ date, theme, selected, active, canControl, onLiveItem, onOpenLesson }: {
  date: string; theme: string; selected?: SundaySchoolBoardItem; active: boolean; canControl: boolean;
  onLiveItem: (id: string | null) => void; onOpenLesson: (date: string) => void;
}) {
  const { room, busy, online, error, command } = useSundaySchoolRoom(active);
  const live = room?.lesson_date === date;
  const otherLive = Boolean(room?.lesson_date && !live);
  const state = room?.state;
  const presenting = live && state && state.kind !== "idle";
  const editable = canControl && !busy && online;
  const snapshot = selected ? presentationForItem(selected) : null;
  const verseMissing = snapshot?.kind === "verse" && (!snapshot.last_week.text.trim() || !snapshot.last_week.reference.trim() || !snapshot.this_week.text.trim() || !snapshot.this_week.reference.trim());
  const storyMissing = snapshot?.kind === "story" && !SCHOOL_STORIES[snapshot.story_id];
  const story = state?.kind === "story" ? SCHOOL_STORIES[state.story_id] : null;
  const frame = story && state ? storyFrame(story, state.step) : null;
  const lastStep = state?.kind === "verse" ? 13 : story ? storyLength(story) - 1 : 0;
  const nextLabel = state?.kind === "verse" ? verseNextLabel(state.step) : frame ? `Next: ${frame.next}` : "End element";
  const send = (action: "start" | "present" | "update" | "end_element" | "end", extra = {}) => void command({ action, lesson_date: date, lesson_title: theme, ...extra });

  useEffect(() => { onLiveItem(presenting ? state.element_id : null); }, [presenting, state?.element_id, onLiveItem]);
  useEffect(() => {
    if (!active || !presenting || !editable) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input,textarea,select,[contenteditable=true],dialog,[role=dialog]")) return;
      if ((event.key === "ArrowRight" || event.key === "ArrowDown") && !state.blanked && state.step < lastStep) { event.preventDefault(); send("update", { step: state.step + 1 }); }
      if ((event.key === "ArrowLeft" || event.key === "ArrowUp") && !state.blanked && state.step > 0) { event.preventDefault(); send("update", { step: state.step - 1 }); }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  });

  return <section className={`school-presenter ${live ? "is-live" : ""}`} aria-label="Sunday School presenter">
    <div className="school-presenter-heading">
      <div><strong>{live ? "Sunday School is live" : "Ready for Sunday School"}</strong><span className={`school-tv-status ${room?.connected ? "is-connected" : ""}`}>{!online ? "Reconnecting…" : room?.connected ? room.sound_ready ? "TV ready · sound on" : "TV connected · enable sound on TV" : "TV not connected"}</span></div>
      <a className="text-button compact-button" href={`${import.meta.env.BASE_URL}media/sundayschool`} target="_blank" rel="noreferrer">Open TV</a>
      {live ? <button className="text-button compact-button" disabled={!editable} onClick={() => send("end")} type="button"><CircleStop size={15} /> End Sunday School</button>
        : <button className="primary-button" disabled={!editable || !room || otherLive} onClick={() => send("start")} type="button"><MonitorUp size={16} /> Start Sunday School</button>}
    </div>
    {otherLive && room?.lesson_date ? <div className="school-live-notice" role="status">Another lesson is live ({room.lesson_date}). <button className="text-button" onClick={() => onOpenLesson(room.lesson_date!)} type="button">Go to live lesson</button></div> : null}
    {error ? <p className="status-message" role="alert">{error}</p> : null}
    {presenting ? <>
      <div className="school-live-stage">
        <div className={`school-presenter-preview ${state.blanked ? "is-blanked" : ""}`} aria-label="TV preview">
          <SchoolPresentationContent state={state} />
          {state.blanked ? <span className="school-blank-label">TV blanked · position saved</span> : null}
        </div>
        <div className="school-presenter-prompt">
          <span className="school-live-badge">LIVE ON TV</span><h3>{state.title}</h3>
          {state.kind === "verse" ? <>
            <strong>{versePhase(state.step).mode === "recall" ? "1. Recall last week's verse" : "2. Learn this week's verse"}</strong>
            <p>{versePhase(state.step).mode === "recall" ? "Who remembers? Let the children try, then offer a hint." : "Say it together. Each step covers more words."}</p>
            <p className="school-teacher-verse">{state.step < 7 ? state.last_week.text : state.this_week.text}<br /><small>{state.step < 7 ? state.last_week.reference : state.this_week.reference}</small></p>
          </> : frame ? <><strong>Scene {frame.sceneIndex + 1} of {story!.scenes.length} · {frame.scene.title}</strong><p className="school-story-narration">{frame.teacherText}</p></> : <p>{state.detail}</p>}
          <small>{state.blanked ? "Unblank to carry on from here." : state.step === lastStep ? "Ready to finish this element." : nextLabel}</small>
        </div>
      </div>
      <div className="school-presenter-controls action-row" aria-label="Live element controls">
        <button className="text-button" disabled={!editable || state.blanked || state.step === 0} onClick={() => send("update", { step: state.step - 1 })} type="button"><ArrowLeft size={16} /> Back</button>
        <button className="primary-button school-next-button" disabled={!editable || state.blanked} onClick={() => state.step === lastStep ? send("end_element") : send("update", { step: state.step + 1 })} type="button">{state.step === lastStep ? "Finish element" : nextLabel}<ArrowRight size={16} /></button>
        <button className="text-button" disabled={!editable} onClick={() => send("update", { blanked: !state.blanked })} type="button">{state.blanked ? <Eye size={16} /> : <EyeOff size={16} />}{state.blanked ? "Unblank" : "Blank"}</button>
        {state.step !== lastStep ? <button className="text-button" disabled={!editable} onClick={() => send("end_element")} type="button">End element</button> : null}
        {state.kind === "verse" ? <details className="school-secondary-controls"><summary>More</summary><button className="text-button compact-button" disabled={!editable || state.blanked} onClick={() => send("update", { step: state.step < 7 ? 6 : 7 })} type="button">Show all</button><button className="text-button compact-button" disabled={!editable || state.blanked} onClick={() => send("update", { step: 0 })} type="button">Restart game</button></details> : null}
      </div>
    </> : null}
    {selected && (!presenting || selected.id !== state.element_id) ? <div className="school-selected-element"><div><span className="eyebrow">Selected</span><strong>{selected.title}</strong>{verseMissing ? <small>Add both verse texts and references below.</small> : null}{storyMissing ? <small>Read this passage aloud, or choose an interactive story from Elements.</small> : null}</div><button className="text-button" disabled={!editable || !live || verseMissing || storyMissing || (presenting && state.element_id === selected.id)} onClick={() => snapshot && send("present", { state: snapshot })} type="button"><Play size={15} />{presenting && state.element_id === selected.id ? "Presenting" : "Present"}</button></div>
      : !selected ? <p className="school-presenter-empty">Choose an element from today's board to present.</p> : null}
  </section>;
}
