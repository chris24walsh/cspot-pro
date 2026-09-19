import { useCallback, useEffect, useRef, useState } from "react";
import { controlSundaySchoolDisplay, getSundaySchoolDisplay, heartbeatSundaySchoolDisplay, type SundaySchoolCommand, type SundaySchoolDisplayRead } from "../api";

export function useSundaySchoolRoom(active = true, receiver = false, soundReady = false) {
  const [room, setRoom] = useState<SundaySchoolDisplayRead | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const commandInFlight = useRef(false);
  const accept = useCallback((next: SundaySchoolDisplayRead) => {
    setRoom((current) => !current || next.revision >= current.revision ? next : current);
    setOnline(true);
  }, []);

  useEffect(() => {
    if (!active) return;
    let mounted = true;
    let polling = false;
    let lastHeartbeat = 0;
    const poll = async () => {
      if (polling) return;
      polling = true;
      try {
        const heartbeat = receiver && Date.now() - lastHeartbeat > 4000;
        if (heartbeat) lastHeartbeat = Date.now();
        const next = await (heartbeat ? heartbeatSundaySchoolDisplay(soundReady) : getSundaySchoolDisplay());
        if (mounted) accept(next);
      } catch { if (mounted) setOnline(false); }
      finally { polling = false; }
    };
    void poll();
    const timer = window.setInterval(poll, receiver ? 400 : 1000);
    return () => { mounted = false; window.clearInterval(timer); };
  }, [active, receiver, soundReady, accept]);

  async function command(payload: Omit<SundaySchoolCommand, "revision">) {
    if (!room || commandInFlight.current) return;
    commandInFlight.current = true;
    setBusy(true);
    setError(null);
    try { accept(await controlSundaySchoolDisplay({ ...payload, revision: room.revision })); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update the TV. Try again.");
      try { accept(await getSundaySchoolDisplay()); } catch { setOnline(false); }
    } finally { commandInFlight.current = false; setBusy(false); }
  }
  return { room, busy, error, online, command };
}
