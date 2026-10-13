// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { MusicianLiveView } from './MusicianLiveView';
import { createEmptyChordChart, serializeChordChart } from '../chordSheet';
import { updatePresentationLiveState, type PlanDetail, type Song } from '../api';
const audio = vi.hoisted(() => ({ play: vi.fn(async (..._args: unknown[]) => {}), stop: vi.fn() }));
vi.mock('../musicPractice', async original => ({ ...await original<typeof import('../musicPractice')>(), PracticeAudioPlayer: vi.fn(function() { return audio; }) }));
vi.mock('../api', () => ({ getPresentationLiveState: vi.fn(async () => ({ plan_id: 'plan', index: 0, updated_at: '2026-10-13', worship_coupled: true, plan_item_id: 'item', slide_offset: 0 })), updatePresentationLiveState: vi.fn() }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('gates Music to admins, preserves hidden-bar spacing, and turns local pages at bar starts', async () => {
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
    expect(container.querySelector('[aria-label="Show music timing"]')).toBeNull();
    await act(async () => render(true));
    const grid = container.querySelector<HTMLElement>('.musician-chord-line')!.style.gridTemplateColumns;
    expect(container.querySelector('.lyric-bar-line')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Show music timing"]')!.click());
    expect(container.querySelector('.lyric-bar-line')).not.toBeNull();
    expect(container.querySelector<HTMLElement>('.musician-chord-line')!.style.gridTemplateColumns).toBe(grid);
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Listen with timing guide"]')!.click());
    const position = audio.play.mock.calls[0][4] as (position: number) => void;
    act(() => position(0.25));
    expect(container.querySelector('.lyric-timing-dot')).not.toBeNull();
    expect(container.querySelector('.musician-page.is-current')?.textContent).toContain('First');
    act(() => position(1));
    expect(container.querySelector('.musician-page.is-current')?.textContent).toContain('Second');
    expect(updatePresentationLiveState).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Show music timing"]')!.click());
    expect(container.querySelector('.lyric-timing-dot')).toBeNull();
    expect(container.querySelector('.lyric-bar-line')).toBeNull();
    expect(audio.stop).toHaveBeenCalledOnce();
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); vi.clearAllMocks(); }
});
