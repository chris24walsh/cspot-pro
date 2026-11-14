export interface ScrollPoint { bar: number; y: number }
export interface RepeatedScrollRegion { top: number; bottom: number; activeBottom?: number }

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
export function playbackScrollTarget(points: ScrollPoint[], position: number, activeY: number, viewport: number, repeatedRegion?: RepeatedScrollRegion) {
  // Repeated occurrences share one visible block. Keep the whole block framed
  // instead of advancing with the bar clock and rewinding on each repetition.
  if (repeatedRegion) {
    const height = repeatedRegion.bottom - repeatedRegion.top;
    if (height > 0 && height <= viewport * 0.9) {
      return Math.max(0, (repeatedRegion.top + repeatedRegion.bottom - viewport) / 2);
    }
    if (height > 0) {
      // Keep the section's start in view as long as possible. Once the active
      // line needs scrolling, leave its bottom near the bottom of the viewport.
      return Math.max(0, repeatedRegion.top - viewport * 0.1, (repeatedRegion.activeBottom ?? activeY) - viewport * 0.9);
    }
  }
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
