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

  useEffect(() => {
    if (!planId || !slideId) return;
    let stopped = false;
    let busy = false;
    let lastSent = 0;
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
      if (Date.now() - lastSent < 500 && !state.visible) return;
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
      const rect = layer.current?.getBoundingClientRect();
      if (!rect) return;
      const state = { slide_id: slideId, ...pointerPosition(event.clientX, event.clientY, rect), visible: true, updated_at: Date.now() };
      pending.current = state;
      accept(state);
      channel?.postMessage({ planId, pointer: state });
    };
    const hide = () => {
      const state = { slide_id: slideId, x: 0, y: 0, visible: false, updated_at: Date.now() };
      pending.current = state;
      accept(state);
      channel?.postMessage({ planId, pointer: state });
      lastSent = 0;
      void send();
    };
    const element = layer.current;
    if (enabled && !blanked && !output) {
      element?.addEventListener("pointermove", move);
      element?.addEventListener("pointerleave", hide);
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
        if (state?.visible) {
          state.updated_at = Date.now();
          channel?.postMessage({ planId, pointer: state });
        }
        await send();
      }
    };
    const timer = window.setInterval(() => void tick(), 100);
    if (output) void tick();
    return () => {
      if (enabled && !output) hide();
      stopped = true;
      clearInterval(timer);
      element?.removeEventListener("pointermove", move);
      element?.removeEventListener("pointerleave", hide);
      window.removeEventListener("blur", hide);
      channel?.close();
      pending.current = null;
    };
  }, [planId, slideId, enabled, output, blanked]);

  const visible = !blanked && (enabled || output) && pointer?.visible && pointer.slide_id === slideId && Date.now() - pointer.updated_at < 2000;
  return <div ref={layer} className={`live-pointer-layer ${enabled && !blanked && !output ? "is-enabled" : ""}`}>
    {visible ? <span className="live-pointer-dot" style={{ left: `${pointer.x * 100}%`, top: `${pointer.y * 100}%` }} /> : null}
    {error && enabled ? <span className="live-pointer-error" role="status">Pointer could not reach live output</span> : null}
  </div>;
}
