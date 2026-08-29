import { useEffect, useRef, useState } from "react";

import { extractYouTubeId } from "../presentation";
import { preServicePhaseAt } from "./PreServiceSlide";

function loopingYouTubeUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
}

const AUDIO_FADE_DURATION_MS = 6000;
const AUDIO_FADE_INTERVAL_MS = 100;

function sendYouTubeCommand(frame: HTMLIFrameElement | null, func: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), "*");
}

export function preServiceAudioShouldPlay(
  continuous: boolean,
  phase: "waiting" | "montage" | "countdown" | "complete",
  phaseStartedAt: number | undefined,
  now: number,
) {
  if (continuous) return true;
  if (phase === "countdown" && phaseStartedAt && now - phaseStartedAt >= 300_000) return false;
  return phase === "montage" || phase === "countdown";
}

export function PreServiceMusic({
  active = true,
  continuous = false,
  label = "Pre-service music",
  serviceDate,
  url,
  outputMuted = false,
  phase: forcedPhase,
  phaseStartedAt,
}: {
  active?: boolean;
  continuous?: boolean;
  label?: string;
  serviceDate: string;
  url: string;
  outputMuted?: boolean;
  phase?: "waiting" | "montage" | "countdown" | "complete" | null;
  phaseStartedAt?: number;
}) {
  const videoId = extractYouTubeId(url);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [muted, setMuted] = useState(Boolean(videoId));
  const [now, setNow] = useState(Date.now());
  const phase = forcedPhase ?? preServicePhaseAt(serviceDate, now);
  const shouldPlay = active && preServiceAudioShouldPlay(continuous, phase, phaseStartedAt, now);
  const [rendered, setRendered] = useState(shouldPlay);
  const [fading, setFading] = useState(false);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (shouldPlay) {
      setRendered(true);
      setFading(false);
      if (audioRef.current) audioRef.current.volume = 1;
      sendYouTubeCommand(frameRef.current, "setVolume", [100]);
      return;
    }
    if (!rendered) return;

    setFading(true);
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const progress = Math.min(1, (Date.now() - startedAt) / AUDIO_FADE_DURATION_MS);
      const volume = Math.pow(1 - progress, 2);
      if (audioRef.current) audioRef.current.volume = volume;
      sendYouTubeCommand(frameRef.current, "setVolume", [Math.round(volume * 100)]);
      if (progress < 1) return;
      window.clearInterval(timer);
      audioRef.current?.pause();
      sendYouTubeCommand(frameRef.current, "pauseVideo");
      setRendered(false);
      setFading(false);
    }, AUDIO_FADE_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [rendered, shouldPlay]);

  if (!rendered) {
    return null;
  }

  if (!videoId) {
    return (
      <div className={`pre-service-music-control ${fading ? "is-fading" : ""}`}>
        <span>{label}</span>
        <audio autoPlay controls loop muted={outputMuted} ref={audioRef} src={url} />
      </div>
    );
  }

  function enableSound() {
    sendYouTubeCommand(frameRef.current, "unMute");
    sendYouTubeCommand(frameRef.current, "setVolume", [100]);
    sendYouTubeCommand(frameRef.current, "playVideo");
    setMuted(false);
  }

  return (
    <div className={`pre-service-music-control ${fading ? "is-fading" : ""}`}>
      <iframe
        allow="autoplay; encrypted-media"
        aria-hidden="true"
        className="youtube-audio-frame"
        onLoad={() => {
          frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: "pre-service-audio" }), "*");
          sendYouTubeCommand(frameRef.current, "setVolume", [100]);
        }}
        ref={frameRef}
        src={loopingYouTubeUrl(videoId)}
        tabIndex={-1}
        title={label}
      />
      <span>{label}</span>
      {outputMuted ? <strong>Room sound muted</strong> : muted ? <button className="primary-button" onClick={enableSound} type="button">Enable sound</button> : <strong>Playing</strong>}
    </div>
  );
}
