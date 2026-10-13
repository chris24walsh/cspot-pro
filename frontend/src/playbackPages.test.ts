import { expect, it } from 'vitest';
import { playbackPageMotion } from './playbackPages';
it('arrives at the next page half a bar before its first bar, continuously', () => {
  const pages = [{ slideIndex: 1, firstBar: 0 }, { slideIndex: 2, firstBar: 4 }, { slideIndex: 3, firstBar: 8 }];
  expect(playbackPageMotion(pages, 1.75)).toEqual({ slideIndex: 1, nextSlideIndex: 2, fraction: 0.5 });
  expect(playbackPageMotion(pages, 3.49)?.slideIndex).toBe(1);
  expect(playbackPageMotion(pages, 3.5)).toEqual({ slideIndex: 2, nextSlideIndex: 3, fraction: 0 });
  expect(playbackPageMotion(pages, 7.5)?.slideIndex).toBe(3);
  expect(playbackPageMotion(pages, -1)).toBeNull();
});
it('gives short pages half a bar and respects later playback starts', () => {
  expect(playbackPageMotion([{ slideIndex: 1, firstBar: 0 }, { slideIndex: 2, firstBar: 1 }], 0.49)?.slideIndex).toBe(1);
  expect(playbackPageMotion([{ slideIndex: 1, firstBar: 0 }, { slideIndex: 2, firstBar: 1 }], 0.5)?.slideIndex).toBe(2);
  expect(playbackPageMotion([{ slideIndex: 4, firstBar: 8 }], 8)?.slideIndex).toBe(4);
});
