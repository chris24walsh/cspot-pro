import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SlideKeyboardCaptureContext } from './SlideKeyCapture';
import { useEscapeClose } from './useEscapeClose';

/** A small repeat badge opens choices without occupying space in the song view. */
export function RepeatMenu({ label, count, activeRepeat, onSelect, className = '', restoreFocus }: {
  label: string;
  count: number;
  activeRepeat: number | null;
  onSelect: (index: number) => void;
  className?: string;
  restoreFocus?: () => void;
}) {
  const restoreCapture = useContext(SlideKeyboardCaptureContext);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const close = () => {
    setPosition(null);
    if (restoreFocus) restoreFocus();
    else if (restoreCapture) restoreCapture();
    else trigger.current?.focus({ preventScroll: true });
  };
  useEscapeClose(Boolean(position), close);

  const reposition = () => {
    const rect = trigger.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(188, window.innerWidth - 16);
    setPosition({
      left: Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 88)),
    });
  };
  useEffect(() => {
    if (!position) return;
    (panel.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]') ?? panel.current?.querySelector<HTMLButtonElement>('button'))?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target)) setPosition(null);
    };
    document.addEventListener('pointerdown', outside);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [Boolean(position)]);

  const current = activeRepeat === null ? '' : `, repeat ${activeRepeat + 1} of ${count}`;
  return <>
    <button type="button" ref={trigger} className={`repeat-menu-trigger ${className}`}
      aria-label={`Choose ${label} repetition${current}`} aria-haspopup="menu" aria-expanded={Boolean(position)}
      title={`${label}: choose a repetition${current}`} onClick={() => position ? close() : reposition()}>
      ×{count}{activeRepeat !== null ? <span className="repeat-menu-current"> {activeRepeat + 1}/{count}</span> : null}
    </button>
    {position ? createPortal(<div className="repeat-menu" role="menu" aria-label={`${label} repetitions`} ref={panel}
      style={{ left: position.left, top: position.top, maxHeight: Math.max(80, window.innerHeight - position.top - 8) }}
      onKeyDown={event => {
        event.stopPropagation();
        if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button'));
        const index = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length;
        items[next]?.focus();
      }}>
      <strong>{label} repetitions</strong>
      <div className="repeat-menu-options">{Array.from({ length: count }, (_, index) => <button type="button" role="menuitemradio" key={index}
        aria-label={`Go to ${label}, repeat ${index + 1} of ${count}`} aria-checked={index === activeRepeat}
        onClick={() => { onSelect(index); close(); }}>{index + 1}</button>)}</div>
    </div>, document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ?? document.body) : null}
  </>;
}
