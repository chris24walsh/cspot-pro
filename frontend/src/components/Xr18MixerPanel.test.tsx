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
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('EventSource', FakeStream);
  vi.mocked(mixerRequest).mockImplementation(async path => {
    if (path === '/catalog') return {
      strips: [{
        id: '/ch/01',
        kind: 'input',
        name: 'Ch 1',
        meter: 0
      }],
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
  expect(container.querySelector<HTMLInputElement>('input[aria-label="Vocal fader"]')?.value).toBe('0.7');
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
  const fader = container.querySelector<HTMLInputElement>('input[aria-label="Vocal fader"]')!;
  expect(fader.disabled).toBe(false);
  act(() => stream.onerror?.());
  expect(fader.disabled).toBe(true);
  emit({
    ...emptyMixer,
    reset: false,
    connected: false,
    values: {}
  });
  expect(fader.disabled).toBe(true);
  expect(vi.mocked(mixerRequest).mock.calls.every(([, method]) => method !== 'POST')).toBe(true);
});
it('closes the hardware event stream on leaving the mixer', async () => {
  const close = stream.close;
  await act(async () => root.unmount());
  expect(close).toHaveBeenCalledOnce();
  root = createRoot(container);
});
