// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PointerToggle, DEFAULT_MARKER_STYLE } from "./PointerToggle";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("opens marker options with right click and changes thickness and colour without toggling", async () => {
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  const toggle = vi.fn(), style = vi.fn();
  try {
    await act(async () => root.render(<PointerToggle enabled={false} onChange={toggle} markerStyle={DEFAULT_MARKER_STYLE} onStyleChange={style} />));
    const label = container.querySelector("label")!;
    act(() => label.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
    const menu = document.querySelector('[aria-label="Marker options"]')!;
    expect(menu).not.toBeNull();
    act(() => Array.from(menu.querySelectorAll("button")).find((button) => button.textContent === "Thick")!.click());
    expect(style).toHaveBeenCalledWith({ color: "#ffe000", thickness: 60 });
    act(() => menu.querySelector<HTMLButtonElement>('[aria-label="Blue"]')!.click());
    expect(style).toHaveBeenCalledWith({ color: "#58b5ff", thickness: 36 });
    expect(toggle).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); container.remove(); }
});

it("opens with a touch hold without toggling and leaves short taps working", async () => {
  vi.useFakeTimers();
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container); const toggle = vi.fn();
  const down = () => {
    const event = new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 10 });
    Object.defineProperty(event, "pointerType", { value: "touch" }); return event;
  };
  try {
    await act(async () => root.render(<PointerToggle enabled={false} onChange={toggle} markerStyle={DEFAULT_MARKER_STYLE} onStyleChange={() => {}} />));
    const label = container.querySelector("label")!;
    act(() => { label.dispatchEvent(down()); vi.advanceTimersByTime(600); });
    act(() => { label.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); label.click(); });
    expect(document.querySelector('[aria-label="Marker options"]')).not.toBeNull();
    expect(toggle).not.toHaveBeenCalled();
    act(() => { label.dispatchEvent(down()); label.dispatchEvent(new MouseEvent("pointerup", { bubbles: true })); label.click(); });
    expect(toggle).toHaveBeenCalledWith(true);
  } finally { act(() => root.unmount()); container.remove(); vi.useRealTimers(); }
});
