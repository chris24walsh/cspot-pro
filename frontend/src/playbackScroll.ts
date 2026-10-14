export interface ScrollPoint { bar: number; y: number }

function interpolate(points: ScrollPoint[], position: number) {
  if (position <= points[0].bar) return points[0].y;
  for (let index = 1; index < points.length; index++) {
    if (position <= points[index].bar) {
      const before = points[index - 1], after = points[index];
      return before.y + (after.y - before.y) * (position - before.bar) / Math.max(0.001, after.bar - before.bar);
    }
  }
  return points[points.length - 1].y;
}

// Average across four bars, gently favouring the song-wide pace. Visibility
// takes priority when the written density differs too much from that pace.
export function playbackScrollTarget(points: ScrollPoint[], position: number, activeY: number, viewport: number) {
  if (!points.length) return Math.max(0, activeY - viewport / 2);
  let average = 0;
  for (let sample = -8; sample <= 8; sample++) average += interpolate(points, position + sample / 4);
  average /= 17;
  const first = points[0], last = points[points.length - 1];
  const fraction = Math.max(0, Math.min(1, (position - first.bar) / Math.max(1, last.bar - first.bar)));
  const uniform = first.y + (last.y - first.y) * fraction;
  const target = average * 0.8 + uniform * 0.2 - viewport / 2;
  return Math.max(0, Math.min(activeY - viewport * 0.32, Math.max(activeY - viewport * 0.65, target)));
}
