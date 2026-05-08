import { useLayoutEffect, useRef, useState } from "react";

type AutoFitSlideTextProps = {
  text: string;
  compact?: boolean;
  className?: string;
};

export function AutoFitSlideText({ text, compact = false, className = "" }: AutoFitSlideTextProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLPreElement>(null);
  const [fontSize, setFontSize] = useState<number>(compact ? 12 : 72);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const pre = textRef.current;
    if (!frame || !pre) {
      return;
    }

    const min = compact ? 8 : 22;
    const max = compact ? 14 : 76;

    function fits(candidate: number) {
      const activeFrame = frameRef.current;
      const activePre = textRef.current;
      if (!activeFrame || !activePre) {
        return true;
      }

      activePre.style.fontSize = `${candidate}px`;
      return activePre.scrollHeight <= activeFrame.clientHeight && activePre.scrollWidth <= activeFrame.clientWidth;
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

      activePre.style.fontSize = `${best}px`;
      setFontSize(best);
    }

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(frame);
    updateSize();

    return () => {
      resizeObserver.disconnect();
    };
  }, [compact, text]);

  return (
    <div className="fit-slide-box" ref={frameRef}>
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
