import { useEffect, useState } from "react";
import type { PresentationSlide } from "../presentation";

export function SlideOverlay({ running = true, slide, startAt }: { running?: boolean; slide: PresentationSlide; startAt?: number }) {
  const [now, setNow] = useState(Date.now());
  const countdown = slide.overlayMode === "countdown";

  useEffect(() => {
    if (!countdown || !running) return undefined;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [countdown, running, slide.id, startAt]);

  if (!slide.overlayMode || slide.overlayMode === "none") return null;
  const remaining = running
    ? Math.max(0, (slide.overlayCountdownSeconds ?? 300) - Math.floor((now - (startAt ?? now)) / 1000))
    : slide.overlayCountdownSeconds ?? 300;
  const clock = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, "0")}`;
  const panelOpacity = Math.min(100, Math.max(0, slide.overlayPanelOpacity ?? 68)) / 100;
  const backgroundDim = Math.min(80, Math.max(0, slide.overlayBackgroundDim ?? 0)) / 100;
  return <>
    {backgroundDim ? <div className="slide-custom-overlay-dim" style={{ backgroundColor: `rgb(0 0 0 / ${backgroundDim})` }} /> : null}
    <div className={`slide-custom-overlay position-${slide.overlayPosition ?? "bottom"} size-${slide.overlaySize ?? "medium"} font-${slide.overlayFont ?? "sans"}`} style={{ backgroundColor: `rgb(0 0 0 / ${panelOpacity})` }}>
      {slide.overlayText ? <span>{slide.overlayText}</span> : null}
      {countdown ? <strong>{clock}</strong> : null}
    </div>
  </>;
}
