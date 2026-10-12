import { useLayoutEffect, useRef } from "react";

export const POINTER_ZOOM = 2;
const LENS_BORDER = 3;

export function magnifierDiameter(width: number, video = false) {
  return Math.min(video ? 140 : 280, Math.max(video ? 64 : 90, width * (video ? .12 : .24)));
}

export function magnifierTranslation(x: number, y: number, width: number, height: number, diameter: number) {
  return { x: diameter / 2 - x * width * POINTER_ZOOM, y: diameter / 2 - y * height * POINTER_ZOOM };
}

// Copy the rendered visual, including fitted text and image dimensions, without
// mounting another player, countdown, or presentation controller.
export function copySlideVisual(stage: HTMLElement) {
  const copy = stage.cloneNode(false) as HTMLElement;
  function clone(source: HTMLElement): HTMLElement {
    const target = source.cloneNode(false) as HTMLElement;
    const styles = getComputedStyle(source);
    for (const property of Array.from(styles)) target.style.setProperty(property, styles.getPropertyValue(property));
    target.removeAttribute("id");
    target.removeAttribute("tabindex");
    target.style.animation = "none";
    target.style.transition = "none";
    for (const child of Array.from(source.childNodes)) {
      if (child instanceof HTMLElement) {
        if (["IFRAME", "VIDEO", "AUDIO"].includes(child.tagName)) continue;
        target.append(clone(child));
      } else target.append(child.cloneNode(true));
    }
    return target;
  }
  const styles = getComputedStyle(stage);
  for (const property of Array.from(styles)) copy.style.setProperty(property, styles.getPropertyValue(property));
  copy.removeAttribute("id");
  copy.setAttribute("aria-hidden", "true");
  copy.inert = true;
  for (const child of Array.from(stage.children)) {
    if (child instanceof HTMLElement && (child.classList.contains("slide-visual-transition") || child.classList.contains("stage-title"))) copy.append(clone(child));
  }
  Object.assign(copy.style, { position: "absolute", left: "0", top: "0", margin: "0", pointerEvents: "none", transformOrigin: "0 0", animation: "none", transition: "none" });
  return copy;
}

export function SlideMagnifier({ x, y }: { x: number; y: number }) {
  const lens = useRef<HTMLSpanElement>(null);
  const snapshot = useRef<HTMLElement | null>(null);
  const geometry = useRef({ width: 0, height: 0, diameter: 90 });
  const point = useRef({ x, y });
  point.current = { x, y };

  useLayoutEffect(() => {
    const element = lens.current;
    const stage = element?.closest(".presentation-stage, .slideshow-stage") as HTMLElement | null;
    if (!element || !stage) return;
    let frame = 0;
    const position = () => {
      if (!snapshot.current) return;
      const { width, height, diameter } = geometry.current;
      const offset = magnifierTranslation(point.current.x, point.current.y, width, height, diameter - LENS_BORDER * 2);
      snapshot.current.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${POINTER_ZOOM})`;
    };
    const onLoad = (event: Event) => {
      if (!(event.target as Element | null)?.closest?.(".live-pointer-layer")) schedule();
    };
    const refresh = () => {
      frame = 0;
      const video = stage.querySelector(".slide-visual-transition .stage-video-frame");
      element.classList.toggle("is-video", Boolean(video));
      const copy = copySlideVisual(stage);
      const box = stage.getBoundingClientRect();
      // Measure only the original stage. Lens content and transforms must never
      // feed back into its sizing, including in mobile/zoomed browser layouts.
      const width = stage.clientWidth || box.width;
      const height = stage.clientHeight || box.height;
      const diameter = magnifierDiameter(width, Boolean(video));
      geometry.current = { width, height, diameter };
      element.style.width = `${diameter}px`;
      element.style.height = `${diameter}px`;
      copy.style.width = `${width}px`;
      copy.style.height = `${height}px`;
      element.replaceChildren(copy);
      snapshot.current = copy;
      position();
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(refresh); };
    const mutations = new MutationObserver((records) => {
      if (records.some((record) => !(record.target instanceof Element ? record.target : record.target.parentElement)?.closest(".live-pointer-layer"))) schedule();
    });
    mutations.observe(stage, { subtree: true, childList: true, characterData: true, attributes: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(stage);
    window.addEventListener("resize", schedule);
    stage.addEventListener("load", onLoad, true);
    refresh();
    return () => {
      mutations.disconnect(); resize?.disconnect(); cancelAnimationFrame(frame);
      stage.removeEventListener("load", onLoad, true);
      window.removeEventListener("resize", schedule);
      snapshot.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const element = lens.current;
    const stage = element?.closest(".presentation-stage, .slideshow-stage");
    if (!element || !stage || !snapshot.current) return;
    const { width, height, diameter } = geometry.current;
    const offset = magnifierTranslation(x, y, width, height, diameter - LENS_BORDER * 2);
    snapshot.current.style.transform = `translate(${offset.x}px, ${offset.y}px) scale(${POINTER_ZOOM})`;
  }, [x, y]);

  return <span ref={lens} className="live-pointer-dot live-pointer-magnifier" aria-hidden="true" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />;
}
