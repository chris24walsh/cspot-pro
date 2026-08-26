from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.broadcast.audio_scenes import automatic_scene_for_item
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.routes import update_viewer_settings
from app.modules.broadcast.schemas import BroadcastViewerSettingsUpdate


def test_presentation_state_selects_expected_scene() -> None:
    assert automatic_scene_for_item("song", None) == "worship"
    assert automatic_scene_for_item("sermon", None) == "pastor"
    assert automatic_scene_for_item("pre_service", None) == "media"
    assert automatic_scene_for_item("community", None) == "congregation"
    assert automatic_scene_for_item("song", "play") == "media"
    assert automatic_scene_for_item("video", "stop") == "pastor"


def test_media_scene_mutes_room_and_keeps_desk_return() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__])
    with Session(engine) as session:
        update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                audio_sources=[
                    {"id": "room", "label": "Room mic", "url": "http://audio/room"},
                    {"id": "desk", "label": "Desk feed", "url": "http://audio/desk"},
                ],
                live_audio_source="mix",
            ),
            SimpleNamespace(id="operator"),
            session,
        )
        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(active_audio_scene="media"),
            SimpleNamespace(id="operator"),
            session,
        )

    room, desk = result.audio_sources
    assert result.active_audio_scene == "media"
    assert room.mix_enabled is False
    assert desk.mix_enabled is True
    assert desk.gain_db == 0
