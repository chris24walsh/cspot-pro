// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { copySlideVisual, magnifierTranslation, SlideMagnifier, POINTER_ZOOM } from "./SlideMagnifier";
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("slide magnifier", () => {
  it("centres the sampled point at 2× zoom on different display sizes and at edges", () => {
    for (const [width, height, diameter] of [[400, 225, 96], [1920, 1080, 280]]) {
      for (const [x, y] of [[0, 0], [.25, .75], [1, 1]]) {
        const offset = magnifierTranslation(x, y, width, height, diameter);
        expect(offset.x + x * width * POINTER_ZOOM).toBe(diameter / 2);
        expect(offset.y + y * height * POINTER_ZOOM).toBe(diameter / 2);
      }
    }
  });
  it("copies fitted visual styles and images without pointer UI or media players", () => {
    const stage = document.createElement("div");
    stage.className = "presentation-stage";
    stage.innerHTML = '<div class="live-pointer-layer">Clear highlights</div><div class="slide-visual-transition"><p id="original" style="font-size: 32px">Slide words</p><img src="/slide.png" style="width: 400px; height: 225px"><iframe src="about:blank"></iframe><video></video></div><audio></audio>';
    document.body.append(stage);
    try {
      const copy = copySlideVisual(stage);
      expect(copy.textContent).toBe("Slide words");
      expect(copy.querySelector("p")?.style.fontSize).toBe("32px");
      expect(copy.querySelector("img")?.style.width).toBe("400px");
      expect(copy.querySelector("[id], iframe, video, audio, .live-pointer-layer")).toBeNull();
      expect(copy.getAttribute("aria-hidden")).toBe("true");
    } finally { stage.remove(); }
  });
  it("positions a rendered copy inside the lens as the pointer moves", async () => {
    const stage = document.createElement("div");
    stage.className = "presentation-stage";
    stage.innerHTML = '<div class="slide-visual-transition"><p>Magnified content</p></div>';
    const layer = document.createElement("div");
    layer.className = "live-pointer-layer";
    stage.append(layer);
    document.body.append(stage);
    const root = createRoot(layer);
    vi.spyOn(stage, "getBoundingClientRect").mockReturnValue({ width: 400, height: 225 } as DOMRect);
    try {
      await act(async () => root.render(<SlideMagnifier x={.25} y={.75} />));
      expect(layer.querySelector(".live-pointer-magnifier p")?.textContent).toBe("Magnified content");
      expect(layer.querySelector<HTMLElement>(".live-pointer-magnifier")?.style.left).toBe("25%");
      const lens = layer.querySelector<HTMLElement>(".live-pointer-magnifier")!;
      expect(lens.style.width).toBe("96px");
      expect(lens.style.height).toBe("96px");
      // Simulate distorted visual bounds: pointer moves must not sample these
      // bounds and amplify the distortion into subsequent lens sizes.
      const lensBounds = vi.spyOn(lens, "getBoundingClientRect").mockReturnValue({ width: 960, height: 1600 } as DOMRect);
      await act(async () => root.render(<SlideMagnifier x={.6} y={.4} />));
      expect(layer.querySelector<HTMLElement>(".live-pointer-magnifier")?.style.left).toBe("60%");
      expect(layer.querySelector<HTMLElement>(".live-pointer-magnifier > div")?.style.transform).toBe("translate(-435px, -135px) scale(2)");
      for (const [x, y] of [[.1, .2], [.8, .7], [.3, .4]]) {
        await act(async () => root.render(<SlideMagnifier x={x} y={y} />));
        expect(lens.style.width).toBe("96px");
        expect(lens.style.height).toBe("96px");
      }
      expect(lensBounds).not.toHaveBeenCalled();
    } finally { act(() => root.unmount()); stage.remove(); }
  });
});
