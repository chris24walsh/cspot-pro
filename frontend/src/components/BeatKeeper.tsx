export function visualBeat(position: number | null, count: number): number | null {
  if (position === null || !Number.isFinite(position)) return null;
  const fraction = ((position % 1) + 1) % 1;
  return Math.min(count - 1, Math.floor(fraction * count));
}
export function introBarFills(position: number, bars: number): number[] {
  return Array.from({ length: bars }, (_, index) => Math.max(0, Math.min(1, bars + position - index)));
}

export function BeatKeeper({ position, count, introBars, introChord, introCountIn }: { position: number | null; count: number; introBars?: number; introChord?: string; introCountIn?: boolean }) {
  const beat = visualBeat(position, count);
  const countingIn = Boolean(introCountIn && position !== null && position < -(introBars ?? 0));
  const intro = !countingIn && position !== null && position < 0 && introBars && introBars > 0 ? introBarFills(position, introBars) : null;
  const remaining = intro ? Math.min(introBars!, Math.ceil(-position!)) : 0;
  return <div className="musician-beat-keeper" role="img" aria-label={`${beat === null ? `Beat keeper: ${count} beats` : `Beat ${beat + 1} of ${count}`}${countingIn ? " · Count-in" : ""}${intro ? ` · Intro: ${remaining} bars remaining` : ""}`}>
    {countingIn ? <strong className="musician-count-in-label">Count-in</strong> : null}
    {intro ? <div className="musician-intro-countdown" aria-hidden="true">
      <div className="musician-intro-square" style={{ gridTemplateColumns: `repeat(${Math.ceil(Math.sqrt(intro.length))}, 1fr)`, gridTemplateRows: `repeat(${Math.ceil(intro.length / Math.ceil(Math.sqrt(intro.length)))}, 1fr)` }}>
        {intro.map((fill, index) => <div key={index} className="musician-intro-segment" data-bar={index + 1}><div style={{ transform: `scaleY(${fill})` }} /></div>)}
      </div>
      <strong>{remaining}{introChord ? <small>{introChord}</small> : null}<small>{remaining === 1 ? 'bar to lyrics' : 'bars to lyrics'}</small></strong>
    </div> : null}
    {Array.from({ length: count }, (_, index) => <span key={index} aria-hidden="true" className={`${index === 0 ? "is-downbeat" : ""}${index === beat ? " is-active" : ""}`}>{index + 1}</span>)}
  </div>;
}
