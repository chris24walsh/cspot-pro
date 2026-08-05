import type { BroadcastCameraSource } from "./api";

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
) {
  if (!sources.length) return null;
  const configuredIndex = Math.max(0, sources.findIndex((source) => source.id === configuredId));
  if (cycleSeconds <= 0 || sources.length < 2 || !cycleStartedAt) return sources[configuredIndex].id;
  const startedAtMs = new Date(cycleStartedAt).getTime();
  if (!Number.isFinite(startedAtMs) || nowMs <= startedAtMs) return sources[configuredIndex].id;
  const steps = Math.floor((nowMs - startedAtMs) / (cycleSeconds * 1000));
  return sources[(configuredIndex + steps) % sources.length].id;
}
