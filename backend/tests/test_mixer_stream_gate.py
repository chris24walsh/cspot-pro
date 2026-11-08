import asyncio
import time

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.core.database import Base
from app.modules.mixer.automation import (
    AutomationConfiguration,
    AutomationState,
    MixerScene,
    SceneAutomation,
    SceneChannel,
    SceneLevel,
    configuration,
    fader_wire,
)
from app.modules.mixer.engine import MixerEngine
from app.modules.mixer.models import MixerConfiguration
from app.modules.mixer.routes import (
    DeskStreamMute,
    SnapshotName,
    capture_automation_scene,
    save_automation,
    save_snapshot,
    set_desk_stream_mute,
)
from app.modules.mixer.stream_gate import DeskStreamGate


@pytest.fixture
def setup(monkeypatch):
    db = create_engine("sqlite://", poolclass=StaticPool,
                       connect_args={"check_same_thread": False})
    Base.metadata.create_all(db, tables=[MixerConfiguration.__table__])
    desk = MixerEngine()
    desk.transport = object()
    desk.host = "192.168.4.106"
    desk.last_seen = time.monotonic()
    desk.identity = ["XR18"]
    desk.synchronized = True
    desk.values = {
        "/config/buslink/5-6": 1,
        "/ch/01/mix/on": 1, "/ch/01/mix/lr": 1, "/ch/01/mix/fader": .6,
        "/rtn/aux/mix/on": 1, "/rtn/aux/mix/lr": 1, "/rtn/aux/mix/fader": .75,
    }
    for strip, level in [("/ch/01", .6), ("/rtn/aux", .75)]:
        for bus in (5, 6):
            root = f"{strip}/mix/{bus:02}"
            desk.values.update({root + "/level": level, root + "/tap": 3, root + "/grpon": 0})
    sent = []

    def send(path, *args):
        if args:
            sent.append((path, args[0]))
            desk.values[path] = args[0]
            desk.pending.pop(path, None)
            desk.pending_origins.pop(path, None)

    async def configure(_host):
        pass

    desk.send = send
    desk.configure = configure
    monkeypatch.setattr("app.modules.mixer.routes.engine", desk)
    cfg = AutomationConfiguration(
        enabled=True, roles={"/ch/01": "pastor", "/rtn/aux": "media"},
        scenes=[MixerScene(id=key, label=key, channels={
            "/ch/01": SceneChannel(room=SceneLevel(enabled=active, level_db=level)),
            "/rtn/aux": SceneChannel(room=SceneLevel(enabled=True, level_db=0)),
        }) for key, active, level in [("pastor", True, -6), ("worship", False, -18)]],
    )
    with Session(db) as session:
        row = MixerConfiguration(id="xr18", host=desk.host, automation_json=cfg.model_dump_json())
        session.add(row)
        session.commit()
        yield session, desk, sent
    db.dispose()


def toggle(session, muted):
    return asyncio.run(set_desk_stream_mute(DeskStreamMute(muted=muted), session))


def test_desk_gate_preserves_room_channel_switches_and_pc_media(setup):
    session, desk, sent = setup
    before = desk.values.copy()
    response = toggle(session, True)
    assert response == {"muted": True, "confirmed": True, "ready": True, "reason": None}
    assert set(sent) == {
        ("/ch/01/mix/05/level", 0), ("/ch/01/mix/06/level", 0),
    }
    assert all(value == before[path] for path, value in desk.values.items()
               if path not in desk.stream_gate.paths)
    asyncio.run(desk.write("/ch/01/mix/on", 0))
    asyncio.run(desk.write("/ch/01/mix/on", 1))
    assert desk.values["/ch/01/mix/on"] == 1
    assert desk.values["/ch/01/mix/lr"] == 1
    assert desk.values["/ch/01/mix/05/level"] == 0
    assert desk.values["/rtn/aux/mix/05/level"] == .75


def test_repeated_mute_and_manual_send_changes_restore_intended_levels(setup):
    session, desk, sent = setup
    toggle(session, True)
    toggle(session, True)
    asyncio.run(desk.write("/ch/01/mix/05/level", .4))
    assert desk.values["/ch/01/mix/05/level"] == 0
    toggle(session, False)
    assert desk.values["/ch/01/mix/05/level"] == .4
    assert desk.values["/ch/01/mix/06/level"] == .6
    assert desk.values["/rtn/aux/mix/05/level"] == .75
    assert not desk.snapshot()["desk_stream_muted"]
    count = len(sent)
    toggle(session, False)
    assert len(sent) == count


def test_scene_changes_respect_gate_and_restore_latest_scene_sends(setup):
    session, desk, sent = setup
    toggle(session, True)
    cfg = configuration(session.get(MixerConfiguration, "xr18"))
    worker = SceneAutomation(desk)

    async def scenario():
        await worker.tick(AutomationState(cfg, desk.host, "pastor", "service", True))
        # A manual room fader adjustment survives switching only the stream gate.
        await desk.write("/ch/01/mix/fader", .3)
        await worker.tick(AutomationState(cfg, desk.host, "pastor", "service", True))
        assert desk.values["/ch/01/mix/fader"] == .3
        await worker.tick(AutomationState(cfg, desk.host, "worship", "service", True))
    asyncio.run(scenario())
    assert desk.values["/ch/01/mix/05/level"] == 0
    assert desk.values["/rtn/aux/mix/05/level"] == .75
    toggle(session, False)
    assert desk.values["/ch/01/mix/05/level"] == fader_wire(-18)
    assert desk.values["/ch/01/mix/on"] == 0


def test_gate_reloads_and_enforces_mute_even_with_scene_automation_paused(setup):
    session, desk, sent = setup
    toggle(session, True)
    cfg = configuration(session.get(MixerConfiguration, "xr18"))
    cfg.enabled = False
    desk.stream_gate = DeskStreamGate()
    desk.values["/ch/01/mix/05/level"] = .6
    worker = SceneAutomation(desk)
    asyncio.run(worker.tick(AutomationState(cfg, desk.host, "pastor", None, False)))
    assert desk.values["/ch/01/mix/05/level"] == 0
    assert desk.values["/ch/01/mix/on"] == 1
    assert desk.values["/rtn/aux/mix/05/level"] == .75


@pytest.mark.parametrize("fault", ["media", "missing", "offline", "tap", "link"])
def test_gate_preflight_rejects_without_partial_writes(setup, fault):
    session, desk, sent = setup
    if fault == "media":
        row = session.get(MixerConfiguration, "xr18")
        cfg = configuration(row)
        cfg.roles.pop("/rtn/aux")
        row.automation_json = cfg.model_dump_json()
        session.commit()
    if fault == "missing":
        desk.values.pop("/ch/01/mix/06/level")
    if fault == "offline":
        desk.transport = None
    if fault == "tap":
        desk.values["/ch/01/mix/05/tap"] = 4
    if fault == "link":
        desk.values["/config/buslink/5-6"] = 0
    with pytest.raises(HTTPException) as error:
        toggle(session, True)
    assert error.value.status_code == 409
    assert not sent
    assert not configuration(session.get(MixerConfiguration, "xr18")).desk_stream_muted


def test_config_saves_cannot_clear_gate_or_remap_active_sends(setup):
    session, desk, sent = setup
    toggle(session, True)
    row = session.get(MixerConfiguration, "xr18")
    payload = configuration(row)
    payload.desk_stream_muted = False  # A stale editor cannot clear runtime mute.
    payload.desk_stream_restore = {}
    saved = save_automation(payload, session)["configuration"]
    assert saved.desk_stream_muted
    assert saved.desk_stream_restore
    payload.roles["/ch/01"] = "media"
    with pytest.raises(HTTPException):
        save_automation(payload, session)
    assert configuration(session.get(MixerConfiguration, "xr18")).roles["/ch/01"] == "pastor"


def test_capture_and_snapshots_do_not_bake_in_temporary_stream_silence(setup):
    session, desk, sent = setup
    toggle(session, True)
    captured = capture_automation_scene("pastor", session)["configuration"]
    assert captured.scenes[0].channels["/ch/01"].livestream.level_db == -6
    snapshot = save_snapshot(SnapshotName(name="Gate active"), session)
    assert snapshot["values"]["/ch/01/mix/05/level"] == .6
    assert desk.values["/ch/01/mix/05/level"] == 0


def test_failed_release_remains_muted_and_can_be_retried(setup):
    session, desk, sent = setup
    toggle(session, True)
    original = desk.write

    async def fail(*args, **kwargs):
        raise ValueError("Mixer disconnected")

    desk.write = fail
    with pytest.raises(HTTPException):
        toggle(session, False)
    assert desk.stream_gate.paths
    assert configuration(session.get(MixerConfiguration, "xr18")).desk_stream_muted
    desk.write = original
    toggle(session, False)
    assert desk.values["/ch/01/mix/05/level"] == .6
    assert not configuration(session.get(MixerConfiguration, "xr18")).desk_stream_muted


def test_restore_updates_are_durable_without_rearming_a_released_gate(setup, monkeypatch):
    from app.modules.mixer.automation import persist_stream_targets
    session, desk, sent = setup
    bind = session.get_bind()
    monkeypatch.setattr("app.modules.mixer.automation.SessionLocal", lambda: Session(bind))
    toggle(session, True)
    asyncio.run(desk.write("/ch/01/mix/05/level", .4))
    targets = desk.stream_gate.targets.copy()
    persist_stream_targets(desk.host, targets)
    session.expire_all()
    assert configuration(session.get(MixerConfiguration, "xr18")).desk_stream_restore == targets
    toggle(session, False)
    persist_stream_targets(desk.host, targets)  # Late background work cannot restore mute.
    session.expire_all()
    assert not configuration(session.get(MixerConfiguration, "xr18")).desk_stream_muted


def test_preservice_media_stays_audible_and_room_rehearsal_stays_off_stream(setup):
    session, desk, sent = setup
    toggle(session, True)
    cfg = configuration(session.get(MixerConfiguration, "xr18"))
    cfg.scenes.append(MixerScene(id="pre_service", label="Pre-service", channels={
        "/ch/01": SceneChannel(room=SceneLevel(enabled=True, level_db=-6),
                               livestream=SceneLevel(enabled=False, level_db=-6)),
        "/rtn/aux": SceneChannel(room=SceneLevel(enabled=False),
                                 livestream=SceneLevel(enabled=True, level_db=0)),
    }))
    worker = SceneAutomation(desk)
    asyncio.run(worker.tick(AutomationState(cfg, desk.host, "pre_service", "service", True)))
    assert desk.values["/ch/01/mix/on"] == 1
    assert desk.values["/ch/01/mix/lr"] == 1
    assert desk.values["/ch/01/mix/05/level"] == 0
    assert desk.values["/rtn/aux/mix/05/level"] == .75
    assert desk.values["/rtn/aux/mix/on"] == 1
    toggle(session, False)
    assert desk.values["/ch/01/mix/05/level"] == 0
    assert desk.values["/rtn/aux/mix/05/level"] == .75


def test_stale_scene_state_cannot_rearm_gate_after_operator_releases_it(setup):
    session, desk, sent = setup
    toggle(session, True)
    stale = configuration(session.get(MixerConfiguration, "xr18"))
    stale.enabled = False
    toggle(session, False)
    worker = SceneAutomation(desk)
    asyncio.run(worker.tick(AutomationState(stale, desk.host, "pastor", None, False)))
    assert not desk.stream_gate.paths
    assert desk.values["/ch/01/mix/05/level"] == .6


def test_gate_uses_latest_scene_level_if_it_changes_during_database_work(setup, monkeypatch):
    from app.modules.mixer import routes
    session, desk, sent = setup
    original = routes.run_in_threadpool

    async def after_prepare(fn):
        result = await original(fn)
        if fn.__name__ == "prepare":
            desk.values["/ch/01/mix/05/level"] = .5
        return result

    monkeypatch.setattr(routes, "run_in_threadpool", after_prepare)
    toggle(session, True)
    assert desk.stream_gate.targets["/ch/01/mix/05/level"] == .5
    toggle(session, False)
    assert desk.values["/ch/01/mix/05/level"] == .5
