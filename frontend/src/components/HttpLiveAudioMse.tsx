import { Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  BoundedFmp4SegmentQueue,
  FragmentedMp4Parser,
  LIVE_AUDIO_MSE_MIME,
  liveAudioEdgeCorrection,
} from "../liveAudioMse";

interface HttpLiveAudioMseProps {
  label: string;
  onFallback: () => void;
  onSoundEnabledChange: (enabled: boolean) => void;
  preserveSoundOnPlaybackFailure: boolean;
  soundEnabled: boolean;
  url: string;
}

function bufferSource(data: Uint8Array) {
  return data.slice().buffer as ArrayBuffer;
}

function sourceBufferOperation(sourceBuffer: SourceBuffer, operation: () => void) {
  return new Promise<void>((resolve, reject) => {
    const cleanUp = () => {
      sourceBuffer.removeEventListener("updateend", completed);
      sourceBuffer.removeEventListener("error", failed);
      sourceBuffer.removeEventListener("abort", failed);
    };
    const completed = () => {
      cleanUp();
      resolve();
    };
    const failed = () => {
      cleanUp();
      reject(new Error("MediaSource rejected live audio data"));
    };
    sourceBuffer.addEventListener("updateend", completed, { once: true });
    sourceBuffer.addEventListener("error", failed, { once: true });
    sourceBuffer.addEventListener("abort", failed, { once: true });
    try {
      operation();
    } catch (error) {
      cleanUp();
      reject(error);
    }
  });
}

export function HttpLiveAudioMse({
  label,
  onFallback,
  onSoundEnabledChange,
  preserveSoundOnPlaybackFailure,
  soundEnabled,
  url,
}: HttpLiveAudioMseProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const soundEnabledRef = useRef(soundEnabled);
  const preserveSoundRef = useRef(preserveSoundOnPlaybackFailure);
  const onSoundEnabledChangeRef = useRef(onSoundEnabledChange);
  const [playbackFailed, setPlaybackFailed] = useState(false);
  soundEnabledRef.current = soundEnabled;
  preserveSoundRef.current = preserveSoundOnPlaybackFailure;
  onSoundEnabledChangeRef.current = onSoundEnabledChange;

  const handlePlaybackFailure = () => {
    const audio = audioRef.current;
    if (audio) audio.muted = true;
    setPlaybackFailed(true);
    if (!preserveSoundRef.current) {
      soundEnabledRef.current = false;
      onSoundEnabledChangeRef.current(false);
    }
  };

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
    soundEnabledRef.current = true;
    onSoundEnabledChange(true);
    void audio.play().catch(handlePlaybackFailure);
  }

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    audio.muted = !soundEnabled;
    audio.defaultMuted = !soundEnabled;
    if (soundEnabled) void audio.play().catch(handlePlaybackFailure);
    return undefined;
  }, [soundEnabled]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    let disposed = false;
    let fallbackTriggered = false;
    let sourceBuffer: SourceBuffer | null = null;
    let objectUrl: string | null = null;
    let startupTimer = 0;
    let watchdogTimer = 0;
    let lastDataAt = Date.now();
    let draining = false;
    const abortController = new AbortController();
    const parser = new FragmentedMp4Parser();
    const queue = new BoundedFmp4SegmentQueue(4);
    const mediaSource = new MediaSource();

    const fallBack = (reason: string) => {
      if (disposed || fallbackTriggered) return;
      fallbackTriggered = true;
      disposed = true;
      abortController.abort();
      window.clearTimeout(startupTimer);
      window.clearInterval(watchdogTimer);
      console.warn(`HTTP audio MSE fallback (${reason})`, url);
      onFallback();
    };

    const resumePlayback = () => {
      void audio.play()
        .then(() => {
          window.clearTimeout(startupTimer);
          setPlaybackFailed(false);
        })
        .catch(() => {
          if (!audio.muted) handlePlaybackFailure();
        });
    };

    const correctLiveEdge = async () => {
      if (!sourceBuffer?.buffered.length || sourceBuffer.updating) return;
      const lastRange = sourceBuffer.buffered.length - 1;
      const start = sourceBuffer.buffered.start(lastRange);
      const end = sourceBuffer.buffered.end(lastRange);
      const correction = liveAudioEdgeCorrection(audio.currentTime, start, end);
      if (correction.currentTime !== null) audio.currentTime = correction.currentTime;
      audio.playbackRate = correction.playbackRate;
      try {
        mediaSource.setLiveSeekableRange(Math.max(start, end - 3), end);
      } catch {
        // Older MSE implementations do not expose a mutable live range.
      }

      const firstStart = sourceBuffer.buffered.start(0);
      const removeBefore = end - 3;
      if (removeBefore > firstStart + 0.25) {
        await sourceBufferOperation(sourceBuffer, () => sourceBuffer?.remove(firstStart, removeBefore));
      }
    };

    const drain = async () => {
      if (draining || !sourceBuffer || disposed) return;
      draining = true;
      try {
        let segment = queue.take();
        while (segment && !disposed && sourceBuffer) {
          const activeBuffer = sourceBuffer;
          await sourceBufferOperation(activeBuffer, () => activeBuffer.appendBuffer(bufferSource(segment!.data)));
          await correctLiveEdge();
          resumePlayback();
          segment = queue.take();
        }
      } catch {
        fallBack("append failed");
      } finally {
        draining = false;
        if (!disposed && queue.length) void drain();
      }
    };

    const readStream = async () => {
      try {
        const response = await fetch(url, {
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "audio/mp4" },
          signal: abortController.signal,
        });
        if (!response.ok || !response.body) {
          fallBack(`HTTP ${response.status}`);
          return;
        }
        const reader = response.body.getReader();
        while (!disposed) {
          const { done, value } = await reader.read();
          if (done) {
            fallBack("stream ended");
            return;
          }
          if (!value?.byteLength) continue;
          lastDataAt = Date.now();
          for (const segment of parser.push(value)) queue.enqueue(segment);
          void drain();
          if (queue.length >= 4) {
            await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
          }
        }
      } catch (error) {
        if (!disposed && !(error instanceof DOMException && error.name === "AbortError")) {
          fallBack("request failed");
        }
      }
    };

    mediaSource.addEventListener("sourceopen", () => {
      if (disposed) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(LIVE_AUDIO_MSE_MIME);
        sourceBuffer.mode = "segments";
        void readStream();
      } catch {
        fallBack("source buffer rejected");
      }
    }, { once: true });
    objectUrl = URL.createObjectURL(mediaSource);
    audio.src = objectUrl;
    startupTimer = window.setTimeout(() => fallBack("startup timeout"), 12000);
    watchdogTimer = window.setInterval(() => {
      if (Date.now() - lastDataAt > 7000) fallBack("stream stalled");
    }, 2000);
    resumePlayback();

    return () => {
      disposed = true;
      abortController.abort();
      window.clearTimeout(startupTimer);
      window.clearInterval(watchdogTimer);
      if (sourceBuffer?.updating) {
        try {
          sourceBuffer.abort();
        } catch {
          // The MediaSource may already have detached during fallback.
        }
      }
      audio.removeAttribute("src");
      audio.load();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [onFallback, url]);

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
