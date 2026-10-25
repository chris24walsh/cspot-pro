import { Fragment as ReactFragment, useEffect, useRef, useState } from 'react';
import { Camera, Download, Pause, Play, Save, WandSparkles, Plus } from 'lucide-react';
import { mixerRequest, type MixerState, type MixerStrip } from '../xr18';
import { useConfirmationDialog } from './ConfirmationDialog';

type Level = {enabled: boolean; level_db: number};
type Channel = {room?: Level | null; livestream?: Level | null};
type Scene = {id: string; label: string; channels: Record<string, Channel>};
export type MixerAutomationConfiguration = {
  enabled: boolean; follow_service: boolean; room_enabled: boolean; livestream_enabled: boolean;
  livestream_bus: number; manual_scene_id: string | null; manual_revision: number;
  roles: Record<string,string>; scenes: Scene[];
};
type Status = {state: string; scene_id: string | null; detail: string};
type Response = {configuration: MixerAutomationConfiguration; status: Status; available_scenes?: {id:string;label:string}[]};
const roles = [['', 'Leave untouched'], ['pastor','Pastor / message mic'], ['leader','Service leader / opening mic'], ['congregation','Congregation mic'], ['worship','Worship voice / instrument'], ['media','PC media / backing tracks'], ['ambience','Room ambience'], ['other','Other · leave untouched']];

export function MixerAutomationPanel({strips, state}: {strips: MixerStrip[]; state: MixerState}) {
  const [form,setForm] = useState<MixerAutomationConfiguration | null>(null);
  const [status,setStatus] = useState<Status | null>(null);
  const [baseline,setBaseline] = useState('');
  const [available,setAvailable]=useState<{id:string;label:string}[]>([]);
  const [newScene,setNewScene]=useState('');
  const [selected,setSelected] = useState('pastor');
  const [busy,setBusy] = useState(false);
  const [message,setMessage] = useState('');
  const alive=useRef(true);
  const loaded=useRef(false);
  const currentForm=useRef(form);
  const currentBaseline=useRef(baseline);
  currentForm.current=form;
  currentBaseline.current=baseline;
  const {confirm,confirmationDialog}=useConfirmationDialog();
  useEffect(()=>{
    alive.current=true;
    loaded.current=false;
    let inFlight=false;
    async function refresh(initial=false){
      if(inFlight)return;inFlight=true;
      try{
        const response=await mixerRequest<Response>('/automation');
        if(!alive.current)return;
        setStatus(response.status);
        setAvailable(response.available_scenes || []);
        if(initial || !loaded.current || JSON.stringify(currentForm.current)===currentBaseline.current){loaded.current=true;setForm(response.configuration);setBaseline(JSON.stringify(response.configuration));setMessage('');}
      }catch(error){if(alive.current)setMessage(error instanceof Error?error.message:'Could not read scene automation');}
      finally{inFlight=false;}
    }
    void refresh(true);const timer=setInterval(()=>void refresh(),1500);
    return()=>{alive.current=false;clearInterval(timer);};
  },[]);
  if(!form)return <p className="xr-notice">{message || 'Loading hardware scenes…'}</p>;
  const dirty=JSON.stringify(form)!==baseline;
  const scene=form.scenes.find(scene=>scene.id===selected);
  const inputs=strips.filter(strip=>['input','aux','return'].includes(strip.kind));
  const mapped=inputs.filter(strip=>(form.roles[strip.id] && form.roles[strip.id]!=='other') || scene?.channels[strip.id]);
  const name=(strip: MixerStrip)=>String(state.values[strip.id+'/config/name'] || strip.name);
  const patch=(changes: Partial<MixerAutomationConfiguration>)=>setForm({...form,...changes});
  async function action(work:()=>Promise<void>){setBusy(true);setMessage('');try{await work();}catch(error){if(alive.current)setMessage(error instanceof Error?error.message:'Scene action failed');}finally{if(alive.current)setBusy(false);}}
  async function save(next=form!){
    if(next.enabled && !(await confirm({title:'Enable hardware scene control?',confirmLabel:'Enable and save',message:'Saved scene presets can change live room levels and livestream sends. Confirm the bus routing and review each preset first. Scenes open channels needed by either mix and mute mapped channels unused by the enabled mixes. Gain and phantom power remain manual.'})))return;
    await action(async()=>{const response=await mixerRequest<Response>('/automation','PUT',next);if(alive.current){setForm(response.configuration);setBaseline(JSON.stringify(response.configuration));setStatus(response.status);setMessage(next.enabled?'Saved. Following the selected scene mode.':'Saved for setup. Hardware automation is off.');}});
  }
  function channelLevel(strip: string, output:'room'|'livestream', update:Partial<Level>){
    if(!scene)return;
    const current=scene.channels[strip] || {};
    const changed={...current,[output]:{enabled:false,level_db:0,...current[output],...update}};
    patch({scenes:form!.scenes.map(candidate=>candidate.id===scene.id?{...candidate,channels:{...candidate.channels,[strip]:changed}}:candidate)});
  }
  return <section className="xr-automation" aria-label="Hardware audio scenes">
    <header><div><h3>Service audio scenes</h3><p>One service cue, separate room and livestream levels. Hardware control stays off until enabled.</p></div>
      <div className="xr-automation-actions">
        <button type="button" disabled={busy} onClick={()=>void save()}><Save size={16}/>Save scenes</button>
        <button type="button" disabled={busy || !form.enabled} onClick={()=>void action(async()=>{
          const response=await mixerRequest<Response>('/automation','PUT',{...form,enabled:false});if(alive.current){setForm(response.configuration);setBaseline(JSON.stringify(response.configuration));setStatus(response.status);}
        })}><Pause size={16}/>Pause changes</button>
      </div>
    </header>
    {message && <p role="status" className="xr-notice">{message}</p>}
    <p role="status" className={`xr-notice ${status?.state==='error'?'xr-error':''}`}><strong>{status?.scene_id ? form.scenes.find(scene=>scene.id===status.scene_id)?.label || status.scene_id : 'No scene'}:</strong> {status?.detail || 'Waiting for scene status'}{dirty?' · Unsaved changes':''}</p>
    <div className="xr-automation-options">
      <label><input type="checkbox" checked={form.enabled} onChange={event=>patch({enabled:event.target.checked})}/>Enable hardware control</label>
      <label><input type="checkbox" checked={form.follow_service} onChange={event=>patch({follow_service:event.target.checked})}/>Follow service sections</label>
      <label><input type="checkbox" checked={form.room_enabled} onChange={event=>patch({room_enabled:event.target.checked})}/>Control room mix</label>
      <label><input type="checkbox" checked={form.livestream_enabled} onChange={event=>patch({livestream_enabled:event.target.checked})}/>Control livestream mix</label>
      <label>Livestream stereo buses<select value={form.livestream_bus} onChange={event=>patch({livestream_bus:Number(event.target.value)})}>{[1,3,5].map(bus=><option key={bus} value={bus}>{bus} / {bus+1}</option>)}</select></label>
    </div>
    <p className="xr-notice">Sunday setup: choose two free buses, link them, and set mapped sends to Pre fader with subgroup off. Route that bus pair to USB capture. The room uses Main L/R assignment and channel levels; livestream sends remain independent. Scenes open mapped channels needed by either mix; mapped channels unused by the enabled mixes are muted, including in room-only mode. Channel mute affects all outputs. Manual mute changes last until the next scene. Solo stays manual. Unmapped channels stay as they are.</p>
    <details><summary>Map service inputs ({Object.values(form.roles).filter(role=>role!=='other').length})</summary>
      <div className="xr-role-grid">{inputs.map(strip=><label key={strip.id}>{name(strip)}<select aria-label={`${name(strip)} audio role`} value={form.roles[strip.id] || ''} onChange={event=>{
        const next={...form.roles};if(event.target.value)next[strip.id]=event.target.value;else delete next[strip.id];patch({roles:next,...(!event.target.value || event.target.value==='other'?{scenes:form.scenes.map(scene=>{const channels={...scene.channels};delete channels[strip.id];return {...scene,channels};})}:{})});
      }}>{roles.map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>)}</div>
      <button type="button" disabled={busy || !Object.keys(form.roles).length} onClick={()=>void action(async()=>{
        if(!(await confirm({title:'Generate suggested presets?',confirmLabel:'Generate draft',message:'Replace standard scene presets using the mapped input roles, including Service leader when mapped. This edits your draft only; review levels and save afterward.'})))return;
        const draft=await mixerRequest<MixerAutomationConfiguration>('/automation/suggestions','POST',form);if(alive.current)setForm(draft);
      })}><WandSparkles size={16}/>Generate suggested presets</button>
    </details>
    <div className="xr-automation-actions">
      <label>Edit preset<select aria-label="Hardware scene preset" value={selected} onChange={event=>setSelected(event.target.value)}>{form.scenes.map(scene=><option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label>
      {available.some(candidate=>!form.scenes.some(scene=>scene.id===candidate.id)) && <>
        <select aria-label="Add section scene preset" value={newScene} onChange={event=>setNewScene(event.target.value)}><option value="">Add section scene…</option>{available.filter(candidate=>!form.scenes.some(scene=>scene.id===candidate.id)).map(candidate=><option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select>
        <button type="button" disabled={!newScene} onClick={()=>{const candidate=available.find(scene=>scene.id===newScene);if(candidate){patch({scenes:[...form.scenes,{...candidate,channels:{}}]});setSelected(candidate.id);setNewScene('');}}}><Plus size={16}/>Add preset</button>
      </>}
      <button type="button" disabled={busy || dirty || !state.connected || state.syncing} onClick={()=>void action(async()=>{
        const response=await mixerRequest<Response>(`/automation/capture/${selected}`,'POST');if(alive.current){setForm(response.configuration);setBaseline(JSON.stringify(response.configuration));setMessage('Current room and bus levels saved to this preset.');}
      })}><Camera size={16}/>Capture current mix</button>
      <button type="button" disabled={busy || dirty || !form.enabled} onClick={()=>void action(async()=>{
        if(!(await confirm({title:'Apply and hold this scene?',confirmLabel:'Apply scene',message:'Apply this preset to the enabled room/livestream outputs and pause following service sections until you resume.'})))return;
        const response=await mixerRequest<Response>(`/automation/apply/${selected}`,'POST');if(alive.current){setForm(response.configuration);setBaseline(JSON.stringify(response.configuration));setStatus(response.status);}
      })}><Play size={16}/>Apply &amp; hold</button>
      <button type="button" disabled={busy || dirty || form.follow_service} onClick={()=>void save({...form,follow_service:true,manual_scene_id:null})}><Play size={16}/>Resume service cues</button>
      <button type="button" onClick={()=>{
        const blob=new Blob([JSON.stringify(form,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='cspot-xr18-scenes.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),0);
      }}><Download size={16}/>Export setup</button>
    </div>
    {scene && <div className="xr-scene-table-wrap"><table className="xr-scene-table"><thead><tr><th>Input</th><th>Room on</th><th>Room dB</th><th>Stream on</th><th>Stream dB</th></tr></thead><tbody>{mapped.map(strip=>{
      const row=scene.channels[strip.id];return <tr key={strip.id}><th>{name(strip)}</th>{(['room','livestream'] as const).map(output=><ReactFragment key={output}>
        <td><input type="checkbox" aria-label={`${name(strip)} ${output} enabled`} checked={row?.[output]?.enabled || false} onChange={event=>channelLevel(strip.id,output,{enabled:event.target.checked})}/></td>
        <td><input aria-label={`${name(strip)} ${output} dB`} type="number" min={-90} max={10} step={.5} value={row?.[output]?.level_db ?? 0} onChange={event=>{const value=event.target.valueAsNumber;if(Number.isFinite(value))channelLevel(strip.id,output,{level_db:Math.max(-90,Math.min(10,value))});}}/></td>
      </ReactFragment>)}</tr>;
    })}</tbody></table>{!mapped.length && <p>Map inputs above, generate draft presets, then review or capture levels before enabling.</p>}</div>}
    <p>Sections already select Pastor, Congregation, Worship, Media, Pre-service and Post-service. A section’s Audio scene override takes priority. Service cues follow the presenter’s selected item, even without a slideshow window, while audio scene automation is enabled. Source scene buttons override until the next selection; Apply & hold pauses following. Changes apply once per scene; operator adjustments are retained until the next scene.</p>
    {confirmationDialog}
  </section>;
}
