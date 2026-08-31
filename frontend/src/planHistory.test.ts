import { describe, expect, it } from "vitest";
import type { PlanHistoryEntry, PlanHistorySnapshotItem } from "./api";
import { undoHistoryEntrySnapshot } from "./planHistory";

const item = (id: string, sequence: string, title = id): PlanHistorySnapshotItem => ({
  id, item_type: "song", sequence, title, planned_start: null, comment: null, key_signature: null, song_id: id,
});
const entry = (before: PlanHistorySnapshotItem[], after: PlanHistorySnapshotItem[]): PlanHistoryEntry => ({
  id: "history", actor_id: null, actor_name: null, created_at: "2026-01-01T00:00:00Z", label: "change",
  before, after, affected: null, change_type: "plan_items", restorable: true,
});

describe("undoHistoryEntrySnapshot", () => {
  it("reverses only a reorder while preserving a later-added item", () => {
    const before = [item("a", "10"), item("b", "20")];
    const after = [item("a", "20"), item("b", "10")];
    expect(undoHistoryEntrySnapshot([...after, item("c", "30")], entry(before, after))).toEqual([...before, item("c", "30")]);
  });

  it("removes an item added by the selected change", () => {
    const before = [item("a", "10")];
    const after = [...before, item("b", "20")];
    expect(undoHistoryEntrySnapshot(after, entry(before, after))).toEqual(before);
  });
});
