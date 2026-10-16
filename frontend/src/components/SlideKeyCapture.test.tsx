// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SlideKeyCapture, shouldRestoreSlideKeyCapture } from './SlideKeyCapture';
import { isEditableKeyboardTarget, slideKeyboardDirection } from '../keyboardNavigation';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('captures iPhone pedal keys on first mount and reactivation without visiting another view', async () => {
  const userAgent = vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone) CriOS/120 Mobile');
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container), ref = createRef<HTMLInputElement>();
  const received = vi.fn((event: KeyboardEvent) => {
    if (!isEditableKeyboardTarget(event.target)) return slideKeyboardDirection(event);
    return null;
  });
  window.addEventListener('keydown', received);
  try {
    act(() => root.render(<SlideKeyCapture ref={ref} />));
    expect(document.activeElement).toBe(ref.current);
    expect(ref.current?.readOnly).toBe(true);
    expect(ref.current?.inputMode).toBe('none');
    ref.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(received).toHaveLastReturnedWith(1);
    ref.current!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(received).toHaveLastReturnedWith(-1);
    act(() => root.render(<SlideKeyCapture active={false} ref={ref} />));
    const field = document.createElement('input'); container.append(field); field.focus();
    expect(document.activeElement).toBe(field);
    act(() => root.render(<SlideKeyCapture active ref={ref} />));
    expect(document.activeElement).toBe(ref.current);
  } finally { window.removeEventListener('keydown', received); act(() => root.unmount()); container.remove(); userAgent.mockRestore(); }
});

it.each([
  ['<button>V1</button>', true],
  ['<button><svg><path /></svg></button>', true],
  ['<div role="button" tabindex="0">Lyrics</div>', true],
  ['<a href="#">Action</a>', true],
  ['<div>Background</div>', true],
  ['<input />', false],
  ['<textarea></textarea>', false],
  ['<select><option>C</option></select>', false],
  ['<label>Key<select></select></label>', false],
  ['<div contenteditable="true"><b>Edit lyrics</b></div>', false],
  ['<div role="menu"><button>Setting</button></div>', false],
  ['<div role="dialog"><button>Save</button></div>', false],
  ['<button aria-haspopup="menu">Open</button>', false],
])('restores capture for actions while preserving editing: %s', (markup, expected) => {
  const container = document.createElement('div'); container.innerHTML = markup;
  expect(shouldRestoreSlideKeyCapture(container.firstElementChild)).toBe(expected);
  if (container.querySelector('path')) expect(shouldRestoreSlideKeyCapture(container.querySelector('path'))).toBe(expected);
  if (container.querySelector('b')) expect(shouldRestoreSlideKeyCapture(container.querySelector('b'))).toBe(expected);
});

it('recovers idle focus when a focused dialog is removed without stealing form editing', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container), ref = createRef<HTMLInputElement>();
  const dialog = document.createElement('div'); dialog.setAttribute('role', 'dialog');
  const field = document.createElement('input'); dialog.append(field);
  try {
    act(() => root.render(<SlideKeyCapture ref={ref} />));
    await act(async () => { document.body.append(dialog); field.focus(); });
    expect(document.activeElement).toBe(field);
    await act(async () => { dialog.append(document.createElement('span')); });
    expect(document.activeElement).toBe(field);
    await act(async () => { dialog.remove(); });
    expect(document.activeElement).toBe(ref.current);
  } finally { act(() => root.unmount()); container.remove(); dialog.remove(); }
});
