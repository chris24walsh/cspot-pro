// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { LivePointer } from "./LivePointer";
import { getPresentationPointer, updatePresentationPointer } from "../api";
vi.mock("../api", () => ({ getPresentationPointer: vi.fn(), updatePresentationPointer: vi.fn().mockResolvedValue({}) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows matching output pointers and hides them on slide changes and blanking", async () => {
  vi.mocked(getPresentationPointer).mockResolvedValue({ slide_id: "one", x: 0.3, y: 0.7, visible: true, updated_at: Date.now() });
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LivePointer planId="plan" slideId="one" output />));
    expect(container.querySelector<HTMLElement>(".live-pointer-dot")?.style.left).toBe("30%");
    await act(async () => root.render(<LivePointer planId="plan" slideId="two" output />));
    expect(container.querySelector(".live-pointer-dot")).toBeNull();
    await act(async () => root.render(<LivePointer planId="plan" slideId="one" output blanked />));
    expect(container.querySelector(".live-pointer-dot")).toBeNull();
    expect(updatePresentationPointer).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); }
});

it("draws highlights while dragging and keeps them after leaving the preview", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LivePointer planId="plan" slideId="one" enabled />));
    const layer = container.querySelector<HTMLElement>(".live-pointer-layer")!;
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    act(() => layer.dispatchEvent(new MouseEvent("pointermove", { clientX: 20, clientY: 30 })));
    expect(container.querySelector(".live-pointer-dot")).not.toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
    act(() => {
      layer.dispatchEvent(new MouseEvent("pointerdown", { clientX: 10, clientY: 20, button: 0 }));
      layer.dispatchEvent(new MouseEvent("pointermove", { clientX: 50, clientY: 60 }));
      layer.dispatchEvent(new MouseEvent("pointerup", { clientX: 50, clientY: 60 }));
    });
    expect(container.querySelector("polyline")?.getAttribute("points")).toBe("100,200 500,600");
    act(() => layer.dispatchEvent(new MouseEvent("pointerleave")));
    expect(container.querySelector(".live-pointer-dot")).toBeNull();
    expect(container.querySelector("polyline")).not.toBeNull();
    await act(async () => root.render(<LivePointer planId="plan" slideId="two" enabled />));
    expect(container.querySelector("polyline")).toBeNull();
  } finally { act(() => root.unmount()); }
});

function touchEvent(type: string, x: number, y: number, id = 1, primary = true) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, cancelable: true });
  Object.defineProperties(event, { pointerType: { value: "touch" }, pointerId: { value: id }, isPrimary: { value: primary } });
  return event;
}

it("supports touch taps, drag capture, ignores a second finger, and clears highlights", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LivePointer planId="plan" slideId="one" enabled />));
    const layer = container.querySelector<HTMLElement>(".live-pointer-layer")!;
    vi.spyOn(layer, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 100, height: 100 } as DOMRect);
    const capture = vi.fn();
    Object.defineProperty(layer, "setPointerCapture", { value: capture });
    act(() => {
      layer.dispatchEvent(touchEvent("pointerdown", 10, 20));
      layer.dispatchEvent(touchEvent("pointerup", 10, 20));
      layer.dispatchEvent(touchEvent("pointerleave", 10, 20));
    });
    expect(container.querySelector(".live-pointer-dot")).not.toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
    await act(async () => vi.advanceTimersByTime(1300));
    expect(container.querySelector(".live-pointer-dot")).toBeNull();
    act(() => {
      layer.dispatchEvent(touchEvent("pointerdown", 10, 20));
      layer.dispatchEvent(touchEvent("pointerdown", 90, 90, 2, false));
      layer.dispatchEvent(touchEvent("pointermove", 90, 90, 2, false));
      layer.dispatchEvent(touchEvent("pointerup", 90, 90, 2, false));
      layer.dispatchEvent(touchEvent("pointermove", 50, 60));
      layer.dispatchEvent(touchEvent("pointerup", 50, 60));
    });
    expect(capture).toHaveBeenCalledWith(1);
    expect(container.querySelector("polyline")?.getAttribute("points")).toBe("100,200 500,600");
    await act(async () => vi.advanceTimersByTime(1300));
    expect(container.querySelector(".live-pointer-dot")).toBeNull();
    expect(container.querySelector("polyline")).not.toBeNull();
    const clear = container.querySelector<HTMLButtonElement>(".live-pointer-clear")!;
    expect(clear.disabled).toBe(false);
    act(() => clear.click());
    expect(container.querySelector("polyline")).toBeNull();
  } finally { act(() => root.unmount()); vi.useRealTimers(); }
});

it.each(["pointercancel", "lostpointercapture"])("stops %s without leaving the cursor stuck", async (eventType) => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(<LivePointer planId="plan" slideId="one" enabled />));
    const layer = container.querySelector<HTMLElement>(".live-pointer-layer")!;
    act(() => {
      layer.dispatchEvent(touchEvent("pointerdown", 0, 0));
      layer.dispatchEvent(touchEvent(eventType, 0, 0));
      layer.dispatchEvent(touchEvent("pointermove", 50, 50));
    });
    expect(container.querySelector(".live-pointer-dot")).toBeNull();
    expect(container.querySelector("polyline")).toBeNull();
  } finally { act(() => root.unmount()); }
});
