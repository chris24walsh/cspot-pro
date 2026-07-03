import { describe, expect, it } from "vitest";

import { recordingTimelineEventAt, recordingTimestampTitle } from "./SermonRecordingPlayer";

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

  it("labels recordings by their timestamp instead of the sermon item title", () => {
    const title = recordingTimestampTitle({
      recorded_at: "2026-07-03T12:03:02.000Z",
      title: "Old sermon title",
    } as never);
    expect(title).not.toContain("Old sermon title");
    expect(title).toContain("2026");
  });
});
