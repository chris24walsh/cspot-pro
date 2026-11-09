import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteGuest } from "../remoteContribution";

type AlertAudioContext = Window & { webkitAudioContext?: typeof AudioContext };

function playCameraAlert(context: AudioContext) {
  // A brief two-note cue uses local Web Audio, independently of program sound.
  [660, 880].forEach((frequency, index) => {
    const start = context.currentTime + index * 0.18;
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.frequency.value = frequency;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.12, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.16);
    tone.connect(gain).connect(context.destination);
    tone.start(start);
    tone.stop(start + 0.18);
    tone.onended = () => { tone.disconnect(); gain.disconnect(); };
  });
}

export function useServiceCameraAlerts(enabled: boolean) {
  const [soundReady, setSoundReady] = useState(false);
  const pendingSound = useRef(false);
  const [requests, setRequests] = useState<RemoteGuest[]>([]);
  const connectedIds = useRef(new Set<string>());
  const audio = useRef<AudioContext | null>(null);

  const prepareSound = useCallback(() => {
    if (!enabled) return;
    try {
      const Context = window.AudioContext ?? (window as AlertAudioContext).webkitAudioContext;
      if (!Context) return;
      audio.current ??= new Context();
      const context = audio.current;
      const flush = () => {
        if (audio.current !== context) return;
        setSoundReady(context.state === "running");
        if (context.state === "running" && pendingSound.current) {
          pendingSound.current = false;
          playCameraAlert(context);
        }
      };
      if (context.state === "suspended") void context.resume().then(flush).catch(() => undefined);
      else flush();
      return context;
    } catch { return; }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const unlock = () => { prepareSound(); };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      const context = audio.current;
      audio.current = null;
      if (context) void context.close().catch(() => undefined);
    };
  }, [enabled, prepareSound]);

  const reportCameras = useCallback((cameras: RemoteGuest[]) => {
    if (!enabled) return;
    const backstage = cameras.filter(camera => camera.self_managed && camera.connected && !camera.live);
    const incoming = backstage.filter(camera => !connectedIds.current.has(camera.id));
    connectedIds.current = new Set(cameras.filter(camera => camera.connected).map(camera => camera.id));
    setRequests(current => [...current.filter(camera => backstage.some(candidate => candidate.id === camera.id)), ...incoming]);
    if (!backstage.length) pendingSound.current = false;
    if (!incoming.length) return;
    pendingSound.current = true;
    prepareSound();
  }, [enabled, prepareSound]);

  const acknowledge = useCallback(() => { pendingSound.current = false; setRequests([]); }, []);
  return { requests, reportCameras, acknowledge, soundReady, enableSound: prepareSound };
}
