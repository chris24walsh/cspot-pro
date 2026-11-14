import type { Song } from './api';
import type { PresentationSlide } from './presentation';
import { songLyricPageBlocks } from './lyricPages';
import { repeatedSectionGroups } from './repeatedSections';

export interface CompactSongSlide {
  slide: PresentationSlide;
  key: string;
  label: string;
  repeatSlides: PresentationSlide[];
  repeatStarts: PresentationSlide[];
  firstPart: boolean;
  activeRepeat: number | null;
}

export function compactSongSlides(slides: PresentationSlide[], song?: Pick<Song, 'lyrics' | 'sequence'> | null, activeSlideId?: string): CompactSongSlide[] {
  const fallback = () => slides.map(slide => ({ slide, key: slide.id, label: '', repeatSlides: [slide], repeatStarts: [slide], firstPart: true, activeRepeat: null }));
  if (!song?.lyrics || slides.some(slide => slide.itemType !== 'song' || slide.slideKind !== 'content' || slide.imageUrl)) return fallback();
  const blocks = songLyricPageBlocks(song.lyrics, song.sequence);
  if (!blocks.length || blocks[blocks.length - 1].endSlideIndex !== slides.length) return fallback();
  return repeatedSectionGroups(blocks).flatMap(({ block, occurrences }) => {
    const selectedOccurrence = occurrences.find(occurrence => slides.slice(blocks[occurrence].slideIndex, blocks[occurrence].endSlideIndex).some(slide => slide.id === activeSlideId)) ?? occurrences[0];
    const selected = blocks[selectedOccurrence];
    return block.parts.map((_part, partIndex) => ({
      slide: slides[selected.slideIndex + partIndex],
      key: slides[block.slideIndex + partIndex].id,
      label: block.label,
      repeatSlides: occurrences.map(occurrence => slides[blocks[occurrence].slideIndex + partIndex]),
      repeatStarts: occurrences.map(occurrence => slides[blocks[occurrence].slideIndex]),
      firstPart: partIndex === 0,
      activeRepeat: slides.slice(selected.slideIndex, selected.endSlideIndex).some(slide => slide.id === activeSlideId) ? occurrences.indexOf(selectedOccurrence) : null,
    }));
  });
}
