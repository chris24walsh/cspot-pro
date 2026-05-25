export function ScaledSlideImage({ alt, src }: { alt: string; src: string }) {
  return (
    <div className="stage-image-frame">
      <img alt={alt} className="rendered-slide-image" src={src} />
    </div>
  );
}
