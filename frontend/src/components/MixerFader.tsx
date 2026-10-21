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
  const drag = useRef<{ id: number; y: number; lastY: number; value: number; travel: number; moved: boolean } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [touchValue, setTouchValue] = useState(value);
  function cancel() {
    const pointer = drag.current;
    drag.current = null;
    setExpanded(false);
    if (pointer && element.current?.hasPointerCapture(pointer.id)) element.current.releasePointerCapture(pointer.id);
  }
  useEffect(() => { if (disabled) cancel(); }, [disabled]);
  useEffect(() => {
    if (!expanded) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') { event.stopPropagation(); cancel(); }
    };
    const visibility = () => { if (document.visibilityState === 'hidden') cancel(); };
    document.addEventListener('keydown', escape);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('blur', cancel);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', escape);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('blur', cancel);
    };
  }, [expanded]);
  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0) || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const expand = touchExpand && (event.pointerType === 'touch' || event.pointerType === 'pen');
    drag.current = {
      id: event.pointerId, y: event.clientY, lastY: event.clientY, value, moved: false,
      travel: expand ? Math.max(200, window.innerHeight - 180) : Math.max(1, event.currentTarget.getBoundingClientRect().height - 24),
    };
    setTouchValue(value);
    setExpanded(expand);
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
    if (drag.current?.id === event.pointerId) cancel();
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
  function key(event: KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;
    const step = event.shiftKey ? .001 : .005;
    const next: Record<string, number> = {
      ArrowUp: value + step, ArrowRight: value + step,
      ArrowDown: value - step, ArrowLeft: value - step,
      PageUp: value + .05, PageDown: value - .05, Home: 0, End: 1,
    };
    if (!(event.key in next)) return;
    event.preventDefault();
    event.stopPropagation();
    onChange(clamp(next[event.key]));
  }
  return <><div ref={element} className="xr-fader" role="slider" aria-label={label}
    title="Drag to adjust; touch and hold for full-screen fine control. Arrow keys adjust; Shift gives fine control." aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={Math.round(value * 100)} aria-valuetext={valueText}
    aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
    onPointerDown={start} onPointerMove={move} onPointerUp={finish}
    onPointerCancel={finish} onLostPointerCapture={cancel} onKeyDown={key}>
    <span className="xr-fader-rail" aria-hidden="true">
      {resetValue !== undefined && <span className="xr-fader-zero" style={{ top: `${(1 - resetValue) * 100}%` }} />}
      <span className="xr-fader-thumb" style={{ top: `${(1 - value) * 100}%` }} />
    </span>
  </div>{expanded && createPortal(<div className="xr-touch-overlay" role="region" aria-label={`${label} touch control`}
    onPointerDown={event => { event.stopPropagation(); event.preventDefault(); }}>
    <header><strong>{label}</strong><output>{formatValue?.(touchValue) ?? valueText}</output><small>Drag for fine control · release to return</small></header>
    <div className="xr-touch-track" aria-hidden="true">
      <span className="xr-touch-rail" />
      {resetValue !== undefined && <span className="xr-touch-zero" style={{ top: `${(1 - resetValue) * 100}%` }}>{resetLabel}</span>}
      <span className="xr-touch-thumb" style={{ top: `${(1 - touchValue) * 100}%` }} />
    </div>
    {resetValue !== undefined && <button type="button" onPointerDown={event => event.stopPropagation()} onClick={reset}>{resetLabel}</button>}
  </div>, document.body)}</>;
}
