import { createContext, forwardRef, useEffect, useRef } from 'react';
import { isMobileOrTabletDevice } from '../presentationDevice';

/** Menus inside a presenter return focus to its hardware-keyboard target. */
export const SlideKeyboardCaptureContext = createContext<(() => void) | null>(null);

/** A hardware-keyboard target that does not request the mobile software keyboard. */
export const SlideKeyCapture = forwardRef<HTMLInputElement, { active?: boolean }>(function SlideKeyCapture({ active = true }, forwardedRef) {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (active) input.current?.focus({ preventScroll: true });
  }, [active]);
  return <input
    aria-hidden="true" autoCapitalize="off" autoComplete="off" autoCorrect="off"
    className="slide-key-capture" data-slide-key-capture="true" inputMode="none"
    readOnly={isMobileOrTabletDevice()} spellCheck={false} tabIndex={-1}
    onBlur={() => window.setTimeout(() => {
      if (active && document.activeElement === document.body) input.current?.focus({ preventScroll: true });
    }, 0)}
    ref={node => {
      input.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
  />;
});
