import { useEffect, useRef, useState } from "react";

function remainingSeconds(startAt: number, durationSeconds: number, now: number) {
  return Math.max(0, durationSeconds - Math.floor(Math.max(0, now - startAt) / 1000));
}

export function CountdownSlide({
  durationSeconds = 300,
  startAt,
}: {
  durationSeconds?: number;
  startAt?: number | null;
}) {
  const mountedAtRef = useRef(Date.now());
  const [now, setNow] = useState(Date.now());
  const effectiveStart = startAt ?? mountedAtRef.current;
  const remaining = remainingSeconds(effectiveStart, durationSeconds, now);
  const minutes = Math.floor(remaining / 60);
  const seconds = String(remaining % 60).padStart(2, "0");

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="service-countdown-slide" aria-label={`${minutes} minutes ${seconds} seconds until the service begins`}>
      <span>Service begins in</span>
      <strong>{minutes}:{seconds}</strong>
      <small>{remaining ? "Please take your seats" : "Welcome"}</small>
    </div>
  );
}
