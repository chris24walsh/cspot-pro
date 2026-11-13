import { useEffect, useRef, useState } from 'react';
import { commandWorshipMusicTiming, getWorshipMusicTiming, heartbeatWorshipMusicTiming, type WorshipMusicTiming, type WorshipMusicTimingRead } from '../api';
import type { MusicTimingProgress } from './LyricMusicControls';

export interface RemoteMusicTiming { timing: WorshipMusicTiming; position: number }
export interface ScheduledOwnerReseat { commandId: string; revision: number; timing: WorshipMusicTiming; effectiveAt: number }
type ClockSnapshot = WorshipMusicTimingRead;

function interpolate(timing: WorshipMusicTiming, elapsed: number): number | null {
  let remaining = Math.max(0, elapsed), position = timing.position;
  while (remaining > 0 && position < timing.total_bars) {
    const index = Math.floor(position);
    const duration = index < 0 ? timing.bar_duration_ms : timing.bar_durations_ms?.[index] ?? timing.bar_duration_ms;
    const untilNext = (index + 1 - position) * duration;
    if (remaining < untilNext) { position += remaining / duration; break; }
    remaining -= untilNext;
    position = index + 1;
  }
  return position >= timing.total_bars ? null : position;
}

export function remoteMusicPosition(snapshot: ClockSnapshot, receivedAt: number, now: number, roundTrip = 0): number | null {
  if (snapshot.status !== 'running' || !snapshot.timing) return null;
  const elapsed = Math.max(0, snapshot.server_now - snapshot.timing.updated_at) + Math.max(0, now - receivedAt) + roundTrip / 2;
  const pending = snapshot.pending;
  if (pending && snapshot.server_now + Math.max(0, now - receivedAt) + roundTrip / 2 >= pending.effective_at) {
    return interpolate(pending.timing, snapshot.server_now + Math.max(0, now - receivedAt) + roundTrip / 2 - pending.effective_at);
  }
  return interpolate(snapshot.timing, elapsed);
}

function toTiming(ownerId: string, songId: string, itemId: string, progress: MusicTimingProgress): WorshipMusicTiming {
  return {
    owner_id: ownerId, active: true, song_id: songId, plan_item_id: itemId,
    start_index: progress.startIndex, first_bar_stop: progress.firstBarStop ?? 0,
    position: progress.position, bar_duration_ms: progress.barDurationMs,
    bar_durations_ms: progress.barDurationsMs ?? null,
    total_bars: progress.totalBars, updated_at: Date.now(),
  };
}

export function useSharedMusicTiming({ planId, songId, itemId, enabled, canReseat, canAdminStop, follow, clientId, onOwnerStop }: {
  planId: string | null; songId: string | null; itemId: string | null; enabled: boolean;
  canReseat: boolean; canAdminStop: boolean; follow: boolean; clientId?: string; onOwnerStop?: () => void;
}) {
  const ownerId = useRef(clientId ?? `music-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const activePlan = useRef(planId); activePlan.current = planId;
  const latest = useRef<MusicTimingProgress | null>(null);
  const snapshotRef = useRef<ClockSnapshot | null>(null);
  const receivedAtRef = useRef(0);
  const roundTripRef = useRef(0);
  const sessionRef = useRef<string | null>(null);
  const revisionRef = useRef(0);
  const allowNewSession = useRef(true);
  const commandPending = useRef(false), reading = useRef(false);
  const commandTail = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const ownerStopRef = useRef(onOwnerStop); ownerStopRef.current = onOwnerStop;
  const seenOwnerCommands = useRef(new Set<string>());
  const selfHandledCommands = useRef(new Set<string>());
  const [remote, setRemote] = useState<RemoteMusicTiming | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [ownerConnected, setOwnerConnected] = useState(true);
  const [clockStatus, setClockStatus] = useState<'stopped' | 'running'>('stopped');
  const [reseatScheduled, setReseatScheduled] = useState(false);
  const [ownerReseat, setOwnerReseat] = useState<ScheduledOwnerReseat | null>(null);
  const [ownerStopRevision, setOwnerStopRevision] = useState(0);

  function applySnapshot(value: ClockSnapshot, receivedAt: number, roundTrip = 0) {
    const prior = snapshotRef.current;
    if (prior && value.revision < prior.revision) return;
    snapshotRef.current = value;
    receivedAtRef.current = receivedAt;
    roundTripRef.current = roundTrip;
    revisionRef.current = Math.max(revisionRef.current, value.revision);
    setClockStatus(value.status);
    setReseatScheduled(Boolean(value.pending));
    if (prior?.status === 'running' && value.status === 'stopped' && prior.owner.owner_id === ownerId.current) {
      sessionRef.current = null;
      allowNewSession.current = false;
      setOwnerReseat(null);
      setOwnerStopRevision(current => current + 1);
      ownerStopRef.current?.();
    }
    if (value.status !== 'running') setOwnerReseat(null);
    if (value.status === 'running' && value.owner.owner_id === ownerId.current) {
      const pending = value.pending;
      if (pending && !seenOwnerCommands.current.has(pending.command_id)) {
        seenOwnerCommands.current.add(pending.command_id);
        if (!selfHandledCommands.current.has(pending.command_id)) {
          setOwnerReseat({
            commandId: pending.command_id,
            revision: value.revision,
            timing: pending.timing,
            effectiveAt: receivedAt + pending.effective_at - value.server_now - roundTrip / 2,
          });
        }
      } else if (!pending && prior?.status === 'running' && prior.revision < value.revision && prior.timing
        && value.timing && (prior.timing.song_id !== value.timing.song_id || prior.timing.plan_item_id !== value.timing.plan_item_id
          || prior.timing.start_index !== value.timing.start_index || prior.timing.position !== value.timing.position
          || prior.timing.updated_at !== value.timing.updated_at)) {
        const commandId = value.command_id ?? `revision-${value.revision}`;
        if (!seenOwnerCommands.current.has(commandId)) {
          seenOwnerCommands.current.add(commandId);
          setOwnerReseat({
            commandId, revision: value.revision, timing: value.timing,
            effectiveAt: receivedAt + value.timing.updated_at - value.server_now - roundTrip / 2,
          });
        }
      }
    }
    setOwnerConnected(value.owner.connected);
    if (!follow || value.owner.owner_id === ownerId.current) { setRemote(null); return; }
    const position = remoteMusicPosition(value, receivedAt, performance.now());
    setRemote(position === null || !value.timing ? null : { timing: value.pending && value.server_now >= value.pending.effective_at ? value.pending.timing : value.timing, position });
  }

  function send(action: 'start' | 'reseat' | 'stop', timing?: WorshipMusicTiming, locallyScheduled = false): Promise<ClockSnapshot | null> {
    const execute = async (): Promise<ClockSnapshot | null> => {
      if (!planId || !mounted.current) return null;
      const commandId = crypto.randomUUID();
      if (locallyScheduled) selfHandledCommands.current.add(commandId);
      const requestedAt = performance.now();
      commandPending.current = true;
      try {
        const result = await commandWorshipMusicTiming(planId, {
          command_id: commandId, expected_revision: revisionRef.current, action, timing,
          ...(action === 'stop' && !canAdminStop ? { owner_id: ownerId.current } : {}),
        });
        if (activePlan.current !== planId) return null;
        const receivedAt = performance.now();
        applySnapshot(result, receivedAt, receivedAt - requestedAt);
        sessionRef.current = result.session_id;
        setError(null);
        setMessage(action === 'reseat' ? 'Reseat scheduled for the next bar.' : action === 'stop' ? 'Shared timing stopped.' : 'Shared timing started.');
        return result;
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not update shared timing');
        if (planId) void read();
        return null;
      } finally { commandPending.current = false; }
    };
    const result = commandTail.current.then(execute, execute);
    commandTail.current = result.then(() => undefined, () => undefined);
    return result;
  }

  async function read() {
    if (!planId || reading.current) return;
    reading.current = true;
    const requestedAt = performance.now();
    try { const value = await getWorshipMusicTiming(planId); const receivedAt = performance.now(); if (mounted.current && activePlan.current === planId) applySnapshot(value, receivedAt, receivedAt - requestedAt); }
    catch (cause) { if (mounted.current) setOwnerConnected(false); }
    finally { reading.current = false; }
  }

  async function requestReseat(timing: WorshipMusicTiming): Promise<ScheduledOwnerReseat | null> {
    const current = snapshotRef.current;
    if (!canReseat || current?.status !== 'running') return null;
    const locallyScheduled = current.owner.owner_id === ownerId.current;
    const result = await send('reseat', { ...timing, owner_id: current.owner.owner_id ?? ownerId.current, updated_at: 0 }, locallyScheduled);
    if (!result) return null;
    const pending = result.pending;
    return {
      commandId: result.command_id ?? `revision-${result.revision}`,
      revision: result.revision,
      timing: pending?.timing ?? result.timing ?? timing,
      effectiveAt: pending
        ? receivedAtRef.current + pending.effective_at - result.server_now - roundTripRef.current / 2
        : receivedAtRef.current + (result.timing?.updated_at ?? result.server_now) - result.server_now - roundTripRef.current / 2,
    };
  }
  function setLocalTiming(timing: MusicTimingProgress | null) {
    const prior = latest.current;
    latest.current = timing;
    if (!timing && prior && canReseat && snapshotRef.current?.status === 'running' && snapshotRef.current.owner.owner_id === ownerId.current) {
      void send('stop');
      return;
    }
    if (!timing || !enabled || !canReseat || !planId || commandPending.current || !allowNewSession.current) return;
    const current = snapshotRef.current;
    if (current?.status === 'running' && current.owner.owner_id === ownerId.current && current.session_id) {
      if (!sessionRef.current) sessionRef.current = current.session_id;
      return;
    }
    if (current?.status === 'running') {
      if (prior === null && current.owner.owner_id !== ownerId.current) void send('reseat', toTiming(current.owner.owner_id ?? ownerId.current, songId!, itemId!, timing));
      return;
    }
    if (prior === null) void send('start', toTiming(ownerId.current, songId!, itemId!, timing));
  }
  function stopShared() {
    const current = snapshotRef.current;
    if (canAdminStop || canReseat && current?.owner.owner_id === ownerId.current) void send('stop');
  }
  function authorizeExplicitStart() { allowNewSession.current = true; }

  useEffect(() => {
    mounted.current = true;
    snapshotRef.current = null;
    sessionRef.current = null;
    revisionRef.current = 0;
    setClockStatus('stopped');
    setReseatScheduled(false);
    if (!planId) return;
    void read();
    const poll = window.setInterval(() => {
      void read();
    }, 250);
    const heartbeat = window.setInterval(() => {
      const current = snapshotRef.current;
      if (current?.session_id && current.owner.owner_id === ownerId.current) {
        const requestedAt = performance.now();
        void heartbeatWorshipMusicTiming(planId, { session_id: current.session_id, revision: current.revision, owner_id: ownerId.current })
          .then(value => { const receivedAt = performance.now(); if (mounted.current) applySnapshot(value, receivedAt, receivedAt - requestedAt); })
          .catch(() => { if (mounted.current) setOwnerConnected(false); });
      }
    }, 1000);
    const frame = window.setInterval(() => {
      const current = snapshotRef.current;
      if (!follow || !current) return;
      const now = performance.now();
      const position = remoteMusicPosition(current, receivedAtRef.current, now, roundTripRef.current);
      const serverNow = current.server_now + Math.max(0, now - receivedAtRef.current) + roundTripRef.current / 2;
      setRemote(position === null || !current.timing ? null : { timing: current.pending && serverNow >= current.pending.effective_at ? current.pending.timing : current.timing, position });
    }, 40);
    return () => { mounted.current = false; window.clearInterval(poll); window.clearInterval(heartbeat); window.clearInterval(frame); };
  }, [planId, follow]);

  return { remote, error, message, ownerConnected, clockStatus, reseatScheduled, ownerReseat, ownerStopRevision, requestReseat, authorizeExplicitStart, setLocalTiming, stopShared };
}
