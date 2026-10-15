import { useEffect, useRef } from 'react';
import { isEditableKeyboardTarget, slideKeyboardDirection } from './keyboardNavigation';

/** Act on release, so a hold never also performs a tap. Ignore hardware repeats. */
export function usePedalKeyboard(enabled: boolean, action: (direction: -1 | 1, held: boolean) => void) {
  const callback = useRef(action); callback.current = action;
  useEffect(() => {
    if (!enabled) return;
    const pressed = new Map<string, { direction: -1 | 1; time: number }>();
    const key = (event: KeyboardEvent) => event.code || event.key;
    const down = (event: KeyboardEvent) => {
      const direction = slideKeyboardDirection(event);
      if (!direction || isEditableKeyboardTarget(event.target) || event.target instanceof Element && event.target.closest('[role="menu"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat && !pressed.has(key(event))) pressed.set(key(event), { direction, time: Date.now() });
    };
    const up = (event: KeyboardEvent) => {
      const press = pressed.get(key(event));
      if (!press) return;
      pressed.delete(key(event)); event.preventDefault(); event.stopImmediatePropagation();
      callback.current(press.direction, Date.now() - press.time >= 600);
    };
    const clear = () => pressed.clear();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', clear);
    return () => {
      window.removeEventListener('keydown', down, true); window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', clear); document.removeEventListener('visibilitychange', clear);
      clear();
    };
  }, [enabled]);
}
