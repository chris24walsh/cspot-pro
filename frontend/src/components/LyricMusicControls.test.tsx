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
    await play(container, 'Click only');
    expect((audio.play.mock.calls[0][0] as PracticePerformance).notes.every(note => note.channel === 9)).toBe(true);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(0.25));
    expect(onCursor).toHaveBeenLastCalledWith(expect.objectContaining({ lineIndex: 1, occurrence: 0, pulse: 0 }));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    expect(audio.stop).toHaveBeenCalledOnce();
    expect(onCursor).toHaveBeenLastCalledWith(null);
    await play(container, 'Guitar + click');
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
    await play(container, 'Guitar + click');
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

it.each(['Click only', 'Guitar + click'])('starts %s at the selected sequence occurrence and leaves the opening bar silent', async source => {
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
    expect(music.notes.some(note => note.channel === 0)).toBe(source === 'Guitar + click');
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
    await play(container, 'Lyrics only');
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

it.each(['Click only', 'Guitar + click', 'Guitar only', 'Lyrics only'])('queues a manual slide destination without restarting or adding a count-in (%s)', async source => {
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
    const player = source === "Lyrics only" ? silent : audio;
    expect(player.play).toHaveBeenCalledOnce();
    expect(player.stop).not.toHaveBeenCalled();
    expect(player.queuePerformance).toHaveBeenCalledOnce();
    const [music, progress, committed] = player.queuePerformance.mock.calls[0] as [PracticePerformance, (position: number) => void, () => void];
    expect(music.countInTicks).toBe(0);
    if (source === 'Guitar only') { expect(music.notes.some(note => note.channel === 9)).toBe(false); expect(music.notes.some(note => note.channel === 0)).toBe(true); }
    expect(music.bars[0].chords[0].chord).toBe('G');
    expect(container.textContent).toContain('Jump queued');
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
    await play(container, 'Guitar + click');
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
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith('Lyrics only'))!.click());
    expect(silent.play).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Pedal:');
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
    act(() => progress(2.49));
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' })));
    act(() => progress(2.6)); // The tap began early, even though release crosses halfway.
    await act(async () => window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: '' })));
    expect(navigate).toHaveBeenLastCalledWith(-1);
    act(() => progress(2.5));
    await key('ArrowLeft');
    expect(navigate).toHaveBeenLastCalledWith(0);
    await key('ArrowRight');
    expect(navigate).toHaveBeenLastCalledWith(1);
    navigate.mockClear();
    await key('ArrowLeft', true);
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Jump to section');
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

it.each(['Lyrics only', 'Click only', 'Guitar + click', 'Guitar only'])('plays one count-in bar then a chorded intro before lyric timing (%s)', async source => {
  const lyrics = '[V1]\nSing now';
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [{ id: 'one', section: 'V1', lineIndex: 0, anchorIndex: 0 }] };
  const container = document.createElement('div'), root = createRoot(container);
  const timing = vi.fn(), cursor = vi.fn();
  const save = vi.fn(async (intro_bars: number) => { render({ ...rhythm, intro_bars }); });
  const render = (value: SongRhythm) => root.render(<LyricMusicControls rhythm={value} lyrics={lyrics} sequence="V1" annotations={[]} bars={lyricBarLayout(lyrics, value, [])} rootChord="D" onCursor={cursor} onTiming={timing} onSaveIntroBars={save} />);
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
    const player = source === 'Lyrics only' ? silent : audio;
    expect(player.play).not.toHaveBeenCalled();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' })));
    const music = player.play.mock.calls[0][0] as PracticePerformance;
    expect(music.countInTicks).toBe(music.barTicks);
    expect(music.bars).toHaveLength(5); // four musical intro bars, then one lyric bar
    expect(music.bars.slice(0, 4).map(bar => bar.chords)).toEqual(Array(4).fill([{ beat: 1, chord: 'D' }]));
    const progress = player.play.mock.calls[0][4] as (position: number) => void;
    act(() => progress(-0.25));
    expect(cursor).toHaveBeenLastCalledWith(null);
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ position: -4.25, introBars: 4, introChord: 'D', introCountIn: true }));
    act(() => progress(0));
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ position: -4 }));
    expect(cursor).toHaveBeenLastCalledWith(null);
    act(() => progress(3.99));
    expect(cursor).toHaveBeenLastCalledWith(null);
    act(() => progress(4));
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ lineIndex: 1 }));
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ position: 0 }));
    expect(container.textContent).not.toContain('Pedal:');
    if (source === 'Lyrics only') expect(music.notes).toHaveLength(0);
    else expect(music.notes.filter(note => note.channel === 9 && note.tick < music.countInTicks)).toHaveLength(4);
    expect(music.notes.filter(note => note.channel === 0 && note.tick < music.countInTicks)).toHaveLength(0);
    if (source.startsWith('Guitar')) for (let bar = 0; bar < 4; bar++) {
      expect(music.notes.some(note => note.channel === 0 && note.tick >= music.countInTicks + bar * music.barTicks && note.tick < music.countInTicks + (bar + 1) * music.barTicks)).toBe(true);
    }
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
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith('Lyrics only'))!.click());
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


it('steps back repeatedly while jumps are pending and through the pickup before the first full bar', async () => {
  const lyrics = '[V1]\nVerse line\n[C]\nOpening\nSing together';
  const annotations = [{ id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }, { id: 'c', section: 'C', lineIndex: 1, anchorIndex: 8, chord: 'F' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'c1', section: 'C', lineIndex: 0, anchorIndex: 3 },
    { id: 'c2', section: 'C', lineIndex: 1, anchorIndex: 3 },
  ] };
  const container = document.createElement('div'), root = createRoot(container);
  const pending = vi.fn(), committed = vi.fn();
  let occurrence = 3, revision = 0;
  const navigate = vi.fn((direction: -1 | 0 | 1) => { occurrence += direction; revision++; render(); });
  const render = () => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1 C C C" annotations={annotations} bars={lyricBarLayout(lyrics, rhythm, annotations)} startAt={{ occurrence, lineStart: occurrence === 0 ? 1 : 3, lineEnd: occurrence === 0 ? 2 : 5 }} jumpRevision={revision} onCursor={() => {}} onPedalNavigate={navigate} onJumpPending={pending} onJumpCommitted={committed} />);
  const left = async () => act(async () => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', code: 'ArrowLeft' }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowLeft', code: 'ArrowLeft' }));
  });
  try {
    await act(async () => render());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click());
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith('Lyrics only'))!.click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight' }));
    });
    // Simulate a manual entry into C3, including its partial entry bar.
    await act(async () => { revision++; render(); });
    const first = silent.queuePerformance.mock.calls[0] as [PracticePerformance, (position: number) => void, () => void];
    expect(pending).toHaveBeenLastCalledWith(true);
    await left(); // C3 -> C2 while C3 is still queued
    expect(occurrence).toBe(2);
    await left(); // C2 -> C1 without waiting for either jump to commit
    expect(occurrence).toBe(1);
    expect(navigate.mock.calls).toEqual([[-1], [-1]]);
    // An obsolete commit must not release the latest destination hold.
    act(() => first[2]());
    expect(committed).not.toHaveBeenCalled();
    expect(pending).toHaveBeenLastCalledWith(true);
    const latest = silent.queuePerformance.mock.calls[2] as [PracticePerformance, (position: number) => void, () => void];
    act(() => { latest[2](); latest[1](1.5); });
    await left(); // After halfway through the first full bar, restart normally.
    expect(occurrence).toBe(1);
    expect(navigate).toHaveBeenLastCalledWith(0);
    const restarted = silent.queuePerformance.mock.calls[3] as [PracticePerformance, (position: number) => void, () => void];
    act(() => { restarted[2](); restarted[1](0.85); }); // still in C1's entry/pickup bar
    await left();
    expect(occurrence).toBe(0); // C1 -> V1, before its first full bar begins
    expect(navigate.mock.calls).toEqual([[-1], [-1], [0], [-1]]);
    expect(silent.play).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});

it.each([0, 2])('uses the opening song chord before a later selected slide (%i intro bars)', async intro_bars => {
  const lyrics = '[V1]\nFirst line\n[C]\nSecond line';
  const annotations = [{ id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }, { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3, chord: 'G' }];
  const rhythm: SongRhythm = { numerator: 4, denominator: 4, patterns: [], notes: '', intro_bars, markers: annotations.map(({ chord: _chord, ...marker }) => marker) };
  const cursor = vi.fn(), timing = vi.fn(), container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<LyricMusicControls rhythm={rhythm} lyrics={lyrics} sequence="V1 C" annotations={annotations} bars={lyricBarLayout(lyrics, rhythm, annotations)} rootChord="D" startAt={{ occurrence: 1, lineStart: 3, lineEnd: 4 }} onCursor={cursor} onTiming={timing} />));
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
    expect(document.querySelector('[aria-label="Pedal input test"]')).toBeNull();
    expect(document.body.textContent).not.toContain('Test pedal');
    act(() => document.querySelector<HTMLButtonElement>('[role="menuitemcheckbox"]')!.click());
    await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent!.startsWith('Guitar only'))!.click());
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', code: 'ArrowRight' }));
      window.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', code: 'ArrowRight' }));
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBeUndefined();
    const music = audio.play.mock.calls[0][0] as PracticePerformance;
    expect(music.countInTicks).toBe(music.barTicks);
    expect(music.bars.map(bar => bar.chords[0].chord)).toEqual([...Array(intro_bars).fill('C'), 'G']);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(-0.5));
    expect(cursor).toHaveBeenLastCalledWith(null);
    act(() => position(intro_bars));
    expect(cursor).toHaveBeenLastCalledWith(expect.objectContaining({ occurrence: 1, lineIndex: 3 }));
    expect(timing).toHaveBeenLastCalledWith(expect.objectContaining({ startIndex: 1, position: 0 }));
  } finally { act(() => root.unmount()); vi.clearAllMocks(); }
});
