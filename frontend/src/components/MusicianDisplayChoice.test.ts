// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { readMusicianDisplayMode } from './MusicianDisplayChoice';
it('defaults to Auto and migrates an explicit old dot preference', () => {
  localStorage.clear();
  expect(readMusicianDisplayMode('worship-dot-display', 'worship-timing-dot')).toBe('auto');
  localStorage.setItem('worship-timing-dot', 'off');
  expect(readMusicianDisplayMode('worship-dot-display', 'worship-timing-dot')).toBe('off');
  localStorage.setItem('worship-dot-display', 'auto');
  expect(readMusicianDisplayMode('worship-dot-display', 'worship-timing-dot')).toBe('auto');
  localStorage.setItem('worship-bars-display', 'invalid');
  expect(readMusicianDisplayMode('worship-bars-display')).toBe('auto');
  localStorage.clear();
});
