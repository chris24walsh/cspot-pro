import { useEffect, useRef, useState } from 'react';
import { Activity, RefreshCw, Search, SlidersHorizontal, Save, Unplug, Radio } from 'lucide-react';
import { buildAbsoluteApiUrl } from '../api';
import { displayValue, emptyMixer, fromWire, mixerRequest, toWire, type MixerParameter, type MixerState, type MixerStrip } from '../xr18';
import './Xr18MixerPanel.css';
type Catalog = {
  strips: MixerStrip[];
  parameters: Record<string, MixerParameter>;
};
type Snapshot = {
  id: string;
  name: string;
  created_at: string;
  values: Record<string, number | string>;
};
const colors = ['#64748b', '#ef4444', '#22c55e', '#eab308', '#3b82f6', '#d946ef', '#06b6d4', '#e2e8f0'];
export function Xr18MixerPanel() {
  const [catalog, setCatalog] = useState<Catalog>({
    strips: [],
    parameters: {}
  });
  const [state, setState] = useState<MixerState>(emptyMixer);
  const [host, setHost] = useState('');
  const [subnet, setSubnet] = useState('192.168.2.0/24');
  const [found, setFound] = useState<Array<{
    host: string;
    name: string;
    model: string;
    firmware: string;
  }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [streamOnline, setStreamOnline] = useState(false);
  const [bank, setBank] = useState('inputs');
  const [selected, setSelected] = useState('/ch/01');
  const [sendBus, setSendBus] = useState('');
  const [page, setPage] = useState('desk');
  const [group, setGroup] = useState('Input');
  const [search, setSearch] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotName, setSnapshotName] = useState('');
  const [dialog, setDialog] = useState<{
    title: string;
    body: string;
    action: () => Promise<void>;
  } | null>(null);
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const queued = useRef<Record<string, number>>({});
  const current = useRef(state);
  current.current = state;
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const alive = useRef(true);
  async function run(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    alive.current = true;
    void Promise.all([mixerRequest<Catalog>('/catalog'), mixerRequest<MixerState>('/state'), mixerRequest<Snapshot[]>('/snapshots')]).then(([c, s, n]) => {
      if (alive.current) {
        setCatalog(c);
        setState(s);
        setHost(s.host || '');
        setSnapshots(n);
      }
    }).catch(e => setError(e.message));
    const events = new EventSource(buildAbsoluteApiUrl('/api/v1/mixer/events'), {
      withCredentials: true
    });
    events.onmessage = event => {
      const incoming = JSON.parse(event.data);
      setState(previous => {
        const values = incoming.reset ? incoming.values : {
          ...previous.values,
          ...incoming.values
        };
        const fx_specs = incoming.reset ? incoming.fx_specs : {
          ...previous.fx_specs,
          ...incoming.fx_specs
        };
        for (const path of incoming.removed || []) delete values[path];
        for (const path of incoming.removed_fx || []) delete fx_specs[path];
        return {
          ...incoming,
          values,
          fx_specs
        };
      });
      setStreamOnline(true);
    };
    events.onerror = () => {
      setStreamOnline(false);
      Object.values(timers.current).forEach(clearTimeout);
      timers.current = {};
      setDrafts({});
    };
    return () => {
      alive.current = false;
      events.close();
      Object.values(timers.current).forEach(clearTimeout);
    };
  }, []);
  const enabled = state.connected && streamOnline && !state.recalling;
  async function write(path: string, value: number | string, confirmed = false) {
    try {
      await mixerRequest('/command', 'POST', {
        path,
        value,
        confirm_phantom: confirmed
      });
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setDrafts(d => {
        if (d[path] !== value || timers.current[path]) return d;
        const n = {
          ...d
        };
        delete n[path];
        return n;
      });
    }
  }
  function change(path: string, value: number | string) {
    if (path.endsWith('/phantom') && value === 1) {
      setDialog({
        title: 'Enable 48V phantom power?',
        body: `Apply phantom power to ${path.split('/')[2]} on the physical mixer. Check the connected equipment before enabling.`,
        action: () => write(path, value, true)
      });
      return;
    }
    if (typeof value === 'number' && (state.fx_specs[path] || catalog.parameters[path])?.kind === 'float') {
      setDrafts(d => ({
        ...d,
        [path]: value
      }));
      queued.current[path] = value;
      if (!timers.current[path]) timers.current[path] = setTimeout(() => {
        delete timers.current[path];
        if (current.current.connected) void write(path, queued.current[path]);
      }, 35);
    } else void write(path, value);
  }
  function renderControl(spec: MixerParameter) {
    const value = state.values[spec.path];
    const disabled = !enabled || value === undefined;
    return <label className={`xr-control ${state.pending.includes(spec.path) ? 'is-pending' : ''}`} title={spec.path}>
      <span>{spec.label}</span>
      {spec.path.endsWith('/grp/dca') || spec.path.endsWith('/grp/mute') ? <div className="xr-memberships">{Array.from({
          length: 4
        }, (_, i) => <button type="button" key={i} aria-pressed={!!(Number(value) & 1 << i)} disabled={disabled} className={Number(value) & 1 << i ? 'is-active' : ''} onClick={() => change(spec.path, Number(value) ^ 1 << i)}>{spec.path.endsWith('/dca') ? 'DCA' : 'Mute'} {i + 1}</button>)}</div> : spec.kind === 'string' ? <input key={String(value)} aria-label={spec.label} defaultValue={value ?? ''} disabled={disabled} maxLength={12} onBlur={e => {
        if (e.target.value !== value) change(spec.path, e.target.value);
      }} onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }} /> : spec.options ? <select aria-label={spec.label} disabled={disabled} value={value ?? ''} onChange={e => change(spec.path, Number(e.target.value))}><option value="" disabled>Waiting for mixer</option>{spec.options.map((name, i) => <option key={i} value={i}>{name}</option>)}</select> : spec.kind === 'int' ? <input aria-label={spec.label} type="number" key={String(value)} defaultValue={value ?? ''} min={spec.min} max={spec.max} disabled={disabled} onBlur={e => {
        if (e.target.value !== '') change(spec.path, Number(e.target.value));
      }} /> : <><input aria-label={spec.label} type="range" min="0" max="1" step="0.001" disabled={disabled} value={drafts[spec.path] ?? value ?? 0} onChange={e => change(spec.path, Number(e.target.value))} /><output>{displayValue(spec, drafts[spec.path] ?? value)}</output><input aria-label={`${spec.label} exact value`} className="xr-exact" type="number" key={String(value)} disabled={disabled} defaultValue={typeof value === 'number' ? Number(fromWire(spec, value).toFixed(2)) : ''} min={spec.min} max={spec.max} step="any" onBlur={e => {
          const v = Number(e.target.value);
          if (e.target.value && v >= spec.min && v <= spec.max) change(spec.path, toWire(spec, v));
        }} /></>}
      {value === undefined ? <small>Awaiting readback</small> : null}
      {state.failed[spec.path] ? <small className="xr-error">{state.failed[spec.path]}</small> : null}
    </label>;
  }
  function renderStrip(strip: MixerStrip, master = false) {
    const mix = strip.kind === 'dca' ? strip.id : strip.id + '/mix';
    const sends = !!sendBus && ['input', 'aux', 'return'].includes(strip.kind);
    const path = sends ? `${strip.id}/mix/${sendBus}/level` : `${mix}/fader`;
    const spec = catalog.parameters[path];
    const on = state.values[mix + '/on'];
    const level = state.meters[strip.meter];
    const fader = state.values[path];
    const name = String(state.values[strip.id + '/config/name'] || strip.name);
    const color = Number(state.values[strip.id + '/config/color'] || 0) % 8;
    const pan = state.values[strip.id + '/mix/pan'];
    return <article key={strip.id} className={`xr-strip ${selected === strip.id ? 'is-selected' : ''} ${master ? 'xr-master' : ''}`} style={{
      borderTopColor: colors[color]
    }}>
      <button className="xr-strip-name" title={`Select ${name}`} onClick={() => {
        setSelected(strip.id);
        setPage('desk');
      }}><small>{strip.name}</small><strong>{name}</strong></button>
      <div className="xr-strip-status">{state.pending.includes(path) ? 'Sending…' : sends ? `→ ${Number(sendBus) <= 6 ? 'Bus ' + Number(sendBus) : 'FX ' + (Number(sendBus) - 6)}` : 'MAIN MIX'}</div>
      <div className="xr-fader-area"><div className="xr-meter" role="meter" aria-label={`${name} level`} aria-valuemin={-90} aria-valuemax={0} aria-valuenow={level ?? -90}><div style={{
            height: `${level === undefined ? 0 : Math.max(0, Math.min(100, (level + 90) / 90 * 100))}%`
          }} /></div><input className="xr-fader" aria-label={`${name} ${sends ? 'send' : 'fader'}`} type="range" min="0" max="1" step="0.001" disabled={!enabled || fader === undefined} value={drafts[path] ?? fader ?? 0} onChange={e => change(path, Number(e.target.value))} /><div className="xr-scale"><span>+10</span><span>0</span><span>−10</span><span>−30</span><span>−∞</span></div></div>
      <output className="xr-db">{spec ? displayValue(spec, drafts[path] ?? fader) : '—'}</output>
      {strip.kind === 'input' && <button className={state.values[`/-stat/solosw/${strip.id.split('/')[2]}`] === 1 ? 'xr-solo is-active' : 'xr-solo'} disabled={!enabled || state.values[`/-stat/solosw/${strip.id.split('/')[2]}`] === undefined} onClick={() => {
        const p = `/-stat/solosw/${strip.id.split('/')[2]}`;
        change(p, state.values[p] === 1 ? 0 : 1);
      }}>Solo</button>}
      <button className={`xr-mute ${on === 0 ? 'is-muted' : ''}`} disabled={!enabled || on === undefined} onClick={() => change(mix + '/on', on === 1 ? 0 : 1)}>{on === 0 ? 'MUTED' : 'Mute'}</button>
      {pan !== undefined ? <input className="xr-pan" title={`${name} pan`} aria-label={`${name} pan`} type="range" min="0" max="1" step="0.01" value={drafts[strip.id + '/mix/pan'] ?? pan} disabled={!enabled} onChange={e => change(strip.id + '/mix/pan', Number(e.target.value))} /> : <span className="xr-pan-spacer" />}
    </article>;
  }
  const strip = catalog.strips.find(s => s.id === selected);
  const parameters = Object.values(catalog.parameters).map(p => state.fx_specs[p.path] || p);
  const selectedParameters = parameters.filter(p => p.path.startsWith(selected + '/') || selected.startsWith('/ch/') && p.path.startsWith('/headamp/' + selected.split('/')[2] + '/'));
  const groups = Array.from(new Set(selectedParameters.map(p => p.group)));
  const visible = catalog.strips.filter(s => bank === 'all' || bank === 'inputs' && s.kind === 'input' || bank === 'returns' && ['return', 'aux'].includes(s.kind) || bank === 'outputs' && ['bus', 'fxsend', 'dca'].includes(s.kind));
  const inspectorGroup = groups.includes(group) ? group : groups[0];
  const main = catalog.strips.find(s => s.kind === 'main');
  const shown = page === 'routing' ? parameters.filter(p => p.group === 'Routing') : page === 'effects' ? parameters.filter(p => p.path.startsWith('/fx/') && (!p.path.includes('/par/') || state.values[p.path] !== undefined)) : page === 'system' ? parameters.filter(p => ['Links', 'Mute groups', 'Monitor'].includes(p.group)) : selectedParameters.filter(p => p.group === inspectorGroup);
  return <section className="xr-dashboard" aria-label="XR18 mixer dashboard">
    <header className="xr-header"><div><div className="xr-title"><SlidersHorizontal size={21} /><h2>XR18 <span>Live desk</span></h2></div><small>{state.identity.length ? `${state.identity[1]} · ${state.identity[2]} · Firmware ${state.identity[3]}` : 'Local Ethernet control · OSC / UDP'}</small></div><div className="xr-connection"><span className={`xr-led ${state.connected && streamOnline ? 'is-live' : ''}`} /><strong>{!streamOnline ? 'Dashboard reconnecting' : state.connected ? 'Connected' : state.host ? 'Mixer offline' : 'Not connected'}</strong>{state.connected && <small>{state.recalling ? 'Recalling snapshot…' : state.syncing ? 'Reading desk…' : `${Object.keys(state.values).length} parameters · ${state.age_ms ?? '—'} ms since reply`}</small>}</div></header>
    <div className="xr-connect-bar"><label>Mixer IP<input aria-label="Mixer IP address" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.2.141" /></label><button disabled={busy || !host} onClick={() => void run(async () => {
        const s = await mixerRequest<MixerState>('/connection', 'PUT', {
          host
        });
        setState(s);
      })}><Radio size={15} />Connect</button><button disabled={busy || !state.host} onClick={() => void run(async () => {
        setState(await mixerRequest('/connection', 'PUT', {
          host: null
        }));
      })}><Unplug size={15} />Disconnect</button><button disabled={!enabled || state.syncing} onClick={() => void run(() => mixerRequest('/sync', 'POST'))}><RefreshCw size={15} />Sync</button><details><summary><Search size={14} />Find mixer</summary><div className="xr-discovery"><label>LAN subnet<input aria-label="Discovery subnet" value={subnet} onChange={e => setSubnet(e.target.value)} /></label><button disabled={busy} onClick={() => void run(async () => setFound(await mixerRequest('/discover', 'POST', {
            subnet
          })))}>Scan LAN</button>{found.map(f => <button key={f.host} onClick={() => setHost(f.host)}>{f.name} · {f.host} · {f.firmware}</button>)}<small>Discovery runs on the cspot server's LAN. Select an address, then Connect.</small></div></details></div>
    {(error || state.error) && <div className="xr-error" role="alert">{error || state.error}<button onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {Object.keys(state.failed).length > 0 && <p className="xr-error" role="alert">{Object.keys(state.failed).length} changes have no matching mixer readback. Sync to verify the desk.</p>}
    {!state.connected && <p className="xr-notice">{state.host ? `Waiting for ${state.host}:10024. Check power, Ethernet mode and LAN routing.` : 'Connect your XR18 to read the desk. Controls become available as the mixer replies.'} {Object.keys(state.values).length > 0 ? 'Displayed values are cached; controls are disabled.' : ''}</p>}
    <nav className="xr-tabs" aria-label="Mixer views">{[['desk', 'Faders & processing'], ['routing', 'Routing'], ['effects', 'Effects rack'], ['system', 'Links & monitor'], ['snapshots', 'Snapshots']].map(([id, label]) => <button key={id} className={page === id ? 'is-active' : ''} onClick={() => setPage(id)}>{label}</button>)}</nav>
    {page === 'desk' ? <><div className={`xr-bank-bar ${sendBus ? 'xr-sends-active' : ''}`}><div className="xr-tabs">{[['inputs', 'Inputs 1–16'], ['returns', 'Aux & FX returns'], ['outputs', 'Buses & DCAs'], ['all', 'All strips']].map(([id, label]) => <button key={id} className={bank === id ? 'is-active' : ''} onClick={() => setBank(id)}>{label}</button>)}</div><label>Sends on faders<select aria-label="Sends on faders" value={sendBus} onChange={e => setSendBus(e.target.value)}><option value="">Main mix</option>{Array.from({
              length: 10
            }, (_, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{i < 6 ? `Bus ${i + 1}` : `FX ${i - 5}`}</option>)}</select></label></div>{sendBus && <p className="xr-notice">Faders now adjust sends to {Number(sendBus) <= 6 ? `Bus ${Number(sendBus)}` : `FX ${Number(sendBus) - 6}`}. Mute buttons still mute the whole channel.</p>}
    <div className="xr-desk"><div className="xr-strip-scroll">{visible.filter(s => s.kind !== 'main').map(s => renderStrip(s))}</div>{main && renderStrip(main, true)}</div>
    <div className="xr-inspector"><header><h3>{String(state.values[selected + '/config/name'] || strip?.name || 'Channel')} <small>{selected}</small></h3><span><Activity size={14} /> Live readback</span></header><nav className="xr-tabs" aria-label="Channel processing">{groups.map(g => <button key={g} className={inspectorGroup === g ? 'is-active' : ''} onClick={() => setGroup(g)}>{g}</button>)}</nav><div className="xr-control-grid">{shown.map(p => <div key={p.path}>{renderControl(p)}</div>)}</div></div></> : page === 'snapshots' ? <div className="xr-snapshots"><h3>Local desk snapshots</h3><p>Save the parameters read by cspot. Recalls preserve physical preamp gain and phantom power. These snapshots are separate from the mixer's internal scenes.</p><form onSubmit={e => {
        e.preventDefault();
        void run(async () => {
          await mixerRequest('/snapshots', 'POST', {
            name: snapshotName
          });
          setSnapshots(await mixerRequest('/snapshots'));
          setSnapshotName('');
        });
      }}><input aria-label="Snapshot name" placeholder="Snapshot name" maxLength={80} required value={snapshotName} onChange={e => setSnapshotName(e.target.value)} /><button disabled={busy || !enabled || !state.synchronized || state.syncing || !!state.pending.length}><Save size={15} />Save current desk</button></form>{snapshots.map(s => <article key={s.id}><div><strong>{s.name}</strong><small>{new Date(s.created_at).toLocaleString()} · {Object.keys(s.values).length} parameters</small></div><button disabled={!enabled || busy || state.syncing} onClick={() => setDialog({
          title: `Recall ${s.name}?`,
          body: 'This changes live levels, processing, sends, routing and effects. Physical preamps and phantom power are preserved.',
          action: async () => {
            await mixerRequest(`/snapshots/${s.id}/recall`, 'POST');
          }
        })}>Recall</button><button disabled={busy} onClick={() => setDialog({
          title: `Delete ${s.name}?`,
          body: 'Remove this saved snapshot from cspot.',
          action: async () => {
            await mixerRequest(`/snapshots/${s.id}`, 'DELETE');
            setSnapshots(await mixerRequest('/snapshots'));
          }
        })}>Delete</button></article>)}</div> : <div className="xr-inspector"><header><h3>{page === 'routing' ? 'Input & output routing' : page === 'effects' ? 'Effects rack' : 'Desk configuration'}</h3><input aria-label="Filter mixer parameters" placeholder="Filter parameters…" value={search} onChange={e => setSearch(e.target.value)} /></header>{page === 'effects' && <p className="xr-notice">FX parameters follow the selected algorithm. Continuous controls use normalized values (0–1); switches and enums use integer values. Less common algorithms show parameter indices; consult the X AIR effect reference for their order.</p>}<div className="xr-control-grid">{shown.filter(p => (p.label + ' ' + p.path).toLowerCase().includes(search.toLowerCase())).map(p => <div key={p.path}><small className="xr-path">{p.path}</small>{renderControl(p)}</div>)}</div></div>}
    <footer className="xr-footer"><span>LAN UDP :10024 · 20 Hz dashboard stream · Hardware readback</span><span>{state.pending.length ? `${state.pending.length} awaiting confirmation` : 'No pending changes'}</span></footer>
    {dialog && <div className="xr-modal-backdrop" onKeyDown={event => {
      if (event.key === 'Escape') setDialog(null);
      if (event.key === 'Tab') {
        const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
        const first = buttons[0],
          last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    }}><div className="xr-modal" role="dialog" aria-modal="true" aria-label={dialog.title}><h3>{dialog.title}</h3><p>{dialog.body}</p><div><button autoFocus onClick={() => setDialog(null)}>Cancel</button><button disabled={busy} onClick={() => {
            const action = dialog.action;
            setDialog(null);
            void run(action);
          }}>Confirm</button></div></div></div>}
  </section>;
}
