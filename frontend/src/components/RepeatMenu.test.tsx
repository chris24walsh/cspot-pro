// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { RepeatMenu } from './RepeatMenu';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('keeps choices hidden until requested and selects an individual repeat', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container), select = vi.fn();
  try {
    act(() => root.render(<RepeatMenu label="C" count={3} activeRepeat={1} onSelect={select} />));
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label^="Choose C repetition"]')!;
    expect(trigger.textContent).toContain('×3');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    act(() => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = document.querySelector<HTMLElement>('[aria-label="C repetitions"]')!;
    expect(menu.querySelector('[aria-label="Go to C, repeat 2 of 3"]')?.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Go to C, repeat 2 of 3');
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Go to C, repeat 3 of 3');
    act(() => menu.querySelector<HTMLButtonElement>('[aria-label="Go to C, repeat 3 of 3"]')!.click());
    expect(select).toHaveBeenCalledWith(2);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    act(() => trigger.click());
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally { act(() => root.unmount()); container.remove(); }
});
