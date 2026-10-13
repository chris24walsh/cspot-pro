// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CompactControlMenu } from './CompactControlMenu';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('supports keyboard navigation, skips disabled choices, and restores focus on Escape', async () => {
  const container = document.createElement('div'); document.body.appendChild(container); const root = createRoot(container);
  try {
    await act(async () => root.render(<CompactControlMenu label="Musician" icon={null}>{() => <>
      <button role="menuitem" type="button">First</button><button disabled role="menuitem" type="button">Disabled</button><button role="menuitem" type="button">Last</button>
    </>}</CompactControlMenu>));
    const trigger = container.querySelector<HTMLButtonElement>('button')!;
    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    const menu = document.querySelector('[role="menu"]')!;
    expect(document.activeElement?.textContent).toBe('First');
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })));
    expect(document.activeElement?.textContent).toBe('Last');
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
    expect(document.activeElement?.textContent).toBe('First');
    expect(menu.getAttribute('aria-label')).toBe('Musician options');
    act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    act(() => trigger.click());
    act(() => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally { act(() => root.unmount()); container.remove(); }
});

it('keeps a direct stop action as one click without opening a menu', async () => {
  const action = vi.fn(); const container = document.createElement('div'), root = createRoot(container);
  try {
    await act(async () => root.render(<CompactControlMenu label="Stop playback" icon={null} action={action}>{() => <button type="button">Unused</button>}</CompactControlMenu>));
    act(() => container.querySelector<HTMLButtonElement>('button')!.click());
    expect(action).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  } finally { act(() => root.unmount()); }
});
