// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MixerFader } from './MixerFader';
let container: HTMLDivElement;
let root: Root;
const change = vi.fn();
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  container = document.createElement('div'); document.body.append(container);
  root = createRoot(container);
  act(() => root.render(<MixerFader label="Vocal fader" value={.4} valueText="−18 dB" disabled={false} onChange={change}/>));
});
afterEach(() => { act(() => root.unmount()); container.remove(); change.mockReset(); vi.unstubAllGlobals(); });
function fader() {
  const element = container.querySelector<HTMLElement>('[role=slider]')!;
  element.setPointerCapture = vi.fn(); element.releasePointerCapture = vi.fn(); element.hasPointerCapture = () => true;
  element.getBoundingClientRect = () => ({height:224}) as DOMRect;
  return element;
}
function pointer(element: HTMLElement, type: string, y: number, id=1) {
  const event = new MouseEvent(type, {bubbles:true,cancelable:true,clientY:y});
  Object.defineProperties(event, {pointerId:{value:id},pointerType:{value:'touch'}});
  act(() => element.dispatchEvent(event));
}
it('does not jump when the rail is touched and moves relative to the drag', () => {
  const slider = fader();
  pointer(slider,'pointerdown',50);
  pointer(slider,'pointerup',50);
  expect(change).not.toHaveBeenCalled();
  pointer(slider,'pointerdown',100);
  pointer(slider,'pointermove',80);
  expect(change).toHaveBeenLastCalledWith(.5);
  pointer(slider,'pointermove',100);
  expect(change).toHaveBeenLastCalledWith(.4);
  pointer(slider,'pointerup',100);
  pointer(slider,'pointermove',0);
  expect(change).toHaveBeenCalledTimes(2);
});
it('ignores other fingers, clamps the level and stops on pointer cancellation', () => {
  const slider = fader();
  pointer(slider,'pointerdown',100,1);
  pointer(slider,'pointermove',10,2);
  expect(change).not.toHaveBeenCalled();
  pointer(slider,'pointermove',-1000,1);
  expect(change).toHaveBeenLastCalledWith(1);
  pointer(slider,'pointercancel',-1000,1);
  pointer(slider,'pointermove',500,1);
  expect(change).toHaveBeenCalledTimes(1);
});
it('provides keyboard fine adjustment and disables both keyboard and touch offline', () => {
  const slider = fader();
  act(() => slider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',shiftKey:true,bubbles:true})));
  expect(change).toHaveBeenLastCalledWith(.401);
  act(() => root.render(<MixerFader label="Vocal fader" value={.4} valueText="−18 dB" disabled onChange={change}/>));
  change.mockClear();
  pointer(slider,'pointerdown',100);pointer(slider,'pointermove',80);
  act(() => slider.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true})));
  expect(change).not.toHaveBeenCalled();
  expect(slider.tabIndex).toBe(-1);
});

it('keeps simultaneous drags on separate channel faders independent', () => {
  const secondChange=vi.fn();
  act(()=>root.render(<><MixerFader label="One" value={.4} valueText="One" disabled={false} onChange={change}/><MixerFader label="Two" value={.7} valueText="Two" disabled={false} onChange={secondChange}/></>));
  const sliders=Array.from(container.querySelectorAll<HTMLElement>('[role=slider]'));
  for(const slider of sliders){
    slider.setPointerCapture=vi.fn();slider.hasPointerCapture=()=>true;slider.releasePointerCapture=vi.fn();
    slider.getBoundingClientRect=()=>({height:224}) as DOMRect;
  }
  pointer(sliders[0],'pointerdown',100,1);pointer(sliders[1],'pointerdown',100,2);
  pointer(sliders[0],'pointermove',80,1);pointer(sliders[1],'pointermove',120,2);
  expect(change).toHaveBeenLastCalledWith(.5);
  expect(secondChange).toHaveBeenLastCalledWith(.6);
});
