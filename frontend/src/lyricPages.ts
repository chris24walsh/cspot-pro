import { chordPositionForLine, lyricLines } from './chordSheet';
import { musicalSectionKey } from './lyricTiming';
import { splitOversizedLyricSlide } from './presentation';
import { worshipSequenceBlocks } from './worshipText';

// A page belongs to a sequence occurrence and a source line range, not a text value.
export function songLyricPageBlocks(lyrics: string | null | undefined, sequence?: string | null) {
  const source = lyricLines(lyrics ?? null);
  const compact = (line: string) => line.trim().replace(/\s+/g, ' ');
  const unsectioned = !source.some(line => /^\[[^\]]+\]$/.test(line.trim()));
  let slideIndex = 0;
  return worshipSequenceBlocks(lyrics, sequence).map(block => {
    const content = lyricLines(block.content);
    const sourceOffset = source.findIndex((_line, index) => {
      const section = chordPositionForLine(lyrics ?? null, index)?.section;
      if (!unsectioned && (!section || musicalSectionKey(section) !== musicalSectionKey(block.label))) return false;
      return content.every((line, offset) => source[index + offset] !== undefined && compact(source[index + offset]) === compact(line));
    });
    const parts = splitOversizedLyricSlide(block.content);
    let consumed = 0;
    const partLineOffsets = parts.map(part => {
      const offset = sourceOffset < 0 ? -1 : sourceOffset + consumed;
      consumed += lyricLines(part).length;
      return offset;
    });
    const start = slideIndex;
    slideIndex += parts.length;
    return { ...block, parts, partLineOffsets, slideIndex: start, endSlideIndex: slideIndex };
  });
}
