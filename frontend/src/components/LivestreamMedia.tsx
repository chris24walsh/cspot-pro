import { useEffect, useMemo, useRef, useState } from "react";

import { LIVE_EDGE_TARGET_SECONDS } from "../liveAudioMse";
import type { PresentationLiveState } from "../presentation";

const FADE_STOP_DURATION_MS = 2000;

type LivestreamMediaProps = {
  action: PresentationLiveState["videoAction"];
  actionAt?: number;
  provider: "youtube" | "file";
  title: string;
  url: string;
};

function youtubeViewerUrl(value: string) {
  try {
    const url = new URL(value);
    url.searchParams.set("controls", "0");
    url.searchParams.set("disablekb", "1");
    url.searchParams.set("enablejsapi", "1");
    url.searchParams.set("fs", "0");
    url.searchParams.set("mute", "1");
    url.searchParams.set("playsinline", "1");
    return url.toString();
  } catch {
    return value;
  }
}

function postYouTubeCommand(frame: HTMLIFrameElement | null, command: string, args: unknown[] = []) {
  frame?.contentWindow?.postMessage(
    JSON.stringify({ event: "command", func: command, args }),
    "*",
  );
}

type PlaybackTimeline = {
  action: NonNullable<PresentationLiveState["videoAction"]>;
  actionAt: number;
  positionAtAction: number;
  url: string;
};

function projectedPosition(timeline: PlaybackTimeline, at: number) {
  if (timeline.action !== "play") return timeline.positionAtAction;
  return timeline.positionAtAction + Math.max(0, at - timeline.actionAt) / 1000;
}

function updatePlaybackTimeline(
  current: PlaybackTimeline | null,
  action: NonNullable<PresentationLiveState["videoAction"]>,
  actionAt: number,
  url: string,
) {
  if (current?.url === url && current.action === action && current.actionAt === actionAt) return current;

  let positionAtAction = 0;
  if (current?.url === url && current.action !== "stop" && current.action !== "fade-stop") {
    positionAtAction = projectedPosition(current, actionAt);
  }
  if (action === "stop") positionAtAction = 0;

  return { action, actionAt, positionAtAction, url };
}

function playTarget(timeline: PlaybackTimeline, now: number) {
  return timeline.positionAtAction
    + Math.max(0, (now - timeline.actionAt) / 1000 - LIVE_EDGE_TARGET_SECONDS);
}

function fadeStopRemainingMs(actionAt: number | undefined, now: number) {
  if (!actionAt) return FADE_STOP_DURATION_MS;
  return Math.max(0, actionAt + FADE_STOP_DURATION_MS + LIVE_EDGE_TARGET_SECONDS * 1000 - now);
}

function seekFileVideo(video: HTMLVideoElement, position: number) {
  try {
    video.currentTime = position;
  } catch {
    // loadedmetadata will retry the current action once seeking is available.
  }
}

/**
 * A visual-only follower for media shown on the public livestream page.
 * Program sound comes from the selected broadcast route, so this player must
 * stay muted and must not offer independent controls that can drift from it.
 */
export function LivestreamMedia({ action, actionAt, provider, title, url }: LivestreamMediaProps) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const frameReadyRetryRef = useRef<number | undefined>(undefined);
  const playbackTimelineRef = useRef<PlaybackTimeline | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [playerReadyVersion, setPlayerReadyVersion] = useState(0);
  const viewerUrl = useMemo(() => provider === "youtube" ? youtubeViewerUrl(url) : url, [provider, url]);

  useEffect(() => () => {
    if (frameReadyRetryRef.current !== undefined) window.clearTimeout(frameReadyRetryRef.current);
  }, [viewerUrl]);

  useEffect(() => {
    let fadeStopTimer: number | undefined;
    const timeline = action && actionAt
      ? updatePlaybackTimeline(playbackTimelineRef.current, action, actionAt, viewerUrl)
      : null;
    if (timeline) playbackTimelineRef.current = timeline;

    if (provider === "file") {
      const video = videoRef.current;
      if (!video) return undefined;
      video.muted = true;
      video.defaultMuted = true;

      if (action === "play") {
        if (timeline) seekFileVideo(video, playTarget(timeline, Date.now()));
        void video.play().catch(() => undefined);
      } else if (action === "pause") {
        if (timeline) seekFileVideo(video, timeline.positionAtAction);
        video.pause();
      } else if (action === "stop") {
        video.pause();
        seekFileVideo(video, 0);
      } else if (action === "fade-stop") {
        if (timeline) seekFileVideo(video, playTarget(timeline, Date.now()));
        fadeStopTimer = window.setTimeout(() => {
          video.pause();
          seekFileVideo(video, 0);
        }, fadeStopRemainingMs(actionAt, Date.now()));
      }
    } else {
      // Muting before play also lets browsers honor the remote autoplay command.
      postYouTubeCommand(frameRef.current, "mute");
      if (action === "play") {
        if (timeline) postYouTubeCommand(frameRef.current, "seekTo", [playTarget(timeline, Date.now()), true]);
        postYouTubeCommand(frameRef.current, "playVideo");
      } else if (action === "pause") {
        if (timeline) postYouTubeCommand(frameRef.current, "seekTo", [timeline.positionAtAction, true]);
        postYouTubeCommand(frameRef.current, "pauseVideo");
      } else if (action === "stop") {
        postYouTubeCommand(frameRef.current, "stopVideo");
      } else if (action === "fade-stop") {
        if (timeline) postYouTubeCommand(frameRef.current, "seekTo", [playTarget(timeline, Date.now()), true]);
        fadeStopTimer = window.setTimeout(() => {
          postYouTubeCommand(frameRef.current, "pauseVideo");
        }, fadeStopRemainingMs(actionAt, Date.now()));
      }
    }

    return () => {
      if (fadeStopTimer !== undefined) window.clearTimeout(fadeStopTimer);
    };
  }, [action, actionAt, playerReadyVersion, provider, viewerUrl]);

  if (provider === "file") {
    return (
      <video
        aria-label={`${title} livestream video`}
        controls={false}
        muted
        onLoadedMetadata={() => setPlayerReadyVersion((current) => current + 1)}
        playsInline
        preload="auto"
        ref={videoRef}
        src={viewerUrl}
        style={{ pointerEvents: "none" }}
      />
    );
  }

  return (
    <iframe
      allow="autoplay; encrypted-media; picture-in-picture"
      aria-label={`${title} livestream video`}
      onLoad={() => {
        frameRef.current?.contentWindow?.postMessage(
          JSON.stringify({ event: "listening", id: "livestream-media" }),
          "*",
        );
        setPlayerReadyVersion((current) => current + 1);
        if (frameReadyRetryRef.current !== undefined) window.clearTimeout(frameReadyRetryRef.current);
        // YouTube's document load can precede the JS player becoming ready.
        frameReadyRetryRef.current = window.setTimeout(() => {
          setPlayerReadyVersion((current) => current + 1);
        }, 350);
      }}
      ref={frameRef}
      src={viewerUrl}
      style={{ pointerEvents: "none" }}
      tabIndex={-1}
      title={title}
    />
  );
}
