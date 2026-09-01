import { describe, expect, it } from "vitest";

import { recordedPlanItems, recordingTimelineEventAt, recordingTimestampTitle } from "./SermonRecordingPlayer";

const timeline = [
  { at: 0.5, plan_item_id: "sermon", slide_offset: 0 },
  { at: 12, plan_item_id: "sermon", slide_offset: 1 },
  { at: 28, plan_item_id: "sermon", slide_offset: 2 },
];

describe("sermon recording timeline", () => {
  it("uses the first slide before the first recorded transition", () => {
    expect(recordingTimelineEventAt(timeline, 0)?.slide_offset).toBe(0);
  });

  it("follows transitions and seeking", () => {
    expect(recordingTimelineEventAt(timeline, 20)?.slide_offset).toBe(1);
    expect(recordingTimelineEventAt(timeline, 40)?.slide_offset).toBe(2);
  });

  it("delays slide changes to match camera audio latency", () => {
    expect(recordingTimelineEventAt(timeline, 12.5)?.slide_offset).toBe(0);
    expect(recordingTimelineEventAt(timeline, 13.6)?.slide_offset).toBe(1);
  });

  it("labels recordings by their timestamp instead of the sermon item title", () => {
    const title = recordingTimestampTitle({
      recorded_at: "2026-07-03T12:03:02.000Z",
      title: "Old sermon title",
    } as never);
    expect(title).not.toContain("Old sermon title");
    expect(title).toContain("2026");
  });

  it("preserves each deleted deck independently without guessing from duration or slides visited", () => {
    const recording = {
      id: "recording-1",
      plan_id: "plan-1",
      timeline: [
        { at: 0, plan_item_id: "deleted-first", slide_offset: 0, item_title: "First", files: [{ file_id: "deck-1", display_name: "First.pptx", content_type: "application/pptx", sort_order: 0 }] },
        { at: 1800, plan_item_id: "deleted-first", slide_offset: 3, item_title: "First", files: [{ file_id: "deck-1", display_name: "First.pptx", content_type: "application/pptx", sort_order: 0 }] },
        { at: 1900, plan_item_id: "deleted-second", slide_offset: 0, item_title: "Second", files: [{ file_id: "deck-2", display_name: "Second.pptx", content_type: "application/pptx", sort_order: 0 }] },
      ],
    } as never;
    const plan = { id: "plan-1", items: [{ id: "readded-first" }, { id: "readded-second" }] } as never;

    expect(recordedPlanItems(recording, plan).map((item) => [item.id, item.files[0]?.file_id])).toEqual([
      ["deleted-first", "deck-1"],
      ["deleted-second", "deck-2"],
    ]);
  });
});
