import { describe, expect, it } from "vitest";
import { countdownDeadline, countdownRemaining, countdownStartsForSelection, withCountdownTiming } from "./countdown";
import type { PresentationLiveState, PresentationSlide } from "./presentation";

const montage: PresentationSlide = { id: "montage", planItemId: "montage", sectionId: "welcome", sectionTitle: "Welcome", title: "Montage", text: "", itemType: "welcome_montage", sequence: "1", overlayMode: "countdown", overlayCountdownSeconds: 1800, autoAdvanceSeconds: 1500 };
const final: PresentationSlide = { ...montage, id: "final", planItemId: "final", itemType: "welcome_countdown", overlayCountdownSeconds: 300, autoAdvanceSeconds: 300 };
const slides = [montage, final];

describe("countdown timing", () => {
  it("counts to a clock time on the service date regardless of slide selection", () => {
    const serviceDate = "2026-09-20T09:00:00";
    const deadline = countdownDeadline(serviceDate, "11:00")!;
    expect(countdownRemaining(300, deadline - 300_000, "11:00", serviceDate, deadline - 90_000)).toBe(90);
    expect(countdownRemaining(300, deadline - 10_000, "11:00", serviceDate, deadline + 1000)).toBe(0);
  });

  it("keeps the original duration start after leaving and returning", () => {
    const startAt = 1_000_000;
    expect(countdownRemaining(300, startAt, undefined, "", startAt + 120_000)).toBe(180);
    expect(countdownRemaining(300, startAt, undefined, "", startAt + 180_000)).toBe(120);
  });

  it("restarts the final countdown on entry while the original montage keeps running", () => {
    const start = 1_000_000;
    let state: PresentationLiveState = { planId: "service", planItemId: montage.planItemId, index: 0, updatedAt: start, countdownStartedAt: { montage: start } };
    const enter = (slide: PresentationSlide, minutes: number) => {
      const now = start + minutes * 60_000;
      state = { ...state, countdownStartedAt: countdownStartsForSelection(state, slide, now), planItemId: slide.planItemId, updatedAt: now };
      return withCountdownTiming(slide, slides, state, "2026-09-20")!;
    };
    expect(enter(final, 10).overlayCountdownDeadline).toBe(start + 15 * 60_000);
    expect(enter(montage, 11).overlayCountdownDeadline).toBe(start + 30 * 60_000);
    expect(enter(montage, 11).autoAdvanceDeadline).toBe(start + 25 * 60_000);
    expect(enter(final, 12).overlayCountdownDeadline).toBe(start + 17 * 60_000);
    // Blanking or changing style on the same slide must not restart it.
    expect(enter(final, 13).autoAdvanceDeadline).toBe(start + 17 * 60_000);
    enter(montage, 26);
    expect(enter(final, 27).autoAdvanceDeadline).toBe(start + 30 * 60_000);
    enter(montage, 31);
    expect(enter(final, 32).overlayCountdownDeadline).toBeLessThan(state.updatedAt);
  });

  it("caps the final countdown at the original clock target on every output timezone", () => {
    const serviceDate = "2026-09-20T10:00:00Z";
    const until = { ...montage, overlayCountdownUntil: "11:00" };
    const now = Date.parse("2026-09-20T09:58:00Z");
    const state: PresentationLiveState = { planId: "service", index: 1, planItemId: "final", updatedAt: now, countdownStartedAt: { final: now } };
    expect(withCountdownTiming(final, [until, final], state, serviceDate)?.overlayCountdownDeadline).toBe(Date.parse("2026-09-20T10:00:00Z"));
    const standaloneFinal = { ...final, sectionId: final.planItemId };
    expect(withCountdownTiming(standaloneFinal, [{ ...until, sectionId: until.planItemId }, standaloneFinal], state, serviceDate)?.overlayCountdownDeadline).toBe(Date.parse("2026-09-20T10:00:00Z"));
    expect(countdownDeadline("2026-12-20T11:00:00Z", "11:00")).toBe(Date.parse("2026-12-20T11:00:00Z"));
  });
});
