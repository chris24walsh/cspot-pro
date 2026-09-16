import { useEffect, useState, type CSSProperties } from "react";
import type { PresentationSlide } from "../presentation";
import { countdownRemaining } from "../countdown";

export function overlayFontScale(value?: number) {
  return Number.isFinite(value) ? Math.min(200, Math.max(25, value!)) / 100 : 1;
}

export function SlideOverlay({ running = true, slide, startAt, serviceDate = "" }: { running?: boolean; slide: PresentationSlide; startAt?: number; serviceDate?: string }) {
  const [now, setNow] = useState(Date.now());
  const countdown = slide.overlayMode === "countdown";

  useEffect(() => {
    if (!countdown || (!running && !slide.overlayCountdownUntil)) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [countdown, running, slide.id, slide.overlayCountdownUntil, startAt]);

  // Timed Welcome slides render their own clock and message. A stored overlay
  // from the service template would draw a second copy over that message.
  if (!slide.overlayMode || slide.overlayMode === "none" || (running && slide.preServiceTimed && slide.montageImageUrls)) return null;
  const remaining = running || slide.overlayCountdownUntil
    ? slide.overlayCountdownDeadline !== undefined
      ? Math.max(0, Math.ceil((slide.overlayCountdownDeadline - now) / 1000))
      : countdownRemaining(slide.overlayCountdownSeconds ?? 300, startAt, slide.overlayCountdownUntil, serviceDate, now)
    : slide.overlayCountdownSeconds ?? 300;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const panelOpacity = Math.min(100, Math.max(0, slide.overlayPanelOpacity ?? 68)) / 100;
  const backgroundDim = Math.min(80, Math.max(0, slide.overlayBackgroundDim ?? 0)) / 100;
  return <>
    {backgroundDim ? <div className="slide-custom-overlay-dim" style={{ backgroundColor: `rgb(0 0 0 / ${backgroundDim})` }} /> : null}
    <div className={`slide-custom-overlay position-${slide.overlayPosition ?? "bottom"} size-${slide.overlaySize ?? "medium"} font-${slide.overlayFont ?? "sans"}`} style={{ backgroundColor: `rgb(0 0 0 / ${panelOpacity})`, "--overlay-font-scale": overlayFontScale(slide.overlayFontScale) } as CSSProperties}>
      {slide.overlayText ? <span>{slide.overlayText}</span> : null}
      {countdown ? <strong>{clock}</strong> : null}
    </div>
  </>;
}
