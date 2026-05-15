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

    const min = compact ? 7 : 18;
    const max = maxFontSize ?? (compact ? 14 : 76);

    function fits(candidate: number) {
      const activeFrame = frameRef.current;
      const activePre = textRef.current;
      if (!activeFrame || !activePre) {
        return true;
      }

      activePre.style.fontSize = `${candidate}px`;
      const verticalBreathingRoom = Math.max(3, Math.ceil(candidate * (compact ? 0.08 : 0.14)));
      return (
        activePre.scrollHeight + verticalBreathingRoom <= activeFrame.clientHeight &&
        activePre.scrollWidth <= activeFrame.clientWidth
      );
    }

    function updateSize() {
      const activeFrame = frameRef.current;
      const activePre = textRef.current;
      if (!activeFrame || !activePre) {
        return;
      }

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

      const settled = Math.max(min, best - (compact ? 0 : 2));
      activePre.style.fontSize = `${settled}px`;
      setFontSize(settled);
    }

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(frame);
    updateSize();

    return () => {
      resizeObserver.disconnect();
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
