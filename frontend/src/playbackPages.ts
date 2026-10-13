export interface PlaybackPage { slideIndex: number; firstBar: number }

// A full bar of lead on longer pages; half a bar on single-bar pages so no
// page is skipped at the start of playback.
export function playbackPageMotion(pages: PlaybackPage[], position: number) {
  if (!pages.length || position < 0) return null;
  const turns = pages.map((page, index) => index === 0 ? page.firstBar : page.firstBar - Math.min(1, (page.firstBar - pages[index - 1].firstBar) / 2));
  let index = 0;
  while (index + 1 < pages.length && position >= turns[index + 1]) index++;
  const next = Math.min(index + 1, pages.length - 1);
  const span = turns[next] - turns[index];
  return { slideIndex: pages[index].slideIndex, nextSlideIndex: pages[next].slideIndex, fraction: span > 0 ? Math.max(0, Math.min(1, (position - turns[index]) / span)) : 0 };
}
