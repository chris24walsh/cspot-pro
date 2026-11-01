// @vitest-environment jsdom
import React, { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { WorshipLiveWorkspace } from './WorshipLiveWorkspace';
vi.mock('./Xr18MixerPanel', () => ({ Xr18MixerPanel: () => {
  const [bank, setBank] = useState(0);
  return <button onClick={() => setBank(bank + 1)}>Bank {bank}</button>;
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
  act(() => root.render(<WorshipLiveWorkspace canUseMixer={canUseMixer}>{visible => <div data-visible={visible}><input defaultValue="Verse 2" /></div>}</WorshipLiveWorkspace>));
}
function click(label: string) { act(() => container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click()); }
it('keeps worship and mixer state while switching and splitting', () => {
  render();
  const song = container.querySelector('input');
  click('Mixer');
  expect(container.querySelector('[data-visible]')!.getAttribute('data-visible')).toBe('false');
  act(() => container.querySelector<HTMLButtonElement>('.worship-live-mixer button')!.click());
  click('Worship'); click('Split');
  expect(container.querySelector('input')).toBe(song);
  expect(container.querySelector('.worship-live-mixer')!.textContent).toBe('Bank 1');
  expect(container.querySelector('[data-visible]')!.getAttribute('data-visible')).toBe('true');
});
it('falls back from split when narrowed and allows full-width mixer', () => {
  render(); click('Split');
  act(() => { wide = false; resize(); });
  expect(container.querySelector('[aria-label="Split"]')).toBeNull();
  expect(container.querySelector('[aria-label="Worship"]')!.getAttribute('aria-pressed')).toBe('true');
  click('Mixer');
  expect(container.querySelector('.worship-workspace-song')!.hasAttribute('hidden')).toBe(true);
});
it('only offers the mixer to permitted users', () => {
  render(false);
  expect(container.querySelector('[aria-label="Live workspace view"]')).toBeNull();
  expect(container.querySelector('.worship-live-mixer')).toBeNull();
});
