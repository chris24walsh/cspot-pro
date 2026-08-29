import { useEffect, useRef, useState } from "react";

import { extractYouTubeId } from "../presentation";
import { preServicePhaseAt } from "./PreServiceSlide";

function loopingYouTubeUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
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
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [100] }), "*");
      return;
    }
    if (!rendered) return;

    setFading(true);
    let step = 0;
    const timer = window.setInterval(() => {
      step += 1;
      const volume = Math.max(0, 1 - step / 20);
      if (audioRef.current) audioRef.current.volume = volume;
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "setVolume", args: [Math.round(volume * 100)] }), "*");
      if (step < 20) return;
      window.clearInterval(timer);
      audioRef.current?.pause();
      frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "pauseVideo", args: [] }), "*");
      setRendered(false);
      setFading(false);
    }, 100);
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
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
    setMuted(false);
  }

  return (
    <div className={`pre-service-music-control ${fading ? "is-fading" : ""}`}>
      <iframe
        allow="autoplay; encrypted-media"
        aria-hidden="true"
        className="youtube-audio-frame"
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
