import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useEscapeClose } from './useEscapeClose';

export function CompactControlMenu({ label, icon, children, active = false, action }: {
  label: string; icon: ReactNode; children: (close: () => void) => ReactNode; active?: boolean; action?: () => void;
}) {
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const trigger = useRef<HTMLButtonElement>(null), panel = useRef<HTMLDivElement>(null);
  const close = () => { setPosition(null); trigger.current?.focus(); };
  useEscapeClose(Boolean(position), close);
  useEffect(() => {
    if (!position) return;
    panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!trigger.current?.contains(target) && !panel.current?.contains(target) && !(target instanceof Element && target.closest('.song-rhythm-display-panel'))) setPosition(null);
    };
    const resize = () => setPosition(null);
    document.addEventListener('pointerdown', outside); window.addEventListener('resize', resize);
    return () => { document.removeEventListener('pointerdown', outside); window.removeEventListener('resize', resize); };
  }, [position]);
  function open() {
    const bounds = trigger.current!.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(bounds.right - 240, window.innerWidth - 248)), top: Math.min(bounds.bottom + 5, window.innerHeight - 80) });
  }
  return <>
    <button aria-label={label} aria-expanded={action ? undefined : Boolean(position)} aria-haspopup={action ? undefined : 'menu'} className={`musician-reader-toggle ${active ? 'is-active' : ''}`} ref={trigger} onClick={() => action ? action() : position ? close() : open()} onKeyDown={event => { if (!action && event.key === 'ArrowDown') { event.preventDefault(); open(); } }} title={label} type="button">
      {icon}<span className="musician-control-text">{label}</span>{!action ? <ChevronDown size={12} aria-hidden="true" /> : null}
    </button>
    {position ? createPortal(<div className="musician-control-menu" role="menu" aria-label={`${label} options`} ref={panel} style={{ left: position.left, top: position.top, maxHeight: Math.max(60, window.innerHeight - position.top - 8) }} onKeyDown={event => {
      if (event.target instanceof HTMLSelectElement || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const items = Array.from(panel.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }}>{children(close)}</div>, document.fullscreenElement ?? (document as Document & { webkitFullscreenElement?: Element }).webkitFullscreenElement ?? document.body) : null}
  </>;
}
