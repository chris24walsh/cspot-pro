// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { MusicianLiveView } from './MusicianLiveView';
import { createEmptyChordChart, serializeChordChart } from '../chordSheet';
import { updateBandSelection, getWorshipMusicTiming, updateWorshipMusicTiming, getPresentationLiveState, updatePresentationLiveState, type PlanDetail, type Song } from '../api';
const audio = vi.hoisted(() => ({ play: vi.fn(async (..._args: unknown[]) => {}), queuePerformance: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn() }));
vi.mock('../musicPractice', async original => ({ ...await original<typeof import('../musicPractice')>(), PracticeAudioPlayer: vi.fn(function() { return audio; }) }));
vi.mock('../api', () => ({ getBandSelection: vi.fn(async () => ({ selection: null })), updateBandSelection: vi.fn(async (_id, slide_id) => ({ selection: { slide_id, updated_at: Date.now() } })), getPresentationLiveState: vi.fn(async () => ({ plan_id: 'plan', index: 0, updated_at: '2026-10-13', worship_coupled: true, plan_item_id: 'item', slide_offset: 0 })), updatePresentationLiveState: vi.fn(), getWorshipMusicTiming: vi.fn(async () => ({ timing: null, server_now: 0 })), updateWorshipMusicTiming: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => localStorage.clear());

function musician(container: HTMLElement) { act(() => container.querySelector<HTMLButtonElement>('[aria-label="Musician"]')!.click()); }
function toggleBars(container: HTMLElement, mode = "on") {
  musician(container);
  act(() => document.querySelector<HTMLButtonElement>(`[aria-label="Bars: ${mode}"]`)!.click());
  musician(container);
}
async function play(container: HTMLElement) {
  act(() => container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!.click());
  await act(async () => Array.from(document.querySelectorAll<HTMLButtonElement>('.musician-control-menu [role="menuitem"]')).find(button => button.textContent!.startsWith('Metronome'))!.click());
}

it.each([false, true])('turns playback pages and publishes them only when synced (%s)', async (coupled) => {
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: coupled, plan_item_id: 'item', slide_offset: 0 } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  vi.mocked(updatePresentationLiveState).mockImplementation(async (_id, state) => state as Awaited<ReturnType<typeof updatePresentationLiveState>>);
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  const song = { id: 'song', title: 'Test song', lyrics: '[V1]\nFirst line\n[C]\nSecond line', sequence: 'V1 C', chords: serializeChordChart({ ...createEmptyChordChart(), absoluteKey: 'C', annotations: [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }, { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3, chord: 'F' },
  ] }), rhythm: { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3 }, { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3 },
  ] } } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'); container.appendChild(mount); const root = createRoot(mount);
  const toolbar = document.createElement('div'); container.appendChild(toolbar);
  const render = (canUseMusic: boolean) => root.render(<MusicianLiveView canUseMusic={canUseMusic} plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />);
  try {
    await act(async () => render(false));
    musician(container);
    expect(document.querySelector('[aria-label="Bars display"]')).not.toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Bars: on"]')!.click());
    expect(container.querySelector(".lyric-bar-line")).not.toBeNull();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Bars: auto"]')!.click());
    expect(document.querySelector('[aria-label="Band sync: on"]')?.getAttribute('aria-checked')).toBe('true');
    const bandToggle = document.querySelector<HTMLButtonElement>('[aria-label="Band sync: off"]')!;
    expect(bandToggle.getAttribute('aria-checked')).toBe('false');
    if (coupled) await act(async () => bandToggle.click()); // service sync works even with Band sync off
    musician(container);
    await act(async () => render(true));
    const grid = container.querySelector<HTMLElement>('.musician-chord-line')!.style.gridTemplateColumns;
    expect(container.querySelector('.lyric-bar-line')).toBeNull();
    toggleBars(container);
    expect(container.querySelector('.lyric-bar-line')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.musician-chord-line')!.style.gridTemplateColumns).toBe(grid);
    await play(container);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    await act(async () => position(0.25));
    expect(container.querySelector('.lyric-timing-dot')).not.toBeNull();
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Lyric highlight: on"]')!.click());
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Dot: off"]')!.click());
    musician(container);
    expect(container.querySelector('.lyric-timing-dot')).toBeNull();
    expect(container.querySelector('.is-lyric-current .lyric-highlight-character')).not.toBeNull();
    expect(Number(container.querySelector<HTMLElement>('.lyric-highlight-character .lyric-highlight-fill')!.style.opacity)).toBeGreaterThan(0);
    expect(localStorage.getItem('worship-lyric-highlight')).toBe('on');
    expect(container.querySelector<HTMLElement>('.musician-chord-line')!.style.gridTemplateColumns).toBe(grid);
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Dot: on"]')!.click());
    musician(container);
    expect(container.querySelector('.lyric-timing-dot')).not.toBeNull();

    expect(container.querySelector('.musician-page.is-current')?.textContent).toContain('First');
    await act(async () => position(0.49));
    expect(container.querySelector('.musician-lyric-space.lyric-highlight-character .lyric-highlight-fill')).not.toBeNull();
    await act(async () => position(0.5));
    expect(updatePresentationLiveState).toHaveBeenCalledTimes(coupled ? 2 : 0);
    await act(async () => position(1));
    expect(container.querySelector('.musician-page.is-current')?.textContent).toContain('Second');
    if (coupled) {
      expect(updatePresentationLiveState).toHaveBeenCalledTimes(2);
      expect(updatePresentationLiveState).toHaveBeenLastCalledWith('plan', expect.objectContaining({ index: 2, plan_item_id: 'item', slide_offset: 2, worship_coupled: true }));
    } else expect(updatePresentationLiveState).not.toHaveBeenCalled();
    expect(updateBandSelection).toHaveBeenCalledTimes(coupled ? 0 : 2);
    toggleBars(container, 'off');
    expect(container.querySelector('.lyric-timing-dot')).not.toBeNull();
    expect(container.querySelector('.lyric-bar-line')).toBeNull();
    expect(audio.stop).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    expect(container.querySelector('.lyric-timing-dot')).toBeNull();
    expect(audio.stop).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});

it('keeps different chords and a single active dot on identical lyric pages, including repeated sections', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: false, plan_item_id: 'item', slide_offset: 0 } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  const content = 'Sing together\nPraise the Lord\nLift your voice';
  const song = { id: 'song', title: 'Repeated lyrics', lyrics: `[V1]\n${content}\n${content}`, sequence: 'V1 V1', chords: serializeChordChart({ ...createEmptyChordChart(), absoluteKey: 'C', annotations: [
    { id: 'first', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' },
    { id: 'second', section: 'V1', lineIndex: 3, anchorIndex: 3, chord: 'F' },
  ] }), rhythm: { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'first', section: 'V1', lineIndex: 0, anchorIndex: 3 },
    { id: 'second', section: 'V1', lineIndex: 3, anchorIndex: 3 },
  ] } } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div');
  container.append(mount, toolbar); const root = createRoot(mount);
  const labels = (selector: string) => Array.from(container.querySelectorAll(`${selector} .musician-chord-token`)).map(element => element.textContent);
  try {
    await act(async () => root.render(<MusicianLiveView canUseMusic plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    toggleBars(container);
    await play(container);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    await act(async () => position(0.05));
    expect(labels('.musician-page.is-current')).toEqual(['C']);
    expect(labels('.musician-page.is-next')).toEqual(['F']);
    expect(container.querySelectorAll('.musician-page.is-current .lyric-timing-dot')).toHaveLength(1);
    expect(container.querySelectorAll('.musician-page.is-next .lyric-timing-dot')).toHaveLength(0);
    await act(async () => position(1.05));
    expect(labels('.musician-page.is-current')).toEqual(['F']);
    expect(labels('.musician-page.is-next')).toEqual(['C']);
    expect(container.querySelectorAll('.musician-page.is-current .lyric-timing-dot')).toHaveLength(1);
    expect(container.querySelectorAll('.musician-page.is-next .lyric-timing-dot')).toHaveLength(0);
    await act(async () => position(2.05));
    expect(labels('.musician-page.is-current')).toEqual(['C']);
    expect(labels('.musician-page.is-next')).toEqual(['F']);
    expect(container.querySelectorAll('.lyric-timing-dot')).toHaveLength(1);
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Switch to Scroll view"]')!.click());
    expect(labels('.musician-song-part')).toEqual(['C', 'F', 'C', 'F']);
    expect(container.querySelectorAll('.lyric-timing-dot')).toHaveLength(1);
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Switch to Pages view"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    await act(async () => container.querySelector<HTMLButtonElement>('.musician-page.is-next')!.click());
    expect(labels('.musician-page.is-current')).toEqual(['F']);
    await play(container);
    expect((audio.play.mock.calls[1][0] as import('../musicPractice').PracticePerformance).bars).toHaveLength(1);
    const selectedPosition = audio.play.mock.calls[1][4] as (position: number) => void;
    await act(async () => selectedPosition(-0.5));
    expect(labels('.musician-page.is-current')).toEqual(['F']);
    await act(async () => selectedPosition(0.05));
    expect(labels('.musician-page.is-current')).toEqual(['F']);
    expect(container.querySelectorAll('.musician-page.is-current .lyric-timing-dot')).toHaveLength(1);
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});


it.each([false, true])('follows remote lyrics despite an older service song selection (scroll %s)', async scroll => {
  localStorage.clear();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: true, plan_item_id: 'other-item', slide_offset: 0 } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  vi.mocked(getWorshipMusicTiming).mockResolvedValue({ server_now: 100000, timing: {
    owner_id: 'another-device', active: true, song_id: 'song', plan_item_id: 'item', start_index: 0, position: 1.05,
    bar_duration_ms: 2000, total_bars: 2, updated_at: 100000,
  } });
  const song = { id: 'song', title: 'Shared song', lyrics: '[V1]\nFirst line\n[C]\nSecond line', sequence: 'V1 C', chords: null, rhythm: { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [
    { id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3 }, { id: 'c', section: 'C', lineIndex: 0, anchorIndex: 3 },
  ] } } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'other-item', item_type: 'song', song_id: 'other-song', sequence: '0', title: 'Other song' }, { id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div'); container.append(mount, toolbar); const root = createRoot(mount);
  try {
    await act(async () => root.render(<MusicianLiveView plan={plan} songs={[{ ...song, id: 'other-song', title: 'Other song' }, song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    expect(getWorshipMusicTiming).not.toHaveBeenCalled();
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Lyric highlight: on"]')!.click());
    if (scroll) {
      act(() => document.querySelector<HTMLButtonElement>('[aria-label="Switch to Scroll view"]')!.click());
      const scroller = container.querySelector<HTMLElement>('.musician-full-song')!;
      Object.defineProperty(scroller, 'clientHeight', { value: 100 });
      Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
      musician(container);
      // Position every song's line consistently, including after the host changes song.
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
        return { top: this.hasAttribute('data-playback-line') ? 300 - scroller.scrollTop : 0, height: 20 } as DOMRect;
      });
    }
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Follow shared timing: on"]')!.click());
    expect(container.querySelector(scroll ? '.musician-song-part.is-current' : '.musician-page.is-current')?.textContent).toContain('Second');
    expect(container.querySelectorAll('.lyric-timing-dot')).toHaveLength(1);
    expect(container.querySelector('.lyric-highlight-character')).not.toBeNull();
    if (scroll) expect(container.querySelector<HTMLElement>('.musician-full-song')!.scrollTop).toBeGreaterThan(0);
    expect(audio.play).not.toHaveBeenCalled();
    expect(updatePresentationLiveState).not.toHaveBeenCalled();
    expect(updateWorshipMusicTiming).not.toHaveBeenCalled();
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Dot: off"]')!.click());
    expect(container.querySelector('.lyric-timing-dot')).toBeNull();
    expect(container.querySelector(scroll ? '.musician-song-part.is-current' : '.musician-page.is-current')?.textContent).toContain('Second');
  } finally { act(() => root.unmount()); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); localStorage.clear(); }
});

it.each(['auto', 'on', 'off'])('keeps %s visibility choices through playback start and stop', async mode => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: false, plan_item_id: 'item', slide_offset: 0 } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  const song = { id: 'song', title: 'Visibility song', lyrics: '[V1]\nSing now', sequence: 'V1', chords: serializeChordChart({ ...createEmptyChordChart(), absoluteKey: 'C', annotations: [{ id: 'c', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'C' }] }), rhythm: { numerator: 4, denominator: 4, patterns: [], notes: '', markers: [{ id: 'v', section: 'V1', lineIndex: 0, anchorIndex: 3 }] } } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div'); container.append(mount, toolbar); const root = createRoot(mount);
  const assertVisible = (playing: boolean) => {
    const chord = container.querySelector('.musician-page.is-current .musician-chord-token')!;
    expect(chord.classList.contains('is-hidden')).toBe(mode === 'off');
    expect(Boolean(container.querySelector('.lyric-bar-line'))).toBe(mode === 'on' || mode === 'auto' && playing);
    expect(Boolean(container.querySelector('.lyric-timing-dot'))).toBe(mode !== 'off' && playing);
  };
  try {
    await act(async () => root.render(<MusicianLiveView canUseMusic plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    await act(async () => container.querySelector<HTMLButtonElement>('.musician-page.is-current')!.click());
    musician(container);
    for (const label of ['Chords', 'Bars', 'Dot']) act(() => document.querySelector<HTMLButtonElement>(`[aria-label="${label}: ${label === "Bars" ? mode : mode === "off" ? "off" : "on"}"]`)!.click());
    musician(container);
    assertVisible(false);
    expect(updatePresentationLiveState).not.toHaveBeenCalled(); // a parked dot never advances the service
    await play(container);
    assertVisible(true);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    await act(async () => position(0.25));
    assertVisible(true);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Stop playback"]')!.click());
    assertVisible(false);
    musician(container);
    for (const label of ['Chords', 'Bars', 'Dot']) expect(document.querySelector(`[aria-label="${label}: ${label === "Bars" ? mode : mode === "off" ? "off" : "on"}"]`)?.getAttribute('aria-checked')).toBe('true');
    expect(localStorage.getItem('worship-chords-display')).toBe(mode === 'off' ? 'off' : 'on');
    expect(localStorage.getItem('worship-bars-display')).toBe(mode);
    expect(localStorage.getItem('worship-dot-display')).toBe(mode === 'off' ? 'off' : 'on');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});

it('keeps sung lyrics in view across early page turns and pauses on manual scroll', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: false } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  const song = { id: 'song', title: 'Scrolling', lyrics: '[V1]\nFirst line\n[C]\nSecond line\n[B]\nThird line', sequence: 'V1 C B', chords: null, rhythm: { numerator: 4, denominator: 4, patterns: [], notes: '', markers: ['V1', 'C', 'B'].map(section => ({ id: section, section, lineIndex: 0, anchorIndex: 3 })) } } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div'); container.append(mount, toolbar); const root = createRoot(mount);
  try {
    await act(async () => root.render(<MusicianLiveView canUseMusic plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Switch to Scroll view"]')!.click());
    const scroller = container.querySelector<HTMLElement>('.musician-full-song')!;
    const parts = Array.from(scroller.querySelectorAll<HTMLElement>('.musician-song-part'));
    Object.defineProperty(scroller, 'clientHeight', { value: 100 });
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    parts.forEach((part, index) => { Object.defineProperty(part, 'offsetTop', { value: 100 + 200 * index }); Object.defineProperty(part, 'clientHeight', { value: 100 }); });
    const lines = Array.from(scroller.querySelectorAll<HTMLElement>('[data-playback-line]'));
    lines.forEach((line, index) => { line.getBoundingClientRect = () => ({ top: 100 + 200 * index - scroller.scrollTop, height: 20 } as DOMRect); });
    await play(container);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    await act(async () => position(0.25));
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect(lines[0].getBoundingClientRect().top).toBeGreaterThan(35);
    act(() => scroller.dispatchEvent(new WheelEvent('wheel', { bubbles: true })));
    scroller.scrollTop = 50;
    await act(async () => position(0.4));
    expect(scroller.scrollTop).toBe(50);
    await act(async () => position(0.5));
    expect(parts[1].classList.contains('is-current')).toBe(true);
    expect(scroller.scrollTop).toBe(50); // automatic page turns preserve manual browsing
    expect(lines[0].getBoundingClientRect().top).toBeGreaterThan(35); // still singing the first slide
    await act(async () => position(1));
    expect(scroller.scrollTop).toBe(50);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Catch up to current lyrics"]')!.click());
    expect(scroller.scrollTop).toBeLessThan(300);
    expect(lines[1].getBoundingClientRect().top).toBeGreaterThan(35);
    musician(container);
    const toggle = document.querySelector<HTMLButtonElement>('[aria-label="Auto-scroll: off"]')!;
    act(() => toggle.click());
    scroller.scrollTop = 75;
    await act(async () => position(1.1));
    expect(scroller.scrollTop).toBe(75);
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});


it('preserves pre-lyric chord positions in page and scroll views', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: false } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  const song = { id: 'song', title: 'Lead-in chords', lyrics: '[V1]\nSing together', sequence: 'V1', chords: serializeChordChart({ ...createEmptyChordChart(), absoluteKey: 'C', annotations: [
    { id: 'before', section: 'V1', lineIndex: 0, anchorIndex: 0, chord: 'C' },
    { id: 'lead', section: 'V1', lineIndex: 0, anchorIndex: 2, chord: 'F' },
    { id: 'word', section: 'V1', lineIndex: 0, anchorIndex: 3, chord: 'G' },
  ] }) } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div'); container.append(mount, toolbar); const root = createRoot(mount);
  const assertPositions = (selector: string) => {
    const line = container.querySelector(selector)!;
    expect(Array.from(line.querySelectorAll<HTMLElement>('.musician-chord-token')).map(token => token.style.gridColumn)).toEqual(['1 / span 1', '3 / span 1', '4 / span 1']);
    expect(line.querySelector<HTMLElement>('.musician-lyric-character')!.style.gridColumn).toBe('4');
  };
  try {
    await act(async () => root.render(<MusicianLiveView plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Next slide"]')!.click());
    assertPositions('.musician-page.is-current .musician-chord-line');
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Switch to Scroll view"]')!.click());
    assertPositions('.musician-full-song .musician-chord-line');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});

it('queues manual section changes while automatic page turns leave the player running', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: false } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  const annotations = ['V1', 'C'].map((section, index) => ({ id: section, section, lineIndex: 0, anchorIndex: 3, chord: index ? 'G' : 'C' }));
  const song = { id: 'song', title: 'Jump song', lyrics: '[V1]\nFirst line\n[C]\nSecond line', sequence: 'V1 C', chords: serializeChordChart({ ...createEmptyChordChart(), absoluteKey: 'C', annotations }), rhythm: { numerator: 4, denominator: 4, patterns: [], notes: '', markers: annotations.map(({ chord: _chord, ...marker }) => marker) } } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div'); container.append(mount, toolbar); const root = createRoot(mount);
  try {
    await act(async () => root.render(<MusicianLiveView canUseMusic plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Switch to Scroll view"]')!.click());
    const scroller = container.querySelector<HTMLElement>('.musician-full-song')!;
    Object.defineProperty(scroller, 'clientHeight', { value: 100 });
    Object.defineProperty(scroller, 'scrollHeight', { value: 1000 });
    const lines = Array.from(scroller.querySelectorAll<HTMLElement>('[data-playback-line]'));
    lines.forEach((line, index) => { line.getBoundingClientRect = () => ({ top: 100 + 200 * index - scroller.scrollTop, height: 20 } as DOMRect); });
    await play(container);
    const oldPosition = audio.play.mock.calls[0][4] as (position: number) => void;
    await act(async () => oldPosition(0.25));
    expect(audio.queuePerformance).not.toHaveBeenCalled();
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Next slide"]')!.click());
    expect(scroller.scrollTop).toBe(260);
    expect(audio.queuePerformance).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.stop).not.toHaveBeenCalled();
    await act(async () => oldPosition(0.4));
    expect(scroller.scrollTop).toBe(260);
    expect(container.querySelector('.musician-song-part.is-current')?.textContent).toContain('Second');
    const [, nextPosition, commit] = audio.queuePerformance.mock.calls[0] as [unknown, (position: number) => void, () => void];
    await act(async () => { commit(); nextPosition(0); });
    expect(container.querySelector('.musician-song-part.is-current')?.textContent).toContain('Second');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Previous slide"]')!.click());
    expect(audio.queuePerformance).toHaveBeenCalledTimes(2);
    const [, returnPosition, returnCommit] = audio.queuePerformance.mock.calls[1] as [unknown, (position: number) => void, () => void];
    await act(async () => { returnCommit(); returnPosition(0.25); });
    const touch = (kind: string, y: number) => { const event = new Event(kind, { bubbles: true }); Object.defineProperty(event, 'touches', { value: [{ clientY: y }] }); act(() => scroller.dispatchEvent(event)); };
    touch('touchstart', 100);
    const priorScroll = scroller.scrollTop;
    await act(async () => returnPosition(0.3));
    expect(scroller.scrollTop).not.toBe(priorScroll); // a tap does not pause following
    touch('touchmove', 150);
    scroller.scrollTop = 400;
    await act(async () => returnPosition(0.35));
    expect(scroller.scrollTop).toBe(400); // a real swipe does pause following
    act(() => scroller.dispatchEvent(new Event('touchend', { bubbles: true })));
    const catchUp = container.querySelector<HTMLButtonElement>('[aria-label="Catch up to current lyrics"]')!;
    expect(catchUp.classList.contains('sorter-catch-up-up')).toBe(true);
    act(() => catchUp.click());
    expect(container.querySelector('[aria-label="Catch up to current lyrics"]')).toBeNull();
    expect(scroller.scrollTop).toBeLessThan(400);
    expect(audio.queuePerformance).toHaveBeenCalledTimes(2);
    scroller.scrollTop = 0;
    act(() => scroller.dispatchEvent(new Event('wheel', { bubbles: true })));
    act(() => scroller.dispatchEvent(new Event('scroll')));
    expect(container.querySelector('.sorter-catch-up-down')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Catch up to current lyrics"]')!.click());
    const caughtUpScroll = scroller.scrollTop;
    const clock = vi.spyOn(performance, 'now').mockReturnValue(10000);
    scroller.scrollTop += 8;
    act(() => scroller.dispatchEvent(new Event('wheel', { bubbles: true })));
    await act(async () => returnPosition(0.4));
    expect(scroller.scrollTop).toBe(caughtUpScroll + 8); // allow the gesture to finish
    clock.mockReturnValue(11300);
    await act(async () => returnPosition(0.41));
    expect(container.querySelector('[aria-label="Catch up to current lyrics"]')).toBeNull();
    expect(scroller.scrollTop).toBeLessThan(caughtUpScroll + 8);
    const resumedScroll = scroller.scrollTop;
    scroller.scrollTop += 10;
    await act(async () => returnPosition(0.42));
    expect(scroller.scrollTop).toBeLessThan(resumedScroll + 10);
    expect(audio.queuePerformance).toHaveBeenCalledTimes(2);
    clock.mockRestore();

    await act(async () => container.querySelector<HTMLButtonElement>('.musician-song-part.is-current')!.click());
    expect(audio.queuePerformance).toHaveBeenCalledTimes(3);
    expect(scroller.scrollTop).toBe(60); // same slide immediately returns into view
    const [, restartPosition, restartCommit] = audio.queuePerformance.mock.calls[2] as [unknown, (position: number) => void, () => void];
    await act(async () => { restartCommit(); restartPosition(0.25); });
    expect(scroller.scrollTop).not.toBe(400);
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.stop).not.toHaveBeenCalled();

  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});


it('shows four visual beats over 8/8 and lets the Musician menu hide them', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: false } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  const song = { id: 'song', title: 'Eight beats', lyrics: '[V1]\nSing now', sequence: 'V1', chords: null, rhythm: { numerator: 8, denominator: 8, visual_beats: 4, patterns: [], notes: '', markers: [{ id: 'bar', section: 'V1', lineIndex: 0, anchorIndex: 3 }] } } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div'); container.append(mount, toolbar); const root = createRoot(mount);
  try {
    await act(async () => root.render(<MusicianLiveView canUseMusic plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    expect(container.querySelector('.musician-beat-keeper')).toBeNull();
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Lyric highlight: on"]')!.click());
    musician(container);
    await play(container);
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    await act(async () => position(0.25));
    expect(container.querySelector('.lyric-highlight-character.is-downbeat')).not.toBeNull();
    await act(async () => position(0.1));
    expect(container.querySelector('.lyric-highlight-character.is-downbeat')).not.toBeNull();
    await act(async () => position(0.4));
    expect(container.querySelector('.lyric-highlight-character.is-downbeat')).toBeNull();
    await act(async () => position(0.25));
    expect(container.querySelectorAll('.musician-beat-keeper span')).toHaveLength(4);
    expect(container.querySelector('.musician-beat-keeper .is-active')?.textContent).toBe('2');
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Current lyrics"]')!.click());
    expect(audio.queuePerformance).toHaveBeenCalledOnce();
    expect(audio.play).toHaveBeenCalledOnce();
    expect(audio.stop).not.toHaveBeenCalled();
    const [, restarted, committed] = audio.queuePerformance.mock.calls[0] as [unknown, (position: number) => void, () => void];
    await act(async () => { committed(); restarted(0.25); });
    musician(container);
    act(() => document.querySelector<HTMLButtonElement>('[aria-label="Beat keeper: off"]')!.click());
    expect(container.querySelector('.musician-beat-keeper')).toBeNull();
    expect(audio.stop).not.toHaveBeenCalled();
    expect(localStorage.getItem('worship-beat-keeper')).toBe('off');
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});

it('keeps a read-only mobile keyboard target and accepts arrows from a closed menu trigger', async () => {
  const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) CriOS/120 Mobile');
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  vi.mocked(getPresentationLiveState).mockResolvedValue({ plan_id: 'plan', index: 0, updated_at: 1, worship_coupled: false, plan_item_id: 'item', slide_offset: 0 } as Awaited<ReturnType<typeof getPresentationLiveState>>);
  const song = { id: 'song', title: 'Pedal test', lyrics: '[V1]\nFirst line\n[C]\nSecond line', sequence: 'V1 C', chords: null, rhythm: null } as unknown as Song;
  const plan = { id: 'plan', items: [{ id: 'item', item_type: 'song', song_id: 'song', sequence: '1', title: song.title }] } as PlanDetail;
  const container = document.createElement('div'), mount = document.createElement('div'), toolbar = document.createElement('div');
  container.append(mount, toolbar); document.body.append(container);
  const root = createRoot(mount);
  try {
    await act(async () => root.render(<MusicianLiveView canUseMusic plan={plan} songs={[song]} topbarSlot={toolbar} onEditSong={() => {}} onExit={() => {}} />));
    const capture = container.querySelector<HTMLInputElement>('[data-slide-key-capture]')!;
    expect(capture.readOnly).toBe(true);
    expect(capture.inputMode).toBe('none');
    expect(document.activeElement).toBe(capture);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="Play"]')!;
    await act(async () => { trigger.focus(); trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(updateBandSelection).toHaveBeenCalled();
    expect(container.querySelector('.musician-page.is-current')?.textContent?.replace(/\s/g, ' ')).toContain('First line');
  } finally { act(() => root.unmount()); container.remove(); userAgent.mockRestore(); vi.clearAllMocks(); }
});
