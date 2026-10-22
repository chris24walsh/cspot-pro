// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { DURABLE_CHANGE_EVENT, useDurableChange } from './changePolling';
it('passes changed domains to refresh handlers so planning need not reload songs', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const callback = vi.fn();
  function Listener() { useDurableChange(callback, true, ['planning', 'music']); return null; }
  const root = createRoot(document.createElement('div'));
  try {
    act(() => root.render(<Listener />));
    act(() => window.dispatchEvent(new CustomEvent(DURABLE_CHANGE_EVENT, { detail: { domains: ['planning'] } })));
    expect(callback).toHaveBeenLastCalledWith(['planning']);
    act(() => window.dispatchEvent(new CustomEvent(DURABLE_CHANGE_EVENT, { detail: { domains: ['music', 'planning'] } })));
    expect(callback).toHaveBeenLastCalledWith(['music', 'planning']);
    act(() => window.dispatchEvent(new CustomEvent(DURABLE_CHANGE_EVENT, { detail: { domains: ['identity'] } })));
    expect(callback).toHaveBeenCalledTimes(2);
  } finally { act(() => root.unmount()); vi.unstubAllGlobals(); }
});
