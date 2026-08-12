import type { BroadcastCameraSource } from "./api";
import { appAssetUrl } from "./paths";

export type CameraServicePhase = "general" | "worship" | "prayer" | "sermon" | "announcements";

const CAMERA_PATTERN_REPETITIONS = 16;

const CAMERA_DWELL_WEIGHTS: Record<CameraServicePhase, { lectern: number; other: number }> = {
  general: { lectern: 1.3, other: 0.9 },
  worship: { lectern: 1.15, other: 0.9 },
  prayer: { lectern: 1.4, other: 0.85 },
  sermon: { lectern: 1.8, other: 0.7 },
  announcements: { lectern: 1.55, other: 0.8 },
};

function hashSeed(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnit(seed: number) {
  let value = seed + 0x6d2b79f5;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}

function isLecternCamera(source: BroadcastCameraSource) {
  return /(?:^|[\s_-])(lectern|pulpit)(?:$|[\s_-])/i.test(`${source.id} ${source.label}`);
}

function cameraDwellMs(
  source: BroadcastCameraSource,
  baseSeconds: number,
  phase: CameraServicePhase,
  seed: string,
) {
  const weights = CAMERA_DWELL_WEIGHTS[phase];
  const weight = isLecternCamera(source) ? weights.lectern : weights.other;
  // Keep the variation subtle: the camera/phase weighting should remain more
  // noticeable than the random pacing.
  const jitter = 0.85 + seededUnit(hashSeed(seed)) * 0.3;
  return Math.max(1000, Math.round(baseSeconds * weight * jitter * 1000));
}

export function cameraServicePhase(itemType?: string | null, title?: string | null): CameraServicePhase {
  const normalizedType = itemType?.trim().toLowerCase() ?? "";
  const normalizedTitle = title?.trim().toLowerCase() ?? "";

  if (normalizedType === "song") return "worship";
  if (normalizedType === "prayer") return "prayer";
  if (normalizedType === "sermon") return "sermon";
  if (normalizedType === "announcement" || normalizedType === "announcements") return "announcements";
  if (/\b(prayer|intercession)\b/.test(normalizedTitle)) return "prayer";
  if (/\b(announcements?|notices?)\b/.test(normalizedTitle)) return "announcements";
  if (/\b(sermon|message|teaching)\b/.test(normalizedTitle)) return "sermon";
  if (/\b(worship|praise)\b/.test(normalizedTitle)) return "worship";
  return "general";
}

function parsedCameraUrl(url: string) {
  const browserOrigin = typeof window === "undefined" ? null : window.location.origin;
  const base = !browserOrigin || browserOrigin === "null" ? "http://localhost" : browserOrigin;
  return new URL(url, base);
}

export function go2RtcSourceName(url: string): string | null {
  try {
    const parsed = parsedCameraUrl(url);
    if (!parsed.pathname.endsWith("/api/stream.m3u8")) return null;
    return parsed.searchParams.get("src") || null;
  } catch {
    return null;
  }
}

export function go2RtcWebSocketUrl(url: string): string | null {
  const source = go2RtcSourceName(url);
  if (!source) return null;
  const parsed = parsedCameraUrl(url);
  parsed.pathname = parsed.pathname.replace(/\/api\/stream\.m3u8$/, "/api/ws");
  parsed.search = new URLSearchParams({ src: source }).toString();
  parsed.protocol = parsed.protocol === "https:" ? "wss:" : "ws:";
  return parsed.toString();
}

export function go2RtcAudioStreamUrl(streamName: string): string | null {
  const source = streamName.trim();
  if (!source) return null;
  const query = new URLSearchParams({ audio: "aac", src: source });
  return `${appAssetUrl("camera/api/stream.m3u8")}?${query}`;
}

export function cameraAudioUrl(url: string): string {
  try {
    const parsed = parsedCameraUrl(url);
    if (!parsed.pathname.endsWith("/api/stream.m3u8")) return url;
    const source = parsed.searchParams.get("src");
    if (!source) return url;
    parsed.search = new URLSearchParams({ audio: "aac", src: source }).toString();
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return url;
  }
}

export function activeCameraIdAt(
  sources: BroadcastCameraSource[],
  configuredId: string | null,
  cycleSeconds: number,
  cycleStartedAt: string | null,
  nowMs: number,
  phase: CameraServicePhase = "general",
) {
  if (!sources.length) return null;
  const configuredIndex = Math.max(0, sources.findIndex((source) => source.id === configuredId));
  if (cycleSeconds <= 0 || sources.length < 2 || !cycleStartedAt) return sources[configuredIndex].id;
  const startedAtMs = new Date(cycleStartedAt).getTime();
  if (!Number.isFinite(startedAtMs) || nowMs <= startedAtMs) return sources[configuredIndex].id;

  // Generate a short deterministic pattern and repeat it. This avoids walking
  // every historical camera change when automation has been enabled for days,
  // while keeping independently connected viewers on the same source.
  const timeline = Array.from({ length: sources.length * CAMERA_PATTERN_REPETITIONS }, (_, step) => {
    const source = sources[(configuredIndex + step) % sources.length];
    return {
      source,
      durationMs: cameraDwellMs(
        source,
        cycleSeconds,
        phase,
        `${cycleStartedAt}:${phase}:${step}:${source.id}`,
      ),
    };
  });
  const patternDurationMs = timeline.reduce((total, entry) => total + entry.durationMs, 0);
  let positionMs = (nowMs - startedAtMs) % patternDurationMs;
  for (const entry of timeline) {
    if (positionMs < entry.durationMs) return entry.source.id;
    positionMs -= entry.durationMs;
  }
  return sources[configuredIndex].id;
}
