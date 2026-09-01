import { RefreshCw, Volume2, VolumeX } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { go2RtcWebSocketUrl } from "../broadcastCamera";
import { LIVE_AUDIO_MSE_MIME, liveAudioEdgeCorrection, liveEdgeCorrection } from "../liveAudioMse";
import { HttpLiveAudioMse } from "./HttpLiveAudioMse";

type StreamStatus = "connecting" | "live" | "recovering" | "unavailable";

const MSE_CODECS = [
  "avc1.640029",
  "avc1.64002A",
  "avc1.640033",
  "hvc1.1.6.L153.B0",
  "mp4a.40.2",
  "mp4a.40.5",
  "flac",
  "opus",
];

function cameraKind(url: string) {
  const lower = url.toLowerCase();
  if (/\.(mjpg|mjpeg)(?:[?#]|$)/.test(lower) || lower.includes("mjpeg") || lower.includes("mjpg")) return "mjpeg";
  if (/\.(mp4|webm|ogg|m3u8)(?:[?#]|$)/.test(lower)) return "video";
  return "frame";
}

function LowLatencyMseVideo({ label, onFallback, url }: { label: string; onFallback: () => void; url: string }) {
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
    let startupTimer = 0;
    let sourceBuffer: SourceBuffer | null = null;
    let mediaSource: MediaSource | null = null;
    let sourceOpen = false;
    let socketOpen = false;
    let lastDataAt = Date.now();
    const queue: ArrayBuffer[] = [];

    const fallBack = (reason: string) => {
      if (disposed) return;
      console.warn(`Camera MSE fallback (${reason})`, websocketUrl);
      disposed = true;
      socket?.close();
      onFallback();
    };

    const appendNext = () => {
      if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
      try {
        sourceBuffer.appendBuffer(queue.shift()!);
      } catch {
        fallBack("append failed");
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
        const codecs = MSE_CODECS.filter((codec) => MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)).join();
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
            fallBack("invalid response");
            return;
          }
          if (message.type === "mse" && message.value && mediaSource?.readyState === "open" && !sourceBuffer) {
            if (!MediaSource.isTypeSupported(message.value)) {
              fallBack(`unsupported codec ${message.value}`);
              return;
            }
            try {
              sourceBuffer = mediaSource.addSourceBuffer(message.value);
              sourceBuffer.mode = "segments";
              sourceBuffer.addEventListener("updateend", () => {
                if (!sourceBuffer) return;
                if (!sourceBuffer.updating && sourceBuffer.buffered.length) {
                  const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                  const bufferedStart = sourceBuffer.buffered.start(0);
                  const removeBefore = end - 3;
                  const correction = liveEdgeCorrection(video.currentTime, bufferedStart, end);
                  if (correction.currentTime !== null) video.currentTime = correction.currentTime;
                  video.playbackRate = correction.playbackRate;
                  if (removeBefore > bufferedStart + 0.25) {
                    try {
                      sourceBuffer.remove(bufferedStart, removeBefore);
                      mediaSource?.setLiveSeekableRange(removeBefore, end);
                      return;
                    } catch {
                      // A following update will retry trimming the live buffer.
                    }
                  }
                }
                if (!sourceBuffer.updating && queue.length) appendNext();
                void video.play().catch(() => undefined);
              });
            } catch {
              fallBack("source buffer rejected");
            }
          } else if (message.type === "error") {
            fallBack(message.value || "server error");
          }
          return;
        }
        lastDataAt = Date.now();
        queue.push(event.data as ArrayBuffer);
        if (queue.length > 8) queue.splice(0, queue.length - 8);
        appendNext();
      });
      socket.addEventListener("close", scheduleReconnect);
      socket.addEventListener("error", () => socket?.close());
      void video.play().catch(() => undefined);
    };

    const markLive = () => {
      window.clearTimeout(startupTimer);
      setStatus("live");
    };
    const handleVideoError = () => fallBack("video decode error");
    video.addEventListener("loadeddata", markLive);
    video.addEventListener("playing", markLive);
    video.addEventListener("error", handleVideoError);
    connect();
    startupTimer = window.setTimeout(() => fallBack("startup timeout"), 12000);
    watchdogTimer = window.setInterval(() => {
      if (Date.now() - lastDataAt > 7000 || (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA && Date.now() - lastDataAt > 4000)) {
        socket?.close();
      }
    }, 2000);

    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(startupTimer);
      window.clearInterval(watchdogTimer);
      video.removeEventListener("loadeddata", markLive);
      video.removeEventListener("playing", markLive);
      video.removeEventListener("error", handleVideoError);
      socket?.close();
      if (video.src.startsWith("blob:")) URL.revokeObjectURL(video.src);
      video.removeAttribute("src");
      video.load();
    };
  }, [onFallback, retryToken, websocketUrl]);

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
  const [failedMseUrl, setFailedMseUrl] = useState<string | null>(null);
  const fallBack = useCallback(() => setFailedMseUrl(url), [url]);
  const kind = cameraKind(url);
  if (websocketUrl && failedMseUrl !== url && typeof MediaSource !== "undefined") {
    return <LowLatencyMseVideo label={label} onFallback={fallBack} url={url} />;
  }
  if (kind === "mjpeg") return <img alt={label} className="service-broadcast-camera-media" src={url} />;
  if (kind === "video") return <ResilientVideo label={label} url={url} />;
  return <iframe allow="autoplay; fullscreen; picture-in-picture" className="service-broadcast-camera-media" src={url} title={label} />;
}

function LowLatencyMseAudio({
  label,
  onFallback,
  onSoundEnabledChange,
  preserveSoundOnPlaybackFailure,
  soundEnabled,
  url,
}: {
  label: string;
  onFallback: () => void;
  onSoundEnabledChange: (enabled: boolean) => void;
  preserveSoundOnPlaybackFailure: boolean;
  soundEnabled: boolean;
  url: string;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preserveSoundOnPlaybackFailureRef = useRef(preserveSoundOnPlaybackFailure);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const websocketUrl = go2RtcWebSocketUrl(url);
  preserveSoundOnPlaybackFailureRef.current = preserveSoundOnPlaybackFailure;

  function toggleSound() {
    const audio = audioRef.current;
    if (!audio) return;
    if (soundEnabled) {
      audio.muted = true;
      onSoundEnabledChange(false);
      return;
    }
    setPlaybackFailed(false);
    audio.muted = false;
    audio.volume = 1;
    onSoundEnabledChange(true);
    void audio.play()
      .then(() => setPlaybackFailed(false))
      .catch(() => {
        audio.muted = true;
        if (!preserveSoundOnPlaybackFailureRef.current) onSoundEnabledChange(false);
        setPlaybackFailed(true);
      });
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !websocketUrl) return undefined;
    audio.muted = !soundEnabled;
    audio.defaultMuted = !soundEnabled;
    let disposed = false;
    let fallbackTriggered = false;
    let socket: WebSocket | null = null;
    let sourceBuffer: SourceBuffer | null = null;
    let reconnectTimer = 0;
    let watchdogTimer = 0;
    let startupTimer = 0;
    let lastDataAt = Date.now();
    let objectUrl: string | null = null;
    const queue: ArrayBuffer[] = [];

    const resumePlayback = () => {
      void audio.play().catch(() => {
        if (disposed || audio.muted) return;
        audio.muted = true;
        setPlaybackFailed(true);
        if (!preserveSoundOnPlaybackFailureRef.current) onSoundEnabledChange(false);
      });
    };

    const fallBack = (reason: string) => {
      if (disposed || fallbackTriggered) return;
      fallbackTriggered = true;
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(startupTimer);
      window.clearInterval(watchdogTimer);
      console.warn(`Audio MSE fallback (${reason})`, websocketUrl);
      socket?.close();
      onFallback();
    };

    const appendNext = () => {
      if (!sourceBuffer || sourceBuffer.updating || !queue.length) return;
      try {
        sourceBuffer.appendBuffer(queue.shift()!);
      } catch {
        fallBack("append failed");
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
      const previousObjectUrl = objectUrl;
      objectUrl = URL.createObjectURL(mediaSource);
      audio.src = objectUrl;
      if (previousObjectUrl) URL.revokeObjectURL(previousObjectUrl);
      lastDataAt = Date.now();
      socket = new WebSocket(websocketUrl);
      socket.binaryType = "arraybuffer";
      const requestMse = () => {
        if (!sourceOpen || !socketOpen || !socket) return;
        const codecs = ["mp4a.40.2", "mp4a.40.5", "flac", "opus"]
          .filter((codec) => MediaSource.isTypeSupported(`video/mp4; codecs="${codec}"`)).join();
        if (!codecs) {
          fallBack("no supported audio codec");
          return;
        }
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
            fallBack("invalid response");
            return;
          }
          if (message.type === "mse" && message.value && mediaSource.readyState === "open" && !sourceBuffer) {
            if (!MediaSource.isTypeSupported(message.value)) {
              fallBack(`unsupported codec ${message.value}`);
              return;
            }
            try {
              sourceBuffer = mediaSource.addSourceBuffer(message.value);
              sourceBuffer.mode = "segments";
              sourceBuffer.addEventListener("updateend", () => {
                if (sourceBuffer?.buffered.length) {
                  const end = sourceBuffer.buffered.end(sourceBuffer.buffered.length - 1);
                  const start = sourceBuffer.buffered.start(0);
                  const correction = liveAudioEdgeCorrection(audio.currentTime, start, end);
                  if (correction.currentTime !== null) audio.currentTime = correction.currentTime;
                  audio.playbackRate = correction.playbackRate;
                  if (end - start > 3.25 && !sourceBuffer.updating) {
                    try {
                      sourceBuffer.remove(start, end - 3);
                      return;
                    } catch {
                      // A following update will retry trimming the live buffer.
                    }
                  }
                }
                appendNext();
                resumePlayback();
              });
              appendNext();
            } catch {
              fallBack("source buffer rejected");
            }
          } else if (message.type === "error") {
            fallBack(message.value || "server error");
          }
          return;
        }
        lastDataAt = Date.now();
        queue.push(event.data as ArrayBuffer);
        if (queue.length > 8) queue.splice(0, queue.length - 8);
        appendNext();
      });
      socket.addEventListener("close", () => {
        if (!disposed && !reconnectTimer) reconnectTimer = window.setTimeout(connect, 1500);
      });
      socket.addEventListener("error", () => socket?.close());
      resumePlayback();
    };

    const markReady = () => window.clearTimeout(startupTimer);
    const handleMediaError = () => fallBack("audio decode error");
    audio.addEventListener("loadeddata", markReady);
    audio.addEventListener("playing", markReady);
    audio.addEventListener("error", handleMediaError);
    connect();
    startupTimer = window.setTimeout(() => fallBack("startup timeout"), 12000);
    watchdogTimer = window.setInterval(() => {
      if (Date.now() - lastDataAt > 7000) socket?.close();
    }, 2000);
    return () => {
      disposed = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(startupTimer);
      window.clearInterval(watchdogTimer);
      audio.removeEventListener("loadeddata", markReady);
      audio.removeEventListener("playing", markReady);
      audio.removeEventListener("error", handleMediaError);
      socket?.close();
      audio.removeAttribute("src");
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [onFallback, onSoundEnabledChange, websocketUrl]);

  return (
    <div className="service-broadcast-preservice-audio service-broadcast-live-audio">
      <audio autoPlay className="service-broadcast-audio-element" ref={audioRef} />
      <button aria-label={soundEnabled ? "Mute sound" : playbackFailed ? "Retry sound" : "Turn on sound"} aria-pressed={soundEnabled} className={`service-broadcast-sound-button ${soundEnabled ? "is-enabled" : ""}`} onClick={toggleSound} title={soundEnabled ? `Mute ${label}` : playbackFailed ? "Retry sound" : `Turn on ${label}`} type="button">
        <span className="service-broadcast-sound-button-face">
          {soundEnabled ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          <span className="service-broadcast-sound-button-label">{soundEnabled ? "Mute sound" : playbackFailed ? "Retry sound" : "Turn on sound"}</span>
        </span>
      </button>
    </div>
  );
}

function FallbackLiveStreamAudio({ label, onSoundEnabledChange, preserveSoundOnPlaybackFailure, soundEnabled, url }: { label: string; onSoundEnabledChange: (enabled: boolean) => void; preserveSoundOnPlaybackFailure: boolean; soundEnabled: boolean; url: string }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const preserveSoundOnPlaybackFailureRef = useRef(preserveSoundOnPlaybackFailure);
  const soundEnabledRef = useRef(soundEnabled);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const isHls = url.toLowerCase().includes(".m3u8");
  soundEnabledRef.current = soundEnabled;
  preserveSoundOnPlaybackFailureRef.current = preserveSoundOnPlaybackFailure;

  function toggleSound() {
    const audio = audioRef.current;
    if (!audio) return;
    if (soundEnabled) {
      audio.muted = true;
      soundEnabledRef.current = false;
      onSoundEnabledChange(false);
      return;
    }
    setPlaybackFailed(false);
    audio.muted = false;
    audio.volume = 1;
    if (audio.error) {
      audio.load();
    }
    soundEnabledRef.current = true;
    onSoundEnabledChange(true);
    void audio.play()
      .then(() => setPlaybackFailed(false))
      .catch(() => {
        audio.muted = true;
        if (!preserveSoundOnPlaybackFailureRef.current) {
          soundEnabledRef.current = false;
          onSoundEnabledChange(false);
        }
        setPlaybackFailed(true);
        setRetryToken((current) => current + 1);
      });
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    let cancelled = false;
    let hls: InstanceType<typeof import("hls.js").default> | null = null;
    const resumeEnabledSound = () => {
      if (!soundEnabledRef.current || cancelled) return;
      audio.muted = false;
      audio.volume = 1;
      void audio.play()
        .then(() => setPlaybackFailed(false))
        .catch(() => {
          audio.muted = true;
          setPlaybackFailed(true);
          if (!preserveSoundOnPlaybackFailureRef.current) {
            soundEnabledRef.current = false;
            onSoundEnabledChange(false);
          }
        });
    };
    const handlePlaybackError = () => {
      audio.muted = true;
      setPlaybackFailed(true);
      if (!preserveSoundOnPlaybackFailureRef.current) {
        soundEnabledRef.current = false;
        onSoundEnabledChange(false);
      }
    };
    audio.muted = !soundEnabledRef.current;
    audio.defaultMuted = !soundEnabledRef.current;
    audio.addEventListener("error", handlePlaybackError);
    audio.addEventListener("canplay", resumeEnabledSound);
    audio.addEventListener("loadeddata", resumeEnabledSound);
    if (!isHls || audio.canPlayType("application/vnd.apple.mpegurl")) {
      audio.src = url;
      resumeEnabledSound();
    } else {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled || !Hls.isSupported()) return;
        hls = new Hls({ enableWorker: true, liveSyncDurationCount: 1, lowLatencyMode: true });
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
      audio.removeEventListener("error", handlePlaybackError);
      audio.removeEventListener("canplay", resumeEnabledSound);
      audio.removeEventListener("loadeddata", resumeEnabledSound);
      audio.removeAttribute("src");
      audio.load();
    };
  }, [isHls, onSoundEnabledChange, retryToken, url]);

  return (
    <div className="service-broadcast-preservice-audio service-broadcast-live-audio">
      <audio autoPlay className="service-broadcast-audio-element" preload="auto" ref={audioRef} />
      <button aria-label={soundEnabled ? "Mute sound" : playbackFailed ? "Retry sound" : "Turn on sound"} aria-pressed={soundEnabled} className={`service-broadcast-sound-button ${soundEnabled ? "is-enabled" : ""}`} onClick={toggleSound} title={soundEnabled ? `Mute ${label}` : playbackFailed ? "Retry sound" : `Turn on ${label}`} type="button">
        <span className="service-broadcast-sound-button-face">
          {soundEnabled ? <VolumeX size={16} aria-hidden="true" /> : <Volume2 size={16} aria-hidden="true" />}
          <span className="service-broadcast-sound-button-label">{soundEnabled ? "Mute sound" : playbackFailed ? "Retry sound" : "Turn on sound"}</span>
        </span>
      </button>
    </div>
  );
}

export function LiveStreamAudio({
  label,
  onSoundEnabledChange,
  preserveSoundOnPlaybackFailure = false,
  soundEnabled: controlledSoundEnabled,
  url,
}: {
  label: string;
  onSoundEnabledChange?: (enabled: boolean) => void;
  preserveSoundOnPlaybackFailure?: boolean;
  soundEnabled?: boolean;
  url: string;
}) {
  const [failedMseUrl, setFailedMseUrl] = useState<string | null>(null);
  const [internalSoundEnabled, setInternalSoundEnabled] = useState(false);
  const onSoundEnabledChangeRef = useRef(onSoundEnabledChange);
  onSoundEnabledChangeRef.current = onSoundEnabledChange;
  const soundEnabled = controlledSoundEnabled ?? internalSoundEnabled;
  const fallBack = useCallback(() => setFailedMseUrl(url), [url]);
  const changeSoundEnabled = useCallback((enabled: boolean) => {
    setInternalSoundEnabled(enabled);
    onSoundEnabledChangeRef.current?.(enabled);
  }, []);
  const isHttpMseUrl = /\/live-audio\.mp4(?:[?#]|$)/.test(url);
  const fallbackUrl = isHttpMseUrl
    ? url.replace(/\/live-audio\.mp4(?=[?#]|$)/, "/live-audio")
    : url;
  const httpMseSupported = (
    typeof MediaSource !== "undefined"
    && typeof MediaSource.isTypeSupported === "function"
    && MediaSource.isTypeSupported(LIVE_AUDIO_MSE_MIME)
  );
  const activeUrl = failedMseUrl === url || (isHttpMseUrl && !httpMseSupported) ? fallbackUrl : url;
  const websocketUrl = useMemo(() => go2RtcWebSocketUrl(activeUrl), [activeUrl]);
  if (
    isHttpMseUrl
    && failedMseUrl !== url
    && httpMseSupported
  ) {
    return <HttpLiveAudioMse label={label} onFallback={fallBack} onSoundEnabledChange={changeSoundEnabled} preserveSoundOnPlaybackFailure={preserveSoundOnPlaybackFailure} soundEnabled={soundEnabled} url={url} />;
  }
  if (websocketUrl && failedMseUrl !== url && typeof MediaSource !== "undefined") {
    return <LowLatencyMseAudio label={label} onFallback={fallBack} onSoundEnabledChange={changeSoundEnabled} preserveSoundOnPlaybackFailure={preserveSoundOnPlaybackFailure} soundEnabled={soundEnabled} url={activeUrl} />;
  }
  return <FallbackLiveStreamAudio label={label} onSoundEnabledChange={changeSoundEnabled} preserveSoundOnPlaybackFailure={preserveSoundOnPlaybackFailure} soundEnabled={soundEnabled} url={activeUrl} />;
}
