import { useEffect, useRef, useState } from 'react';
import { getWorshipMusicTiming, updateWorshipMusicTiming, type WorshipMusicTiming, type WorshipMusicTimingRead } from '../api';
import type { MusicTimingProgress } from './LyricMusicControls';

export interface RemoteMusicTiming { timing: WorshipMusicTiming; position: number }
export function remoteMusicPosition(snapshot: WorshipMusicTimingRead, receivedAt: number, now: number, roundTrip = 0): number | null {
  const timing = snapshot.timing;
  if (!timing?.active) return null;
  const elapsed = Math.max(0, snapshot.server_now - timing.updated_at) + Math.max(0, now - receivedAt) + roundTrip / 2;
  if (elapsed >= 12000) return null;
  let remaining = elapsed, position = timing.position;
  while (remaining > 0 && position < timing.total_bars) {
    const index = Math.floor(position);
    const duration = index < 0 ? timing.bar_duration_ms : timing.bar_durations_ms?.[index] ?? timing.bar_duration_ms;
    const untilNext = (index + 1 - position) * duration;
    if (remaining < untilNext) { position += remaining / duration; break; }
    remaining -= untilNext; position = index + 1;
  }
  return position >= timing.total_bars ? null : position;
}

export function useSharedMusicTiming({ planId, songId, itemId, share, follow }: {
  planId: string | null; songId: string | null; itemId: string | null; share: boolean; follow: boolean;
}) {
  const owner = useRef(`music-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const latest = useRef<MusicTimingProgress | null>(null);
  const context = useRef({ planId, songId, itemId, share }); context.current = { planId, songId, itemId, share };
  const published = useRef<{ planId: string; timing: WorshipMusicTiming } | null>(null);
  const sourceRevision = useRef(0);
  const pending = useRef(false), mounted = useRef(true);
  const publishRef = useRef<() => void>(() => {});
  const [error, setError] = useState<string | null>(null);
  const [remote, setRemote] = useState<RemoteMusicTiming | null>(null);
  async function publish() {
    if (pending.current) return;
    const current = context.current, progress = latest.current;
    const old = published.current;
    const active = Boolean((!old || old.planId === current.planId) && current.share && current.planId && current.songId && current.itemId && progress);
    if (!active && !old) return;
    const request = active ? { planId: current.planId!, timing: {
      owner_id: owner.current, active: true, song_id: current.songId!, plan_item_id: current.itemId!, start_index: progress!.startIndex, first_bar_stop: progress!.firstBarStop ?? 0,
      position: progress!.position, bar_duration_ms: progress!.barDurationMs, ...(progress!.barDurationsMs ? { bar_durations_ms: progress!.barDurationsMs } : {}), total_bars: progress!.totalBars, updated_at: 0,
    } } : { planId: old!.planId, timing: { ...old!.timing, active: false } };
    const revision = sourceRevision.current;
    pending.current = true;
    let succeeded = false;
    try {
      await updateWorshipMusicTiming(request.planId, request.timing);
      succeeded = true;
      published.current = active ? request : null;
      if (mounted.current) setError(null);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : 'Could not share timing'); }
    finally {
      pending.current = false;
      const shouldBeActive = Boolean(mounted.current && context.current.share && context.current.planId && context.current.songId && context.current.itemId && latest.current);
      if (succeeded && (active !== shouldBeActive || revision !== sourceRevision.current)) void publish();
    }
  }
  publishRef.current = () => { void publish(); };
  function setLocalSource(songId: string, itemId: string) {
    context.current = { ...context.current, songId, itemId };
    sourceRevision.current += 1;
    latest.current = null; // Next position publishes the destination immediately.
  }
  function setLocalTiming(timing: MusicTimingProgress | null) {
    const changed = Boolean(latest.current) !== Boolean(timing) || Boolean(timing && latest.current && (timing.startIndex !== latest.current.startIndex || (timing.firstBarStop ?? 0) !== (latest.current.firstBarStop ?? 0) || timing.position < latest.current.position - 0.2));
    latest.current = timing;
    if (changed) {
      sourceRevision.current += 1;
      publishRef.current();
    }
  }
  useEffect(() => {
    publishRef.current();
    const timer = window.setInterval(() => publishRef.current(), 2000);
    return () => window.clearInterval(timer);
  }, [planId, songId, itemId, share]);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; latest.current = null; context.current = { ...context.current, share: false }; publishRef.current(); };
  }, []);
  useEffect(() => {
    setRemote(null);
    if (!follow || !planId) return;
    let cancelled = false, reading = false;
    let snapshot: WorshipMusicTimingRead | null = null, receivedAt = 0, roundTrip = 0;
    const render = () => {
      if (!snapshot || snapshot.timing?.owner_id === owner.current) { setRemote(null); return; }
      const position = remoteMusicPosition(snapshot, receivedAt, performance.now(), roundTrip);
      setRemote(position === null || !snapshot.timing ? null : { timing: snapshot.timing, position });
    };
    const read = async () => {
      if (reading) return;
      reading = true; const requestedAt = performance.now();
      try {
        const value = await getWorshipMusicTiming(planId);
        if (!cancelled) { receivedAt = performance.now(); roundTrip = receivedAt - requestedAt; snapshot = value; render(); }
      } catch { /* The existing clock expires after a lost connection. */ }
      finally { reading = false; }
    };
    void read();
    const poll = window.setInterval(() => void read(), 1000), frames = window.setInterval(render, 25);
    return () => { cancelled = true; window.clearInterval(poll); window.clearInterval(frames); };
  }, [planId, follow]);
  return { remote, error, setLocalSource, setLocalTiming };
}
