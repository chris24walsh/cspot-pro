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
}: {
  backgroundImageUrl: string;
  imageUrls: string[];
  serviceDate: string;
}) {
  const [now, setNow] = useState(Date.now());
  const images = imageUrls.filter(Boolean);
  const phase = preServicePhaseAt(serviceDate, now);
  const montageImageUrl = images[Math.floor(now / 12_000) % Math.max(images.length, 1)];
  const imageUrl = phase === "montage" || phase === "countdown" ? montageImageUrl : backgroundImageUrl;
  const remaining = Math.max(0, Math.ceil((serviceDayTimestamp(serviceDate, 11, 0) - now) / 1000));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`pre-service-slide is-${phase}`}
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
    >
      {phase === "countdown" ? <div className="pre-service-shade" /> : null}
      {phase === "countdown" ? (
        <div className="pre-service-countdown" aria-live="off">
          <span>Service begins in</span>
          <strong>{countdownLabel(remaining)}</strong>
        </div>
      ) : null}
    </div>
  );
}
