// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mixerRequest } from '../xr18';
import { MixerSceneControls } from './MixerSceneControls';
vi.mock('../xr18', () => ({ mixerRequest: vi.fn() }));
let root: Root, container: HTMLDivElement;
let cfg: { enabled: boolean; follow_service: boolean; manual_scene_id: string | null; scenes: {id:string;label:string}[] };
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  cfg = { enabled:true, follow_service:true, manual_scene_id:null, scenes:[{id:'pastor',label:'Pastor'},{id:'pre_service',label:'Pre-service'}] };
  vi.mocked(mixerRequest).mockImplementation(async (_path, method, patch) => {
    if (method === 'PATCH') {
      const change = patch as { scene_id?: string; follow_service?: boolean };
      if (change.scene_id) cfg.manual_scene_id = change.scene_id;
      if (change.follow_service !== undefined) { cfg.follow_service = change.follow_service; if (change.follow_service) cfg.manual_scene_id = null; }
    }
    return { configuration:{...cfg}, status:{scene_id:'pastor',detail:'Applied'} };
  });
  container=document.createElement('div'); document.body.append(container); root=createRoot(container);
  await act(async () => root.render(<MixerSceneControls connected />));
});
afterEach(() => { act(() => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals(); });
it('selects a scene without changing automatic following', async () => {
  const select=container.querySelector('select')!;
  await act(async () => { select.value='pre_service'; select.dispatchEvent(new Event('change',{bubbles:true})); });
  expect(mixerRequest).toHaveBeenCalledWith('/automation/control','PATCH',{scene_id:'pre_service'});
  expect(container.querySelector<HTMLInputElement>('[role="switch"]')!.checked).toBe(true);
  expect(select.value).toBe('pre_service');
});
it('toggles automatic selection with a narrow patch', async () => {
  const toggle=container.querySelector<HTMLInputElement>('[role="switch"]')!;
  await act(async () => toggle.click());
  expect(mixerRequest).toHaveBeenLastCalledWith('/automation/control','PATCH',{follow_service:false});
  expect(toggle.checked).toBe(false);
  await act(async () => toggle.click());
  expect(mixerRequest).toHaveBeenLastCalledWith('/automation/control','PATCH',{follow_service:true});
});
it('retains the displayed selection when applying fails', async () => {
  vi.mocked(mixerRequest).mockRejectedValueOnce(new Error('Mixer unavailable'));
  const select=container.querySelector('select')!;
  await act(async () => { select.value='pre_service'; select.dispatchEvent(new Event('change',{bubbles:true})); });
  expect(select.value).toBe('pastor');
  expect(container.querySelector('[role="alert"]')?.textContent).toBe('Mixer unavailable');
});
it('prevents scene application while disconnected', async () => {
  await act(async () => root.render(<MixerSceneControls connected={false} />));
  expect(container.querySelector('select')!.disabled).toBe(true);
});
