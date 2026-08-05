import { RefreshCw, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { go2RtcWebSocketUrl } from "../broadcastCamera";

type StreamStatus = "connecting" | "live" | "recovering" | "unavailable";

const VIDEO_CODECS = ["avc1.640029", "avc1.64002A", "avc1.640033", "hvc1.1.6.L153.B0"];

function cameraKind(url: string) {
  const lower = url.toLowerCase();
  if (/\.(mjpg|mjpeg)(?:[?#]|$)/.test(lower) || lower.includes("mjpeg") || lower.includes("mjpg")) return "mjpeg";
  if (/\.(mp4|webm|ogg|m3u8)(?:[?#]|$)/.test(lower)) return "video";
  return "frame";
}

function LowLatencyMseVideo({ label, url }: { label: string; url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const websocketUrl = go2RtcWebSocketUrl(url);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !websocketUrl) return undefined;
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let watchdogTimer = 0;
    let sourceBuffer: SourceBuffer | null = null;
    let mediaSource: MediaSource | null = null;
    let sourceOpen = false;
    let socketOpen = false;
    let lastDataAt = Date.now();
    const queue: ArrayBuffer[] = [];

    const appendNext = () => {
      if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
      try {
        sourceBuffer.appendBuffer(queue.shift()!);
      } catch {
        socket?.close();
      }
    };

    const scheduleReconnect = () => {
      if (disposed || reconnectTimer) return;
      setStatus("recovering");
      reconnectTimer = window.setTimeout(connect, 1500);
    };

    const connect = () => {
      if (disposed) return;
      reconnectTimer = 0;
      setStatus((current) => current === "connecting" ? current : "recovering");
      queue.length = 0;
      sourceBuffer = null;
      mediaSource = new MediaSource();
      sourceOpen = false;
      socketOpen = false;
      video.srcObject = null;
      video.src = URL.createObjectURL(mediaSource);
      video.muted = true;
      video.defaultMuted = true;
      video.autoplay = true;
      video.playsInline = true;
      lastDataAt = Date.now();
      socket = new WebSocket(websocketUrl);
      socket.binaryType = "arraybuffer";

      const requestMse = () => {
        if (!sourceOpen || !socketOpen || !socket) return;
        const codecs = VIDEO_CODECS.filter((codec) => MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)).join();
        socket.send(JSON.stringify({ type: "mse", value: codecs }));
      };
      mediaSource.addEventListener("sourceopen", () => {
        sourceOpen = true;
        requestMse();
      }, { once: true });
      socket.addEventListener("open", () => {
        socketOpen = true;
        requestMse();
      });

      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          let message: { type?: string; value?: string };
          try {
            message = JSON.parse(event.data) as { type?: string; value?: string };
          } catch {
            socket?.close();
            return;
          }
          if (message.type === "mse" && message.value && mediaSource?.readyState === "open" && !sourceBuffer) {
            try {
              sourceBuffer = mediaSource.addSourceBuffer(message.value);
              sourceBuffer.mode = "segments";
              sourceBuffer.addEventListener("updateend", () => {
                if (!sourceBuffer) return;
                if (sourceBuffer.buffered.length) {
                  const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                  const start = sourceBuffer.buffered.start(0);
                  if (end - start > 4 && !sourceBuffer.updating) {
                    try {
                      sourceBuffer.remove(start, end - 3);
                    } catch {
                      // A following update will retry trimming the live buffer.
                    }
                  }
                  if (end - video.currentTime > 0.8) video.currentTime = Math.max(0, end - 0.12);
                }
                appendNext();
              });
            } catch {
              socket?.close();
            }
          } else if (message.type === "error") {
            socket?.close();
          }
          return;
        }
        lastDataAt = Date.now();
        queue.push(event.data as ArrayBuffer);
        appendNext();
      });
      socket.addEventListener("close", scheduleReconnect);
      socket.addEventListener("error", () => socket?.close());
      void video.play().catch(() => undefined);
    };

    const markLive = () => setStatus("live");
    const handleVideoError = () => socket?.close();
    video.addEventListener("playing", markLive);
    video.addEventListener("error", handleVideoError);
    connect();
    watchdogTimer = window.setInterval(() => {
      if (Date.now() - lastDataAt > 7000 || (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && Date.now() - lastDataAt > 4000)) {
        socket?.close();
      }
    }, 2000);

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(watchdogTimer);
      video.removeEventListener("playing", markLive);
      video.removeEventListener("error", handleVideoError);
      socket?.close();
      if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src);
      video.removeAttribute("src");
      video.load();
    };
  }, [retryToken, websocketUrl]);

  return (
    <div className="service-broadcast-camera-player">
      <video aria-label={label} autoPlay className="service-broadcast-camera-media" muted playsInline ref={videoRef} />
      {status !== "live" ? (
        <button className="service-broadcast-camera-overlay" onClick={() => setRetryToken((current) => current + 1)} type="button">
          <RefreshCw size={14} aria-hidden="true" /> {status === "connecting" ? "Connecting camera…" : "Retry camera"}
        </button>
      ) : null}
    </div>
  );
}

function ResilientVideo({ label, url }: { label: string; url: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [status, setStatus] = useState<StreamStatus>("connecting");
  const isHls = url.toLowerCase().includes(".m3u8");

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    let cancelled = false;
    let hls: InstanceType<typeof import("hls.js").default> | null = null;
    let watchdog = 0;
    let lastProgressAt = Date.now();
    let lastTime = -1;
    const play = () => void video.play().catch(() => undefined);
    const markLive = () => setStatus("live");
    const markProgress = () => {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgressAt = Date.now();
      }
    };
    const handleVideoError = () => setRetryToken((current) => current + 1);
    video.muted = true;
    video.defaultMuted = true;
    if (!isHls || video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = url;
      play();
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls({
          backBufferLength: 0,
          enableWorker: true,
          liveBackBufferLength: 0,
          liveMaxLatencyDurationCount: 3,
          liveSyncDurationCount: 1,
          lowLatencyMode: true,
          maxLiveSyncPlaybackRate: 1.5,
        });
        hls.on(Hls.Events.MANIFEST_PARSED, play);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || !hls) return;
          setStatus("recovering");
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setRetryToken((current) => current + 1);
        });
        hls.loadSource(url);
        hls.attachMedia(video);
      });
    }
    video.addEventListener("playing", markLive);
    video.addEventListener("timeupdate", markProgress);
    video.addEventListener("error", handleVideoError);
    watchdog = window.setInterval(() => {
      if (!video.paused && Date.now() - lastProgressAt > 8000) setRetryToken((current) => current + 1);
    }, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(watchdog);
      video.removeEventListener("playing", markLive);
      video.removeEventListener("timeupdate", markProgress);
      video.removeEventListener("error", handleVideoError);
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
  }, [isHls, retryToken, url]);

  return (
    <div className="service-broadcast-camera-player">
      <video aria-label={label} autoPlay className="service-broadcast-camera-media" muted playsInline ref={videoRef} />
      {status !== "live" ? (
        <button className="service-broadcast-camera-overlay" onClick={() => setRetryToken((current) => current + 1)} type="button">
          <RefreshCw size={14} aria-hidden="true" /> {status === "connecting" ? "Connecting camera…" : "Retry camera"}
        </button>
      ) : null}
    </div>
  );
}

export function LowLatencyCamera({ label, url }: { label: string; url: string }) {
  const websocketUrl = useMemo(() => go2RtcWebSocketUrl(url), [url]);
  const kind = cameraKind(url);
  if (websocketUrl && typeof MediaSource !== "undefined") return <LowLatencyMseVideo label={label} url={url} />;
  if (kind === "mjpeg") return <img alt={label} className="service-broadcast-camera-media" src={url} />;
  if (kind === "video") return <ResilientVideo label={label} url={url} />;
  return <iframe allow="autoplay; fullscreen; picture-in-picture" className="service-broadcast-camera-media" src={url} title={label} />;
}

function LowLatencyMseAudio({ label, url }: { label: string; url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const websocketUrl = go2RtcWebSocketUrl(url)!;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    let disposed = false;
    let socket: WebSocket | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let reconnectTimer = 0;
    let watchdogTimer = 0;
    let lastDataAt = Date.now();
    const queue: ArrayBuffer[] = [];

    const appendNext = () => {
      if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
      try {
        sourceBuffer.appendBuffer(queue.shift()!);
      } catch {
        socket?.close();
      }
    };

    const connect = () => {
      if (disposed) return;
      reconnectTimer = 0;
      sourceBuffer = null;
      queue.length = 0;
      const mediaSource = new MediaSource();
      let sourceOpen = false;
      let socketOpen = false;
      audio.src = URL.createObjectURL(mediaSource);
      lastDataAt = Date.now();
      socket = new WebSocket(websocketUrl);
      socket.binaryType = "arraybuffer";
      const requestMse = () => {
        if (!sourceOpen || !socketOpen || !socket) return;
        const codecs = ["mp4a.40.2", "mp4a.40.5", "flac", "opus"]
          .filter((codec) => MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)).join();
        socket.send(JSON.stringify({ type: "mse", value: codecs }));
      };
      mediaSource.addEventListener("sourceopen", () => {
        sourceOpen = true;
        requestMse();
      }, { once: true });
      socket.addEventListener("open", () => {
        socketOpen = true;
        requestMse();
      });
      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") {
          let message: { type?: string; value?: string };
          try {
            message = JSON.parse(event.data) as { type?: string; value?: string };
          } catch {
            socket?.close();
            return;
          }
          if (message.type === "mse" && message.value && mediaSource.readyState === "open" && !sourceBuffer) {
            try {
              sourceBuffer = mediaSource.addSourceBuffer(message.value);
              sourceBuffer.addEventListener("updateend", () => {
                if (sourceBuffer?.buffered.length) {
                  const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                  const start = sourceBuffer.buffered.start(0);
                  if (end - start > 4 && !sourceBuffer.updating) {
                    try {
                      sourceBuffer.remove(start, end - 3);
                    } catch {
                      // A following update will retry trimming the live buffer.
                    }
                  }
                  if (end - audio.currentTime > 0.8) audio.currentTime = Math.max(0, end - 0.12);
                }
                appendNext();
                void audio.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
              });
            } catch {
              socket?.close();
            }
          } else if (message.type === "error") {
            socket?.close();
          }
          return;
        }
        lastDataAt = Date.now();
        queue.push(event.data as ArrayBuffer);
        appendNext();
      });
      socket.addEventListener("close", () => {
        if (!disposed && !reconnectTimer) reconnectTimer = window.setTimeout(connect, 1500);
      });
      socket.addEventListener("error", () => socket?.close());
      void audio.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
    };

    connect();
    watchdogTimer = window.setInterval(() => {
      if (Date.now() - lastDataAt > 7000) socket?.close();
    }, 2000);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearInterval(watchdogTimer);
      socket?.close();
      if (audio.src.startsWith("blob:")) URL.revokeObjectURL(audio.src);
      audio.removeAttribute("src");
      audio.load();
    };
  }, [retryToken, websocketUrl]);

  return (
    <div className="service-broadcast-preservice-audio service-broadcast-live-audio">
      <span>{label}</span>
      <audio autoPlay controls ref={audioRef} />
      {playbackBlocked ? (
        <button className="text-button icon-text-button" onClick={() => void audioRef.current?.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))} type="button">
          <Volume2 size={14} aria-hidden="true" /> Turn on live sound
        </button>
      ) : (
        <button aria-label="Reconnect live audio" className="section-icon-button" onClick={() => setRetryToken((current) => current + 1)} title="Reconnect live audio" type="button">
          <RefreshCw size={14} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function FallbackLiveStreamAudio({ label, url }: { label: string; url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const isHls = url.toLowerCase().includes(".m3u8");

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    let cancelled = false;
    let hls: InstanceType<typeof import("hls.js").default> | null = null;
    const play = () => void audio.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true));
    if (!isHls || audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = url;
      play();
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls({ enableWorker: true, liveSyncDurationCount: 1, lowLatencyMode: true });
        hls.on(Hls.Events.MANIFEST_PARSED, play);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (!data.fatal || !hls) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setRetryToken((current) => current + 1);
        });
        hls.loadSource(url);
        hls.attachMedia(audio);
      });
    }
    return () => {
      cancelled = true;
      hls?.destroy();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [isHls, retryToken, url]);

  return (
    <div className="service-broadcast-preservice-audio service-broadcast-live-audio">
      <span>{label}</span>
      <audio autoPlay controls ref={audioRef} />
      {playbackBlocked ? (
        <button className="text-button icon-text-button" onClick={() => void audioRef.current?.play().then(() => setPlaybackBlocked(false)).catch(() => setPlaybackBlocked(true))} type="button">
          <Volume2 size={14} aria-hidden="true" /> Turn on live sound
        </button>
      ) : null}
    </div>
  );
}

export function LiveStreamAudio({ label, url }: { label: string; url: string }) {
  const websocketUrl = go2RtcWebSocketUrl(url);
  if (websocketUrl && typeof MediaSource !== "undefined") return <LowLatencyMseAudio label={label} url={url} />;
  return <FallbackLiveStreamAudio label={label} url={url} />;
}
