import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  label: string;
  value: number;
  valueText: string;
  disabled: boolean;
  onChange: (value: number) => void;
  touchExpand?: boolean;
  resetValue?: number;
  resetLabel?: string;
  formatValue?: (value: number) => string;
};

const clamp = (value: number) => Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));

/** Relative movement never jumps a live level when its rail is touched. */
export function MixerFader({ label, value, valueText, disabled, onChange, touchExpand = false, resetValue, resetLabel, formatValue }: Props) {
  const element = useRef<HTMLDivElement>(null);
  const overlay = useRef<HTMLDivElement>(null);
  const drag = useRef<{ node: HTMLDivElement; id: number; y: number; lastY: number; value: number; travel: number; moved: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [touchValue, setTouchValue] = useState(value);
  function endDrag() {
    const pointer = drag.current;
    drag.current = null;
    if (pointer?.node.hasPointerCapture(pointer.id)) pointer.node.releasePointerCapture(pointer.id);
  }
  function close() {
    endDrag();
    setExpanded(false);
    if (!disabled) element.current?.focus({ preventScroll: true });
  }
  useEffect(() => { if (disabled) close(); }, [disabled]);
  useEffect(() => { if (!drag.current) setTouchValue(value); }, [value]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    overlay.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); close(); }
    };
    const visibility = () => { if (document.visibilityState === 'hidden') endDrag(); };
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', endDrag);
    return () => {
      endDrag();
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', endDrag);
    };
  }, [expanded]);
  function start(event: PointerEvent<HTMLDivElement>, enlarged = false) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0) || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    if (!enlarged && touchExpand && (event.pointerType === 'touch' || event.pointerType === 'pen')) {
      setTouchValue(value);
      setExpanded(true);
      return;
    }
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      node: event.currentTarget, id: event.pointerId, y: event.clientY, lastY: event.clientY,
      value: enlarged ? touchValue : value, moved: false,
      travel: Math.max(1, event.currentTarget.getBoundingClientRect().height - (enlarged ? 0 : 24)),
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (disabled || !start || start.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    start.lastY = event.clientY;
    const distance = start.y - event.clientY;
    if (!start.moved && Math.abs(distance) < 3) return;
    start.moved = true;
    let next = clamp(start.value + distance / start.travel);
    if (resetValue !== undefined && Math.abs(next - resetValue) <= .008) next = resetValue;
    setTouchValue(next);
    onChange(next);
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id === event.pointerId) endDrag();
  }
  function reset() {
    if (disabled || resetValue === undefined) return;
    if (drag.current) {
      drag.current.value = resetValue;
      drag.current.y = drag.current.lastY;
    }
    setTouchValue(resetValue);
    onChange(resetValue);
  }
  function key(event: KeyboardEvent<HTMLDivElement>, currentValue = value) {
    if (disabled) return;
    const step = event.shiftKey ? .001 : .005;
    const next: Record<string, number> = {
      ArrowUp: currentValue + step, ArrowRight: currentValue + step,
      ArrowDown: currentValue - step, ArrowLeft: currentValue - step,
      PageUp: currentValue + .05, PageDown: currentValue - .05, Home: 0, End: 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    event.stopPropagation();
    setTouchValue(clamp(next[event.key]));
    onChange(clamp(next[event.key]));
  }
  return <><div ref={element} className="xr-fader" role="slider" aria-label={label}
    title="Drag to adjust; tap to open full-screen fine control. Arrow keys adjust; Shift gives fine control." aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={Math.round(value * 100)} aria-valuetext={valueText}
    aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
    onPointerDown={event => start(event)} onPointerMove={move} onPointerUp={finish}
    onPointerCancel={finish} onLostPointerCapture={endDrag} onKeyDown={key}>
    <span className="xr-fader-rail" aria-hidden="true">
      {resetValue !== undefined && <span className="xr-fader-zero" style={{ top: `${(1 - resetValue) * 100}%` }} />}
      <span className="xr-fader-thumb" style={{ top: `${(1 - value) * 100}%` }} />
    </span>
  </div>{expanded && createPortal(<div ref={overlay} className="xr-touch-overlay" role="dialog" aria-modal="true" aria-label={`${label} touch control`}
    onPointerDown={event => event.stopPropagation()}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), [role=slider][tabindex="0"]'));
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <button type="button" className="xr-touch-close" aria-label={`Close ${label} control`} title="Close control" onClick={close}>×</button>
    <header><strong>{label}</strong><output>{formatValue?.(touchValue) ?? valueText}</output><small>Drag to adjust · × to close</small></header>
    <div className="xr-touch-track" role="slider" aria-label={`${label} expanded`} aria-orientation="vertical"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(touchValue * 100)}
      aria-valuetext={formatValue?.(touchValue) ?? valueText} aria-disabled={disabled} tabIndex={0}
      onPointerDown={event => start(event, true)} onPointerMove={move} onPointerUp={finish}
      onPointerCancel={finish} onLostPointerCapture={endDrag} onKeyDown={event => key(event, touchValue)}>
      <span className="xr-touch-rail" aria-hidden="true" />
      {resetValue !== undefined && <span className="xr-touch-zero" aria-hidden="true" style={{ top: `${(1 - resetValue) * 100}%` }}>{resetLabel}</span>}
      <span className="xr-touch-thumb" aria-hidden="true" style={{ top: `${(1 - touchValue) * 100}%` }} />
    </div>
    {resetValue !== undefined && <button type="button" className="xr-touch-reset" onClick={reset}>{resetLabel}</button>}
  </div>, document.body)}</>;
}
