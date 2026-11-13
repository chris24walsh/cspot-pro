import { expect, it, vi } from 'vitest';
import { buildPresentationSlides } from './presentation';
import { serviceSlideMusicDestination, reseatForManualServiceNavigation } from './serviceMusicNavigation';
import { resolveMusicTimingDestination } from './musicTimingDestination';
import type { PlanItem, Song } from './api';

const song = {
  id: 'song', title: 'Refrain', lyrics: '[V1]\nFirst line\nSecond line\n[C]\nRefrain line',
  sequence: 'V1 C V1', chords: null,
  rhythm: { numerator: 4, denominator: 4, bpm: 100, patterns: [], notes: '', intro_bars: 0, markers: [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'v2', section: 'V1', lineIndex: 1, anchorIndex: 3 },
    { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3 },
  ] },
} as unknown as Song;
const item = { id: 'item', plan_id: 'plan', song_id: 'song', item_type: 'song', sequence: '1', title: song.title, comment: null, key_signature: null, files: [], teacher_notes: null } as PlanItem;
const slides = buildPresentationSlides([item], [song]);

it('resolves a repeated service slide to its musical occurrence and reseats only manual navigation', () => {
  const secondOccurrence = slides.filter(slide => slide.slideKind === 'content')[2];
  const resolved = serviceSlideMusicDestination(secondOccurrence, slides, [item], [song]);
  const expected = resolveMusicTimingDestination(song, item.id, { occurrence: 2, lineStart: 1, lineEnd: 3 });
  expect(resolved).not.toBeNull();
  expect(expected).not.toBeNull();
  expect(resolved).toMatchObject({ song_id: 'song', plan_item_id: 'item', first_bar_stop: 0 });
  expect(resolved).toMatchObject(expected!);
  const reseat = vi.fn();
  expect(reseatForManualServiceNavigation(false, secondOccurrence, slides, [item], [song], reseat)).toBe(false);
  expect(reseat).not.toHaveBeenCalled();
  expect(reseatForManualServiceNavigation(true, secondOccurrence, slides, [item], [song], reseat)).toBe(true);
  expect(reseat).toHaveBeenCalledWith(resolved);
});

it('maps a song title slide to its first valid musical destination', () => {
  const title = slides.find(slide => slide.slideKind === 'title')!;
  expect(serviceSlideMusicDestination(title, slides, [item], [song])).toMatchObject({
    song_id: 'song', plan_item_id: 'item', start_index: 0, position: 0,
  });
});
