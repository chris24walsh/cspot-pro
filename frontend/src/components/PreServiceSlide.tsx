import { useEffect, useState } from "react";

function serviceStartTimestamp(serviceDate: string) {
  const date = new Date(serviceDate);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 11, 0, 0, 0).getTime();
}

function countdownLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function PreServiceSlide({ imageUrls, serviceDate }: { imageUrls: string[]; serviceDate: string }) {
  const [now, setNow] = useState(Date.now());
  const images = imageUrls.filter(Boolean);
  const imageUrl = images[Math.floor(now / 12_000) % Math.max(images.length, 1)];
  const remaining = Math.max(0, Math.ceil((serviceStartTimestamp(serviceDate) - now) / 1000));
  const finalFiveMinutes = remaining > 0 && remaining <= 5 * 60;

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div
      className={`pre-service-slide ${finalFiveMinutes ? "is-final-countdown" : ""}`}
      style={imageUrl ? { backgroundImage: `url(${imageUrl})` } : undefined}
    >
      <div className="pre-service-shade" />
      <div className="pre-service-countdown" aria-live="off">
        {remaining ? (
          <>
            <span>{finalFiveMinutes ? "Service begins in" : "Welcome · Service begins in"}</span>
            <strong>{countdownLabel(remaining)}</strong>
          </>
        ) : (
          <strong>Welcome</strong>
        )}
      </div>
    </div>
  );
}
