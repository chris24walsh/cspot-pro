import { describe, expect, it } from "vitest";

import type { PlanDetail, PlanItem, PlanSummary } from "./api";
import { WORSHIP_SET_ANCHOR_ITEM_TYPE, combinedPlanningItemCount, dateKey, matchingWorshipSetForService, mergeWorshipSetIntoService, preferredWorshipSetPlanId } from "./worshipSets";

function item(id: string, sequence: string, itemType: string, songId: string | null = null): PlanItem {
  return {
    comment: null,
    files: [],
    id,
    item_type: itemType,
    key_signature: null,
    plan_id: "plan-1",
    sequence,
    song_id: songId,
    teacher_notes: null,
    title: id,
  };
}

function summary(id: string, serviceDate: string, planType = "Service"): PlanSummary {
  return {
    id,
    item_count: 0,
    leader_id: null,
    plan_type: planType,
    service_date: serviceDate,
    status: "draft",
    subtitle: null,
    title: id,
  };
}

describe("worship set merge", () => {
  it("includes linked worship-set content in service calendar counts", () => {
    expect(combinedPlanningItemCount({ item_count: 0 }, { item_count: 5 })).toBe(5);
    expect(combinedPlanningItemCount({ item_count: 2 }, undefined)).toBe(2);
  });

  it("keeps today's worship set selected on Sunday and rolls forward on Monday", () => {
    const today = summary("today", "2026-07-05T10:30:00.000Z", "Worship Set");
    const following = summary("following", "2026-07-12T10:30:00.000Z", "Worship Set");

    expect(preferredWorshipSetPlanId([following, today], new Date(2026, 6, 5, 12))).toBe("today");
    expect(preferredWorshipSetPlanId([following, today], new Date(2026, 6, 6, 12))).toBe("following");
  });

  it("uses local date keys when matching service and worship set days", () => {
    const service = { service_date: "2026-02-01T10:30:00.000Z" } as PlanDetail;
    const matching = summary("set-1", "2026-02-01T09:00:00.000Z", "Worship Set");
    const other = summary("set-2", "2026-02-08T09:00:00.000Z", "Worship Set");

    expect(dateKey(service.service_date)).toBe("2026-02-01");
    expect(matchingWorshipSetForService(service, [other, matching])).toBe(matching);
  });

  it("replaces service placeholder with sorted worship set songs", () => {
    const merged = mergeWorshipSetIntoService(
      [
        item("welcome", "10.00", "welcome"),
        item("anchor", "20.00", WORSHIP_SET_ANCHOR_ITEM_TYPE),
        item("sermon", "30.00", "sermon"),
      ],
      [item("song-b", "20.00", "song", "song-b"), item("song-a", "10.00", "song", "song-a")],
    );

    expect(merged.map((entry) => entry.id)).toEqual(["welcome", "song-a", "song-b", "sermon"]);
    expect(merged[1].sequence).toBe("20.0001");
    expect(merged[2].sequence).toBe("20.0002");
  });

  it("falls back to service items without anchors when no worship songs exist", () => {
    const merged = mergeWorshipSetIntoService(
      [item("welcome", "10.00", "welcome"), item("anchor", "20.00", WORSHIP_SET_ANCHOR_ITEM_TYPE)],
      [item("note", "10.00", "custom")],
    );

    expect(merged.map((entry) => entry.id)).toEqual(["welcome"]);
  });
});
