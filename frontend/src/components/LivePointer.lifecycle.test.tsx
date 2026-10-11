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
