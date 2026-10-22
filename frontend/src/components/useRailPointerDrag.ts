import { useEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { RailPlacement } from '../railOrdering';

export type RailDropTarget = { id: string; placement: RailPlacement };

export function railPlacementAt(element: HTMLElement, y: number): RailPlacement {
  const fixed = element.dataset.railPlacement;
  if (fixed === 'before' || fixed === 'after' || fixed === 'inside') return fixed;
  const bounds = (element.querySelector('.section-rail-jump') ?? element).getBoundingClientRect();
  const fraction = (y - bounds.top) / bounds.height;
  if (element.dataset.railSection === 'true' && fraction >= .25 && fraction <= .75) return 'inside';
  return fraction >= .5 ? 'after' : 'before';
}

export function railEdgeScroll(point: number, start: number, end: number) {
  const edge = Math.min(36, (end - start) / 3);
  if (edge <= 0 || point < start || point > end) return 0;
  if (point < start + edge) return -Math.ceil(12 * (start + edge - point) / edge);
  if (point > end - edge) return Math.ceil(12 * (point - end + edge) / edge);
  return 0;
}

type Options = {
  enabled: boolean;
  scrollRef: RefObject<HTMLElement>;
  canDrop: (source: string, target: RailDropTarget) => boolean;
  onStart: (source: string) => void;
  onTarget: (target: RailDropTarget | null) => void;
  onFinish: (source: string, target: RailDropTarget | null) => void;
};

export function useRailPointerDrag(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<{ id: string; pointerId: number; startX: number; startY: number; x: number; y: number; active: boolean } | null>(null);
  const frame = useRef<number | null>(null);

  function targetAt(x: number, y: number): RailDropTarget | null {
    const root = latest.current.scrollRef.current;
    const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-rail-drop-id]');
    if (!element || !root?.contains(element) || !session.current || !latest.current.enabled) return null;
    const target = { id: element.dataset.railDropId!, placement: railPlacementAt(element, y) };
    return latest.current.canDrop(session.current.id, target) ? target : null;
  }

  function stop(cancel: boolean) {
    const current = session.current;
    if (!current) return;
    const target = !cancel && current.active ? targetAt(current.x, current.y) : null;
    session.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    if (current.active) latest.current.onFinish(current.id, target);
  }

  function scrollFrame() {
    const current = session.current;
    const root = latest.current.scrollRef.current;
    if (!current?.active || !root) return;
    if (!latest.current.enabled) { stop(true); return; }
    const rect = root.getBoundingClientRect();
    root.scrollTop += railEdgeScroll(current.y, Math.max(0, rect.top), Math.min(window.innerHeight, rect.bottom));
    root.scrollLeft += railEdgeScroll(current.x, Math.max(0, rect.left), Math.min(window.innerWidth, rect.right));
    latest.current.onTarget(targetAt(current.x, current.y));
    frame.current = requestAnimationFrame(scrollFrame);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && session.current) { event.preventDefault(); stop(true); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      session.current = null;
      if (frame.current !== null) cancelAnimationFrame(frame.current);
    };
  }, []);

  return (id: string) => ({
    onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (!latest.current.enabled || session.current || event.button !== 0 || event.isPrimary === false) return;
      event.preventDefault();
      event.stopPropagation();
      session.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY, active: false };
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => {
      const current = session.current;
      if (!current || current.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      current.x = event.clientX;
      current.y = event.clientY;
      if (!current.active && Math.hypot(current.x - current.startX, current.y - current.startY) >= 6) {
        current.active = true;
        latest.current.onStart(current.id);
        frame.current = requestAnimationFrame(scrollFrame);
      }
      if (current.active) latest.current.onTarget(targetAt(current.x, current.y));
    },
    onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (session.current?.pointerId !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      session.current.x = event.clientX;
      session.current.y = event.clientY;
      stop(false);
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => { if (session.current?.pointerId === event.pointerId) stop(true); },
    onLostPointerCapture: (event: ReactPointerEvent<HTMLButtonElement>) => { if (session.current?.pointerId === event.pointerId) stop(true); },
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => { event.preventDefault(); event.stopPropagation(); },
    onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => event.preventDefault(),
  });
}
