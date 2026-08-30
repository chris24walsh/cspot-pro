import { describe, expect, it } from "vitest";

import type { BroadcastViewerSettings } from "./api";
import {
  buildBroadcastSettingsSavePatch,
  buildLiveAudioSourcePatch,
} from "./broadcastSettingsSave";

function settings(
  overrides: Partial<BroadcastViewerSettings> = {},
): BroadcastViewerSettings {
  return {
    auto_record_sermons: true,
    recording_grace_seconds: 60,
    camera_url: null,
    camera_sources: [{ id: "lectern", label: "Lectern", url: "rtsp://lectern" }],
    audio_sources: [
      {
        id: "desk",
        label: "Desk feed",
        stream_name: "desk-stream",
        url: "http://bridge/audio/desk.mp3",
        gain_db: 0,
        mix_enabled: true,
        role: "desk",
      },
      {
        id: "pc-media",
        label: "PC media",
        stream_name: "media-stream",
        url: "http://bridge/audio/pc-media.mp3",
        gain_db: 0,
        mix_enabled: false,
        role: "media",
      },
    ],
    audio_scenes: [
      {
        id: "worship",
        label: "Worship",
        channels: {
          desk: { enabled: true, gain_db: 0 },
          "pc-media": { enabled: false, gain_db: 0 },
        },
      },
    ],
    active_audio_scene: "worship",
    audio_scene_automation: true,
    active_camera_id: "lectern",
    camera_cycle_seconds: 0,
    camera_cycle_started_at: null,
    camera_fade_ms: 1200,
    live_audio_url: null,
    live_audio_source: "mix",
    live_audio_stream_name: null,
    manual_live_audience: "off",
    mixer_name: null,
    mixer_protocol: "none",
    mixer_control_url: null,
    mixer_notes: null,
    slide_delay_ms: 800,
    offline_message: "Offline",
    pre_service_audio_url: null,
    pre_service_room_audio_enabled: false,
    pre_service_minutes: 60,
    starting_soon_message: "Starting soon",
    stream_description: null,
    stream_title: "Sunday Service",
    ...overrides,
  };
}

function mediaSceneSettings() {
  const baseline = settings();
  return settings({
    active_audio_scene: "media",
    audio_sources: baseline.audio_sources.map((source) => ({
      ...source,
      mix_enabled: source.id === "pc-media",
    })),
    audio_scenes: [
      ...baseline.audio_scenes,
      {
        id: "media",
        label: "Media",
        channels: {
          desk: { enabled: false, gain_db: 0 },
          "pc-media": { enabled: true, gain_db: 0 },
        },
      },
    ],
    manual_live_audience: "public",
  });
}

describe("buildBroadcastSettingsSavePatch", () => {
  it("does not let a title save revert an automated Media scene", () => {
    const baseline = settings();
    const form = settings({ stream_title: "Updated title" });
    const latest = mediaSceneSettings();

    expect(buildBroadcastSettingsSavePatch(form, baseline, latest)).toEqual({
      stream_title: "Updated title",
    });
  });

  it("uses the newest media-only channel flags when source metadata is edited", () => {
    const baseline = settings();
    const form = settings({
      stream_title: "Updated title",
      audio_sources: baseline.audio_sources.map((source) => (
        source.id === "desk" ? { ...source, label: "Main desk feed" } : source
      )),
    });
    const latest = mediaSceneSettings();

    const patch = buildBroadcastSettingsSavePatch(form, baseline, latest);

    expect(patch).not.toHaveProperty("active_audio_scene");
    expect(patch).not.toHaveProperty("audio_scene_automation");
    expect(patch).not.toHaveProperty("audio_scenes");
    expect(patch).not.toHaveProperty("live_audio_source");
    expect(patch).not.toHaveProperty("manual_live_audience");
    expect(patch.audio_sources).toEqual([
      expect.objectContaining({ id: "desk", label: "Main desk feed", mix_enabled: false }),
      expect.objectContaining({ id: "pc-media", mix_enabled: true }),
    ]);
  });

  it("falls back safely when the selected audio source is removed", () => {
    const baseline = settings({ live_audio_source: "desk" });
    const form = settings({
      live_audio_source: "desk",
      audio_sources: baseline.audio_sources.filter((source) => source.id !== "desk"),
    });
    const latest = settings({ live_audio_source: "desk" });

    const patch = buildBroadcastSettingsSavePatch(form, baseline, latest);

    expect(patch.audio_sources?.map((source) => source.id)).toEqual(["pc-media"]);
    expect(patch.live_audio_source).toBe("pc-media");
  });

  it("moves the on-air camera before removing the selected camera", () => {
    const baseline = settings({
      active_camera_id: "ptz",
      camera_sources: [
        { id: "lectern", label: "Lectern", url: "rtsp://lectern" },
        { id: "ptz", label: "PTZ", url: "rtsp://ptz" },
      ],
    });
    const form = settings({
      active_camera_id: "ptz",
      camera_sources: [{ id: "lectern", label: "Lectern", url: "rtsp://lectern" }],
    });

    const patch = buildBroadcastSettingsSavePatch(form, baseline, baseline);

    expect(patch.camera_sources).toEqual(form.camera_sources);
    expect(patch.active_camera_id).toBe("lectern");
  });
});

describe("buildLiveAudioSourcePatch", () => {
  it("changes an existing route without carrying cached mixer flags", () => {
    const form = settings();
    const latest = mediaSceneSettings();

    expect(buildLiveAudioSourcePatch("pc-media", form, latest)).toEqual({
      live_audio_source: "pc-media",
    });
  });
});
