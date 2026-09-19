import { useEffect, useRef, useState } from "react";
import type { SundaySchoolDisplayState } from "../api";
import { versePhase, verseWords } from "../sundaySchoolPresentation";
import { SundaySchoolSound } from "../sundaySchoolSound";
import { SCHOOL_STORIES, storyFrame } from "../sundaySchoolStories";
import { SundaySchoolStory } from "./SundaySchoolStory";
import { AutoFitSlideText } from "./AutoFitSlideText";
import { useSundaySchoolRoom } from "./useSundaySchoolRoom";

export function VerseGame({ state }: { state: SundaySchoolDisplayState }) {
  const { mode, stage } = versePhase(state.step);
  const verse = mode === "recall" ? state.last_week : state.this_week;
  const referenceHidden = mode === "recall" ? stage < 6 : stage === 6;
  return <div className={`school-verse-game ${stage === 6 ? "is-complete" : ""}`}>
    <p className="school-display-kicker">{mode === "recall" ? "Remember last week's verse" : "Learn this week's verse"}</p>
    <div className="school-verse-paper">
      <AutoFitSlideText text={verse.text} maxFontSize={64} className="school-verse-text">
        {verseWords(verse.text, state.step).map((token, index) => token.word
          ? <span className={`school-verse-word ${token.hidden ? "is-covered" : ""}`} key={index}>{token.text}</span>
          : <span key={index}>{token.text}</span>)}
      </AutoFitSlideText>
      <p className={`school-verse-reference ${referenceHidden ? "is-covered" : ""}`}><span>{verse.reference}{state.translation ? ` · ${state.translation}` : ""}</span></p>
    </div>
    <div className="school-game-reward" aria-label={`Stage ${stage + 1} of 7`}>
      <span className="school-game-stars" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <span className={index < stage ? "earned" : ""} key={index}>★</span>)}</span>
      <strong key={`${mode}-${stage}`}>{stage === 6 ? "Brilliant teamwork!" : mode === "recall" ? "Who remembers?" : "Let's say it together!"}</strong>
    </div>
  </div>;
}

export function SchoolPresentationContent({ state }: { state: SundaySchoolDisplayState }) {
  if (state.kind === "verse") return <VerseGame state={state} />;
  if (state.kind === "story") return <SundaySchoolStory storyId={state.story_id} step={state.step} />;
  return <div className="school-simple-content"><p className="school-display-kicker">{state.kind === "song" ? "Sing and move together" : "Sunday School"}</p><h1>{state.title}</h1><AutoFitSlideText text={state.detail} maxFontSize={48} /></div>;
}

export function SundaySchoolDisplay() {
  const audio = useRef(new SundaySchoolSound());
  const [soundReady, setSoundReady] = useState(false);
  const [soundError, setSoundError] = useState("");
  const { room } = useSundaySchoolRoom(true, true, soundReady);
  const lastCue = useRef<string | null>(null);

  useEffect(() => {
    const path = window.location.pathname.replace(/sunday-school\/?$/, "sundayschool");
    window.history.replaceState(null, "", path);
    return () => audio.current.close();
  }, []);

  useEffect(() => {
    if (!room) return;
    const state = room.state;
    const cue = `${room.lesson_date}:${state.element_id}:${state.kind}:${state.step}`;
    const previous = lastCue.current;
    lastCue.current = cue;
    if (!room.lesson_date || state.kind === "idle" || state.blanked) { audio.current.stop(); return; }
    if (previous === null || previous === cue || !soundReady) return;
    audio.current.stop();
    if (state.kind === "verse") audio.current.play(state.step === 6 || state.step === 13 ? "success" : state.step < 7 ? "hint" : "pop");
    if (state.kind === "story" && SCHOOL_STORIES[state.story_id]) {
      const sound = storyFrame(SCHOOL_STORIES[state.story_id], state.step).sound;
      const forward = !previous.startsWith(`${room.lesson_date}:${state.element_id}:story:`) || state.step > Number(previous.split(":").slice(-1)[0]);
      if (sound && forward) audio.current.play(sound);
    }
  }, [room, soundReady]);

  async function enableSound() {
    void document.documentElement.requestFullscreen?.().catch(() => undefined);
    try {
      await audio.current.enable();
      setSoundReady(true);
      setSoundError("");
      if (audio.current.context) audio.current.context.onstatechange = () => setSoundReady(audio.current.context?.state === "running");
    } catch (cause) { setSoundError(cause instanceof Error ? cause.message : "Tap again to enable sound."); }
  }

  const presenting = room?.lesson_date && room.state.kind !== "idle";
  return <main className={`school-display ${room?.state.blanked ? "is-blanked" : ""}`}>
    <div className="school-display-surface" aria-hidden={Boolean(room?.state.blanked)}>
      {presenting ? <SchoolPresentationContent state={room.state} /> : <div className="school-display-idle"><span aria-hidden="true">✦</span><h1>Sunday School</h1><p>{room?.lesson_date ? "Ready for our next activity" : "Welcome, everyone"}</p></div>}
    </div>
    {!soundReady && !room?.state.blanked ? <div className="school-sound-gate"><div><span aria-hidden="true">♪</span><h1>Sunday School</h1><p>Ready to learn, play and discover together?</p><button className="primary-button" onClick={() => void enableSound()} type="button">Enable Sound &amp; Start Display</button>{soundError ? <p role="alert">{soundError}</p> : null}</div></div> : null}
  </main>;
}
