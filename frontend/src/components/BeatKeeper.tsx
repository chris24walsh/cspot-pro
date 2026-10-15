export function visualBeat(position: number | null, count: number): number | null {
  if (position === null || !Number.isFinite(position)) return null;
  const fraction = ((position % 1) + 1) % 1;
  return Math.min(count - 1, Math.floor(fraction * count));
}
export function BeatKeeper({ position, count }: { position: number | null; count: number }) {
  const beat = visualBeat(position, count);
  return <div className="musician-beat-keeper" role="img" aria-label={beat === null ? `Beat keeper: ${count} beats` : `Beat ${beat + 1} of ${count}`}>
    {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true" className={`${index === 0 ? "is-downbeat" : ""}${index === beat ? " is-active" : ""}`}>{index + 1}</span>)}
  </div>;
}
