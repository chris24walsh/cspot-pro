import { useState, type CSSProperties, type ReactNode } from "react";
import type { BroadcastCameraSource } from "../api";

export function CameraFraming({ source, children, startedAt }: {
  source: BroadcastCameraSource;
  children: ReactNode;
  startedAt?: string | null;
}) {
  const [mountedAt] = useState(Date.now);
  const anchor = startedAt ? Date.parse(startedAt) : 0;
  const x = source.crop_x ?? 50;
  const y = source.crop_y ?? 50;
  const style = {
    transform: `scale(${source.digital_pan ? Math.max(1.25, source.zoom ?? 1) : source.zoom ?? 1})`,
    transformOrigin: `${x}% ${y}%`,
    "--pan-from": `${Math.max(0, x - 25)}% ${y}%`,
    "--pan-to": `${Math.min(100, x + 25)}% ${y}%`,
    animationDelay: `-${((mountedAt - (Number.isFinite(anchor) ? anchor : 0)) / 1000) % 60}s`,
  } as CSSProperties;
  return <div className={`broadcast-camera-crop ${source.digital_pan ? "has-digital-pan" : ""}`} style={style}>{children}</div>;
}
