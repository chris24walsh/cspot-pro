import { useEffect, useState } from "react";

function serviceDayTimestamp(serviceDate: string, hour: number, minute: number) {
  const date = new Date(serviceDate);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();
}

function countdownLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function preServicePhaseAt(serviceDate: string, now: number) {
  const montageStart = serviceDayTimestamp(serviceDate, 10, 30);
  const countdownStart = serviceDayTimestamp(serviceDate, 10, 55);
  const serviceStart = serviceDayTimestamp(serviceDate, 11, 0);
  if (now < montageStart) return "waiting" as const;
  if (now < countdownStart) return "montage" as const;
  if (now < serviceStart) return "countdown" as const;
  return "complete" as const;
}

export function PreServiceSlide({
  backgroundImageUrl,
  imageUrls,
  serviceDate,
  timed = true,
  phase: forcedPhase,
  phaseStartedAt,
}: {
  backgroundImageUrl: string;
  imageUrls: string[];
  serviceDate: string;
  timed?: boolean;
  phase?: "waiting" | "montage" | "countdown" | "complete" | null;
  phaseStartedAt?: number;
}) {
  const [now, setNow] = useState(Date.now());
  const images = imageUrls.filter(Boolean);
  const phase = forcedPhase ?? (timed ? preServicePhaseAt(serviceDate, now) : "montage");
  const montageImageIndex = Math.floor(now / 12_000) % Math.max(images.length, 1);
  const remaining = Math.max(0, Math.ceil(
    forcedPhase && phaseStartedAt
      ? (forcedPhase === "countdown" ? 300 : 1800) - (now - phaseStartedAt) / 1000
      : (serviceDayTimestamp(serviceDate, 11, 0) - now) / 1000,
  ));
  const displayPhase = phase === "countdown" && remaining === 0 ? "complete" : phase;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`pre-service-slide is-${displayPhase}`}
      style={backgroundImageUrl ? { backgroundImage: `url(${backgroundImageUrl})` } : undefined}
    >
      {images.map((imageUrl, index) => (
        <div
          className={`pre-service-photo-layer ${index === montageImageIndex ? "is-active" : ""}`}
          key={`${imageUrl}:${index}`}
          style={{ backgroundImage: `url(${imageUrl})` }}
        />
      ))}
      {displayPhase === "montage" ? (
        <div className="pre-service-montage-clock">
          <span>Service starts in</span>
          <strong>{countdownLabel(remaining)}</strong>
        </div>
      ) : null}
      {displayPhase === "countdown" || displayPhase === "complete" ? <div className="pre-service-shade" /> : null}
      {displayPhase === "countdown" || displayPhase === "complete" ? (
        <div className="pre-service-countdown" aria-live="off">
          {displayPhase === "countdown" ? (
            <>
              <span>Service begins in</span>
              <strong>{countdownLabel(remaining)}</strong>
            </>
          ) : <strong className="pre-service-seated-message">Please be seated</strong>}
        </div>
      ) : null}
    </div>
  );
}
