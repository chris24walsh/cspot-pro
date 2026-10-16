import { createContext, forwardRef, useEffect, useRef } from 'react';
import { isMobileOrTabletDevice } from '../presentationDevice';

/** Menus inside a presenter return focus to its hardware-keyboard target. */
export const SlideKeyboardCaptureContext = createContext<(() => void) | null>(null);

/** Action clicks return to presenting; fields and open popups keep native input. */
export function shouldRestoreSlideKeyCapture(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('input:not([data-slide-key-capture]), select, textarea, [contenteditable]:not([contenteditable="false"]), [role="menu"], [role="dialog"], [aria-modal="true"], .song-rhythm-display-panel, .confirmation-dialog-backdrop')) return false;
  if (target.closest('[aria-haspopup]:not([aria-haspopup="false"])')) return false;
  const label = target.closest('label');
  return !label?.querySelector('input, select, textarea');
}

/** A hardware-keyboard target that does not request the mobile software keyboard. */
export const SlideKeyCapture = forwardRef<HTMLInputElement, { active?: boolean }>(function SlideKeyCapture({ active = true }, forwardedRef) {
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!active) return;
    input.current?.focus({ preventScroll: true });
    const restoreIdleCapture = () => {
      // Removing a focused popup can leave focus on body without another blur
      // from this input. Recover only idle focus, never an actual editing field.
      if (document.activeElement === document.body
        && !document.querySelector('[role="dialog"], [role="menu"], .song-rhythm-display-panel, .confirmation-dialog-backdrop')) {
        input.current?.focus({ preventScroll: true });
      }
    };
    const observer = new MutationObserver(restoreIdleCapture);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener('focus', restoreIdleCapture);
    return () => { observer.disconnect(); window.removeEventListener('focus', restoreIdleCapture); };
  }, [active]);
  return <input
    aria-hidden="true" autoCapitalize="off" autoComplete="off" autoCorrect="off"
    className="slide-key-capture" data-slide-key-capture="true" inputMode="none"
    readOnly={isMobileOrTabletDevice()} spellCheck={false} tabIndex={-1}
    onBlur={() => window.setTimeout(() => {
      if (active && document.activeElement === document.body
        && !document.querySelector('[role="dialog"], [role="menu"], .song-rhythm-display-panel, .confirmation-dialog-backdrop')) input.current?.focus({ preventScroll: true });
    }, 0)}
    ref={node => {
      input.current = node;
      if (typeof forwardedRef === 'function') forwardedRef(node);
      else if (forwardedRef) forwardedRef.current = node;
    }}
  />;
});
