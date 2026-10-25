import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { RefreshCw, Search, SlidersHorizontal, Save, Unplug, Radio, Settings2, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Maximize2, Minimize2, VolumeX, Volume2 } from 'lucide-react';
import { buildAbsoluteApiUrl } from '../api';
import { displayValue, emptyMixer, fromWire, mixerCommandValue, mixerRequest, physicalHeadamp, toWire, type MixerParameter, type MixerState, type MixerStrip } from '../xr18';
import { MixerAutomationPanel } from './MixerAutomationPanel';
import { MixerSceneControls } from './MixerSceneControls';
import { MixerFader } from './MixerFader';
import { MixerCommandQueue } from '../mixerCommands';
import { mixerBankSize } from '../mixerLayout';
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
const mixerPages = [['desk', 'Faders'], ['routing', 'Routing'], ['effects', 'Effects'], ['system', 'Monitor'], ['snapshots', 'Snapshots'], ['scenes', 'Audio scenes']];
type StripMode = 'level' | 'gain' | 'balance';
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
  const [page, setPage] = useState('desk');
  const [scrollEdges, setScrollEdges] = useState({ start: true, end: false });
  const stripScrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1200);
  const [setupOpen, setSetupOpen] = useState<boolean | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const dashboardRef = useRef<HTMLElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const compact = width < 1100;
  const showEditor = editorOpen;
  const showSetup = setupOpen ?? !state.host;
  const bankSize = mixerBankSize(width);
  useEffect(() => {
    const panel = dashboardRef.current;
    if (!panel) return;
    const measure = () => setWidth(panel.getBoundingClientRect().width || window.innerWidth);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(measure);
      observer.observe(panel);
      return () => observer.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);
  function measureScroll() {
    const scroller = stripScrollRef.current;
    if (scroller) setScrollEdges({ start: scroller.scrollLeft <= 1, end: scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 1 });
  }
  useEffect(() => {
    const scroller = stripScrollRef.current;
    if (!scroller) return;
    scroller.scrollLeft = 0;
    measureScroll();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measureScroll);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [bank, bankSize, catalog.strips, page]);
  function browseChannels(direction: number) {
    const scroller = stripScrollRef.current;
    scroller?.scrollBy({ left: direction * scroller.clientWidth, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }
  const [selected, setSelected] = useState('/ch/01');
  const [sendBus, setSendBus] = useState('');
  const [stripModes, setStripModes] = useState<Record<string, StripMode>>({});
  const [group, setGroup] = useState('Input');
  const [search, setSearch] = useState('');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotName, setSnapshotName] = useState('');
  const [dialog, setDialog] = useState<{
    title: string;
    body: string;
    action: () => Promise<void>;
  } | null>(null);
  useEffect(() => {
    if (!focused) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !dialog) setFocused(false);
    };
    window.addEventListener('keydown', escape);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', escape);
    };
  }, [focused, dialog]);
  const commandQueue = useRef<MixerCommandQueue | null>(null);
  const sequence = useRef(0);
  const latestSequence = useRef(new Map<string, number>());
  const lastEvent = useRef(0);
  const current = useRef(state);
  current.current = state;
  const [drafts, setDrafts] = useState<Record<string, number | string>>({});
  const alive = useRef(true);
  useEffect(() => {
    const queue = new MixerCommandQueue(async commands => {
      if (!current.current.connected || current.current.recalling || Date.now() - lastEvent.current > 3000) {
        throw new Error('Live connection interrupted; reconnect before changing controls');
      }
      await mixerRequest('/commands', 'POST', {
        commands: commands.map(({
          sequence: _sequence,
          ...command
        }) => command)
      });
    }, (commands, error) => {
      if (!alive.current) return;
      setError(error instanceof Error ? error.message : String(error));
      setDrafts(previous => {
        const next = {
          ...previous
        };
        for (const command of commands) {
          if (latestSequence.current.get(command.path) === command.sequence) delete next[command.path];
        }
        return next;
      });
    });
    commandQueue.current = queue;
    return () => {
      queue.dispose();
      commandQueue.current = null;
    };
  }, []);
  useEffect(() => {
    setDrafts(previous => {
      let next = previous;
      for (const [path, desired] of Object.entries(previous)) {
        const actual = state.values[path];
        const matches = actual === desired || typeof actual === 'number' && typeof desired === 'number' && Math.abs(actual - desired) < .002;
        if (!commandQueue.current?.outstanding(path) && (matches || state.failed[path])) {
          if (next === previous) next = {
            ...previous
          };
          delete next[path];
        }
      }
      return next;
    });
  }, [state]);
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
    let stopped = false;
    let lastStreamFrame = 0;
    let polling = false;
    let lastPoll = 0;
    let receivedStream = false;
    let streamHasFrame = false;
    let source: EventSource | null = null;
    const interrupted = () => {
      if (Date.now() - lastPoll < 3000) return;
      setStreamOnline(false);
      commandQueue.current?.clear();
      latestSequence.current.clear();
      setDrafts({});
    };
    void Promise.all([mixerRequest<Catalog>('/catalog'), mixerRequest<MixerState>('/state'), mixerRequest<Snapshot[]>('/snapshots')]).then(([c, s, n]) => {
      if (!stopped) {
        setCatalog(c);
        // A slow initial HTTP response must never overwrite a newer live snapshot.
        if (!receivedStream) setState(s);
        setHost(s.host || '');
        setSnapshots(n);
      }
    }).catch(e => {
      if (!stopped) setError(e.message);
    });
    function openStream() {
      source?.close();
      interrupted();
      lastStreamFrame = Date.now();
      streamHasFrame = false;
      const events = new EventSource(buildAbsoluteApiUrl('/api/v1/mixer/events'), {
        withCredentials: true
      });
      source = events;
      events.onmessage = event => {
        if (stopped || source !== events) return;
        const incoming = JSON.parse(event.data);
        receivedStream = true;
        streamHasFrame = true;
        lastStreamFrame = lastEvent.current = Date.now();
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
        if (source === events && alive.current) interrupted();
      };
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        source?.close();
        source = null;
        lastPoll = lastEvent.current = 0;
        interrupted();
      } else openStream();
    };
    if (document.visibilityState !== 'hidden') openStream();
    const watchdog = setInterval(() => {
      if (document.visibilityState !== 'hidden' && Date.now() - lastStreamFrame > (streamHasFrame ? 3000 : 10000)) openStream();
    }, 1000);
    // Recover from browser/proxy buffering without overlapping state requests.
    const recovery = setInterval(() => {
      if (!stopped && Date.now() - lastEvent.current >= 3000) interrupted();
      if (stopped || polling || document.visibilityState === 'hidden' ||
          (streamHasFrame && Date.now() - lastStreamFrame < 1000)) return;
      polling = true;
      const streamAtStart = lastStreamFrame;
      void mixerRequest<MixerState>('/state').then(snapshot => {
        if (stopped || document.visibilityState === 'hidden' || lastStreamFrame !== streamAtStart) return;
        receivedStream = true;
        lastPoll = lastEvent.current = Date.now();
        setState(snapshot);
        setStreamOnline(true);
      }).catch(() => {
        if (!stopped) interrupted();
      }).finally(() => { polling = false; });
    }, 250);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      stopped = true;
      alive.current = false;
      source?.close();
      clearInterval(watchdog);
      clearInterval(recovery);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);
  const enabled = state.connected && streamOnline && !state.recalling && !state.startup_muting;
  const controlValue = (path: string) => drafts[path] ?? state.values[path];
  async function write(path: string, value: number | string, confirmed = false, immediate?: boolean) {
    value = mixerCommandValue(path, value);
    const next = ++sequence.current;
    latestSequence.current.set(path, next);
    setDrafts(previous => ({
      ...previous,
      [path]: value
    }));
    commandQueue.current?.enqueue({
      path,
      value,
      confirm_phantom: confirmed,
      sequence: next
    }, immediate ?? (state.fx_specs[path] || catalog.parameters[path])?.kind !== 'float');
  }
  const mutePaths = catalog.strips.filter(strip => ['input', 'aux', 'return'].includes(strip.kind)).map(strip => strip.id + '/mix/on');
  const bulkMuteReady = enabled && !state.syncing && !busy && mutePaths.length > 0 && mutePaths.every(path => state.values[path] === 0 || state.values[path] === 1);
  async function muteAll(value: number) {
    if (!bulkMuteReady) return;
    for (const path of mutePaths) void write(path, value, false, false);
  }
  function change(path: string, value: number | string) {
    if (path.endsWith('/phantom') && value === 1) {
      setDialog({
        title: 'Enable 48V phantom power?',
        body: `Apply phantom power to ${path.split('/')[2]} on the physical mixer. Check the connected equipment before enabling.`,
        action: () => write(path, value, true)
      });
    } else void write(path, value);
  }
  function renderControl(spec: MixerParameter) {
    const value = controlValue(spec.path);
    const disabled = !enabled || state.values[spec.path] === undefined;
    return <label className={`xr-control ${spec.path in drafts || state.pending.includes(spec.path) ? 'is-pending' : ''}`} title={spec.path}>
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
    const levelPath = sends ? `${strip.id}/mix/${sendBus}/level` : `${mix}/fader`;
    const headamp = physicalHeadamp(state.values, strip.id);
    const usb = state.values[strip.id + '/preamp/rtnsw'] === 1;
    const gainPath = usb ? strip.id + '/preamp/rtntrim' : headamp ? headamp + '/gain' : null;
    const panPath = strip.id + '/mix/pan';
    const modes: StripMode[] = ['level'];
    if (strip.kind === 'input' || usb && catalog.parameters[gainPath ?? '']) modes.push('gain');
    if (catalog.parameters[panPath]) modes.push('balance');
    const mode = modes.includes(stripModes[strip.id]) ? stripModes[strip.id] : 'level';
    const path = mode === 'gain' ? gainPath : mode === 'balance' ? panPath : levelPath;
    const spec = path ? catalog.parameters[path] : undefined;
    const fader = path ? state.values[path] : undefined;
    const value = Number((path ? drafts[path] : undefined) ?? fader ?? 0);
    const disabled = !enabled || fader === undefined || !spec || !path;
    const on = controlValue(mix + '/on');
    const level = state.meters[strip.meter];
    const name = String(state.values[strip.id + '/config/name'] || strip.name);
    const color = Number(state.values[strip.id + '/config/color'] || 0) % 8;
    const modeLabel = mode === 'gain' ? usb ? 'USB trim' : 'Gain' : mode === 'balance' ? 'Balance' : 'Level';
    const resetValue = spec ? mode === 'balance' ? .5 : toWire(spec, 0) : undefined;
    const resetLabel = mode === 'balance' ? 'Centre' : '0 dB';
    const format = (wire: number) => mode === 'balance'
      ? Math.abs(wire - .5) < .001 ? 'Centre' : `${wire < .5 ? 'L' : 'R'} ${Math.round(Math.abs(wire - .5) * 200)}%`
      : spec ? displayValue(spec, wire) : '—';
    const ticks = mode === 'balance' ? [[1, 'R'], [.5, 'C'], [0, 'L']] as const
      : spec ? (mode === 'gain' ? [spec.max, (spec.max + spec.min) / 2, 0, spec.min] : [10, 0, -10, -30, -90])
        .map(db => [toWire(spec, db), db === -90 ? '−∞' : db > 0 ? `+${db}` : String(db)] as const) : [];
    return <article key={strip.id} className={`xr-strip ${selected === strip.id ? 'is-selected' : ''} ${master ? 'xr-master' : ''}`} style={{ borderTopColor: colors[color] }}>
      <button type="button" className="xr-strip-name" title={`Select ${name}`} aria-label={`Select ${name}`} aria-pressed={selected === strip.id} onClick={() => { setSelected(strip.id); setPage('desk'); }}><small>{strip.name}</small><strong>{name}</strong></button>
      <div className="xr-strip-status">{!enabled ? state.recalling ? 'Recalling snapshot…' : state.connected ? 'Reconnecting…' : 'Mixer offline' : mode === 'gain' && !usb && headamp === null && typeof state.values[strip.id + '/config/insrc'] === 'number' ? 'NO ANALOG INPUT' : fader === undefined ? 'Reading level…' : path && (path in drafts || state.pending.includes(path)) ? 'Sending…' : mode === 'gain' ? usb ? 'USB RETURN' : headamp ? `INPUT ${Number(headamp.split('/')[2])} PREAMP` : 'NO ANALOG INPUT' : sends && mode === 'level' ? `→ ${Number(sendBus) <= 6 ? 'Bus ' + Number(sendBus) : 'FX ' + (Number(sendBus) - 6)}` : mode === 'balance' ? 'LEFT / RIGHT' : 'MAIN MIX'}</div>
      <div className="xr-strip-accordion">
        {modes.map(section => <div key={section} className={`xr-strip-section ${mode === section ? 'is-open' : ''}`}>
          <button type="button" className="xr-strip-section-toggle" aria-label={`${name} ${section === 'level' ? 'level' : section} controls`} aria-expanded={mode === section}
            onClick={() => { setStripModes(previous => ({ ...previous, [strip.id]: section })); setEditorOpen(false); }}>
            <span>{section === 'level' ? 'Level' : section === 'gain' ? usb ? 'USB trim' : 'Gain' : 'Pan'}</span>{mode === section ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          {mode === section && <div className="xr-strip-control">
            <div className="xr-fader-area"><div className="xr-meter" role="meter" aria-label={`${name} level`} aria-valuemin={-90} aria-valuemax={0} aria-valuenow={level ?? -90}><div style={{height: `${level === undefined ? 0 : Math.max(0, Math.min(100, (level + 90) / 90 * 100))}%`}} /></div>
              <MixerFader key={path ?? mode} label={`${name} ${mode === 'level' ? sends ? 'send' : 'fader' : mode === 'gain' ? usb ? 'USB trim' : 'gain' : 'balance'}`} value={value} valueText={fader === undefined ? '—' : format(value)} disabled={disabled}
                touchExpand resetValue={resetValue} resetLabel={resetLabel} formatValue={format} onChange={next => { if (path) change(path, next); }} />
              <div className="xr-scale xr-positioned-scale">{ticks.map(([wire, label], index) => <span key={index} style={{top: `${(1 - wire) * 100}%`}}>{label}</span>)}</div>
            </div>
            <output className="xr-db" aria-label={`${name} ${modeLabel} value`}>{fader === undefined ? '—' : format(value)}</output>
            <button type="button" className="xr-zero-button" aria-label={`${name} ${mode === 'balance' ? 'centre balance' : mode === 'gain' ? 'gain to 0 dB' : 'level to 0 dB'}`} disabled={disabled}
              onClick={() => { if (path && resetValue !== undefined) change(path, resetValue); }}>{resetLabel}</button>
          </div>}
        </div>)}
      </div>
      <div className="xr-strip-buttons">{strip.kind === 'input' && <button type="button" className={controlValue(`/-stat/solosw/${strip.id.split('/')[2]}`) === 1 ? 'xr-solo is-active' : 'xr-solo'} disabled={!enabled || state.values[`/-stat/solosw/${strip.id.split('/')[2]}`] === undefined} onClick={() => {
        const p = `/-stat/solosw/${strip.id.split('/')[2]}`;
        change(p, controlValue(p) === 1 ? 0 : 1);
      }}>Solo</button>}
      {strip.kind !== 'input' && <span className="xr-solo-spacer" aria-hidden="true" />}
      <button type="button" className={`xr-mute ${on === 0 ? 'is-muted' : ''}`} aria-pressed={on === 0} aria-busy={mix + '/on' in drafts || state.pending.includes(mix + '/on')} disabled={!enabled || on === undefined} onClick={() => change(mix + '/on', on === 1 ? 0 : 1)}>{on === 0 ? 'MUTED' : 'Mute'}</button></div>
    </article>;
  }
  const strip = catalog.strips.find(s => s.id === selected);
  const parameters = Object.values(catalog.parameters).map(p => state.fx_specs[p.path] || p);
  const headamp = physicalHeadamp(state.values, selected);
  const selectedParameters = parameters.filter(p => p.path.startsWith(selected + '/') || headamp !== null && p.path.startsWith(headamp + '/'));
  const groups = Array.from(new Set(selectedParameters.map(p => p.group)));
  const visible = catalog.strips.filter(s => bank === 'all' || bank === 'inputs' && s.kind === 'input' || bank === 'returns' && ['return', 'aux'].includes(s.kind) || bank === 'outputs' && ['bus', 'fxsend', 'dca'].includes(s.kind));
  const inspectorGroup = groups.includes(group) ? group : groups[0];
  const main = catalog.strips.find(s => s.kind === 'main');
  const shown = page === 'routing' ? parameters.filter(p => p.group === 'Routing') : page === 'effects' ? parameters.filter(p => p.path.startsWith('/fx/') && (!p.path.includes('/par/') || state.values[p.path] !== undefined)) : page === 'system' ? parameters.filter(p => ['Links', 'Mute groups', 'Monitor'].includes(p.group)) : selectedParameters.filter(p => p.group === inspectorGroup);
  function renderMenus() {
    return <nav className="xr-compact-menus" aria-label="Mixer menus">
      <select aria-label="Mixer view" title="Mixer view" value={page} onChange={event => { setPage(event.target.value); setEditorOpen(false); setSetupOpen(false); }}>{mixerPages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
      {page === 'desk' && <>
        <select aria-label="Channel bank" title="Channel bank" value={bank} onChange={event => { setBank(event.target.value); setEditorOpen(false); setSetupOpen(false); }}>{[['inputs', 'Inputs'], ['returns', 'Returns'], ['outputs', 'Outputs'], ['all', 'All']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select>
        <select aria-label="Sends on faders" title="Sends on faders" value={sendBus} onChange={event => { setSendBus(event.target.value); setStripModes({}); setEditorOpen(false); setSetupOpen(false); }}><option value="">Main mix</option>{Array.from({length:10}, (_, i) => <option key={i} value={String(i + 1).padStart(2, '0')}>{i < 6 ? `Bus ${i + 1}` : `FX ${i - 5}`}</option>)}</select>
      </>}
    </nav>;
  }
  return <section ref={dashboardRef} className={`xr-dashboard ${focused ? 'is-focused' : ''}`} data-fit={page === 'desk' && !showEditor && !showSetup ? 'desk' : undefined} data-layout={compact ? 'compact' : 'wide'} aria-label="XR18 mixer dashboard" onKeyDown={event => {
    // The desk lives inside Broadcast settings: editing must not submit that form.
    if (event.key === 'Enter' && event.target instanceof HTMLInputElement) {
      event.preventDefault();
      event.stopPropagation();
      event.target.blur();
    }
  }}>
    <header className="xr-header">{focused ? renderMenus() : <div><div className="xr-title"><SlidersHorizontal size={21} /><h2>XR18 <span>Live desk</span></h2></div><small>{state.identity.length ? `${state.identity[1]} · ${state.identity[2]} · Firmware ${state.identity[3]}` : 'Local Ethernet control · OSC / UDP'}</small></div>}<div className="xr-connection" title={state.syncing ? 'Reading desk…' : state.recalling ? 'Recalling snapshot…' : state.connected ? streamOnline ? 'Connected' : 'Reconnecting' : 'Mixer offline'}><span className={`xr-led ${state.connected && streamOnline ? 'is-live' : ''}`} /><strong>{!streamOnline ? 'Reconnecting' : state.connected ? 'Connected' : state.host ? 'Mixer offline' : 'Not connected'}</strong></div><div className="xr-header-actions">
      <button type="button" title={showSetup ? 'Hide connection settings' : 'Connection settings'} aria-label="Connection settings" aria-expanded={showSetup} aria-controls="xr-connection-settings" onClick={() => { setSetupOpen(!showSetup); setEditorOpen(false); }}><Settings2 size={18} /><span className="xr-action-label">Setup</span></button>
      <button type="button" title={focused ? 'Exit expanded desk' : 'Expand desk to fill screen'} aria-label={focused ? 'Exit expanded desk' : 'Expand desk'} aria-pressed={focused} onClick={() => { setFocused(!focused); setSetupOpen(false); setEditorOpen(false); }}>{focused ? <Minimize2 size={18} /> : <Maximize2 size={18} />}<span className="xr-action-label">{focused ? 'Restore' : 'Expand'}</span></button>
    </div></header>
    <MixerSceneControls connected={enabled && !state.syncing} />
    {!focused && renderMenus()}
    <div className="xr-connect-bar" id="xr-connection-settings" hidden={!showSetup}><label>Mixer IP<input aria-label="Mixer IP address" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.2.141" /></label><button type="button" disabled={busy || !host} onClick={() => void run(async () => {
        const s = await mixerRequest<MixerState>('/connection', 'PUT', {
          host
        });
        setState(s);
        setSetupOpen(false);
      })}><Radio size={15} />Connect</button><button type="button" disabled={busy || !state.host} onClick={() => void run(async () => {
        setState(await mixerRequest('/connection', 'PUT', {
          host: null
        }));
      })}><Unplug size={15} />Disconnect</button><button type="button" disabled={!enabled || state.syncing} onClick={() => void run(async () => { await mixerRequest('/sync', 'POST'); setSetupOpen(false); })}><RefreshCw size={15} />Sync</button><details><summary><Search size={14} />Find mixer</summary><div className="xr-discovery"><label>LAN subnet<input aria-label="Discovery subnet" value={subnet} onChange={e => setSubnet(e.target.value)} /></label><button type="button" disabled={busy} onClick={() => void run(async () => setFound(await mixerRequest('/discover', 'POST', {
            subnet
          })))}>Scan LAN</button>{found.map(f => <button type="button" key={f.host} onClick={() => setHost(f.host)}>{f.name} · {f.host} · {f.firmware}</button>)}<small>Discovery runs on the cspot server's LAN. Select an address, then Connect.</small></div></details></div>
    {(error || state.error) && <div className="xr-error" role="alert">{error || state.error}<button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>}
    {state.startup_muting && <p className="xr-notice" role="status">Startup: muting all inputs and returns. Waiting for mixer confirmation before enabling controls. Apply a configured scene or unmute channels when ready.</p>}
    {state.startup_scene_hold && !state.startup_muting && <p className="xr-notice" role="status">Startup muted. Apply a configured audio scene or unmute channels to start audio.</p>}
    {Object.keys(state.failed).length > 0 && <p className="xr-error" role="alert">{Object.keys(state.failed).length === 1 ? '1 change has' : `${Object.keys(state.failed).length} changes have`} no matching mixer readback: {Object.keys(state.failed).map(path => path.startsWith('/headamp/') ? `Input ${Number(path.split('/')[2])} ${catalog.parameters[path]?.label ?? path}` : `${path} (${catalog.parameters[path]?.label ?? 'control'})`).join(', ')}. Sync to verify the desk.</p>}
    {state.connected && !streamOnline && <p className="xr-notice" role="status">Live updates interrupted. Reconnecting; controls are disabled until updates resume.</p>}
    {!state.connected && <p className="xr-notice">{state.host ? `Waiting for ${state.host}:10024. Check power, Ethernet mode and LAN routing.` : 'Connect your XR18 to read the desk. Controls become available as the mixer replies.'} {Object.keys(state.values).length > 0 ? 'Displayed values are cached; controls are disabled.' : ''}</p>}
    {page === 'desk' ? <>{sendBus && <p className="xr-notice">Faders adjust {Number(sendBus) <= 6 ? `Bus ${Number(sendBus)}` : `FX ${Number(sendBus) - 6}`} sends. Mute still mutes the whole channel.</p>}
    <div className="xr-desk-toolbar">
      <div className="xr-bulk-mute" role="group" aria-label="All input channel mutes">
        <button type="button" aria-label="Mute all input channels and returns" title="Mute every input and return in both room and livestream, across all banks" disabled={!bulkMuteReady} onClick={() => void muteAll(0)}><VolumeX size={17}/><span className="xr-action-label">Mute all</span></button>
        <button type="button" aria-label="Unmute all input channels and returns" title="Unmute every input and return; confirm before opening all microphones" disabled={!bulkMuteReady} onClick={() => setDialog({title:'Unmute all channels?',body:'Unmute every input and FX return across all banks, including microphones. This affects both room and livestream; scene routing and levels still apply. Master, bus and DCA mutes remain unchanged.',action:()=>muteAll(1)})}><Volume2 size={17}/><span className="xr-action-label">Unmute all</span></button>
      </div>
      <div className="xr-bank-pager" role="group" aria-label="Browse channels">
        <button type="button" title="Previous channel bank" aria-label="Previous channel bank" disabled={scrollEdges.start} onClick={() => browseChannels(-1)}><ChevronLeft size={19} /></button>
        <span aria-live="polite">{visible.filter(s => s.kind !== 'main').length} channels · scroll</span>
        <button type="button" title="Next channel bank" aria-label="Next channel bank" disabled={scrollEdges.end} onClick={() => browseChannels(1)}><ChevronRight size={19} /></button>
      </div>
      <button type="button" aria-expanded={showEditor} aria-controls="xr-channel-editor" onClick={() => {
        setEditorOpen(!showEditor);
        setSetupOpen(false);
        if (!showEditor) requestAnimationFrame(() => editorRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
      }}><SlidersHorizontal size={17} /><span>{showEditor ? 'Hide editor' : 'Edit channel'}</span>{showEditor ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
    </div>
    <div className="xr-desk"><div ref={stripScrollRef} className="xr-strip-scroll" onScroll={measureScroll} style={{ '--xr-visible-strips': bankSize } as CSSProperties} aria-label="Channel faders">{visible.filter(s => s.kind !== 'main').map(s => renderStrip(s))}</div>{main && renderStrip(main, true)}</div>
    <div ref={editorRef} className="xr-inspector xr-channel-editor" id="xr-channel-editor" hidden={!showEditor}><header><h3>{String(state.values[selected + '/config/name'] || strip?.name || 'Channel')} <small>{selected}</small></h3><button type="button" aria-label="Collapse channel editor" onClick={() => setEditorOpen(false)}><ChevronUp size={16} /><span>Collapse</span></button></header><label className="xr-processing-menu">Processing<select aria-label="Channel processing" value={inspectorGroup ?? ''} onChange={event => setGroup(event.target.value)}>{groups.map(g => <option key={g} value={g}>{g}</option>)}</select></label>{inspectorGroup === 'Headamp' && headamp && <p className="xr-notice">Physical input {Number(headamp.split('/')[2])} · Gain and 48V follow the channel's analog input assignment.</p>}<div className="xr-control-grid">{shown.map(p => <div key={p.path}>{renderControl(p)}</div>)}</div></div></> : page === 'scenes' ? <MixerAutomationPanel strips={catalog.strips} state={state} /> : page === 'snapshots' ? <div className="xr-snapshots"><h3>Local desk snapshots</h3><p>Save the parameters read by cspot. Recalls preserve physical preamp gain and phantom power. These snapshots are separate from the mixer's internal scenes.</p><div className="xr-snapshot-save"><input aria-label="Snapshot name" placeholder="Snapshot name" maxLength={80} value={snapshotName} onChange={e => setSnapshotName(e.target.value)} /><button type="button" disabled={busy || !enabled || !state.synchronized || state.syncing || !!state.pending.length || !!Object.keys(drafts).length || !snapshotName.trim()} onClick={() => void run(async () => {
          await mixerRequest('/snapshots', 'POST', {
            name: snapshotName.trim()
          });
          setSnapshots(await mixerRequest('/snapshots'));
          setSnapshotName('');
        })}><Save size={15} />Save current desk</button></div>{snapshots.map(s => <article key={s.id}><div><strong>{s.name}</strong><small>{new Date(s.created_at).toLocaleString()} · {Object.keys(s.values).length} parameters</small></div><button type="button" disabled={!enabled || busy || state.syncing || !!Object.keys(drafts).length} onClick={() => setDialog({
          title: `Recall ${s.name}?`,
          body: 'This changes live levels, processing, sends, routing and effects. Physical preamps and phantom power are preserved.',
          action: async () => {
            await mixerRequest(`/snapshots/${s.id}/recall`, 'POST');
          }
        })}>Recall</button><button type="button" disabled={busy} onClick={() => setDialog({
          title: `Delete ${s.name}?`,
          body: 'Remove this saved snapshot from cspot.',
          action: async () => {
            await mixerRequest(`/snapshots/${s.id}`, 'DELETE');
            setSnapshots(await mixerRequest('/snapshots'));
          }
        })}>Delete</button></article>)}</div> : <div className="xr-inspector"><header><h3>{page === 'routing' ? 'Input & output routing' : page === 'effects' ? 'Effects rack' : 'Desk configuration'}</h3><input aria-label="Filter mixer parameters" placeholder="Filter parameters…" value={search} onChange={e => setSearch(e.target.value)} /></header>{page === 'effects' && <p className="xr-notice">FX parameters follow the selected algorithm. Continuous controls use normalized values (0–1); switches and enums use integer values. Less common algorithms show parameter indices; consult the X AIR effect reference for their order.</p>}<div className="xr-control-grid">{shown.filter(p => (p.label + ' ' + p.path).toLowerCase().includes(search.toLowerCase())).map(p => <div key={p.path}><small className="xr-path">{p.path}</small>{renderControl(p)}</div>)}</div></div>}
    <footer className="xr-footer"><span>LAN UDP :10024 · 20 Hz dashboard stream · Hardware readback</span><span>{state.pending.length || Object.keys(drafts).length ? `${new Set([...state.pending, ...Object.keys(drafts)]).size} awaiting desk confirmation` : 'No pending changes'}</span></footer>
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
    }}><div className="xr-modal" role="dialog" aria-modal="true" aria-label={dialog.title}><h3>{dialog.title}</h3><p>{dialog.body}</p><div><button type="button" autoFocus onClick={() => setDialog(null)}>Cancel</button><button type="button" disabled={busy} onClick={() => {
            const action = dialog.action;
            setDialog(null);
            void run(action);
          }}>Confirm</button></div></div></div>}
  </section>;
}
