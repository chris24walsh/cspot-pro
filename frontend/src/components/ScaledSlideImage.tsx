import { useLayoutEffect, useRef, useState } from "react";

type Dimensions = {
  width: number;
  height: number;
};

function fitDimensions(container: Dimensions, image: Dimensions) {
  if (!container.width || !container.height || !image.width || !image.height) {
    return { width: 0, height: 0 };
  }

  const scale = Math.min(container.width / image.width, container.height / image.height);
  return {
    width: Math.floor(image.width * scale),
    height: Math.floor(image.height * scale),
  };
}

export function ScaledSlideImage({ alt, src }: { alt: string; src: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [displaySize, setDisplaySize] = useState<Dimensions>({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const image = imageRef.current;
    if (!frame || !image) {
      return;
    }

    function updateSize() {
      const activeFrame = frameRef.current;
      const activeImage = imageRef.current;
      if (!activeFrame || !activeImage) {
        return;
      }
      const nextSize = fitDimensions(
        { width: activeFrame.clientWidth, height: activeFrame.clientHeight },
        { width: activeImage.naturalWidth, height: activeImage.naturalHeight },
      );
      setDisplaySize(nextSize);
    }

    const resizeObserver = new ResizeObserver(updateSize);
    resizeObserver.observe(frame);

    if (image.complete) {
      updateSize();
    } else {
      image.addEventListener("load", updateSize);
    }

    return () => {
      resizeObserver.disconnect();
      image.removeEventListener("load", updateSize);
    };
  }, [src]);

  return (
    <div className="stage-image-frame" ref={frameRef}>
      <img
        alt={alt}
        className="rendered-slide-image"
        ref={imageRef}
        src={src}
        style={{
          width: displaySize.width ? `${displaySize.width}px` : undefined,
          height: displaySize.height ? `${displaySize.height}px` : undefined,
        }}
      />
    </div>
  );
}
