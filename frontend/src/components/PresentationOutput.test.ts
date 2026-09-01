import { describe, expect, it } from "vitest";

import { type PresentationLiveService } from "../api";
import { networkDisplayState, networkOutputMediaUrl, presentationOutputAudioEnabled } from "./PresentationOutput";

describe("network TV display", () => {
  it("keeps TV followers muted while allowing the dedicated media receiver", () => {
    expect(presentationOutputAudioEnabled(true, false)).toBe(false);
    expect(presentationOutputAudioEnabled(true, true)).toBe(true);
    expect(presentationOutputAudioEnabled(false, false)).toBe(true);
  });

  it("loads network YouTube players muted before JavaScript control is ready", () => {
    const url = networkOutputMediaUrl("https://www.youtube-nocookie.com/embed/video-1?playsinline=1", true);
    expect(url).toContain("mute=1");
    expect(url).toContain("enablejsapi=1");
    expect(networkOutputMediaUrl("/app/files/video.mp4", true)).toBe("/app/files/video.mp4");
  });

  it("starts following the active service at its current slide", () => {
    const service: PresentationLiveService = {
      plan_id: "plan-1",
      title: "Sunday Service",
      subtitle: null,
      service_date: "2026-07-19T10:30:00Z",
      plan_type: "Service",
      item_count: 8,
      session_id: "session-1",
      status: "live",
      index: 12,
      plan_item_id: "sermon-1",
      slide_offset: 3,
      updated_at: 12345,
      output_owner_id: "tv-controller-1",
      output_heartbeat_at: 12346,
      service_stage: "post_service",
      pre_service_phase: "countdown",
    };

    expect(networkDisplayState(service)).toMatchObject({
      planId: "plan-1",
      index: 12,
      planItemId: "sermon-1",
      slideOffset: 3,
      updatedAt: 12345,
      serviceStage: "post_service",
      preServicePhase: "countdown",
    });
  });
});
