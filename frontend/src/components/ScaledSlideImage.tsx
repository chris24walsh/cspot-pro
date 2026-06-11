export function ScaledSlideImage({ alt, className = "", src }: { alt: string; className?: string; src: string }) {
  return (
    <div className={`stage-image-frame ${className}`.trim()}>
      <img alt={alt} className="rendered-slide-image" decoding="async" loading="lazy" src={src} />
    </div>
  );
}
