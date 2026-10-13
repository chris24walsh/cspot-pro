// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MusicianLiveView } from './MusicianLiveView';
import { createEmptyChordChart, serializeChordChart } from '../chordSheet';
import { getPresentationLiveState, updatePresentationLiveState, type PlanDetail, type Song } from '../api';
const audio = vi.hoisted(() => ({ play: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn() }));
vi.mock('../musicPractice', async original => ({ ...await original<typeof import('../musicPractice')>(), PracticeAudioPlayer: vi.fn(function() { return audio; }) }));
vi.mock('../api', () => ({ getPresentationLiveState: vi.fn(async () => ({ plan_id: 'plan', index: 0, updated_at: '2026-10-13', worship_coupled: true, plan_item_id: 'item', slide_offset: 0 })), updatePresentationLiveState: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function musician(container: HTMLElement) { act(() => container.querySelector<HTMLButtonElement>('[aria-label="Musician"]')!.click()); }
function toggleBars(container: HTMLElement) {
  musician(container);
  act(() => document.querySelector<HTMLButtonElement>('[aria-label="Show music timing"]')!.click());
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
    expect(document.querySelector('[aria-label="Show music timing"]')).toBeNull();
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
    expect(container.querySelector('.musician-page.is-current')?.textContent).toContain('First');
    await act(async () => position(0.5));
    expect(updatePresentationLiveState).toHaveBeenCalledTimes(coupled ? 1 : 0);
    await act(async () => position(1));
    expect(container.querySelector('.musician-page.is-current')?.textContent).toContain('Second');
    if (coupled) {
      expect(updatePresentationLiveState).toHaveBeenCalledTimes(2);
      expect(updatePresentationLiveState).toHaveBeenLastCalledWith('plan', expect.objectContaining({ index: 2, plan_item_id: 'item', slide_offset: 2, worship_coupled: true }));
    } else expect(updatePresentationLiveState).not.toHaveBeenCalled();
    toggleBars(container);
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
