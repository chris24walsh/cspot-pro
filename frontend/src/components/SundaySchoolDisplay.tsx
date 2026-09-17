import { useEffect, useState } from "react";
import { getSundaySchoolDisplay, heartbeatSundaySchoolDisplay, type SundaySchoolDisplayState } from "../api";

export const EMPTY_SCHOOL_DISPLAY: SundaySchoolDisplayState = { kind: "blank", title: "", detail: "", reference: "", mode: "learn", stage: 0 };

export function VerseGame({ text, reference, mode, stage }: Pick<SundaySchoolDisplayState, "reference" | "mode" | "stage"> & { text: string }) {
  const tokens = text.match(/\S+|\s+/g) ?? [];
  const wordCount = tokens.filter((token) => !/^\s+$/.test(token)).length;
  let wordIndex = 0;
  return <div className="school-verse-game">
    <p className="school-verse-text">{tokens.map((token, index) => {
      if (/^\s+$/.test(token)) return <span key={index}>{token}</span>;
      const position = wordIndex++;
      const rank = position;
      const hidden = mode === "learn" ? rank < Math.ceil(wordCount * Math.min(stage, 5) / 5) : rank >= Math.ceil(wordCount * Math.min(stage, 6) / 6);
      return <span className={hidden ? "school-verse-word is-hidden" : "school-verse-word"} key={index}>{token}</span>;
    })}</p>
    <p className={mode === "learn" && stage >= 6 || mode === "challenge" && stage === 0 ? "school-verse-reference is-hidden" : "school-verse-reference"}>{reference}</p>
  </div>;
}

export function SundaySchoolDisplay() {
  const date = new URLSearchParams(window.location.search).get("date") || new Date().toISOString().slice(0, 10);
  const [state, setState] = useState<SundaySchoolDisplayState>(EMPTY_SCHOOL_DISPLAY);
  useEffect(() => {
    let active = true;
    const poll = () => {
      void heartbeatSundaySchoolDisplay(date).then((value) => { if (active) setState(value.state); }).catch(() => {
        void getSundaySchoolDisplay(date).then((value) => { if (active) setState(value.state); }).catch(() => undefined);
      });
    };
    poll();
    const timer = window.setInterval(poll, 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [date]);
  return <main className="school-display" aria-live="polite">
    {state.kind === "blank" ? <div className="school-display-waiting">Sunday School</div> : <div className="school-display-content">
      {state.kind === "verse" ? <><p className="school-display-kicker">{state.mode === "learn" ? "This week's memory verse" : "Last week's verse challenge"}</p><VerseGame text={state.detail} reference={state.reference} mode={state.mode} stage={state.stage} /></> : <><p className="school-display-kicker">{state.kind === "song" ? "Action song" : "Sunday School"}</p><h1>{state.title}</h1><p className="school-display-detail">{state.detail}</p></>}
    </div>}
  </main>;
}
