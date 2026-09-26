// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useEscapeClose } from "./useEscapeClose";

const containers: HTMLDivElement[] = [];
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function EscapeTarget({ active, onClose, priority = 0 }: { active: boolean; onClose: () => void; priority?: number }) {
  useEscapeClose(active, onClose, priority);
  return null;
}

afterEach(() => {
  for (const container of containers.splice(0)) container.remove();
});

describe("useEscapeClose", () => {
  it("closes only the topmost active popup", () => {
    const firstClose = vi.fn();
    const secondClose = vi.fn();
    const container = document.createElement("div");
    containers.push(container);
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <>
          <EscapeTarget active onClose={firstClose} />
          <EscapeTarget active onClose={secondClose} />
        </>,
      );
    });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(firstClose).not.toHaveBeenCalled();
    expect(secondClose).toHaveBeenCalledOnce();
    act(() => root.unmount());
  });

  it("lets a nested dialog take priority over its parent overlay", () => {
    const parentClose = vi.fn();
    const dialogClose = vi.fn();
    const container = document.createElement("div");
    containers.push(container);
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <>
          <EscapeTarget active onClose={dialogClose} priority={1} />
          <EscapeTarget active onClose={parentClose} />
        </>
      );
    });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(dialogClose).toHaveBeenCalledOnce();
    expect(parentClose).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
