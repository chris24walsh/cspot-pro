import json
from types import SimpleNamespace

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.broadcast.audio_scenes import automatic_scene_for_item
from app.modules.mixer.models import MixerConfiguration
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.routes import update_viewer_settings
from app.modules.broadcast.schemas import (
    BroadcastAudioScene,
    BroadcastAudioSource,
    BroadcastViewerSettingsUpdate,
)
from app.modules.broadcast.settings import apply_scene_to_sources, audio_scenes


def test_presentation_state_selects_expected_scene() -> None:
    assert automatic_scene_for_item("song", None) == "worship"
    assert automatic_scene_for_item("sermon", None) == "pastor"
    assert automatic_scene_for_item("pre_service", None) == "pre_service"
    assert automatic_scene_for_item("pre_service", None, "service") == "pastor"
    assert automatic_scene_for_item("welcome_montage", None, "service") == "pre_service"
    assert automatic_scene_for_item("welcome_countdown", None, "service") == "pre_service"
    assert automatic_scene_for_item("welcome_seated", None, "service") == "pastor"
    assert automatic_scene_for_item("sermon", None, "post_service") == "post_service"
    assert automatic_scene_for_item("open_time", None) == "congregation"
    assert automatic_scene_for_item("song", "play") == "worship"
    assert automatic_scene_for_item("video", "play") == "media"
    assert automatic_scene_for_item("video", "stop") == "pastor"


def test_media_and_pre_service_scenes_use_only_pc_media() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__, MixerConfiguration.__table__])
    with Session(engine) as session:
        update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                audio_sources=[
                    {
                        "id": "room",
                        "label": "Room mic",
                        "url": "http://audio/room",
                        "role": "room",
                    },
                    {
                        "id": "desk",
                        "label": "Desk feed",
                        "url": "http://audio/desk",
                        "role": "desk",
                    },
                    {
                        "id": "pc-media",
                        "label": "Church PC media",
                        "url": "http://audio/pc-media",
                        "role": "media",
                    },
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

    room, desk, media = result.audio_sources
    assert result.active_audio_scene == "media"
    assert room.mix_enabled is False
    assert desk.mix_enabled is False
    assert desk.gain_db == 0
    assert media.mix_enabled is True

    pre_service = next(scene for scene in result.audio_scenes if scene.id == "pre_service")
    assert pre_service.label == "Pre-service"
    assert pre_service.channels["room"].enabled is False
    assert pre_service.channels["desk"].enabled is False
    assert pre_service.channels["pc-media"].enabled is True


def test_legacy_unclassified_source_remains_live_in_routine_scenes_only() -> None:
    settings = BroadcastViewerSettings(
        audio_sources_json=json.dumps(
            [
                {
                    "id": "independent",
                    "label": "Independent audio",
                    "url": "http://audio/independent",
                    "gain_db": -6,
                    "mix_enabled": True,
                }
            ]
        )
    )

    scenes = {scene.id: scene for scene in audio_scenes(settings)}

    for scene_id in ("pastor", "congregation", "worship"):
        channel = scenes[scene_id].channels["independent"]
        assert channel.enabled is True
        assert channel.gain_db == -6
    for scene_id in ("media", "pre_service"):
        channel = scenes[scene_id].channels["independent"]
        assert channel.enabled is False
        assert channel.gain_db == 0


def test_persisted_scenes_merge_current_sources_and_drop_removed_channels() -> None:
    settings = BroadcastViewerSettings(
        audio_sources_json=json.dumps(
            [
                {
                    "id": "desk",
                    "label": "Desk feed",
                    "url": "http://audio/desk",
                    "role": "desk",
                },
                {
                    "id": "pc-media",
                    "label": "Church PC media",
                    "url": "http://audio/pc-media",
                    "role": "media",
                },
                {
                    "id": "aux",
                    "label": "Unclassified feed",
                    "url": "http://audio/aux",
                    "role": "other",
                },
            ]
        ),
        audio_scenes_json=json.dumps(
            [
                {
                    "id": "pastor",
                    "label": "Pastor",
                    "channels": {
                        "desk": {"gain_db": -4, "enabled": True},
                        "removed": {"gain_db": 12, "enabled": True},
                    },
                }
            ]
        ),
    )

    scenes = audio_scenes(settings)
    pastor = next(scene for scene in scenes if scene.id == "pastor")
    media = next(scene for scene in scenes if scene.id == "media")

    assert [scene.id for scene in scenes] == [
        "pastor",
        "congregation",
        "worship",
        "media",
        "pre_service",
        "post_service",
    ]
    assert set(pastor.channels) == {"desk", "pc-media", "aux"}
    assert pastor.channels["desk"].gain_db == -4
    assert pastor.channels["desk"].enabled is True
    assert pastor.channels["pc-media"].enabled is False
    assert pastor.channels["aux"].enabled is True
    assert media.channels["desk"].enabled is False
    assert media.channels["pc-media"].enabled is True
    assert media.channels["aux"].enabled is False


def test_first_media_source_migrates_legacy_media_scene_to_mix_minus() -> None:
    settings = BroadcastViewerSettings(
        audio_sources_json=json.dumps(
            [
                {
                    "id": "desk",
                    "label": "Desk feed",
                    "url": "http://audio/desk",
                    "role": "desk",
                },
                {
                    "id": "pc-media",
                    "label": "Church PC media",
                    "url": "http://audio/pc-media",
                    "role": "media",
                },
            ]
        ),
        audio_scenes_json=json.dumps(
            [
                {
                    "id": "media",
                    "label": "Media",
                    "channels": {"desk": {"gain_db": 0, "enabled": True}},
                }
            ]
        ),
    )

    media = next(scene for scene in audio_scenes(settings) if scene.id == "media")

    assert media.channels["desk"].enabled is False
    assert media.channels["pc-media"].enabled is True


def test_existing_media_mix_preserves_operator_scene_edits() -> None:
    settings = BroadcastViewerSettings(
        audio_sources_json=json.dumps(
            [
                {
                    "id": "desk",
                    "label": "Desk feed",
                    "url": "http://audio/desk",
                    "role": "desk",
                },
                {
                    "id": "pc-media",
                    "label": "Church PC media",
                    "url": "http://audio/pc-media",
                    "role": "media",
                },
            ]
        ),
        audio_scenes_json=json.dumps(
            [
                {
                    "id": "media",
                    "label": "Custom media",
                    "channels": {
                        "desk": {"gain_db": -6, "enabled": True},
                        "pc-media": {"gain_db": -3, "enabled": True},
                    },
                }
            ]
        ),
    )

    media = next(scene for scene in audio_scenes(settings) if scene.id == "media")

    assert media.label == "Custom media"
    assert media.channels["desk"].enabled is True
    assert media.channels["desk"].gain_db == -6
    assert media.channels["pc-media"].gain_db == -3


@pytest.mark.parametrize(
    ("active_scene", "desk_enabled", "media_enabled"),
    [
        ("pastor", True, False),
        ("worship", True, False),
        ("media", False, True),
        ("pre_service", False, True),
    ],
)
def test_adding_first_media_source_applies_the_safe_active_scene(
    active_scene: str,
    desk_enabled: bool,
    media_enabled: bool,
) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__, MixerConfiguration.__table__])
    with Session(engine) as session:
        session.add(
            BroadcastViewerSettings(
                active_audio_scene=active_scene,
                live_audio_source="mix",
                audio_sources_json=json.dumps(
                    [
                        {
                            "id": "desk",
                            "label": "Desk feed",
                            "url": "http://audio/desk",
                            "role": "desk",
                            "mix_enabled": True,
                        }
                    ]
                ),
                audio_scenes_json=json.dumps(
                    [
                        {
                            "id": "media",
                            "label": "Media",
                            "channels": {
                                "desk": {"gain_db": 0, "enabled": True},
                            },
                        }
                    ]
                ),
            )
        )
        session.commit()

        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                audio_sources=[
                    {
                        "id": "desk",
                        "label": "Desk feed",
                        "url": "http://audio/desk",
                        "role": "desk",
                        "mix_enabled": True,
                    },
                    {
                        "id": "pc-media",
                        "label": "Church PC media",
                        "url": "http://audio/pc-media",
                        "role": "media",
                        "mix_enabled": True,
                    },
                ]
            ),
            SimpleNamespace(id="operator"),
            session,
        )

    sources = {source.id: source for source in result.audio_sources}
    active = next(scene for scene in result.audio_scenes if scene.id == active_scene)
    assert result.active_audio_scene == active_scene
    assert sources["desk"].mix_enabled is desk_enabled
    assert sources["pc-media"].mix_enabled is media_enabled
    assert active.channels["desk"].enabled is desk_enabled
    assert active.channels["pc-media"].enabled is media_enabled


def test_missing_scene_channel_is_applied_as_muted() -> None:
    source = BroadcastAudioSource(
        id="new-source",
        label="New source",
        url="http://audio/new",
        gain_db=8,
        mix_enabled=True,
    )
    scene = BroadcastAudioScene(id="pastor", label="Pastor", channels={})

    applied = apply_scene_to_sources([source], scene)

    assert applied[0].gain_db == 0
    assert applied[0].mix_enabled is False


def test_settings_update_persists_normalized_five_scene_configuration() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__, MixerConfiguration.__table__])
    with Session(engine) as session:
        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                audio_sources=[
                    {
                        "id": "desk",
                        "label": "Desk feed",
                        "url": "http://audio/desk",
                        "role": "desk",
                    },
                    {
                        "id": "pc-media",
                        "label": "Church PC media",
                        "url": "http://audio/pc-media",
                        "role": "media",
                    },
                ],
                audio_scenes=[
                    {
                        "id": "pastor",
                        "label": "Pastor",
                        "channels": {
                            "desk": {"gain_db": -3, "enabled": True},
                            "removed": {"gain_db": 10, "enabled": True},
                        },
                    }
                ],
                live_audio_source="mix",
            ),
            SimpleNamespace(id="operator"),
            session,
        )
        stored_json = session.scalar(select(BroadcastViewerSettings.audio_scenes_json).limit(1))

    assert stored_json is not None
    stored = json.loads(stored_json)
    assert [scene["id"] for scene in stored] == [
        "pastor",
        "congregation",
        "worship",
        "media",
        "pre_service",
        "post_service",
    ]
    assert set(stored[0]["channels"]) == {"desk", "pc-media"}
    assert result.audio_scenes[0].channels["desk"].gain_db == -3
    assert result.audio_scenes[0].channels["pc-media"].enabled is False


def test_pc_media_source_can_replace_the_desk_feed() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__, MixerConfiguration.__table__])
    with Session(engine) as session:
        result = update_viewer_settings(
            BroadcastViewerSettingsUpdate(
                audio_sources=[
                    {
                        "id": "desk",
                        "label": "Desk feed",
                        "url": "http://audio/desk",
                        "role": "desk",
                    },
                    {
                        "id": "pc-media",
                        "label": "Church PC media",
                        "url": "http://audio/pc-media",
                        "role": "media",
                    },
                ],
                live_audio_source="pc-media",
            ),
            SimpleNamespace(id="operator"),
            session,
        )

    assert result.live_audio_source == "pc-media"
    assert result.live_audio_url == "http://audio/pc-media"
    assert [source.role for source in result.audio_sources] == ["desk", "media"]


def test_hardware_program_mode_stays_on_stereo_feed_across_scenes(monkeypatch):
    from app.modules.broadcast.audio_mix import audio_mix_inputs, ffmpeg_recording_mix_command
    from app.modules.broadcast.audio_scenes import activate_audio_scene
    from app.modules.broadcast.settings import effective_audio_source
    from pathlib import Path

    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__, MixerConfiguration.__table__])
    with Session(engine) as session:
        settings = BroadcastViewerSettings(
            stream_title="Service", audio_mix_mode="mixer", mixer_program_source_id="program",
            live_audio_source="program", audio_sources_json=json.dumps([
                {"id":"program", "label":"XR18 program", "url":"http://bridge/audio/program.mp3", "gain_db":-12,"mix_enabled":False},
                {"id":"pc", "label":"PC media", "url":"http://bridge/audio/pc.mp3", "role":"media"},
            ]),
        )
        session.add(settings)
        session.commit()
        monkeypatch.setattr("app.modules.broadcast.audio_scenes.reconfigure_active_recording", lambda session: None)
        original = settings.audio_sources_json
        for scene in ("pastor", "media", "worship", "pre_service", "post_service"):
            assert activate_audio_scene(session, settings, scene)
            assert effective_audio_source(settings) == "program"
            inputs = audio_mix_inputs(settings)
            assert len(inputs) == 1
            assert inputs[0].source_id == "program"
            assert inputs[0].gain_db == 0
            assert inputs[0].channels == 2
            assert settings.audio_sources_json == original
        command = ffmpeg_recording_mix_command(inputs, Path("recording.ogg"))
        assert command[command.index("-ac")+1] == "2"
        assert command[command.index("-b:a")+1] == "96k"
        settings.live_audio_source = "none"
        assert effective_audio_source(settings) == "none"


def test_hardware_program_mode_rejects_missing_source():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[BroadcastViewerSettings.__table__, MixerConfiguration.__table__])
    with Session(engine) as session:
        from fastapi import HTTPException
        with pytest.raises(HTTPException) as error:
            update_viewer_settings(
                BroadcastViewerSettingsUpdate(audio_mix_mode="mixer", mixer_program_source_id="missing"),
                SimpleNamespace(id="operator"), session,
            )
        assert error.value.status_code == 422


def test_source_scene_button_holds_matching_hardware_scene_without_a_live_service():
    from app.modules.mixer.automation import AutomationConfiguration, MixerScene, SceneChannel, SceneLevel, configuration
    from app.modules.mixer.models import MixerConfiguration
    from app.modules.mixer.engine import engine as desk

    db = create_engine('sqlite://')
    Base.metadata.create_all(db)
    cfg = AutomationConfiguration(enabled=True, scenes=[MixerScene(
        id='worship', label='Worship', channels={'/ch/01': SceneChannel(
            room=SceneLevel(enabled=True), livestream=SceneLevel(enabled=True))})])
    old_hold = desk.startup_scene_hold
    try:
        desk.startup_scene_hold = True
        with Session(db) as session:
            item = MixerConfiguration(id='xr18', automation_json=cfg.model_dump_json())
            session.add_all([item, BroadcastViewerSettings()])
            session.commit()
            result = update_viewer_settings(BroadcastViewerSettingsUpdate(active_audio_scene='worship'), SimpleNamespace(id='operator'), session)
            saved = configuration(item)
            assert result.active_audio_scene == 'worship'
            assert saved.manual_scene_id == 'worship'
            assert not saved.follow_service
            assert saved.manual_revision == 1
            from app.modules.mixer.routes import hold_automation_scene
            response = hold_automation_scene("worship", session)
            assert response["configuration"].manual_revision == 2
            assert not response["configuration"].follow_service
            assert not desk.startup_scene_hold
    finally:
        desk.startup_scene_hold = old_hold


def test_source_scene_button_rejects_empty_enabled_hardware_preset():
    from fastapi import HTTPException
    from app.modules.mixer.automation import AutomationConfiguration, configuration
    db = create_engine('sqlite://')
    Base.metadata.create_all(db)
    with Session(db) as session:
        item = MixerConfiguration(id='xr18', automation_json=AutomationConfiguration(enabled=True).model_dump_json())
        session.add_all([item, BroadcastViewerSettings()])
        session.commit()
        with pytest.raises(HTTPException) as error:
            update_viewer_settings(BroadcastViewerSettingsUpdate(active_audio_scene='worship'), SimpleNamespace(id='operator'), session)
        assert error.value.status_code == 409
        assert 'Map inputs' in error.value.detail
        assert configuration(item).follow_service
