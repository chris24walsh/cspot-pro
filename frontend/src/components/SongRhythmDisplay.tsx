import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { STROKE_NAMES, STROKE_SYMBOLS, strumCounts, strumPatternForSection, type SongRhythm } from "../songRhythm";
import type { ChordAnnotation } from "../chordSheet";
import type { PracticeMode } from "../musicPractice";
import { RhythmPracticeControls } from "./RhythmPracticeControls";
import { useEscapeClose } from "./useEscapeClose";

export function SongRhythmDisplay({ rhythm, section, lyrics, sequence, previewChord, transpose, title, annotations, onPosition, menuItem = false }: {
  menuItem?: boolean; annotations?: ChordAnnotation[]; onPosition?: (position: number | null, mode: PracticeMode, section: string) => void;
  rhythm?: SongRhythm | null; section?: string | null; lyrics?: string | null; sequence?: string | null;
  previewChord?: string; transpose?: number; title?: string;
}) {
  const [position, setPosition] = useState<{ left: number; top: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const close = () => { setPosition(null); triggerRef.current?.focus(); };
  useEscapeClose(Boolean(position), close, 1);
  useEffect(() => {
    if (!position) return;
    const dismiss = (event: PointerEvent) => {
      if (!panelRef.current?.contains(event.target as Node) && !triggerRef.current?.contains(event.target as Node)) setPosition(null);
    };
    const resize = () => setPosition(null);
    document.addEventListener("pointerdown", dismiss);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      window.removeEventListener("resize", resize);
    };
  }, [position]);
  if (!rhythm) return null;
  const currentPattern = strumPatternForSection(rhythm, section);
  return (
    <div className="song-rhythm-display">
      <button role={menuItem ? "menuitem" : undefined} aria-label="Show song rhythm" aria-expanded={Boolean(position)} className="song-rhythm-summary" ref={triggerRef}
        onClick={() => {
          if (position) { close(); return; }
          const bounds = triggerRef.current!.getBoundingClientRect();
          const width = Math.min(360, window.innerWidth - 24);
          setPosition({ left: Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12)), top: bounds.bottom + 4, width });
        }} title="Show counts, strumming patterns and rhythm notes" type="button">
        <span>{rhythm.numerator}/{rhythm.denominator}</span>
        {currentPattern ? <span className="song-rhythm-inline-pattern" aria-label={`${currentPattern.section} strumming: ${currentPattern.strokes.map((stroke) => STROKE_NAMES[stroke]).join(", ")}`}>{currentPattern.strokes.map((stroke) => STROKE_SYMBOLS[stroke]).join(" ")}</span> : null}
      </button>
      {position ? createPortal(
        <div aria-label="Song rhythm reference" className="song-rhythm-display-panel" ref={panelRef} role="region"
          style={{ position: "fixed", left: position.left, top: position.top, width: position.width, maxHeight: Math.max(100, window.innerHeight - position.top - 12) }}>
          <div className="song-rhythm-heading"><strong>Rhythm · {rhythm.numerator}/{rhythm.denominator}</strong><button aria-label="Close rhythm reference" className="section-icon-button" onClick={close} title="Close rhythm reference" type="button"><X size={14} aria-hidden="true" /></button></div>
          {rhythm.patterns.map((pattern) => {
            const counts = strumCounts(rhythm, pattern);
            return <div className="song-rhythm-reference" key={pattern.section}>
              <strong>{pattern.section === "Default" ? "Whole song" : pattern.section}{pattern.name ? ` · ${pattern.name}` : ""}</strong>
              <div className="song-strum-grid" style={{ gridTemplateColumns: `repeat(${rhythm.numerator * pattern.subdivision}, minmax(22px, 1fr))` }}>
                {pattern.strokes.map((stroke, index) => <div className="song-strum-cell" key={index}><span>{counts[index]}</span><span className="song-strum-symbol" aria-label={STROKE_NAMES[stroke]}>{STROKE_SYMBOLS[stroke]}</span></div>)}
              </div>
            </div>;
          })}
          <RhythmPracticeControls annotations={annotations} onPosition={onPosition} rhythm={rhythm} section={section ?? "Default"} lyrics={lyrics} sequence={sequence} previewChord={previewChord} transpose={transpose} title={title} />
          {rhythm.notes ? <p>{rhythm.notes}</p> : null}
          {rhythm.patterns.length ? <small>↓ Down · ↑ Up · – Rest · × Muted</small> : null}
        </div>, document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ?? document.body,
      ) : null}
    </div>
  );
}
