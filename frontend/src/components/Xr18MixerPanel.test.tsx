// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { emptyMixer, mixerRequest } from '../xr18';
import { Xr18MixerPanel } from './Xr18MixerPanel';
vi.mock('../xr18', async () => ({
  ...(await vi.importActual('../xr18')),
  mixerRequest: vi.fn()
}));
const parameter = (path: string, label: string, kind = 'float') => ({
  path,
  label,
  group: 'Setup',
  kind,
  min: 0,
  max: 1,
  unit: '',
  scale: 'linear',
  options: null
});
let stream: FakeStream;
class FakeStream {
  onmessage: ((event: {
    data: string;
  }) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor() {
    stream = this;
  }
}
let deskWidth = 1280;
let resized: () => void;
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('EventSource', FakeStream);
  deskWidth = 1280;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({width:deskWidth,height:224}) as DOMRect);
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(element: HTMLElement) { if (element.classList.contains('xr-dashboard')) resized = this.callback; }
    disconnect() {}
  });
  vi.mocked(mixerRequest).mockImplementation(async path => {
    if (path === '/catalog') return {
      strips: [...Array.from({length:16},(_,i)=>({id:`/ch/${String(i+1).padStart(2,'0')}`,kind:'input',name:`Ch ${i+1}`,meter:i})),{id:'/lr',kind:'main',name:'Main LR',meter:36}],
      parameters: {
        '/ch/01/config/name': parameter('/ch/01/config/name', 'Name', 'string'),
        '/ch/01/mix/fader': parameter('/ch/01/mix/fader', 'Level'),
        '/ch/01/mix/on': parameter('/ch/01/mix/on', 'On', 'int')
      }
    };
    if (path === '/snapshots') return [];
    return {
      ...emptyMixer,
      host: '192.168.2.141'
    };
  });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Xr18MixerPanel />);
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function emit(data: object) {
  act(() => stream.onmessage?.({
    data: JSON.stringify(data)
  }));
}
it('merges incremental readbacks and preserves focused controls during meter updates', () => {
  emit({
    ...emptyMixer,
    reset: true,
    connected: true,
    values: {
      '/ch/01/config/name': 'Vocal',
      '/ch/01/mix/fader': .5,
      '/ch/01/mix/on': 1
    }
  });
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  input.focus();
  emit({
    ...emptyMixer,
    connected: true,
    reset: false,
    values: {
      '/ch/01/mix/fader': .7
    },
    meters: [-20]
  });
  expect(container.querySelector('input[aria-label="Name"]')).toBe(input);
  expect(document.activeElement).toBe(input);
  expect(input.value).toBe('Vocal');
  expect(container.querySelector('[role=slider][aria-label="Vocal fader"]')?.getAttribute('aria-valuenow')).toBe('70');
});
it('disables hardware writes when either the desk or dashboard stream goes offline', () => {
  emit({
    ...emptyMixer,
    reset: true,
    connected: true,
    values: {
      '/ch/01/config/name': 'Vocal',
      '/ch/01/mix/fader': .5,
      '/ch/01/mix/on': 1
    }
  });
  const fader = container.querySelector('[role=slider][aria-label="Vocal fader"]')!;
  expect(fader.getAttribute('aria-disabled')).toBe('false');
  act(() => stream.onerror?.());
  expect(fader.getAttribute('aria-disabled')).toBe('true');
  emit({
    ...emptyMixer,
    reset: false,
    connected: false,
    values: {}
  });
  expect(fader.getAttribute('aria-disabled')).toBe('true');
  expect(vi.mocked(mixerRequest).mock.calls.every(([, method]) => method !== 'POST')).toBe(true);
});
it('closes the hardware event stream on leaving the mixer', async () => {
  const close = stream.close;
  await act(async () => root.unmount());
  expect(close).toHaveBeenCalledOnce();
  root = createRoot(container);
});

function resizeDesk(width: number) { deskWidth=width;act(()=>resized()); }
it('keeps every channel scrollable through rotation with the main fader pinned', () => {
  resizeDesk(900);
  expect(container.querySelectorAll('[role=slider]')).toHaveLength(17);
  expect(container.querySelector<HTMLElement>('.xr-strip-scroll')?.style.getPropertyValue('--xr-visible-strips')).toBe('8');
  resizeDesk(700);
  expect(container.querySelectorAll('[role=slider]')).toHaveLength(17);
  expect(container.querySelector<HTMLElement>('.xr-strip-scroll')?.style.getPropertyValue('--xr-visible-strips')).toBe('4');
  expect(container.querySelector('#xr-channel-editor')?.hasAttribute('hidden')).toBe(true);
  resizeDesk(390);
  expect(container.querySelectorAll('[role=slider]')).toHaveLength(17);
  expect(container.querySelector<HTMLElement>('.xr-strip-scroll')?.style.getPropertyValue('--xr-visible-strips')).toBe('2');
  expect(container.querySelector('[aria-label="Main LR fader"]')).not.toBeNull();
  expect(container.querySelector('.xr-strip-scroll [aria-label="Ch 16 fader"]')).not.toBeNull();
  expect(container.querySelector('.xr-strip-scroll .xr-master')).toBeNull();
  expect(vi.mocked(mixerRequest).mock.calls.every(([,method])=>method!=='POST')).toBe(true);
});
it.each([768, 1366])('keeps channel selection separate from explicitly opening the editor at %i px', width => {
  resizeDesk(width);
  expect(container.querySelector('#xr-connection-settings')?.hasAttribute('hidden')).toBe(true);
  act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Connection settings"]')!.click());
  expect(container.querySelector('#xr-connection-settings')?.hasAttribute('hidden')).toBe(false);
  act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Select Ch 1"]')!.click());
  expect(container.querySelector('#xr-channel-editor')?.hasAttribute('hidden')).toBe(true);
  act(()=>Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='Edit channel')!.click());
  expect(container.querySelector('#xr-channel-editor')?.hasAttribute('hidden')).toBe(false);
  act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Collapse channel editor"]')!.click());
  expect(container.querySelector('#xr-channel-editor')?.hasAttribute('hidden')).toBe(true);
});
it('expands the desk without changing the mixer and restores scrolling with Escape', () => {
  act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Expand desk"]')!.click());
  expect(container.querySelector('.xr-dashboard')?.classList.contains('is-focused')).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  expect(container.querySelector('.xr-dashboard')?.getAttribute('data-fit')).toBe('desk');
  act(()=>window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'})));
  expect(container.querySelector('.xr-dashboard')?.classList.contains('is-focused')).toBe(false);
  expect(document.body.style.overflow).toBe('');
});
it('keeps desk gestures and snapshot controls out of the surrounding Broadcast save form', () => {
  const parent=document.createElement('form');
  const submit=vi.fn((event: Event)=>event.preventDefault());
  parent.addEventListener('submit',submit);
  container.before(parent);parent.append(container);
  act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Expand desk"]')!.click());
  act(()=>container.querySelector<HTMLButtonElement>('[aria-label="Connection settings"]')!.click());
  expect(submit).not.toHaveBeenCalled();
  expect(container.querySelectorAll('button:not([type="button"])')).toHaveLength(0);
  const name=container.querySelector<HTMLInputElement>('input[aria-label="Name"]')!;
  const enter=new KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true});
  act(()=>name.dispatchEvent(enter));
  expect(enter.defaultPrevented).toBe(true);
  act(()=>Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find(b=>b.textContent==='Snapshots')!.click());
  expect(container.querySelector('form')).toBeNull();
  parent.before(container);parent.remove();
});

it('shows mute changes immediately and keeps the newest intent until hardware readback', async()=>{
  emit({...emptyMixer,reset:true,connected:true,values:{'/ch/01/mix/on':1,'/ch/01/mix/fader':.5}});
  const releases:Array<()=>void>=[];
  const original=vi.mocked(mixerRequest).getMockImplementation()!;
  vi.mocked(mixerRequest).mockImplementation(async(path,...args)=>{
    if(path==='/commands')return new Promise<void>(resolve=>releases.push(resolve));
    return original(path,...args);
  });
  const mute=container.querySelector<HTMLButtonElement>('.xr-mute')!;
  await act(async()=>mute.click());
  expect(mute.textContent).toBe('MUTED');
  await act(async()=>mute.click());
  expect(mute.textContent).toBe('Mute');
  expect(vi.mocked(mixerRequest).mock.calls.filter(([path])=>path==='/commands')).toHaveLength(1);
  emit({...emptyMixer,connected:true,reset:false,values:{'/ch/01/mix/on':0}});
  expect(mute.textContent).toBe('Mute');
  await act(async()=>releases.shift()!());
  expect(vi.mocked(mixerRequest).mock.calls.filter(([path])=>path==='/commands')).toHaveLength(2);
  await act(async()=>releases.shift()!());
  emit({...emptyMixer,connected:true,reset:false,values:{'/ch/01/mix/on':1}});
  expect(container.textContent).toContain('No pending changes');
});
it('reconnects with a new full snapshot when returning from a background tab',()=>{
  emit({...emptyMixer,reset:true,connected:true,values:{'/ch/01/mix/fader':.5}});
  const previous=stream;
  const visibility=vi.spyOn(document,'visibilityState','get');
  visibility.mockReturnValue('hidden');
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(previous.close).toHaveBeenCalled();
  visibility.mockReturnValue('visible');
  act(()=>document.dispatchEvent(new Event('visibilitychange')));
  expect(stream).not.toBe(previous);
  emit({...emptyMixer,reset:true,connected:true,values:{'/ch/01/mix/fader':.8}});
  expect(container.querySelector('[aria-label="Ch 1 fader"]')?.getAttribute('aria-valuenow')).toBe('80');
});
it('reopens silently stalled streams without waiting for a page refresh',async()=>{
  await act(async()=>root.unmount());
  vi.useFakeTimers();
  root=createRoot(container);
  await act(async()=>root.render(<Xr18MixerPanel/>));
  emit({...emptyMixer,reset:true,connected:true,values:{'/ch/01/mix/fader':.5}});
  const previous=stream;
  await act(async()=>vi.advanceTimersByTimeAsync(4000));
  expect(previous.close).toHaveBeenCalled();
  expect(stream).not.toBe(previous);
  expect(container.querySelector('[aria-label="Ch 1 fader"]')?.getAttribute('aria-disabled')).toBe('true');
  emit({...emptyMixer,reset:true,connected:true,values:{'/ch/01/mix/fader':.9}});
  expect(container.querySelector('[aria-label="Ch 1 fader"]')?.getAttribute('aria-valuenow')).toBe('90');
});
it('does not overwrite live updates with a slower initial state request',async()=>{
  await act(async()=>root.unmount());
  let finish!: (state: typeof emptyMixer)=>void;
  const delayed=new Promise<typeof emptyMixer>(resolve=>{finish=resolve;});
  const original=vi.mocked(mixerRequest).getMockImplementation()!;
  vi.mocked(mixerRequest).mockImplementation(async(path,...args)=>path==='/state'?delayed:original(path,...args));
  root=createRoot(container);
  await act(async()=>root.render(<Xr18MixerPanel/>));
  emit({...emptyMixer,reset:true,connected:true,values:{'/ch/01/mix/fader':.8}});
  await act(async()=>finish({...emptyMixer,values:{'/ch/01/mix/fader':.1}}));
  expect(container.querySelector('[aria-label="Ch 1 fader"]')?.getAttribute('aria-valuenow')).toBe('80');
});
it('recovers controls through state requests when EventSource never delivers', async () => {
  await act(async () => root.unmount());
  vi.useFakeTimers();
  const original = vi.mocked(mixerRequest).getMockImplementation()!;
  vi.mocked(mixerRequest).mockImplementation(async (path, ...args) => path === '/state'
    ? {...emptyMixer, connected: true, values: {'/ch/01/mix/on': 1, '/ch/01/mix/fader': .6}}
    : original(path, ...args));
  root = createRoot(container);
  await act(async () => root.render(<Xr18MixerPanel/>));
  await act(async () => vi.advanceTimersByTimeAsync(250));
  const mute = container.querySelector<HTMLButtonElement>('.xr-mute')!;
  expect(mute.disabled).toBe(false);
  await act(async () => mute.click());
  expect(mute.textContent).toBe('MUTED');
  expect(vi.mocked(mixerRequest).mock.calls.some(([path]) => path === '/commands')).toBe(true);
  emit({...emptyMixer, reset: true, connected: true, values: {'/ch/01/mix/fader': .8}});
  const count = vi.mocked(mixerRequest).mock.calls.filter(([path]) => path === '/state').length;
  await act(async () => vi.advanceTimersByTimeAsync(500));
  expect(vi.mocked(mixerRequest).mock.calls.filter(([path]) => path === '/state')).toHaveLength(count);
});
