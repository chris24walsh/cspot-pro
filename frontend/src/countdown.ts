import type { PresentationLiveState, PresentationSlide } from "./presentation";

export function countdownDeadline(serviceDate: string, until: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(until)) return null;
  const day = new Date(serviceDate);
  if (Number.isNaN(day.getTime())) return null;
  // Service clock times are Dublin times on every output, including remote viewers.
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(day);
  const part = (type: string) => parts.find((entry) => entry.type === type)!.value;
  const guess = Date.parse(`${part("year")}-${part("month")}-${part("day")}T${until}:00Z`);
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(guess);
  const localMinutes = Number(clock.find((entry) => entry.type === "hour")!.value) % 24 * 60 + Number(clock.find((entry) => entry.type === "minute")!.value);
  const [hour, minute] = until.split(":").map(Number);
  const offsetMinutes = (localMinutes - (hour * 60 + minute) + 1440) % 1440;
  return guess - offsetMinutes * 60_000;
}

export function countdownStartsForSelection(state: PresentationLiveState | null | undefined, slide: PresentationSlide | null, now: number): Record<string, number> | undefined {
  const starts = state?.countdownStartedAt;
  if (!slide) return starts;
  if (slide.itemType === "welcome_countdown" && state?.planItemId !== slide.planItemId) return { ...starts, [slide.planItemId]: now };
  if ((slide.overlayMode === "countdown" || slide.countdownSeconds || slide.itemType === "welcome_montage" || slide.itemType === "welcome_countdown") && (!slide.overlayCountdownUntil || slide.itemType === "welcome_countdown")) {
    return { ...starts, [slide.planItemId]: starts?.[slide.planItemId] ?? now };
  }
  return starts;
}

export function withCountdownTiming(slide: PresentationSlide | null, slides: PresentationSlide[], state: PresentationLiveState | null | undefined, serviceDate: string, serviceStart?: string | null): PresentationSlide | null {
  if (!slide || !["welcome_montage", "welcome_countdown"].includes(slide.itemType)) return slide;
  const starts = state?.countdownStartedAt ?? {};
  const duration = slide.overlayCountdownSeconds ?? (slide.itemType === "welcome_montage" ? 1800 : 300);
  const start = starts[slide.planItemId] ?? state?.updatedAt ?? Date.now();
  let deadline = start + duration * 1000;
  for (const target of [slide.overlayCountdownUntil, serviceStart]) {
    const until = target ? countdownDeadline(serviceDate, target) : null;
    if (until !== null) deadline = Math.min(deadline, until);
  }
  if (slide.itemType === "welcome_countdown") {
    const montage = slides.find((candidate) => candidate.itemType === "welcome_montage" && (
      candidate.sectionId === slide.sectionId || (candidate.sectionId === candidate.planItemId && slide.sectionId === slide.planItemId)
    ));
    if (montage && (starts[montage.planItemId] !== undefined || montage.overlayCountdownUntil)) {
      const originalDeadline = withCountdownTiming(montage, slides, state, serviceDate, serviceStart)?.overlayCountdownDeadline;
      if (originalDeadline !== undefined) deadline = Math.min(deadline, originalDeadline);
    }
  }
  const finalSlide = slide.itemType === "welcome_montage" ? slides.find((candidate) => candidate.itemType === "welcome_countdown" && (
    candidate.sectionId === slide.sectionId || (candidate.sectionId === candidate.planItemId && slide.sectionId === slide.planItemId)
  )) : null;
  const advanceDeadline = finalSlide
    ? Math.min(start + (slide.autoAdvanceSeconds ?? 1500) * 1000, deadline - (finalSlide.overlayCountdownSeconds ?? 300) * 1000)
    : deadline;
  return { ...slide, overlayCountdownDeadline: deadline, autoAdvanceDeadline: advanceDeadline };
}

export function countdownRemaining(durationSeconds: number, startAt: number | undefined, until: string | undefined, serviceDate: string, now: number) {
  const deadline = until ? countdownDeadline(serviceDate, until) : null;
  if (deadline !== null) return Math.max(0, Math.ceil((deadline - now) / 1000));
  return Math.max(0, durationSeconds - Math.floor(Math.max(0, now - (startAt ?? now)) / 1000));
}
