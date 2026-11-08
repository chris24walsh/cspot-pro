from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.broadcast.audio_scenes import activate_audio_scene
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.mixer.automation import (
    AutomationConfiguration,
    MixerScene,
    SceneChannel,
    SceneLevel,
    configuration,
)
from app.modules.mixer.models import MixerConfiguration
from app.modules.mixer.routes import SceneControl, control_automation
from app.modules.mixer.stream_gate import DeskStreamGate


@pytest.fixture
def setup(monkeypatch):
    db = create_engine("sqlite://")
    Base.metadata.create_all(
        db, tables=[MixerConfiguration.__table__, BroadcastViewerSettings.__table__]
    )
    monkeypatch.setattr("app.modules.mixer.routes.engine", SimpleNamespace(startup_scene_hold=True))
    monkeypatch.setattr(
        "app.modules.broadcast.audio_scenes.reconfigure_active_recording", lambda s: None
    )
    with Session(db) as session:
        cfg = AutomationConfiguration(
            enabled=True,
            scenes=[
                MixerScene(
                    id=key,
                    label=key,
                    channels={"/ch/01": SceneChannel(room=SceneLevel(enabled=True))},
                )
                for key in ["pastor", "pre_service", "worship"]
            ],
        )
        mixer = MixerConfiguration(id="xr18", automation_json=cfg.model_dump_json())
        viewer = BroadcastViewerSettings(active_audio_scene="pastor")
        session.add_all([mixer, viewer])
        session.commit()
        yield session, mixer, viewer


def test_manual_scene_with_auto_on_yields_to_next_cue(setup):
    session, mixer, viewer = setup
    control_automation(SceneControl(scene_id="pre_service"), session)
    assert configuration(mixer).manual_scene_id == "pre_service"
    assert configuration(mixer).follow_service
    assert activate_audio_scene(session, viewer, "worship")
    assert configuration(mixer).manual_scene_id is None


def test_manual_scene_with_auto_off_survives_next_cue(setup):
    session, mixer, viewer = setup
    control_automation(SceneControl(scene_id="pre_service", follow_service=False), session)
    assert activate_audio_scene(session, viewer, "worship")
    assert configuration(mixer).manual_scene_id == "pre_service"
    assert not configuration(mixer).follow_service
    control_automation(SceneControl(follow_service=True), session)
    assert configuration(mixer).manual_scene_id is None
    assert configuration(mixer).follow_service


def test_invalid_selection_does_not_save_toggle(setup):
    session, mixer, viewer = setup
    with pytest.raises(HTTPException) as error:
        control_automation(SceneControl(scene_id="missing", follow_service=False), session)
    assert error.value.status_code == 409
    assert configuration(mixer).follow_service


def test_cannot_arm_disabled_hardware_with_quick_controls(setup):
    session, mixer, viewer = setup
    cfg = configuration(mixer)
    cfg.enabled = False
    mixer.automation_json = cfg.model_dump_json()
    session.commit()
    with pytest.raises(HTTPException) as error:
        control_automation(SceneControl(scene_id="pastor"), session)
    assert error.value.status_code == 409
    assert not configuration(mixer).enabled


@pytest.mark.parametrize("unmuted", [False, True])
@pytest.mark.parametrize("scope", ["both", "room", "stream"])
def test_capture_uses_mute_not_connected_routes_for_normal_scene(
    setup, monkeypatch, unmuted, scope
):
    from app.modules.mixer.automation import fader_wire
    from app.modules.mixer.routes import capture_automation_scene
    session, mixer, viewer = setup
    cfg = configuration(mixer)
    cfg.roles = {"/ch/01": "pastor"}
    cfg.room_enabled = scope != "stream"
    cfg.livestream_enabled = scope != "room"
    mixer.automation_json = cfg.model_dump_json()
    session.commit()
    monkeypatch.setattr("app.modules.mixer.routes.engine", SimpleNamespace(
        connected=True, syncing=False, recalling=False, stream_gate=DeskStreamGate(), values={
            "/ch/01/mix/on": int(unmuted), "/ch/01/mix/lr": 1,
            "/ch/01/mix/fader": fader_wire(-6), "/ch/01/mix/05/level": fader_wire(-12),
        },
    ))
    captured = capture_automation_scene("pastor", session)["configuration"]
    channel = captured.scenes[0].channels["/ch/01"]
    assert channel.room == channel.livestream
    assert channel.room.enabled == unmuted
    assert channel.room.level_db == (-12 if scope == "stream" else -6)
    # Round-trip persistence must retain a muted-but-connected channel as off.
    assert configuration(mixer).scenes[0].channels["/ch/01"] == channel


def test_capture_requires_mute_readback_without_saving_partial_preset(setup, monkeypatch):
    from app.modules.mixer.routes import capture_automation_scene
    session, mixer, viewer = setup
    cfg = configuration(mixer)
    cfg.roles = {"/ch/01": "pastor"}
    mixer.automation_json = cfg.model_dump_json()
    session.commit()
    previous = mixer.automation_json
    monkeypatch.setattr("app.modules.mixer.routes.engine", SimpleNamespace(
        connected=True, syncing=False, recalling=False, stream_gate=DeskStreamGate(), values={},
    ))
    with pytest.raises(HTTPException) as error:
        capture_automation_scene("pastor", session)
    assert error.value.status_code == 409
    assert "mute states" in error.value.detail
    assert mixer.automation_json == previous


def test_capture_preservice_keeps_room_and_stream_separate(setup, monkeypatch):
    from app.modules.mixer.automation import fader_wire
    from app.modules.mixer.routes import capture_automation_scene
    session, mixer, viewer = setup
    cfg = configuration(mixer)
    cfg.roles = {"/ch/01": "worship"}
    mixer.automation_json = cfg.model_dump_json()
    session.commit()
    monkeypatch.setattr("app.modules.mixer.routes.engine", SimpleNamespace(
        connected=True, syncing=False, recalling=False, stream_gate=DeskStreamGate(), values={
            "/ch/01/mix/on": 1, "/ch/01/mix/lr": 1,
            "/ch/01/mix/fader": fader_wire(-6), "/ch/01/mix/05/level": 0,
        },
    ))
    captured = capture_automation_scene("pre_service", session)["configuration"]
    scene = next(scene for scene in captured.scenes if scene.id == "pre_service")
    assert scene.channels["/ch/01"].room.enabled
    assert not scene.channels["/ch/01"].livestream.enabled
