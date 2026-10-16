import { useEffect, useRef } from 'react';
import { isEditableKeyboardTarget, slideKeyboardDirection } from './keyboardNavigation';

/** Commands may consume keydown; otherwise distinguish taps and holds on release. */
export function usePedalKeyboard(enabled: boolean, action: (direction: -1 | 1, held: boolean) => void, onPress?: (direction: -1 | 1) => boolean) {
  const callback = useRef(action); callback.current = action;
  const pressCallback = useRef(onPress); pressCallback.current = onPress;
  useEffect(() => {
    if (!enabled) return;
    const pressed = new Map<number, { direction: -1 | 1; time: number; consumed: boolean }>();
    const down = (event: KeyboardEvent) => {
      const direction = slideKeyboardDirection(event);
      if (!direction || isEditableKeyboardTarget(event.target) || event.target instanceof Element && event.target.closest('[role="menu"]')) return;
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat && !pressed.has(direction)) {
        const press = { direction, time: Date.now(), consumed: false };
        pressed.set(direction, press);
        press.consumed = pressCallback.current?.(direction) ?? false;
      }
    };
    const up = (event: KeyboardEvent) => {
      const direction = slideKeyboardDirection(event);
      if (!direction) return;
      const press = pressed.get(direction);
      if (!press) return;
      pressed.delete(direction); event.preventDefault(); event.stopImmediatePropagation();
      if (!press.consumed) callback.current(press.direction, Date.now() - press.time >= 600);
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
