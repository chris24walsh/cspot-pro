// @vitest-environment jsdom
import { act, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { railEdgeScroll, railPlacementAt, useRailPointerDrag } from './useRailPointerDrag';

class TestPointerEvent extends MouseEvent {
  pointerId: number;
  isPrimary: boolean;
  pointerType = 'touch';
  constructor(type: string, init: MouseEventInit & { pointerId?: number; isPrimary?: boolean } = {}) {
    super(type, init);
    this.pointerId = init.pointerId ?? 1;
    this.isPrimary = init.isPrimary ?? true;
  }
}
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let handle: HTMLButtonElement;
let target: HTMLElement;
let rail: HTMLElement;
let hit: Element | null;
let frame: FrameRequestCallback;
const onStart = vi.fn(), onTarget = vi.fn(), onFinish = vi.fn(), selectSlide = vi.fn();
let valid = true;
function Harness({ enabled = true }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const props = useRailPointerDrag({ enabled, scrollRef, canDrop: () => valid, onStart, onTarget, onFinish });
  return <div ref={scrollRef} data-testid="rail" onClick={selectSlide}>
    <button {...props('source')} className="handle" type="button">Grip</button>
    <div data-rail-drop-id="section" data-rail-section="true"><button className="section-rail-jump">Section</button></div>
  </div>;
}
function pointer(type: string, x = 50, y = 50, pointerId = 1) {
  act(() => handle.dispatchEvent(new TestPointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId })));
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('PointerEvent', TestPointerEvent);
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => { frame = callback; return 1; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host);
  valid = true;
  act(() => root.render(<Harness />));
  handle = host.querySelector('.handle')!;
  handle.setPointerCapture = vi.fn();
  rail = host.querySelector('[data-testid="rail"]')!;
  target = host.querySelector('[data-rail-drop-id]')!;
  const rect = { top: 0, bottom: 100, left: 0, right: 100, width: 100, height: 100 } as DOMRect;
  rail.getBoundingClientRect = () => rect;
  target.getBoundingClientRect = () => rect;
  target.querySelector('button')!.getBoundingClientRect = () => rect;
  hit = target;
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => hit) });
});
afterEach(() => {
  act(() => root.unmount()); host.remove();
  vi.clearAllMocks(); vi.unstubAllGlobals();
  delete (document as unknown as Record<string, unknown>).elementFromPoint;
});

it('captures a finger drag and drops inside a section without selecting a slide', () => {
  pointer('pointerdown', 50, 10);
  expect(handle.setPointerCapture).toHaveBeenCalledWith(1);
  pointer('pointermove', 50, 50);
  expect(onStart).toHaveBeenCalledWith('source');
  expect(onTarget).toHaveBeenLastCalledWith({ id: 'section', placement: 'inside' });
  pointer('pointerup', 50, 50);
  act(() => handle.click());
  expect(onFinish).toHaveBeenCalledWith('source', { id: 'section', placement: 'inside' });
  expect(selectSlide).not.toHaveBeenCalled();
});

it('supports dropping before/after children and into outside-section gaps', () => {
  target.dataset.railSection = 'false';
  pointer('pointerdown', 50, 50); pointer('pointermove', 50, 10); pointer('pointerup', 50, 10);
  expect(onFinish).toHaveBeenLastCalledWith('source', { id: 'section', placement: 'before' });
  target.dataset.railPlacement = 'after';
  pointer('pointerdown', 50, 50); pointer('pointermove', 50, 80); pointer('pointerup', 50, 80);
  expect(onFinish).toHaveBeenLastCalledWith('source', { id: 'section', placement: 'after' });
});

it.each(['pointercancel', 'lostpointercapture', 'Escape'])('cancels on %s and never saves a move', (event) => {
  pointer('pointerdown', 50, 10); pointer('pointermove', 50, 50);
  if (event === 'Escape') act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })));
  else pointer(event);
  pointer('pointerup');
  expect(onFinish).toHaveBeenCalledTimes(1);
  expect(onFinish).toHaveBeenCalledWith('source', null);
  expect(cancelAnimationFrame).toHaveBeenCalled();
});

it('ignores taps, secondary fingers and disabled handles', () => {
  pointer('pointerdown'); pointer('pointermove', 52, 51); pointer('pointerup', 52, 51);
  expect(onStart).not.toHaveBeenCalled();
  expect(onFinish).not.toHaveBeenCalled();
  pointer('pointerdown'); pointer('pointermove', 50, 90, 2); pointer('pointerup', 50, 90, 2);
  expect(onStart).not.toHaveBeenCalled();
  pointer('pointercancel');
  act(() => root.render(<Harness enabled={false} />));
  pointer('pointerdown'); pointer('pointermove', 50, 90); pointer('pointerup', 50, 90);
  expect(onFinish).not.toHaveBeenCalled();
});

it('does not drop on invalid targets or outside the rail', () => {
  valid = false;
  pointer('pointerdown', 50, 10); pointer('pointermove', 50, 50); pointer('pointerup');
  expect(onFinish).toHaveBeenLastCalledWith('source', null);
  valid = true; hit = document.body;
  pointer('pointerdown', 50, 10); pointer('pointermove', 50, 50); pointer('pointerup');
  expect(onFinish).toHaveBeenLastCalledWith('source', null);
});

it('scrolls near an edge and refreshes the drop target while the finger is stationary', () => {
  pointer('pointerdown', 50, 50); pointer('pointermove', 50, 98);
  const before = onTarget.mock.calls.length;
  act(() => frame(0));
  expect(rail.scrollTop).toBeGreaterThan(0);
  expect(onTarget.mock.calls.length).toBeGreaterThan(before);
  pointer('pointercancel');
});

it('cleans up an in-progress gesture on unmount', () => {
  pointer('pointerdown', 50, 10); pointer('pointermove', 50, 50);
  act(() => root.render(null));
  expect(cancelAnimationFrame).toHaveBeenCalled();
  expect(onFinish).not.toHaveBeenCalled();
});

it('uses the header bounds for placement and clamps edge scrolling', () => {
  expect(railPlacementAt(target, 10)).toBe('before');
  expect(railPlacementAt(target, 50)).toBe('inside');
  expect(railPlacementAt(target, 90)).toBe('after');
  expect(railEdgeScroll(50, 0, 100)).toBe(0);
  expect(railEdgeScroll(-1, 0, 100)).toBe(0);
  expect(railEdgeScroll(1, 0, 100)).toBeLessThan(0);
  expect(railEdgeScroll(99, 0, 100)).toBeGreaterThan(0);
});
