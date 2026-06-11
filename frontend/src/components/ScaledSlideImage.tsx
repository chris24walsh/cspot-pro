import { useLayoutEffect, useRef, useState } from "react";

type ScaledSlideImageProps = {
  alt: string;
  className?: string;
  src: string;
};

export function ScaledSlideImage({ alt, className = "", src }: ScaledSlideImageProps) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState({ height: 0, width: 0 });
  const [displaySize, setDisplaySize] = useState<{ height?: number; width?: number }>({});

  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !naturalSize.height || !naturalSize.width) {
      return undefined;
    }

    function updateSize() {
      const activeFrame = frameRef.current;
      if (!activeFrame) {
        return;
      }
      const frameBox = activeFrame.getBoundingClientRect();
      const frameWidth = Math.max(frameBox.width, 0);
      const frameHeight = Math.max(frameBox.height, 0);
      if (!frameWidth || !frameHeight) {
        return;
      }

      const scale = Math.min(frameWidth / naturalSize.width, frameHeight / naturalSize.height);
      setDisplaySize({
        height: Math.floor(naturalSize.height * scale),
        width: Math.floor(naturalSize.width * scale),
      });
    }

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(frame);
    return () => observer.disconnect();
  }, [naturalSize.height, naturalSize.width]);

  function updateNaturalSize() {
    const image = imageRef.current;
    if (!image?.naturalHeight || !image.naturalWidth) {
      return;
    }
    setNaturalSize({ height: image.naturalHeight, width: image.naturalWidth });
  }

  return (
    <div className={`stage-image-frame ${className}`.trim()} ref={frameRef}>
      <img
        alt={alt}
        className="rendered-slide-image"
        decoding="async"
        loading="lazy"
        onLoad={updateNaturalSize}
        ref={imageRef}
        src={src}
        style={{
          height: displaySize.height ? `${displaySize.height}px` : undefined,
          width: displaySize.width ? `${displaySize.width}px` : undefined,
        }}
      />
    </div>
  );
}
