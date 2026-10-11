import { SlideMagnifier } from "./SlideMagnifier";
import { useEffect, useRef, useState } from "react";
import { getPresentationPointer, updatePresentationPointer, type PresentationPointerState } from "../api";

const CHANNEL = "cspot-pro-live-pointer";

export function pointerPosition(clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">) {
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
  };
}

export function LivePointer({ planId, slideId, enabled = false, output = false, blanked = false }: {
  planId?: string; slideId?: string; enabled?: boolean; output?: boolean; blanked?: boolean;
}) {
  const [pointer, setPointer] = useState<PresentationPointerState | null>(null);
  const [error, setError] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const pending = useRef<PresentationPointerState | null>(null);
  const clearHighlights = useRef<() => void>(() => {});

  useEffect(() => {
    if (!planId || !slideId) return;
    let stopped = false;
    let busy = false;
    let lastSent = 0;
    let drawing = false;
    let activePointer: number | null = null;
    let touchTimer: number | undefined;
    let strokes: Array<Array<{ x: number; y: number }>> = [];
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    const accept = (state: PresentationPointerState | null) => {
      if (!stopped) setPointer(state);
    };
    if (output) channel?.addEventListener("message", (event) => {
      if (event.data.planId === planId) accept(event.data.pointer);
    });
    const send = async () => {
      if (busy || !pending.current) return;
      const state = pending.current;
      if (!state.visible && !state.strokes?.length && state.updated_at <= lastSent) return;
      busy = true;
      try {
        await updatePresentationPointer(planId, state);
        lastSent = Date.now();
        if (!stopped) setError(false);
      } catch {
        if (!stopped) setError(true);
      } finally { busy = false; }
    };
    const move = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.("button")) return;
      if (event.isPrimary === false || (activePointer !== null && (event.pointerId ?? 0) !== activePointer)) return;
      if (event.pointerType === "touch" && activePointer === null) return;
      clearTimeout(touchTimer);
      const rect = layer.current?.getBoundingClientRect();
      if (!rect) return;
      const point = pointerPosition(event.clientX, event.clientY, rect);
      if (drawing && strokes.length) {
        const stroke = strokes[strokes.length - 1];
        const previous = stroke[stroke.length - 1];
        if (!previous || Math.hypot(point.x - previous.x, point.y - previous.y) > 0.003) {
          if (stroke.length >= 100) strokes[strokes.length - 1] = stroke.filter((_, index) => index % 2 === 0);
          strokes[strokes.length - 1].push(point);
        }
      }
      const state = { slide_id: slideId, ...point, strokes: strokes.map((stroke) => [...stroke]), visible: true, updated_at: Date.now() };
      pending.current = state;
      accept(state);
      channel?.postMessage({ planId, pointer: state });
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || activePointer !== null || (event.target as Element | null)?.closest?.("button")) return;
      activePointer = event.pointerId ?? 0;
      clearTimeout(touchTimer);
      event.preventDefault();
      if (strokes.length >= 50) strokes.shift();
      strokes.push([]);
      drawing = true;
      layer.current?.setPointerCapture?.(event.pointerId);
      move(event);
    };
    const end = (event: PointerEvent) => {
      if (activePointer !== (event.pointerId ?? 0)) return;
      if (event.type === "pointerup") move(event);
      drawing = false;
      activePointer = null;
      // A tap points; only a drag leaves an annotation.
      if (strokes[strokes.length - 1]?.length < 2) strokes.pop();
      if (pending.current) {
        pending.current = { ...pending.current, strokes: strokes.map((stroke) => [...stroke]), updated_at: Date.now() };
        accept(pending.current);
        channel?.postMessage({ planId, pointer: pending.current });
      }
      if (layer.current?.hasPointerCapture?.(event.pointerId)) layer.current.releasePointerCapture(event.pointerId);
      if (event.type !== "pointerup") hide();
      else if (event.pointerType === "touch" || event.pointerType === "pen") touchTimer = window.setTimeout(hide, 1200);
    };
    const hide = () => {
      clearTimeout(touchTimer);
      drawing = false;
      activePointer = null;
      const state = { slide_id: slideId, x: 0, y: 0, strokes: strokes.map((stroke) => [...stroke]), visible: false, updated_at: Date.now() };
      pending.current = state;
      accept(state);
      channel?.postMessage({ planId, pointer: state });
      lastSent = 0;
      void send();
    };
    const leave = (event: PointerEvent) => {
      if (activePointer !== null || touchTimer !== undefined && (event.pointerType === "touch" || event.pointerType === "pen")) return;
      hide();
    };
    clearHighlights.current = () => {
      strokes = [];
      hide();
    };
    const element = layer.current;
    if (enabled && !blanked && !output) {
      element?.addEventListener("pointerdown", start);
      element?.addEventListener("pointerup", end);
      element?.addEventListener("pointercancel", end);
      element?.addEventListener("lostpointercapture", end);
      element?.addEventListener("pointermove", move);
      element?.addEventListener("pointerleave", leave);
      window.addEventListener("blur", hide);
    }
    const tick = async () => {
      if (output) {
        if (busy) return;
        busy = true;
        try { accept(await getPresentationPointer(planId)); } catch { accept(null); }
        finally { busy = false; }
      } else if (enabled && !blanked) {
        const state = pending.current;
        if (state && (state.visible || state.strokes?.length)) {
          state.updated_at = Date.now();
          channel?.postMessage({ planId, pointer: state });
        }
        await send();
      }
    };
    const timer = window.setInterval(() => void tick(), 100);
    if (output) void tick();
    return () => {
      clearTimeout(touchTimer);
      clearHighlights.current = () => {};
      strokes = [];
      if (enabled && !output) hide();
      stopped = true;
      clearInterval(timer);
      element?.removeEventListener("pointerdown", start);
      element?.removeEventListener("pointerup", end);
      element?.removeEventListener("pointercancel", end);
      element?.removeEventListener("lostpointercapture", end);
      element?.removeEventListener("pointermove", move);
      element?.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", hide);
      channel?.close();
      pending.current = null;
    };
  }, [planId, slideId, enabled, output, blanked]);

  const active = !blanked && (enabled || output) && pointer != null && pointer.slide_id === slideId && Date.now() - pointer.updated_at < 2000;
  const visible = active && pointer?.visible;
  return <div ref={layer} className={`live-pointer-layer ${enabled && !blanked && !output ? "is-enabled" : ""}`}>
    {active && pointer?.strokes?.length ? <svg className="live-highlighter" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">{pointer.strokes.map((stroke, index) => <polyline key={index} points={stroke.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} />)}</svg> : null}
    {visible ? <SlideMagnifier x={pointer.x} y={pointer.y} /> : null}
    {enabled && !output && !blanked ? <button className="live-pointer-clear" type="button" disabled={!active || !pointer?.strokes?.length} onClick={() => clearHighlights.current()} title="Clear highlights on this slide">Clear highlights</button> : null}
    {error && enabled ? <span className="live-pointer-error" role="status">Pointer could not reach live output</span> : null}
  </div>;
}
