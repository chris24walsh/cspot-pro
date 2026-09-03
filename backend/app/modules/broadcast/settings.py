import json

import json

from pydantic import ValidationError

from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.schemas import ServiceScheduleRule

DEFAULT_SERVICE_SCHEDULES = [
    ServiceScheduleRule(
        id="sunday-morning",
        name="Sunday morning",
        plan_type="Sunday Service",
        weekday=6,
        pre_service_start="10:30",
        countdown_start="10:55",
        service_start="11:00",
        cleanup_time="13:30",
        enabled=True,
    )
]


def service_schedules(settings: BroadcastViewerSettings) -> list[ServiceScheduleRule]:
    if not settings.service_schedules_json:
        return [rule.model_copy() for rule in DEFAULT_SERVICE_SCHEDULES]
    try:
        values = json.loads(settings.service_schedules_json)
        return [ServiceScheduleRule.model_validate(value) for value in values]
    except (json.JSONDecodeError, TypeError, ValidationError):
        return [rule.model_copy() for rule in DEFAULT_SERVICE_SCHEDULES]
from app.modules.broadcast.schemas import (
    BroadcastAudioScene,
    BroadcastAudioSceneChannel,
    BroadcastAudioSource,
    BroadcastCameraSource,
)

SCENE_LABELS = {
    "pastor": "Pastor",
    "congregation": "Congregation",
    "worship": "Worship",
    "media": "Media",
    "pre_service": "Pre-service",
    "post_service": "Post-service",
}


def camera_sources(settings: BroadcastViewerSettings) -> list[BroadcastCameraSource]:
    try:
        raw_sources = json.loads(settings.camera_sources_json or "[]")
    except (json.JSONDecodeError, TypeError):
        raw_sources = []

    sources: list[BroadcastCameraSource] = []
    if isinstance(raw_sources, list):
        for raw_source in raw_sources:
            try:
                sources.append(BroadcastCameraSource.model_validate(raw_source))
            except (TypeError, ValueError):
                continue

    if not sources and settings.camera_url:
        sources.append(
            BroadcastCameraSource(id="lectern", label="Lectern", url=settings.camera_url)
        )
    return sources


def audio_sources(settings: BroadcastViewerSettings) -> list[BroadcastAudioSource]:
    try:
        raw_sources = json.loads(settings.audio_sources_json or "[]")
    except (json.JSONDecodeError, TypeError):
        raw_sources = []

    sources: list[BroadcastAudioSource] = []
    if isinstance(raw_sources, list):
        for raw_source in raw_sources:
            try:
                sources.append(BroadcastAudioSource.model_validate(raw_source))
            except (TypeError, ValueError):
                continue

    if not sources and settings.live_audio_url:
        sources.append(
            BroadcastAudioSource(
                id="independent",
                label="Independent audio",
                url=settings.live_audio_url,
            )
        )
    return sources


def audio_source_kind(source: BroadcastAudioSource) -> str:
    if source.role != "other":
        return source.role
    name = f"{source.id} {source.label}".lower()
    if any(token in name for token in ("room", "ambient", "audience", "congregation")):
        return "room"
    if any(token in name for token in ("desk", "mixer", "board", "console")):
        return "desk"
    if any(token in name for token in ("media", "playback", "computer", "pc")):
        return "media"
    return "other"


def default_audio_scenes(sources: list[BroadcastAudioSource]) -> list[BroadcastAudioScene]:
    scene_levels = {
        "pastor": {"room": (-18, True), "desk": (0, True), "media": (0, False)},
        "congregation": {"room": (0, True), "desk": (-12, True), "media": (0, False)},
        "worship": {"room": (-12, True), "desk": (0, True), "media": (0, False)},
        "media": {"room": (-30, False), "desk": (0, False), "media": (0, True)},
        "pre_service": {"room": (-30, False), "desk": (0, False), "media": (0, True)},
        "post_service": {"room": (-30, False), "desk": (0, False), "media": (0, True)},
    }
    return [
        BroadcastAudioScene(
            id=scene_id,
            label=label,
            channels={
                source.id: BroadcastAudioSceneChannel(
                    gain_db=scene_levels[scene_id].get(
                        audio_source_kind(source),
                        (source.gain_db, source.mix_enabled)
                        if scene_id in {"pastor", "congregation", "worship"}
                        else (0, False),
                    )[0],
                    enabled=scene_levels[scene_id].get(
                        audio_source_kind(source),
                        (source.gain_db, source.mix_enabled)
                        if scene_id in {"pastor", "congregation", "worship"}
                        else (0, False),
                    )[1],
                )
                for source in sources
            },
            room_media_enabled=scene_id == "post_service",
        )
        for scene_id, label in SCENE_LABELS.items()
    ]


def audio_scenes(settings: BroadcastViewerSettings) -> list[BroadcastAudioScene]:
    sources = audio_sources(settings)
    try:
        raw_scenes = json.loads(settings.audio_scenes_json or "[]")
    except (json.JSONDecodeError, TypeError):
        raw_scenes = []
    parsed: dict[str, BroadcastAudioScene] = {}
    if isinstance(raw_scenes, list):
        for raw_scene in raw_scenes:
            try:
                scene = BroadcastAudioScene.model_validate(raw_scene)
                parsed[scene.id] = scene
            except (TypeError, ValueError):
                continue
    defaults = default_audio_scenes(sources)
    media_source_ids = {source.id for source in sources if audio_source_kind(source) == "media"}
    normalized: list[BroadcastAudioScene] = []
    for scene in defaults:
        stored = parsed.get(scene.id)
        # Older Media scenes predate the direct PC-media role and normally have
        # the desk return enabled. On the first addition of a media source,
        # migrate that whole scene to the safe mix-minus default instead of
        # combining the new direct leg with its delayed desk return. Once a
        # stored Media scene contains a media channel, preserve operator edits.
        migrate_legacy_media_scene = bool(
            scene.id == "media"
            and stored
            and media_source_ids
            and not media_source_ids.intersection(stored.channels)
        )
        normalized.append(
            scene.model_copy(
                update={
                    "label": stored.label if stored else scene.label,
                    "room_media_enabled": stored.room_media_enabled if stored else scene.room_media_enabled,
                    "channels": {
                        source.id: (
                            stored.channels.get(source.id, scene.channels[source.id])
                            if stored and not migrate_legacy_media_scene
                            else scene.channels[source.id]
                        )
                        for source in sources
                    },
                }
            )
        )
    default_ids = {scene.id for scene in defaults}
    normalized.extend(scene for scene in parsed.values() if scene.id not in default_ids)
    return normalized


def apply_scene_to_sources(
    sources: list[BroadcastAudioSource], scene: BroadcastAudioScene
) -> list[BroadcastAudioSource]:
    applied: list[BroadcastAudioSource] = []
    for source in sources:
        channel = scene.channels.get(source.id, BroadcastAudioSceneChannel())
        applied.append(
            source.model_copy(update={"gain_db": channel.gain_db, "mix_enabled": channel.enabled})
        )
    return applied


def effective_audio_source(
    settings: BroadcastViewerSettings,
    sources: list[BroadcastCameraSource] | None = None,
    independent_sources: list[BroadcastAudioSource] | None = None,
) -> str:
    sources = sources if sources is not None else camera_sources(settings)
    independent_sources = (
        independent_sources if independent_sources is not None else audio_sources(settings)
    )
    source_ids = {source.id for source in [*sources, *independent_sources]}
    configured = settings.live_audio_source or ""
    if configured == "none":
        return "none"
    if configured == "mix" and independent_sources:
        return "mix"
    if configured in source_ids:
        return configured
    if configured == "independent" and independent_sources:
        return independent_sources[0].id
    if independent_sources:
        return independent_sources[0].id
    return sources[0].id if sources else "none"


def selected_audio_url(settings: BroadcastViewerSettings) -> str | None:
    sources = audio_sources(settings)
    selected_id = effective_audio_source(settings, independent_sources=sources)
    selected = next((source for source in sources if source.id == selected_id), None)
    return selected.url if selected else None


def selected_independent_audio_sources(
    settings: BroadcastViewerSettings,
) -> list[BroadcastAudioSource]:
    sources = audio_sources(settings)
    selected_id = effective_audio_source(settings, independent_sources=sources)
    if selected_id == "mix":
        return [source for source in sources if source.mix_enabled]
    selected = next((source for source in sources if source.id == selected_id), None)
    return [selected] if selected else []


def selected_camera_url(settings: BroadcastViewerSettings) -> str | None:
    sources = camera_sources(settings)
    selected_id = effective_audio_source(settings, sources)
    selected = next((source for source in sources if source.id == selected_id), None)
    return selected.url if selected else None
