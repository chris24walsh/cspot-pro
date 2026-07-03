import { describe, expect, it } from "vitest";

import { recordingTimelineEventAt } from "./SermonRecordingPlayer";

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
});
