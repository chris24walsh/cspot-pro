// @vitest-environment jsdom
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { SlideKeyCapture } from './SlideKeyCapture';
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
