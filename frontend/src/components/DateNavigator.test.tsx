// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DateNavigator } from "./DateNavigator";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => vi.unstubAllGlobals());

it("portals history outside the header and clamps its anchor after viewport changes", () => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  const bounds = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ right: 300, bottom: 60 } as DOMRect);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<DateNavigator label="Date" pickerLabel="Pick" previousLabel="Previous" nextLabel="Next" historyLabel="History" onOpenPicker={() => {}} onPrevious={() => {}} onNext={() => {}} onHistory={() => {}} historyContent={<section className="worship-history-popover">History entries</section>} />));
  const layer = document.querySelector<HTMLElement>(".date-navigator-history-layer")!;
  expect(layer.parentElement).toBe(document.body);
  expect(host.contains(layer)).toBe(false);
  expect(layer.style.top).toBe("66px");
  bounds.mockReturnValue({ right: -100, bottom: 60 } as DOMRect);
  act(() => window.dispatchEvent(new Event("resize")));
  expect(layer.style.left).toBe("12px");
  act(() => root.unmount());
  expect(document.querySelector(".date-navigator-history-layer")).toBeNull();
  host.remove();
  bounds.mockRestore();
});
