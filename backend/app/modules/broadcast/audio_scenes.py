from sqlalchemy.orm import Session

from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.recording import reconfigure_active_recording
from app.modules.broadcast.settings import audio_scenes


def activate_audio_scene(
    session: Session, settings: BroadcastViewerSettings, scene_id: str, *, manual: bool = False
) -> bool:
    scene = next(
        (candidate for candidate in audio_scenes(settings) if candidate.id == scene_id), None
    )
    if scene is None:
        return False
    # Scenes control desk sends. The finished program feed stays at unity gain.
    if not manual:
        from app.modules.mixer.automation import configuration
        from app.modules.mixer.models import MixerConfiguration
        mixer = session.get(MixerConfiguration, "xr18")
        cfg = configuration(mixer)
        if mixer and cfg.follow_service and cfg.manual_scene_id:
            cfg.manual_scene_id = None
            mixer.automation_json = cfg.model_dump_json()
    settings.active_audio_scene = scene.id
    session.commit()
    session.refresh(settings)
    from app.modules.mixer.automation import automation
    automation.notify()
    reconfigure_active_recording(session)
    return True


def automatic_scene_for_item(
    item_type: str | None,
    video_action: str | None,
    service_stage: str | None = None,
) -> str:
    if service_stage == "post_service":
        return "post_service"
    if service_stage == "pre_service":
        return "pre_service"
    if item_type in {"welcome_montage", "welcome_countdown"}:
        return "pre_service"
    if item_type in {"pre_service", "welcome_seated"} and service_stage != "service":
        return "pre_service"
    # A song backing track is deliberately carried through the sound desk so
    # the livestream retains the live musicians and vocals alongside it.  The
    # direct PC-media route is reserved for standalone media, where muting the
    # desk return removes the duplicated PC playback cleanly.
    if item_type == "song":
        return "worship"
    if video_action == "play":
        return "media"
    if item_type in {
        "seating",
        "testimony",
        "sharing",
        "community",
        "open_time",
        "end",
        "post_service",
    }:
        return "congregation"
    return "pastor"
