// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { buildAbsoluteApiUrl } from './api';
import { storedFileDownloadUrl } from './presentation';

afterEach(() => window.history.replaceState(null, '', '/'));

it.each(['/app/tv', '/app/tv/', '/app/?presentation=tv'])('uses public display reads and media at %s', path => {
  window.history.replaceState(null, '', path);
  for (const endpoint of ['presentation/live', 'presentation/live/plan', 'presentation/pointer/plan', 'planning/plans', 'planning/plans/plan', 'music/songs', 'broadcast/viewer-settings', 'library/files/file/slides']) {
    expect(buildAbsoluteApiUrl(`/api/v1/${endpoint}`)).toContain(`/api/v1/tv/${endpoint}`);
  }
  expect(storedFileDownloadUrl('file')).toContain('/v1/tv/library/files/file/download');
  expect(buildAbsoluteApiUrl('/api/v1/tv/library/files/file/slides/1.png')).not.toContain('/tv/tv/');
  expect(buildAbsoluteApiUrl('/api/v1/identity/session')).not.toContain('/tv/');
});

it.each(['/app', '/app/media', '/app/media/sundayschool', '/app/?presentation=output'])('retains authenticated APIs at %s', path => {
  window.history.replaceState(null, '', path);
  expect(buildAbsoluteApiUrl('/api/v1/planning/plans')).not.toContain('/tv/');
  expect(storedFileDownloadUrl('file')).not.toContain('/tv/');
});
