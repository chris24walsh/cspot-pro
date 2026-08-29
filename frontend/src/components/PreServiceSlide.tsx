import { useEffect, useState } from "react";

function serviceDayTimestamp(serviceDate: string, hour: number, minute: number) {
  const date = new Date(serviceDate);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();
}

function countdownLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function preServiceRemainingSeconds(
  serviceDate: string,
  now: number,
  forcedPhase?: "waiting" | "montage" | "countdown" | "complete" | null,
  phaseStartedAt?: number,
) {
  if (forcedPhase === "complete") return 0;
  if (forcedPhase && phaseStartedAt) {
    const durationSeconds = forcedPhase === "countdown" ? 300 : 1800;
    return Math.max(0, Math.ceil(durationSeconds - (now - phaseStartedAt) / 1000));
  }
  return Math.max(0, Math.ceil((serviceDayTimestamp(serviceDate, 11, 0) - now) / 1000));
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
  // Ordinary section montages reuse the photo crossfade, but must not inherit
  // the global pre-service clock/countdown phase.
  const phase = timed ? (forcedPhase ?? preServicePhaseAt(serviceDate, now)) : "montage";
  const montageImageIndex = Math.floor(now / 12_000) % Math.max(images.length, 1);
  const remaining = preServiceRemainingSeconds(serviceDate, now, forcedPhase, phaseStartedAt);
  const displayPhase = phase === "countdown" && remaining === 0 ? "complete" : phase;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`pre-service-slide is-${displayPhase}`}
    >
      {backgroundImageUrl ? (
        <img alt="" aria-hidden="true" className="pre-service-background-layer" src={backgroundImageUrl} />
      ) : null}
      <div aria-hidden="true" className="pre-service-photo-matte" />
      {images.map((imageUrl, index) => (
        <img
          alt=""
          aria-hidden="true"
          className={`pre-service-photo-layer ${index === montageImageIndex ? "is-active" : ""}`}
          key={`${imageUrl}:${index}`}
          src={imageUrl}
        />
      ))}
      {timed ? (
        <>
          <div className={`pre-service-montage-clock ${displayPhase === "montage" ? "is-active" : ""}`}>
            <span>Service starts in</span>
            <strong>{countdownLabel(remaining)}</strong>
          </div>
          <div className={`pre-service-shade ${displayPhase === "countdown" || displayPhase === "complete" ? "is-active" : ""}`} />
          <div className={`pre-service-countdown ${displayPhase === "countdown" || displayPhase === "complete" ? "is-active" : ""}`} aria-live="off">
            <div className="pre-service-message-box">
              <div className={`pre-service-countdown-copy ${displayPhase === "countdown" ? "is-active" : ""}`}>
                <span>Service begins in</span>
                <strong>{countdownLabel(remaining)}</strong>
              </div>
              <strong className={`pre-service-seated-message ${displayPhase === "complete" ? "is-active" : ""}`}>Please be seated</strong>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
