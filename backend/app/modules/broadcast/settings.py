import json

from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.schemas import BroadcastCameraSource


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


def effective_audio_source(
    settings: BroadcastViewerSettings,
    sources: list[BroadcastCameraSource] | None = None,
) -> str:
    sources = sources if sources is not None else camera_sources(settings)
    source_ids = {source.id for source in sources}
    configured = settings.live_audio_source or ""
    if configured == "independent" and settings.live_audio_url:
        return configured
    if configured in source_ids:
        return configured
    if settings.live_audio_url:
        return "independent"
    return sources[0].id if sources else "none"


def selected_camera_url(settings: BroadcastViewerSettings) -> str | None:
    sources = camera_sources(settings)
    selected_id = effective_audio_source(settings, sources)
    selected = next((source for source in sources if source.id == selected_id), None)
    return selected.url if selected else None
