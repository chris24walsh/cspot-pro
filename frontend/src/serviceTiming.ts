import type { PlanItem, PlanType } from "./api";

type TimedCue = Pick<PlanItem, "item_type" | "presentation_options">;

export function welcomeLeadSeconds(items: TimedCue[]): number {
  const montage = items.find((item) => item.item_type === "welcome_montage");
  const countdown = items.find((item) => item.item_type === "welcome_countdown");
  if (!montage?.presentation_options?.auto_advance || !countdown?.presentation_options?.auto_advance) return 0;
  return Math.max(0, Number(montage.presentation_options.auto_advance_seconds) || 0)
    + Math.max(0, Number(countdown.presentation_options.overlay_countdown_seconds) || 300);
}

export function shiftClock(value: string, seconds: number): string {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return "";
  const [hour, minute] = value.split(":").map(Number);
  const total = ((hour * 60 + minute + Math.round(seconds / 60)) % 1440 + 1440) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function templateServiceStart(type: PlanType): string {
  const queued = type.automation_start ?? type.starts_at ?? "";
  const lead = welcomeLeadSeconds(type.default_outline);
  return type.starts_at && type.starts_at !== queued ? type.starts_at : shiftClock(queued, lead);
}
