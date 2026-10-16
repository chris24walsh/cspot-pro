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
    expect(music.countInTicks).toBe(music.barTicks);
    expect(music.totalTicks).toBe(music.barTicks * 2);
    const position = silent.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(-1));
    expect(cursor).toHaveBeenLastCalledWith(null);
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ position: -1, startIndex: 0 }));
    act(() => position(0));
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: 0, lineIndex: 1, pulse: 0 }));
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

it('arms pedal playback and distinguishes restart/back taps, holds, repeats and section selection', async () => {
  vi.useFakeTimers();
  const lyrics = '[V1]\nFirst line\n[C]\nSecond line';
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 0 },
    { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 0 },
  ] };
  const navigate = vi.fn();
  const container = document.createElement('div'), root = createRoot(container);
  const key = async (direction: 'ArrowLeft' | 'ArrowRight', held = false) => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: direction, code: direction, bubbles: true }));
      if (held) {
        vi.advanceTimersByTime(650);
        window.dispatchEvent(new KeyboardEvent('keydown', { key: direction, code: direction, repeat: true }));
      }
      window.dispatchEvent(new KeyboardEvent('keyup', { key: direction, code: direction, bubbles: true }));
    });
  };
  try {
    await act(async () => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1 C" annotations={[]} bars={lyricBarLayout(lyrics, rhythm, [])} startAt={{ occurrence: 0, lineStart: 1, lineEnd: 2 }} onCursor={() => {}} onPedalNavigate={navigate} />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click());
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith('Silent guide'))!.click());
    expect(silent.play).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Ready: silent');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' })));
    expect(silent.play).toHaveBeenCalledOnce(); // starts before release
    await act(async () => {
      vi.advanceTimersByTime(650);
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight', repeat: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight' }));
    });
    expect(silent.play).toHaveBeenCalledOnce();
    expect(silent.stop).not.toHaveBeenCalled(); // release must not pause the newly started guide
    expect(navigate).not.toHaveBeenCalled();
    const progress = silent.play.mock.calls[0][4] as (position: number) => void;
    act(() => progress(0.49));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' })));
    act(() => progress(0.6)); // The tap began early, even though release crosses halfway.
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: '' })));
    expect(navigate).toHaveBeenLastCalledWith(-1);
    act(() => progress(0.5));
    await key('ArrowLeft');
    expect(navigate).toHaveBeenLastCalledWith(0);
    await key('ArrowRight');
    expect(navigate).toHaveBeenLastCalledWith(1);
    navigate.mockClear();
    await key('ArrowLeft', true);
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Choose:');
    await key('ArrowRight');
    await key('ArrowRight', true);
    expect(silent.queuePerformance).toHaveBeenCalledOnce();
    expect((silent.queuePerformance.mock.calls[0][0] as PracticePerformance).bars).toHaveLength(1);
    await key('ArrowRight', true);
    expect(silent.stop).toHaveBeenCalledOnce();
    await key('ArrowRight');
    expect(silent.play).toHaveBeenCalledTimes(2);
    // Lost keyup on a tab switch must not turn into a delayed command.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }));
      window.dispatchEvent(new Event('blur'));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft' }));
    });
    expect(navigate).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); vi.useRealTimers(); vi.clearAllMocks(); }
});

it.each(['Silent guide', 'Metronome', 'MIDI strum', 'MIDI only'])('uses the saved intro instead of an extra count-in in pedal mode (%s)', async source => {
  const lyrics = '[V1]\nSing now';
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [{ id: 'one', section: 'V1', lineIndex: 0, anchorIndex: 0 }] };
  const container = document.createElement('div'), root = createRoot(container);
  const save = vi.fn(async (intro_bars: number) => { render({ ...rhythm, intro_bars }); });
  const render = (value: SongRhythm) => root.render(<LyricMusicControls rhythm={value} lyrics={lyrics} sequence="V1" annotations={[]} bars={lyricBarLayout(lyrics, value, [])} onCursor={() => {}} onSaveIntroBars={save} />);
  try {
    await act(async () => render(rhythm));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    const select = document.querySelector<HTMLSelectElement>('[aria-label="Song intro bars"]')!;
    expect(select.value).toBe('2');
    await act(async () => { select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(save).toHaveBeenCalledWith(4);
    expect(select.value).toBe('4');
    act(() => document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click());
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith(source))!.click());
    const player = source === 'Silent guide' ? silent : audio;
    expect(player.play).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' })));
    const music = player.play.mock.calls[0][0] as PracticePerformance;
    expect(music.countInTicks).toBe(4 * music.barTicks);
    expect(container.textContent).toContain('Intro: 4 bars remaining');
    const progress = player.play.mock.calls[0][4] as (position: number) => void;
    act(() => progress(-1.25));
    expect(container.textContent).toContain('Intro: 2 bars remaining');
    act(() => progress(0));
    expect(container.textContent).not.toContain('bars remaining');
    if (source === 'Silent guide') expect(music.notes).toHaveLength(0);
    else expect(music.notes.filter(note => note.channel === 9 && note.tick < music.countInTicks)).toHaveLength(16);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});

it('measures the previous-slide window from the actual chord entry after a live restart', async () => {
  const lyrics = '[V1]\nOpening rest\nSing now';
  const annotations = [{ id: 'chord', section: 'V1', lineIndex: 1, anchorIndex: 0, chord: 'C' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'rest', section: 'V1', lineIndex: 0, anchorIndex: 0 },
    { id: 'entry', section: 'V1', lineIndex: 1, anchorIndex: 0 },
  ] };
  const navigate = vi.fn(), container = document.createElement('div'), root = createRoot(container);
  const render = (revision: number) => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1" annotations={annotations} bars={lyricBarLayout(lyrics, rhythm, annotations)} startAt={{ occurrence: 0, lineStart: 1, lineEnd: 3 }} jumpRevision={revision} onCursor={() => {}} onPedalNavigate={navigate} />);
  const left = async () => act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft' }));
  });
  try {
    await act(async () => render(0));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click());
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith('Silent guide'))!.click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight' }));
    });
    await act(async () => render(1));
    const [, progress, committed] = silent.queuePerformance.mock.calls[0] as [PracticePerformance, (position: number) => void, () => void];
    act(() => { committed(); progress(0.25); });
    await left();
    expect(navigate).toHaveBeenLastCalledWith(-1);
    act(() => progress(0.5));
    await left();
    expect(navigate).toHaveBeenLastCalledWith(0);
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});

it('allows manual pedal navigation before arming and records phone key events without moving slides', async () => {
  const navigate = vi.fn(), container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<LyricMusicControls rhythm={{ numerator: 4, denominator: 4, patterns: [], notes: '' }} lyrics="[V1]\nSing" sequence="V1" annotations={[]} bars={[]} onCursor={() => {}} onPedalNavigate={navigate} />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click());
    // Close the menu without arming playback.
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: '' }));
    });
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(-1);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    act(() => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith('Test pedal'))!.click());
    expect(container.textContent).toContain('No keys received yet');
    navigate.mockClear();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: '' }));
    });
    expect(container.textContent).toContain('keydown: ArrowRight');
    expect(container.textContent).toContain('keyup: ArrowRight');
    expect(navigate).not.toHaveBeenCalled();
    expect(audio.play).not.toHaveBeenCalled();
    expect(silent.play).not.toHaveBeenCalled();
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
