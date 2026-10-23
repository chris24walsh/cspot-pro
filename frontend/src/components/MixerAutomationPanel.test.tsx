// @vitest-environment jsdom
import React, {act} from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MixerAutomationPanel, type MixerAutomationConfiguration} from './MixerAutomationPanel';
import {emptyMixer,mixerRequest} from '../xr18';

const {confirm}=vi.hoisted(()=>({confirm:vi.fn(async()=>true)}));
vi.mock('../xr18',async()=>({...await vi.importActual('../xr18'),mixerRequest:vi.fn()}));
vi.mock('./ConfirmationDialog',()=>({useConfirmationDialog:()=>({confirm,confirmationDialog:null})}));
let root:Root, container:HTMLDivElement, cfg:MixerAutomationConfiguration;
const state={state:'disabled',scene_id:'pastor',detail:'Hardware automation is off'};
beforeEach(async()=>{
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true);
  cfg={enabled:false,follow_service:true,room_enabled:true,livestream_enabled:true,livestream_bus:5,manual_scene_id:null,manual_revision:0,roles:{},scenes:[{id:'pastor',label:'Pastor',channels:{}}]};
  vi.mocked(mixerRequest).mockImplementation(async(path,method,body)=>{
    if(path==='/automation' && method==='PUT')return {configuration:body,status:state};
    if(path==='/automation/suggestions')return {...cfg,roles:{'/ch/01':'pastor'},scenes:[{id:'pastor',label:'Pastor',channels:{'/ch/01':{room:{enabled:true,level_db:-6},livestream:{enabled:true,level_db:-12}}}}]};
    return {configuration:cfg,status:state,available_scenes:[{id:'pastor',label:'Pastor'},{id:'prayer',label:'Prayer'}]};
  });
  container=document.createElement('div');document.body.append(container);root=createRoot(container);
  await act(async()=>root.render(<MixerAutomationPanel strips={[{id:'/ch/01',kind:'input',name:'Pastor mic',meter:0}]} state={emptyMixer}/>));
});
afterEach(()=>{act(()=>root.unmount());container.remove();vi.clearAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
function button(text:string){return [...container.querySelectorAll<HTMLButtonElement>('button')].find(button=>button.textContent?.includes(text))!;}
async function click(element:HTMLElement){await act(async()=>{element.click();await new Promise(resolve=>setTimeout(resolve,0));});}
function select(label:string,value:string){const element=container.querySelector<HTMLSelectElement>(`[aria-label="${label}"]`)!;act(()=>{element.value=value;element.dispatchEvent(new Event('change',{bubbles:true}));});}

it('prepares role-based drafts and saves with hardware automation disabled',async()=>{
  select('Pastor mic audio role','pastor');
  expect(vi.mocked(mixerRequest).mock.calls.every(([,method])=>method!=='PUT')).toBe(true);
  await click(button('Generate suggested presets'));
  expect(container.querySelector<HTMLInputElement>('[aria-label="Pastor mic room dB"]')?.value).toBe('-6');
  await click(button('Save scenes'));
  const save=vi.mocked(mixerRequest).mock.calls.find(([,method])=>method==='PUT')!;
  expect(save[2]).toMatchObject({enabled:false,roles:{'/ch/01':'pastor'}});
  expect(vi.mocked(mixerRequest).mock.calls.some(([path])=>path==='/commands')).toBe(false);
});

it('requires explicit confirmation before enabling live hardware control',async()=>{
  const enable=[...container.querySelectorAll('label')].find(label=>label.textContent?.includes('Enable hardware control'))!.querySelector<HTMLInputElement>('input')!;
  await click(enable);
  confirm.mockResolvedValueOnce(false);
  await click(button('Save scenes'));
  expect(vi.mocked(mixerRequest).mock.calls.some(([,method])=>method==='PUT')).toBe(false);
  confirm.mockResolvedValueOnce(true);
  await click(button('Save scenes'));
  expect(vi.mocked(mixerRequest).mock.calls.find(([,method])=>method==='PUT')?.[2]).toMatchObject({enabled:true});
});

it('adds matching presets for custom section scene IDs',async()=>{
  select('Add section scene preset','prayer');
  await click(button('Add preset'));
  expect(container.querySelector<HTMLSelectElement>('[aria-label="Hardware scene preset"]')?.value).toBe('prayer');
  await click(button('Save scenes'));
  const save=vi.mocked(mixerRequest).mock.calls.find(([,method])=>method==='PUT')?.[2] as MixerAutomationConfiguration;
  expect(save.scenes.map(scene=>scene.id)).toEqual(['pastor','prayer']);
});

it('recovers an initial configuration request failure without overwriting later edits',async()=>{
  act(()=>root.unmount());
  vi.useFakeTimers();
  vi.mocked(mixerRequest).mockRejectedValueOnce(new Error('Temporary connection failure'));
  root=createRoot(container);
  await act(async()=>root.render(<MixerAutomationPanel strips={[]} state={emptyMixer}/>));
  expect(container.textContent).toContain('Temporary connection failure');
  await act(async()=>vi.advanceTimersByTimeAsync(1500));
  expect(container.textContent).toContain('Service audio scenes');
});

it('removes saved scene control from the draft when an input is left untouched',async()=>{
  select('Pastor mic audio role','pastor');
  await click(button('Generate suggested presets'));
  select('Pastor mic audio role','');
  await click(button('Save scenes'));
  const save=vi.mocked(mixerRequest).mock.calls.find(([,method])=>method==='PUT')?.[2] as MixerAutomationConfiguration;
  expect(save.roles).toEqual({});
  expect(save.scenes[0].channels).toEqual({});
});
