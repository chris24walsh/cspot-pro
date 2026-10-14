// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { LyricMusicControls } from './LyricMusicControls';
import { lyricBarLayout, type LyricCursor } from '../lyricTiming';
import { buildPracticePerformance, type PracticePerformance } from '../musicPractice';
import type { SongRhythm } from '../songRhythm';
const silent = vi.hoisted(() => ({ play: vi.fn(async (..._args: unknown[]) => {}), queuePerformance: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn() }));
const audio = vi.hoisted(() => ({ play: vi.fn(async (..._args: unknown[]) => {}), queuePerformance: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn() }));
vi.mock('../musicPractice', async original => ({ ...await original<typeof import('../musicPractice')>(), PracticeAudioPlayer: vi.fn(function() { return audio; }), PracticeSilentPlayer: vi.fn(function() { return silent; }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function play(container: HTMLElement, source: string) {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('.musician-control-menu [role="menuitem"]')).find(button => button.textContent!.startsWith(source))!.click());
}

it('starts with clicks only, adds complete chords, and reports the same timed lyric cursor', async () => {
  const lyrics = '[V1]\nSing now';
  const annotations = [{ id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [{ id: 'one', section: 'V1', lineIndex: 0, anchorIndex: 3 }] };
  const onCursor = vi.fn<[LyricCursor | null], void>();
  const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1" annotations={annotations} bars={lyricBarLayout(lyrics, rhythm, annotations)} onCursor={onCursor} />));
    await play(container, 'Metronome');
    expect((audio.play.mock.calls[0][0] as PracticePerformance).notes.every(note => note.channel === 9)).toBe(true);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(0.25));
    expect(onCursor).toHaveBeenLastCalledWith(expect.objectContaining({ lineIndex: 1, occurrence: 0, pulse: 0 }));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(onCursor).toHaveBeenLastCalledWith(null);
    await play(container, 'MIDI strum');
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
    await play(container, 'MIDI strum');
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(audio.play).toHaveBeenCalledOnce();
    const inline = audio.play.mock.calls[0][0] as PracticePerformance;
    for (const mode of ['song', 'part'] as const) {
      const editor = buildPracticePerformance(rhythm, { mode, finish: true, section: 'V1', lyrics, sequence: 'V1', annotations, countIn: true, metronome: true });
      expect(inline).toEqual(editor);
    }
    expect(inline.bars[0].chords).toEqual([{ beat: 1, chord: '' }]);
    expect(inline.countInTicks).toBe(0);
    expect(inline.notes.filter(note => note.channel === 0).every(note => note.tick >= inline.barTicks)).toBe(true);
    expect(inline.notes.some(note => note.channel === 0)).toBe(true);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});


it('offers permission-scoped backing playback and a direct stop, with no local synthesis', async () => {
  const toggle = vi.fn(async () => {});
  const container = document.createElement('div'), root = createRoot(container);
  const render = (playing: boolean, disabledReason?: string) => root.render(<LyricMusicControls rhythm={null} lyrics={null} sequence={null} annotations={[]} bars={[]} canPractice={false} onCursor={() => {}} backing={{ playing, disabledReason, toggle }} />);
  try {
    await act(async () => render(false, 'Sync with the service first'));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    expect(document.querySelectorAll('.musician-control-menu [role="menuitem"]')).toHaveLength(1);
    expect(document.querySelector<HTMLButtonElement>('.musician-control-menu [role="menuitem"]')!.disabled).toBe(true);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    await act(async () => render(false));
    await play(container, 'Backing track');
    expect(toggle).toHaveBeenCalledOnce();
    expect(audio.play).not.toHaveBeenCalled();
    await act(async () => render(true));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    expect(toggle).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});

it.each(['Metronome', 'MIDI strum'])('starts %s at the selected sequence occurrence and leaves the opening bar silent', async source => {
  const lyrics = '[V1]\nFirst line\nSecond line\n[C]\nHold the chord';
  const annotations = [
    { id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' },
    { id: 'g', section: 'V1', lineIndex: 1, anchorIndex: 3, chord: 'G' },
  ];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'v1', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'v2', section: 'V1', lineIndex: 1, anchorIndex: 3 },
    { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3 },
  ] };
  const cursor = vi.fn(), container = document.createElement('div'), root = createRoot(container);
  const bars = lyricBarLayout(lyrics, rhythm, annotations);
  const render = (occurrence: number, lineStart: number) => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1 C V1" annotations={annotations} bars={bars} startAt={{ occurrence, lineStart, lineEnd: lineStart + 1 }} onCursor={cursor} />);
  try {
    await act(async () => render(1, 4));
    await play(container, source);
    const music = audio.play.mock.calls[0][0] as PracticePerformance;
    expect(music.bars.map(bar => bar.chords[0].chord)).toEqual(['', 'C', 'G']);
    expect(music.countInTicks).toBe(0);
    expect(music.notes.some(note => note.channel === 0)).toBe(source === 'MIDI strum');
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(-0.5));
    expect(cursor).toHaveBeenLastCalledWith(null);
    act(() => position(0.05));
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: 1, lineIndex: 4, barStartLine: 4 }));
    await act(async () => render(2, 1)); // auto page turn updates the selected page while audio is running
    expect(audio.stop).not.toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalledOnce();
    act(() => position(1.05));
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: 2, lineIndex: 1 }));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    await act(async () => render(2, 2)); // explicitly start on the second slide of the repeated verse
    await play(container, source);
    expect((audio.play.mock.calls[1][0] as PracticePerformance).bars).toHaveLength(1);
    const secondPosition = audio.play.mock.calls[1][4] as (position: number) => void;
    act(() => secondPosition(0.05));
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: 2, lineIndex: 2 }));
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});


it('selects silent guidance from the current slide and emits shareable clock progress without audio', async () => {
  const lyrics = '[V1]\nSing now';
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [{ id: 'one', section: 'V1', lineIndex: 0, anchorIndex: 3 }] };
  const cursor = vi.fn(), timing = vi.fn(), container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1" annotations={[]} bars={lyricBarLayout(lyrics, rhythm, [])} onCursor={cursor} onTiming={timing} startAt={{ occurrence: 0, lineStart: 1, lineEnd: 2 }} />));
    await play(container, 'Silent guide');
    expect(audio.play).not.toHaveBeenCalled();
    expect(silent.play).toHaveBeenCalledOnce();
    const music = silent.play.mock.calls[0][0] as PracticePerformance;
    expect(music.notes).toHaveLength(0);
    expect(music.countInTicks).toBe(0);
    const position = silent.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(0.25));
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: 0, lineIndex: 1 }));
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ position: 0.25, startIndex: 0, totalBars: 1 }));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    expect(silent.stop).toHaveBeenCalledOnce();
    expect(timing).toHaveBeenLastCalledWith(null);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});

it.each(['Metronome', 'MIDI strum', 'MIDI only', 'Silent guide'])('queues a manual slide destination without restarting or adding a count-in (%s)', async source => {
  const lyrics = '[V1]\nFirst line\n[C]\nSecond line';
  const annotations = [{ id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }, { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3, chord: 'G' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: annotations.map(({ chord: _chord, ...marker }) => marker) };
  const bars = lyricBarLayout(lyrics, rhythm, annotations);
  const cursor = vi.fn(), timing = vi.fn(), pending = vi.fn();
  const container = document.createElement('div'), root = createRoot(container);
  const render = (revision: number, occurrence: number, line: number) => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1 C" annotations={annotations} bars={bars} onCursor={cursor} onTiming={timing} onJumpPending={pending} jumpRevision={revision} startAt={{ occurrence, lineStart: line, lineEnd: line + 1 }} />);
  try {
    await act(async () => render(0, 0, 1));
    await play(container, source);
    await act(async () => render(1, 1, 3));
    const player = source === "Silent guide" ? silent : audio;
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.stop).not.toHaveBeenCalled();
    expect(player.queuePerformance).toHaveBeenCalledOnce();
    const [music, progress, committed] = player.queuePerformance.mock.calls[0] as [PracticePerformance, (position: number) => void, () => void];
    expect(music.countInTicks).toBe(0);
    if (source === 'MIDI only') { expect(music.notes.some(note => note.channel === 9)).toBe(false); expect(music.notes.some(note => note.channel === 0)).toBe(true); }
    expect(music.bars[0].chords[0].chord).toBe('G');
    expect(container.textContent).toContain('next bar');
    await act(async () => { committed(); progress(0); });
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: 1, lineIndex: 3 }));
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ startIndex: 1, position: 0 }));
    expect(pending).toHaveBeenLastCalledWith(false);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});

it.each(['F', ''])('keeps the player and carries chords through unannotated live destinations (%s)', async destinationChord => {
  const container = document.createElement('div'), root = createRoot(container);
  const render = (revision: number, name: string, chord: string) => {
    const lyrics = `[V1]\n${name}`;
    const annotations = [{ id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3, chord }];
    const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: annotations.map(({ chord: _chord, ...marker }) => marker) };
    root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1" annotations={annotations} bars={lyricBarLayout(lyrics, rhythm, annotations)} jumpRevision={revision} startAt={{ occurrence: 0, lineStart: 1, lineEnd: 2 }} onCursor={() => {}} />);
  };
  try {
    await act(async () => render(0, 'First song', 'C'));
    await play(container, 'MIDI strum');
    const progress = audio.play.mock.calls[0][4] as (position: number) => void;
    await act(async () => progress(0.25));
    await act(async () => render(1, 'Another song', destinationChord));
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.stop).not.toHaveBeenCalled();
    expect(audio.queuePerformance).toHaveBeenCalledOnce();
    const queued = audio.queuePerformance.mock.calls[0][0] as PracticePerformance;
    expect(queued.bars[0].chords[0].chord).toBe(destinationChord || 'C');
    expect(queued.countInTicks).toBe(0);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
