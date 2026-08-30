import type {
  BroadcastAudioSource,
  BroadcastCameraSource,
  BroadcastViewerSettings,
} from "./api";

type EditableScalarKey =
  | "stream_title"
  | "stream_description"
  | "camera_cycle_seconds"
  | "camera_fade_ms"
  | "mixer_name"
  | "mixer_protocol"
  | "mixer_control_url"
  | "mixer_notes"
  | "slide_delay_ms"
  | "recording_grace_seconds"
  | "pre_service_audio_url"
  | "pre_service_minutes"
  | "starting_soon_message"
  | "offline_message";

const EDITABLE_SCALAR_KEYS: EditableScalarKey[] = [
  "stream_title",
  "stream_description",
  "camera_cycle_seconds",
  "camera_fade_ms",
  "mixer_name",
  "mixer_protocol",
  "mixer_control_url",
  "mixer_notes",
  "slide_delay_ms",
  "recording_grace_seconds",
  "pre_service_audio_url",
  "pre_service_minutes",
  "starting_soon_message",
  "offline_message",
];

function cameraConfiguration(source: BroadcastCameraSource) {
  return { id: source.id, label: source.label, url: source.url };
}

function audioConfiguration(source: BroadcastAudioSource) {
  return {
    id: source.id,
    label: source.label,
    role: source.role,
    url: source.url,
  };
}

function configurationsMatch<T>(
  left: T[],
  right: T[],
  configuration: (value: T) => object,
) {
  return JSON.stringify(left.map(configuration)) === JSON.stringify(right.map(configuration));
}

/**
 * Combines metadata edited in the form with the newest live mixer state.
 *
 * Source gain and enable flags are changed by scene automation, so they must
 * never come from a form snapshot that may have been open for several minutes.
 */
export function mergeAudioSourceConfiguration(
  formSources: BroadcastAudioSource[],
  latestSources: BroadcastAudioSource[],
): BroadcastAudioSource[] {
  const latestById = new Map(latestSources.map((source) => [source.id, source]));
  return formSources.map((source) => {
    const latest = latestById.get(source.id);
    return {
      ...source,
      gain_db: latest?.gain_db ?? source.gain_db,
      mix_enabled: latest?.mix_enabled ?? source.mix_enabled,
      stream_name: latest?.stream_name ?? source.stream_name,
    };
  });
}

/**
 * Builds a PATCH containing only configuration the operator changed in this
 * form. Live selectors, scenes, automation, and manual-live state are omitted.
 */
export function buildBroadcastSettingsSavePatch(
  form: BroadcastViewerSettings,
  baseline: BroadcastViewerSettings,
  latest: BroadcastViewerSettings,
): Partial<BroadcastViewerSettings> {
  const patch: Partial<BroadcastViewerSettings> = {};

  for (const key of EDITABLE_SCALAR_KEYS) {
    if (!Object.is(form[key], baseline[key])) {
      // All keys are scalar BroadcastViewerSettings fields. Keeping the list
      // explicit prevents response-only/live fields from entering this PATCH.
      (patch as Record<EditableScalarKey, BroadcastViewerSettings[EditableScalarKey]>)[key] = form[key];
    }
  }

  const cameraSourcesChanged = !configurationsMatch(
    form.camera_sources,
    baseline.camera_sources,
    cameraConfiguration,
  );
  const audioSourcesChanged = !configurationsMatch(
    form.audio_sources,
    baseline.audio_sources,
    audioConfiguration,
  );
  if (cameraSourcesChanged) {
    patch.camera_sources = form.camera_sources.map(cameraConfiguration);
  }

  if (audioSourcesChanged) {
    patch.audio_sources = mergeAudioSourceConfiguration(form.audio_sources, latest.audio_sources);
  }

  if (cameraSourcesChanged || audioSourcesChanged) {
    const nextCameras = patch.camera_sources ?? latest.camera_sources;
    const nextAudioSources = patch.audio_sources ?? latest.audio_sources;
    const nextSourceIds = new Set([
      ...nextCameras.map((source) => source.id),
      ...nextAudioSources.map((source) => source.id),
    ]);
    if (latest.active_camera_id && !nextCameras.some((source) => source.id === latest.active_camera_id)) {
      patch.active_camera_id = nextCameras[0]?.id ?? null;
    }
    const liveAudioSourceStillExists = latest.live_audio_source === "none"
      || (latest.live_audio_source === "mix" && nextAudioSources.some((source) => source.mix_enabled))
      || nextSourceIds.has(latest.live_audio_source);
    if (!liveAudioSourceStillExists) {
      patch.live_audio_source = nextAudioSources[0]?.id ?? nextCameras[0]?.id ?? "none";
    }
  }

  return patch;
}

/**
 * A newly-added source must be persisted before it can be selected. Existing
 * sources need only the selector PATCH, avoiding an unnecessary mixer write.
 */
export function buildLiveAudioSourcePatch(
  sourceId: string,
  form: BroadcastViewerSettings,
  latest: BroadcastViewerSettings,
): Partial<BroadcastViewerSettings> {
  const patch: Partial<BroadcastViewerSettings> = { live_audio_source: sourceId };
  if (
    form.audio_sources.some((source) => source.id === sourceId)
    && !latest.audio_sources.some((source) => source.id === sourceId)
  ) {
    patch.audio_sources = mergeAudioSourceConfiguration(form.audio_sources, latest.audio_sources);
  }
  if (
    form.camera_sources.some((source) => source.id === sourceId)
    && !latest.camera_sources.some((source) => source.id === sourceId)
  ) {
    patch.camera_sources = form.camera_sources.map(cameraConfiguration);
  }
  return patch;
}

/** Applies fresh server/live state without discarding still-unsaved form edits. */
export function mergeBroadcastServerState(
  form: BroadcastViewerSettings,
  baseline: BroadcastViewerSettings,
  server: BroadcastViewerSettings,
): BroadcastViewerSettings {
  return {
    ...server,
    ...buildBroadcastSettingsSavePatch(form, baseline, server),
  };
}
