import type { PlanItem, Song, WorshipMusicTiming } from './api';
import type { PresentationSlide } from './presentation';
import { lyricLines } from './chordSheet';
import { resolveMusicTimingDestination } from './musicTimingDestination';
import { songLyricPageBlocks } from './lyricPages';

export function serviceSlideMusicDestination(
  slide: PresentationSlide | null | undefined,
  slides: PresentationSlide[],
  items: PlanItem[],
  songs: Song[],
): WorshipMusicTiming | null {
  if (!slide) return null;
  const item = items.find(candidate => candidate.id === slide.planItemId);
  const song = item?.song_id ? songs.find(candidate => candidate.id === item.song_id) : null;
  if (!item || !song?.rhythm || !song.lyrics) return null;
  const contentSlides = slides.filter(candidate => candidate.planItemId === item.id && candidate.slideKind === 'content');
  const contentSlide = slide.slideKind === 'content' ? slide : contentSlides[0];
  if (!contentSlide) return null;
  const contentIndex = contentSlides.findIndex(candidate => candidate.id === contentSlide.id);
  const blocks = songLyricPageBlocks(song.lyrics, song.sequence);
  const occurrence = blocks.findIndex(block => contentIndex >= block.slideIndex && contentIndex < block.endSlideIndex);
  const block = blocks[occurrence];
  const partIndex = block ? contentIndex - block.slideIndex : -1;
  const lineStart = block?.partLineOffsets[partIndex] ?? -1;
  if (occurrence < 0 || partIndex < 0 || lineStart < 0) return null;
  return resolveMusicTimingDestination(song, item.id, {
    occurrence,
    lineStart,
    lineEnd: lineStart + lyricLines(block.parts[partIndex]).length,
  });
}

export function reseatForManualServiceNavigation(
  manual: boolean,
  slide: PresentationSlide | null | undefined,
  slides: PresentationSlide[],
  items: PlanItem[],
  songs: Song[],
  reseat: (timing: WorshipMusicTiming) => void,
): boolean {
  if (!manual) return false;
  const timing = serviceSlideMusicDestination(slide, slides, items, songs);
  if (!timing) return false;
  reseat(timing);
  return true;
}
