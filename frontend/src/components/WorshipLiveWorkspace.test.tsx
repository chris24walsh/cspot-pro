// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorshipLiveWorkspace } from './WorshipLiveWorkspace';
vi.mock('./Xr18MixerPanel', () => ({ Xr18MixerPanel: ({ embeddedExpanded }: { embeddedExpanded: boolean }) => {
  const [bank, setBank] = useState(0);
  return <button data-expanded={embeddedExpanded} onClick={() => setBank(bank + 1)}>Bank {bank}</button>;
} }));
let root: Root, container: HTMLDivElement;
let resize: () => void;
let wide = true;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  wide = true;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return wide; }, addEventListener: (_: string, listener: () => void) => { resize = listener; }, removeEventListener: vi.fn() }));
  container = document.createElement('div'); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
function render(canUseMixer = true) {
  act(() => root.render(<WorshipLiveWorkspace canUseMixer={canUseMixer}>{(visible, menu, split) => <div data-visible={visible} data-split={split}><input defaultValue="Verse 2" />{menu?.(() => {})}</div>}</WorshipLiveWorkspace>));
}
function click(label: string) { act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); }
it('keeps worship and mixer state while switching and splitting', () => {
  render();
  const song = container.querySelector('input');
  click('Mixer');
  expect(container.querySelector('[data-visible]')!.getAttribute('data-visible')).toBe('false');
  act(() => container.querySelector<HTMLButtonElement>('.worship-live-mixer button')!.click());
  click('Worship');
  expect(container.querySelector('[data-split]')!.getAttribute('data-split')).toBe('false');
  click('Split');
  expect(container.querySelector('[data-split]')!.getAttribute('data-split')).toBe('true');
  expect(container.querySelector('input')).toBe(song);
  expect(container.querySelector('.worship-live-mixer')!.textContent).toBe('Bank 1');
  expect(container.querySelector('[data-visible]')!.getAttribute('data-visible')).toBe('true');
});
it('falls back from split when narrowed and allows full-width mixer', () => {
  render(); click('Split');
  act(() => { wide = false; resize(); });
  expect(container.querySelector('[aria-label="Split"]')).toBeNull();
  expect(container.querySelector('[aria-label="Worship"]')!.getAttribute('aria-checked')).toBe('true');
  click('Mixer');
  expect(container.querySelector('.worship-workspace-song')!.hasAttribute('hidden')).toBe(true);
});
it('only offers the mixer to permitted users', () => {
  render(false);
  expect(container.querySelector('[aria-label="Live workspace view"]')).toBeNull();
  expect(container.querySelector('.worship-live-mixer')).toBeNull();
});

function swipe(target: string, dx: number, dy = 0) {
  const edge = container.querySelector(`[data-workspace-swipe="${target}"]`)!;
  Object.assign(edge, { setPointerCapture: vi.fn() });
  function pointer(type: string, x: number, y: number) {
    const event = new Event(type, { bubbles: true });
    Object.assign(event, { pointerType: 'touch', isPrimary: true, pointerId: 1, clientX: x, clientY: y });
    act(() => edge.dispatchEvent(event));
  }
  pointer('pointerdown', 100, 100); pointer('pointerup', 100 + dx, 100 + dy);
}
it('switches on deliberate edge swipes, preserving mounted views', () => {
  render();
  const song = container.querySelector('input');
  swipe('mixer', -100);
  expect(container.querySelector('.view-mixer')).not.toBeNull();
  expect(container.querySelector('[data-expanded="true"]')).not.toBeNull();
  swipe('worship', 100);
  expect(container.querySelector('.view-worship')).not.toBeNull();
  expect(container.querySelector('input')).toBe(song);
  expect(container.querySelector('.worship-workspace-controls')).toBeNull();
});
it('ignores short, vertical and reversed edge swipes', () => {
  render();
  swipe('mixer', -20); swipe('mixer', -70, 100); swipe('mixer', 100);
  expect(container.querySelector('.view-worship')).not.toBeNull();
});
