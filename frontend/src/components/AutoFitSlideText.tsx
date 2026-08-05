import { useLayoutEffect, useRef, useState } from "react";

type AutoFitSlideTextProps = {
  text: string;
  compact?: boolean;
  className?: string;
  maxFontSize?: number;
};

export function AutoFitSlideText({
  text,
  compact = false,
  className = "",
  maxFontSize,
}: AutoFitSlideTextProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [fontSize, setFontSize] = useState<number>(maxFontSize ?? (compact ? 12 : 72));

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const pre = textRef.current;
    if (!frame || !pre) {
      return;
    }

    const min = compact ? 7 : 8;
    const baseMax = maxFontSize ?? (compact ? 14 : 76);

    function availableSpace(element: HTMLElement) {
      const styles = window.getComputedStyle(element);
      const verticalPadding = Number.parseFloat(styles.paddingTop) + Number.parseFloat(styles.paddingBottom);
      return Math.max(0, element.clientHeight - verticalPadding);
    }

    function fits(candidate: number) {
      const activeFrame = frameRef.current;
      const activePre = textRef.current;
      if (!activeFrame || !activePre) {
        return true;
      }

      activePre.style.fontSize = `${candidate}px`;
      const availableHeight = availableSpace(activeFrame);
      const verticalBreathingRoom = Math.max(5, Math.ceil(candidate * (compact ? 0.08 : 0.22)));
      return activePre.scrollHeight + verticalBreathingRoom <= availableHeight;
    }

    function updateSize() {
      const activeFrame = frameRef.current;
      const activePre = textRef.current;
      if (!activeFrame || !activePre) {
        return;
      }

      const frameScale = compact
        ? 1
        : Math.min(activeFrame.clientWidth / 960, activeFrame.clientHeight / 540);
      const max = Math.max(min, Math.round(baseMax * Math.max(0.3, Math.min(2.5, frameScale))));
      let low = min;
      let high = max;
      let best = min;

      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (fits(mid)) {
          best = mid;
          low = mid + 1;
        } else {
          high = mid - 1;
        }
      }

      const settled = Math.max(min, best - (compact ? 0 : 3));
      activePre.style.fontSize = `${settled}px`;
      setFontSize(settled);
    }

    let resizeObserver: ResizeObserver | null = null;
    let firstFrame = 0;
    let secondFrame = 0;
    let settleTimer = 0;

    // Always perform an initial fit, including on browsers without ResizeObserver.
    updateSize();
    firstFrame = window.requestAnimationFrame(() => {
      updateSize();
      secondFrame = window.requestAnimationFrame(updateSize);
    });
    settleTimer = window.setTimeout(updateSize, 250);
    window.addEventListener("resize", updateSize);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(frame);
    }
    void document.fonts?.ready.then(updateSize).catch(() => undefined);

    return () => {
      resizeObserver?.disconnect();
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
      window.clearTimeout(settleTimer);
      window.removeEventListener("resize", updateSize);
    };
  }, [compact, maxFontSize, text]);

  return (
    <div className={`fit-slide-box ${compact ? "fit-slide-box-compact" : "fit-slide-box-live"}`} ref={frameRef}>
      <pre
        className={`fit-slide-text ${compact ? "fit-slide-text-compact" : "fit-slide-text-live"} ${className}`.trim()}
        ref={textRef}
        style={{ fontSize: `${fontSize}px` }}
      >
        {text}
      </pre>
    </div>
  );
}
