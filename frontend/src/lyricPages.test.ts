import { expect, it } from 'vitest';
import { songLyricPageBlocks } from './lyricPages';

it('keeps identical split pages at distinct source line ranges', () => {
  const content = 'Sing together\nPraise the Lord\nLift your voice';
  const blocks = songLyricPageBlocks(`[V1]\n${content}\n${content}`, 'V1 V1');
  expect(blocks.map(block => block.parts)).toEqual([[content, content], [content, content]]);
  expect(blocks.map(block => block.partLineOffsets)).toEqual([[1, 4], [1, 4]]);
  expect(blocks.map(block => [block.slideIndex, block.endSlideIndex])).toEqual([[0, 2], [2, 4]]);
});

it('resolves identical text in different sections by section identity and preserves repeated occurrences', () => {
  const blocks = songLyricPageBlocks('[C1]\nSing together\n[C2]\nSing together', 'C1 C2 C1');
  expect(blocks.map(block => block.partLineOffsets)).toEqual([[1], [3], [1]]);
});
