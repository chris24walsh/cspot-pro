import { DEFAULT_MARKER_STYLE } from "./PointerToggle";
import { SlideMagnifier } from "./SlideMagnifier";
import { useEffect, useRef, useState } from "react";
import { getPresentationPointer, updatePresentationPointer, type PresentationPointerState, type PresentationMarkerStyle } from "../api";

const CHANNEL = "cspot-pro-live-pointer";

export function pointerPosition(clientX: number, clientY: number, rect: Pick<DOMRect, "left" | "top" | "width" | "height">) {
  return {
    x: Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width))),
    y: Math.max(0, Math.min(1, (clientY - rect.top) / Math.max(1, rect.height))),
  };
}

export function LivePointer({ planId, slideId, enabled = false, output = false, blanked = false, markerStyle = DEFAULT_MARKER_STYLE, zoomEnabled = false }: {
  planId?: string; slideId?: string; enabled?: boolean; output?: boolean; blanked?: boolean; markerStyle?: PresentationMarkerStyle; zoomEnabled?: boolean;
}) {
  const [pointer, setPointer] = useState<PresentationPointerState | null>(null);
  const [error, setError] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const pending = useRef<PresentationPointerState | null>(null);
  const zoom = useRef(zoomEnabled);
  zoom.current = zoomEnabled;
  const settings = useRef(markerStyle);
  settings.current = markerStyle;

  useEffect(() => {
    if (!planId || !slideId) return;
    let stopped = false;
    let busy = false;
    let sendInFlight: Promise<PresentationPointerState> | null = null;
    let lastSent = 0;
    let drawing = false;
    let localActive = false;
    let hasPublished = false;
    let needsSend = false;
    let activePointer: number | null = null;
    let touchTimer: number | undefined;
    let strokes: Array<Array<{ x: number; y: number }>> = [];
    let strokeStyles: PresentationMarkerStyle[] = [];
    const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel(CHANNEL);
    const accept = (state: PresentationPointerState | null) => {
      if (!stopped) setPointer(state);
    };
    const receive = (state: PresentationPointerState | null) => {
      if (localActive || needsSend || stopped) return;
      if (state?.slide_id === slideId) {
        strokes = state.strokes?.map((stroke) => [...stroke]) ?? [];
        strokeStyles = strokes.map((_, index) => state.stroke_styles?.[index] ?? DEFAULT_MARKER_STYLE);
      } else { strokes = []; strokeStyles = []; }
      accept(state);
    };
    channel?.addEventListener("message", (event) => {
      if (event.data.planId === planId) receive(event.data.pointer);
    });
    const send = async () => {
      if (busy || !pending.current) return;
      const state = pending.current;
      if (!state.visible && !state.strokes?.length && state.updated_at <= lastSent) return;
      busy = true;
      try {
        sendInFlight = updatePresentationPointer(planId, state);
        await sendInFlight;
        if (pending.current === state) needsSend = false;
        lastSent = Date.now();
        if (!stopped) setError(false);
      } catch {
        if (!stopped) setError(true);
      } finally { busy = false; sendInFlight = null; }
    };
    const move = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.("button")) return;
      if (event.isPrimary === false || (activePointer !== null && (event.pointerId ?? 0) !== activePointer)) return;
      if (event.pointerType === "touch" && activePointer === null) return;
      clearTimeout(touchTimer);
      localActive = true;
      hasPublished = true;
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
      const state = { slide_id: slideId, zoom: zoom.current, ...point, strokes: strokes.map((stroke) => [...stroke]), stroke_styles: [...strokeStyles], visible: !drawing, updated_at: Date.now() };
      pending.current = state;
      needsSend = true;
      accept(state);
      channel?.postMessage({ planId, pointer: state });
    };
    const start = (event: PointerEvent) => {
      if (event.button !== 0 || event.isPrimary === false || activePointer !== null || (event.target as Element | null)?.closest?.("button")) return;
      activePointer = event.pointerId ?? 0;
      clearTimeout(touchTimer);
      event.preventDefault();
      if (strokes.length >= 50) { strokes.shift(); strokeStyles.shift(); }
      strokes.push([]);
      strokeStyles.push({ ...settings.current });
      drawing = true;
      layer.current?.setPointerCapture?.(event.pointerId);
      move(event);
    };
    const end = (event: PointerEvent) => {
      if (activePointer !== (event.pointerId ?? 0)) return;
      if (event.type === "pointerup") move(event);
      drawing = false;
      activePointer = null;
      // Keep the finished mark unobscured; taps still show the magnifier.
      const dragged = (strokes[strokes.length - 1]?.length ?? 0) > 1;
      if (!dragged) { strokes.pop(); strokeStyles.pop(); }
      if (pending.current) {
        pending.current = { ...pending.current, visible: !dragged && event.type === "pointerup", strokes: strokes.map((stroke) => [...stroke]), stroke_styles: [...strokeStyles], updated_at: Date.now() };
        needsSend = true;
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
      const state = { slide_id: slideId, x: 0, y: 0, strokes: strokes.map((stroke) => [...stroke]), stroke_styles: [...strokeStyles], visible: false, updated_at: Date.now() };
      pending.current = state;
      needsSend = true;
      accept(state);
      channel?.postMessage({ planId, pointer: state });
      lastSent = 0;
      void send();
      localActive = false;
    };
    const leave = (event: PointerEvent) => {
      if (activePointer !== null || touchTimer !== undefined && (event.pointerType === "touch" || event.pointerType === "pen")) return;
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
      if (needsSend && enabled && !blanked && !output) { await send(); return; }
      if (output || !enabled || !localActive) {
        if (busy) return;
        busy = true;
        try { receive(await getPresentationPointer(planId)); } catch { /* Preserve completed annotations during a temporary network gap. */ }
        finally { busy = false; }
      } else if (enabled && !blanked) {
        const state = pending.current;
        if (state && (state.visible || state.strokes?.length)) {
          state.zoom = zoom.current;
          state.updated_at = Date.now();
          channel?.postMessage({ planId, pointer: state });
        }
        await send();
      }
    };
    const timer = window.setInterval(() => void tick(), 100);
    void tick();
    return () => {
      clearTimeout(touchTimer);
      strokes = [];
      strokeStyles = [];
      if (enabled && !output && hasPublished) {
        const cleared: PresentationPointerState = { slide_id: slideId, x: 0, y: 0, visible: false, strokes: [], stroke_styles: [], updated_at: Date.now() };
        accept(cleared);
        channel?.postMessage({ planId, pointer: cleared });
        // Clear after any outstanding stroke update so it cannot restore marks.
        const clearRemote = () => updatePresentationPointer(planId, cleared).catch(() => {});
        if (sendInFlight) void sendInFlight.then(clearRemote, clearRemote);
        else void clearRemote();
      }
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

  const active = !blanked && pointer != null && pointer.slide_id === slideId;
  const visible = active && (enabled || output) && pointer?.visible && Date.now() - pointer.updated_at < 2000;
  return <div ref={layer} className={`live-pointer-layer ${enabled && !blanked && !output ? "is-enabled" : ""}`}>
    {active && pointer?.strokes?.length ? <svg className="live-highlighter" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-hidden="true">{pointer.strokes.map((stroke, index) => {
      const style = pointer.stroke_styles?.[index] ?? DEFAULT_MARKER_STYLE;
      return stroke.length === 1 ? <circle key={index} cx={stroke[0].x * 1000} cy={stroke[0].y * 1000} r={style.thickness / 2} style={{ fill: style.color }} /> : <polyline key={index} points={stroke.map((point) => `${point.x * 1000},${point.y * 1000}`).join(" ")} style={{ stroke: style.color, strokeWidth: style.thickness }} />;
    })}</svg> : null}
    {visible ? (enabled && !output ? zoomEnabled : pointer.zoom) ? <SlideMagnifier x={pointer.x} y={pointer.y} /> : <span className="live-pointer-dot live-pointer-ring" aria-hidden="true" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} /> : null}
    {error && enabled ? <span className="live-pointer-error" role="status">Pointer could not reach live output</span> : null}
  </div>;
}
