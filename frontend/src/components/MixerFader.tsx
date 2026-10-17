import { useEffect, useRef, type KeyboardEvent, type PointerEvent } from 'react';

type Props = {
  label: string;
  value: number;
  valueText: string;
  disabled: boolean;
  onChange: (value: number) => void;
};

const clamp = (value: number) => Math.max(0, Math.min(1, Math.round(value * 1000) / 1000));

/** Relative pointer movement prevents a rail touch from jumping a live fader. */
export function MixerFader({ label, value, valueText, disabled, onChange }: Props) {
  const drag = useRef<{ id: number; y: number; value: number; travel: number; moved: boolean } | null>(null);
  useEffect(() => { if (disabled) drag.current = null; }, [disabled]);
  function start(event: PointerEvent<HTMLDivElement>) {
    if (disabled || (event.pointerType === 'mouse' && event.button !== 0) || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = {
      id: event.pointerId,
      y: event.clientY,
      value,
      moved: false,
      travel: Math.max(1, event.currentTarget.getBoundingClientRect().height - 24),
    };
  }
  function move(event: PointerEvent<HTMLDivElement>) {
    const start = drag.current;
    if (disabled || !start || start.id !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    const distance = start.y - event.clientY;
    if (!start.moved && Math.abs(distance) < 3) return;
    start.moved = true;
    onChange(clamp(start.value + distance / start.travel));
  }
  function finish(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.id !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
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
  return <div className="xr-fader" role="slider" aria-label={label}
    title="Drag up or down to adjust. Arrow keys adjust; Shift gives fine control." aria-orientation="vertical" aria-valuemin={0} aria-valuemax={100}
    aria-valuenow={Math.round(value * 100)} aria-valuetext={valueText}
    aria-disabled={disabled} tabIndex={disabled ? -1 : 0}
    onPointerDown={start} onPointerMove={move} onPointerUp={finish}
    onPointerCancel={finish} onLostPointerCapture={() => { drag.current = null; }} onKeyDown={key}>
    <span className="xr-fader-rail" aria-hidden="true">
      <span className="xr-fader-thumb" style={{ top: `${(1 - value) * 100}%` }} />
    </span>
  </div>;
}
