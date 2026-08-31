import { useEffect, useRef, useState } from "react";
import type { ServiceScheduleRule } from "../api";

function serviceDayTimestamp(serviceDate: string, hour: number, minute: number) {
  const date = new Date(serviceDate);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour, minute, 0, 0).getTime();
}

function scheduledTimestamp(serviceDate: string, value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return serviceDayTimestamp(serviceDate, hour, minute);
}

export function serviceScheduleForPlan(
  schedules: ServiceScheduleRule[],
  serviceDate: string,
  planType: string,
) {
  const jsWeekday = new Date(serviceDate).getDay();
  const weekday = (jsWeekday + 6) % 7;
  return schedules.find((rule) => rule.enabled && rule.weekday === weekday && rule.plan_type === planType);
}

function countdownLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function countdownLabelForTransition(
  previousLabel: string,
  phase: "waiting" | "montage" | "countdown" | "complete",
  seconds: number,
) {
  return phase === "countdown" ? countdownLabel(seconds) : previousLabel;
}

export function preServiceRemainingSeconds(
  serviceDate: string,
  now: number,
  forcedPhase?: "waiting" | "montage" | "countdown" | "complete" | null,
  phaseStartedAt?: number,
  schedule?: ServiceScheduleRule,
) {
  if (forcedPhase === "complete") return 0;
  if (forcedPhase && phaseStartedAt) {
    const durationSeconds = forcedPhase === "countdown" ? 300 : 1800;
    return Math.max(0, Math.ceil(durationSeconds - (now - phaseStartedAt) / 1000));
  }
  return Math.max(0, Math.ceil(((schedule ? scheduledTimestamp(serviceDate, schedule.service_start) : serviceDayTimestamp(serviceDate, 11, 0)) - now) / 1000));
}

export function preServicePhaseAt(serviceDate: string, now: number, schedule?: ServiceScheduleRule) {
  const serviceDay = new Date(serviceDate);
  const currentDay = new Date(now);
  if (
    serviceDay.getFullYear() !== currentDay.getFullYear() ||
    serviceDay.getMonth() !== currentDay.getMonth() ||
    serviceDay.getDate() !== currentDay.getDate()
  ) {
    return "waiting" as const;
  }
  const montageStart = schedule ? scheduledTimestamp(serviceDate, schedule.pre_service_start) : serviceDayTimestamp(serviceDate, 10, 30);
  const countdownStart = schedule ? scheduledTimestamp(serviceDate, schedule.countdown_start) : serviceDayTimestamp(serviceDate, 10, 55);
  const serviceStart = schedule ? scheduledTimestamp(serviceDate, schedule.service_start) : serviceDayTimestamp(serviceDate, 11, 0);
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
  schedule,
}: {
  backgroundImageUrl: string;
  imageUrls: string[];
  serviceDate: string;
  timed?: boolean;
  phase?: "waiting" | "montage" | "countdown" | "complete" | null;
  phaseStartedAt?: number;
  schedule?: ServiceScheduleRule;
}) {
  const [now, setNow] = useState(Date.now());
  const images = imageUrls.filter(Boolean);
  // Ordinary section montages reuse the photo crossfade, but must not inherit
  // the global pre-service clock/countdown phase.
  const phase = timed ? (forcedPhase ?? preServicePhaseAt(serviceDate, now, schedule)) : "montage";
  const montageImageIndex = Math.floor(now / 12_000) % Math.max(images.length, 1);
  const remaining = preServiceRemainingSeconds(serviceDate, now, forcedPhase, phaseStartedAt, schedule);
  const displayPhase = phase === "countdown" && remaining === 0 ? "complete" : phase;
  const displayedCountdownLabel = useRef(countdownLabel(remaining));
  displayedCountdownLabel.current = countdownLabelForTransition(displayedCountdownLabel.current, phase, remaining);

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
                <strong>{displayedCountdownLabel.current}</strong>
              </div>
              <strong className={`pre-service-seated-message ${displayPhase === "complete" ? "is-active" : ""}`}>Please be seated</strong>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
