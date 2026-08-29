import { useEffect, useRef, useState } from "react";

import { extractYouTubeId } from "../presentation";
import { preServicePhaseAt } from "./PreServiceSlide";

function loopingYouTubeUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?autoplay=1&mute=1&loop=1&playlist=${videoId}&rel=0&modestbranding=1&playsinline=1&enablejsapi=1`;
}

export function PreServiceMusic({
  continuous = false,
  label = "Pre-service music",
  serviceDate,
  url,
  outputMuted = false,
  phase: forcedPhase,
}: {
  continuous?: boolean;
  label?: string;
  serviceDate: string;
  url: string;
  outputMuted?: boolean;
  phase?: "waiting" | "montage" | "countdown" | "complete" | null;
}) {
  const videoId = extractYouTubeId(url);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const [muted, setMuted] = useState(Boolean(videoId));
  const [now, setNow] = useState(Date.now());
  const phase = forcedPhase ?? preServicePhaseAt(serviceDate, now);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  if (!continuous && phase !== "montage" && phase !== "countdown") {
    return null;
  }

  if (!videoId) {
    return (
      <div className="pre-service-music-control">
        <span>{label}</span>
        <audio autoPlay controls loop muted={outputMuted} src={url} />
      </div>
    );
  }

  function enableSound() {
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "unMute", args: [] }), "*");
    frameRef.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func: "playVideo", args: [] }), "*");
    setMuted(false);
  }

  return (
    <div className="pre-service-music-control">
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
