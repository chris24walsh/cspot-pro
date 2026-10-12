import { MousePointer2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PresentationMarkerStyle } from "../api";

export const DEFAULT_MARKER_STYLE: PresentationMarkerStyle = { color: "#ffe000", thickness: 36 };
const COLORS = [["Yellow", "#ffe000"], ["Red", "#ff4545"], ["Green", "#54e37a"], ["Blue", "#58b5ff"], ["Purple", "#ce83ff"], ["White", "#ffffff"]];

export function PointerToggle({ enabled, onChange, markerStyle, onStyleChange, zoomEnabled = false, onZoomChange }: {
  zoomEnabled?: boolean; onZoomChange?: (value: boolean) => void;
  enabled: boolean; onChange: (value: boolean) => void;
  markerStyle: PresentationMarkerStyle; onStyleChange: (value: PresentationMarkerStyle) => void;
}) {
  const label = useRef<HTMLLabelElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const timer = useRef<number>();
  const suppressClick = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const open = () => {
    const box = label.current?.getBoundingClientRect();
    if (box) setPosition({ left: Math.max(8, Math.min(box.left, window.innerWidth - 264)), top: Math.max(8, Math.min(box.bottom + 6, window.innerHeight - 270)) });
  };
  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    if (!position) return;
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !label.current?.contains(event.target as Node)) setPosition(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setPosition(null); label.current?.querySelector<HTMLInputElement>("input")?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", key, true); };
  }, [position]);

  return <>
    <label ref={label} className="stage-pointer-switch stage-toggle-switch" title={`${enabled ? "Pointer on" : "Pointer off"} — right-click or hold for marker options`}
      onContextMenu={(event) => { event.preventDefault(); clearTimeout(timer.current); open(); }}
      onPointerDown={(event) => {
        suppressClick.current = false;
        if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = window.setTimeout(() => { suppressClick.current = true; open(); }, 550);
      }}
      onPointerMove={(event) => { if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 10) clearTimeout(timer.current); }}
      onPointerUp={() => clearTimeout(timer.current)} onPointerCancel={() => clearTimeout(timer.current)}
      onClickCapture={(event) => { if (suppressClick.current) { event.preventDefault(); event.stopPropagation(); } }}
      onKeyDown={(event) => { if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") { event.preventDefault(); open(); } }}>
      <span className="stage-toggle-label"><MousePointer2 size={13} aria-hidden="true" />Pointer</span>
      <input aria-label="Enable live pointer" checked={enabled} onChange={(event) => onChange(event.target.checked)} type="checkbox" />
      <span className="stage-theme-slider" aria-hidden="true" />
    </label>
    {position ? createPortal(<div ref={menu} className="pointer-marker-menu" role="dialog" aria-label="Marker options" style={position}>
      <div className="pointer-marker-heading"><strong>Marker options</strong><button type="button" aria-label="Close marker options" onClick={() => setPosition(null)}><X size={16} /></button></div>
      <label className="pointer-zoom-option"><span>Zoom</span><input aria-label="Enable pointer zoom" type="checkbox" checked={zoomEnabled} onChange={(event) => onZoomChange?.(event.target.checked)} /></label>
      <span>Thickness</span><div className="pointer-marker-thickness">{[["Thin", 16], ["Medium", 36], ["Thick", 60]].map(([name, thickness]) => <button key={name} type="button" aria-pressed={markerStyle.thickness === thickness} onClick={() => onStyleChange({ ...markerStyle, thickness: Number(thickness) })}>{name}</button>)}</div>
      <span>Colour</span><div className="pointer-marker-colors">{COLORS.map(([name, color]) => <button key={color} type="button" aria-label={name} aria-pressed={markerStyle.color === color} style={{ background: color }} onClick={() => onStyleChange({ ...markerStyle, color })} />)}</div>
    </div>, document.body) : null}
  </>;
}
