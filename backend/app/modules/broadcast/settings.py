import json

from app.modules.broadcast.models import BroadcastViewerSettings
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


def _source_kind(source: BroadcastAudioSource) -> str:
    name = f"{source.id} {source.label}".lower()
    if any(token in name for token in ("room", "ambient", "audience", "congregation")):
        return "room"
    if any(token in name for token in ("desk", "mixer", "board", "console")):
        return "desk"
    return "other"


def default_audio_scenes(sources: list[BroadcastAudioSource]) -> list[BroadcastAudioScene]:
    scene_levels = {
        "pastor": {"room": (-18, True), "desk": (0, True)},
        "congregation": {"room": (0, True), "desk": (-12, True)},
        "worship": {"room": (-12, True), "desk": (0, True)},
        "media": {"room": (-30, False), "desk": (0, True)},
    }
    return [
        BroadcastAudioScene(
            id=scene_id,
            label=label,
            channels={
                source.id: BroadcastAudioSceneChannel(
                    gain_db=scene_levels[scene_id].get(
                        _source_kind(source), (source.gain_db, source.mix_enabled)
                    )[0],
                    enabled=scene_levels[scene_id].get(
                        _source_kind(source), (source.gain_db, source.mix_enabled)
                    )[1],
                )
                for source in sources
            },
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
    return [parsed.get(scene.id, scene) for scene in defaults]


def apply_scene_to_sources(
    sources: list[BroadcastAudioSource], scene: BroadcastAudioScene
) -> list[BroadcastAudioSource]:
    return [
        source.model_copy(
            update={
                "gain_db": scene.channels.get(source.id, BroadcastAudioSceneChannel()).gain_db,
                "mix_enabled": scene.channels.get(
                    source.id, BroadcastAudioSceneChannel()
                ).enabled,
            }
        )
        for source in sources
    ]


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
