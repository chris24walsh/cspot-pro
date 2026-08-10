import json

from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.schemas import BroadcastAudioSource, BroadcastCameraSource


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


def effective_audio_source(
    settings: BroadcastViewerSettings,
    sources: list[BroadcastCameraSource] | None = None,
    independent_sources: list[BroadcastAudioSource] | None = None,
) -> str:
    sources = sources if sources is not None else camera_sources(settings)
    independent_sources = independent_sources if independent_sources is not None else audio_sources(settings)
    source_ids = {source.id for source in [*sources, *independent_sources]}
    configured = settings.live_audio_source or ""
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


def selected_camera_url(settings: BroadcastViewerSettings) -> str | None:
    sources = camera_sources(settings)
    selected_id = effective_audio_source(settings, sources)
    selected = next((source for source in sources if source.id == selected_id), None)
    return selected.url if selected else None
