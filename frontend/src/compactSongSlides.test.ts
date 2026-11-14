import { expect, it } from 'vitest';
import type { PlanItem, Song } from './api';
import { buildPresentationSlides } from './presentation';
import { compactSongSlides } from './compactSongSlides';
import { repeatedSectionGroups } from './repeatedSections';

function fixture(sequence = 'V1 Cx3 V2 C') {
  const song = { id: 'song', title: 'Song', lyrics: '[V1]\nVerse one\n[C]\nLine one\nLine two\nLine three\nLine four\nLine five\nLine six\n[V2]\nVerse two', sequence } as Song;
  const item = { id: 'item', item_type: 'song', song_id: song.id, title: song.title, sequence: '1', files: [] } as unknown as PlanItem;
  const slides = buildPresentationSlides([item], [song]).filter(slide => slide.slideKind === 'content');
  return { song, slides };
}

it('groups whole sections without dropping their distinct pages or later chorus entries', () => {
  const { song, slides } = fixture();
  const entries = compactSongSlides(slides, song);
  expect(entries.map(entry => entry.label)).toEqual(['V1', 'C', 'C', 'V2', 'C', 'C']);
  expect(entries.map(entry => entry.repeatSlides.length)).toEqual([1, 3, 3, 1, 1, 1]);
  expect(entries[1].repeatStarts.map(slide => slide.id)).toEqual([slides[1].id, slides[3].id, slides[5].id]);
  expect(entries[1].slide.text).toContain('Line one');
  expect(entries[2].slide.text).toContain('Line four');
  expect(slides).toHaveLength(10); // original playback sequence is intact
});

it('selects the actual active occurrence for every page and retains stable tile keys', () => {
  const { song, slides } = fixture();
  const first = compactSongSlides(slides, song);
  const active = compactSongSlides(slides, song, slides[4].id);
  expect(active[1].slide.id).toBe(slides[3].id);
  expect(active[2].slide.id).toBe(slides[4].id);
  expect(active[1].activeRepeat).toBe(1);
  expect(active[1].key).toBe(first[1].key);
  expect(active[2].repeatSlides.map(slide => slide.id)).toContain(slides[4].id);
});

it('preserves variant identity and leaves non-song or imported slides alone', () => {
  expect(repeatedSectionGroups([{ label: 'C', content: 'Same' }, { label: 'C2', content: 'Same' }, { label: 'C', content: 'Different' }])).toHaveLength(3);
  const { song, slides } = fixture();
  const imported = slides.map(slide => ({ ...slide, imageUrl: '/deck.png' }));
  expect(compactSongSlides(imported, song).map(entry => entry.slide)).toEqual(imported);
  expect(compactSongSlides(slides).map(entry => entry.slide)).toEqual(slides);
});
