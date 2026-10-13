// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LyricMusicControls } from './LyricMusicControls';
import { lyricBarLayout, type LyricCursor } from '../lyricTiming';
import { buildPracticePerformance, type PracticePerformance } from '../musicPractice';
import type { SongRhythm } from '../songRhythm';
const audio = vi.hoisted(() => ({ play: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn() }));
vi.mock('../musicPractice', async original => ({ ...await original<typeof import('../musicPractice')>(), PracticeAudioPlayer: vi.fn(function() { return audio; }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('starts with clicks only, adds complete chords, and reports the same timed lyric cursor', async () => {
  const lyrics = '[V1]\nSing now';
  const annotations = [{ id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [{ id: 'one', section: 'V1', lineIndex: 0, anchorIndex: 3 }] };
  const onCursor = vi.fn<[LyricCursor | null], void>();
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1" annotations={annotations} bars={lyricBarLayout(lyrics, rhythm, annotations)} onCursor={onCursor} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Listen with timing guide"]')!.click());
    expect((audio.play.mock.calls[0][0] as PracticePerformance).notes.every(note => note.channel === 9)).toBe(true);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(0.25));
    expect(onCursor).toHaveBeenLastCalledWith(expect.objectContaining({ lineIndex: 1, occurrence: 0, pulse: 0 }));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add MIDI chords to metronome"]')!.click());
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(onCursor).toHaveBeenLastCalledWith(null);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Listen with timing guide"]')!.click());
    const notes = (audio.play.mock.calls[1][0] as PracticePerformance).notes.filter(note => note.channel === 0);
    expect(new Set(notes.map(note => note.pitch)).size).toBeGreaterThan(3);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});


it('allows an opening bar of silence and matches whole-song and part playback in the rhythm editor', async () => {
  const lyrics = '[V1]\nInstrumental pickup\nSing now';
  const annotations = [{ id: 'c', section: 'V1', lineIndex: 1, anchorIndex: 3, chord: 'C' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'pickup', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'vocal', section: 'V1', lineIndex: 1, anchorIndex: 3 },
  ] };
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1" annotations={annotations} bars={lyricBarLayout(lyrics, rhythm, annotations)} onCursor={() => {}} />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Add MIDI chords to metronome"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Listen with timing guide"]')!.click());
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(audio.play).toHaveBeenCalledOnce();
    const inline = audio.play.mock.calls[0][0] as PracticePerformance;
    for (const mode of ['song', 'part'] as const) {
      const editor = buildPracticePerformance(rhythm, { mode, section: 'V1', lyrics, sequence: 'V1', annotations, countIn: true, metronome: true });
      expect(inline).toEqual(editor);
    }
    expect(inline.bars[0].chords).toEqual([{ beat: 1, chord: '' }]);
    expect(inline.notes.filter(note => note.channel === 0).every(note => note.tick >= inline.countInTicks + inline.barTicks)).toBe(true);
    expect(inline.notes.some(note => note.channel === 0)).toBe(true);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
