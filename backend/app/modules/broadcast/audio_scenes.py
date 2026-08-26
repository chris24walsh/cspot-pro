import json

from sqlalchemy.orm import Session

from app.modules.broadcast.audio_mix import live_audio_mix_inputs
from app.modules.broadcast.live_audio import update_live_audio_controls
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.recording import reconfigure_active_recording
from app.modules.broadcast.settings import apply_scene_to_sources, audio_scenes, audio_sources


def activate_audio_scene(
    session: Session, settings: BroadcastViewerSettings, scene_id: str
) -> bool:
    scene = next(
        (candidate for candidate in audio_scenes(settings) if candidate.id == scene_id), None
    )
    if scene is None:
        return False
    sources = apply_scene_to_sources(audio_sources(settings), scene)
    settings.audio_sources_json = json.dumps(
        [source.model_dump() for source in sources], separators=(",", ":")
    )
    settings.active_audio_scene = scene.id
    settings.live_audio_source = "mix" if any(source.mix_enabled for source in sources) else "none"
    session.commit()
    session.refresh(settings)
    update_live_audio_controls(live_audio_mix_inputs(settings))
    reconfigure_active_recording(session)
    return True


def automatic_scene_for_item(item_type: str | None, video_action: str | None) -> str:
    if video_action == "play":
        return "media"
    if item_type == "pre_service":
        return "media"
    if item_type == "song":
        return "worship"
    if item_type in {"seating", "testimony", "sharing", "community", "end", "post_service"}:
        return "congregation"
    return "pastor"
