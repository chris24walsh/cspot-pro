import asyncio

import pytest
from pydantic import ValidationError

from app.modules.mixer.automation import (
    AutomationConfiguration,
    AutomationState,
    MixerScene,
    SceneAutomation,
    SceneChannel,
    SceneLevel,
    fader_wire,
    scene_commands,
    suggested_scenes,
)
from app.modules.mixer.engine import validate_value


class Desk:
    def __init__(self):
        self.connected = True
        self.syncing = False
        self.recalling = False
        self.host = None
        self.pending = {}
        self.pending_origins = {}
        self.failed = {}
        self.writes = []
        self.values = {
            "/config/buslink/5-6": 1,
            "/ch/01/mix/lr": 1,
            "/ch/01/mix/fader": 0.5,
            "/ch/01/mix/05/level": 0.1,
            "/ch/01/mix/06/level": 0.1,
            "/ch/01/mix/05/tap": 3,
            "/ch/01/mix/06/tap": 3,
            "/ch/01/mix/05/grpon": 0,
            "/ch/01/mix/06/grpon": 0,
        }

    async def configure(self, host):
        self.host = host

    def command_value(self, path, value):
        validate_value(path, value)
        if path not in self.values:
            raise ValueError("Parameter has not been read from this mixer")
        return value

    async def write(self, path, value, *, origin):
        self.writes.append((path, value))
        self.values[path] = value


def config(**overrides):
    scene = MixerScene(
        id="pastor",
        label="Pastor",
        channels={
            "/ch/01": SceneChannel(
                room=SceneLevel(enabled=True, level_db=-6),
                livestream=SceneLevel(enabled=True, level_db=-12),
            )
        },
    )
    other = MixerScene(
        id="worship",
        label="Worship",
        channels={
            "/ch/01": SceneChannel(
                room=SceneLevel(enabled=False),
                livestream=SceneLevel(enabled=False),
            )
        },
    )
    return AutomationConfiguration(**{"enabled": True, "scenes": [scene, other], **overrides})


def cue(cfg, scene="pastor", service="service-1", automation=True):
    return AutomationState(cfg, "192.168.4.106", scene, service, automation)


def test_configuration_is_inert_and_protects_hardware_scope():
    assert not AutomationConfiguration().enabled
    for path in ["/lr", "/headamp/01", "/bus/5", "/config"]:
        with pytest.raises(ValidationError):
            MixerScene(id="bad", label="Bad", channels={path: SceneChannel()})
    with pytest.raises(ValidationError):
        AutomationConfiguration(livestream_bus=6)
    with pytest.raises(ValidationError):
        SceneLevel(level_db=float("nan"))
    cfg = config()
    commands = scene_commands(cfg, cfg.scenes[0])
    assert commands["/ch/01/mix/fader"] == pytest.approx(0.6)
    assert commands["/ch/01/mix/05/level"] == pytest.approx(0.475)
    assert all(path.endswith(("/lr", "/fader", "/level")) for path in commands)
    assert not any(
        path.endswith("/on") or "headamp" in path or "phantom" in path for path in commands
    )


def test_disabled_drafts_do_not_connect_or_write():
    desk = Desk()
    controller = SceneAutomation(desk)
    asyncio.run(controller.tick(cue(config(enabled=False))))
    assert desk.host is None
    assert not desk.writes


@pytest.mark.parametrize("fault", ["unlinked", "post_fader", "missing", "syncing", "recalling"])
def test_preflight_prevents_partial_house_changes(fault):
    desk = Desk()
    if fault == "unlinked":
        desk.values["/config/buslink/5-6"] = 0
    if fault == "post_fader":
        desk.values["/ch/01/mix/06/tap"] = 4
    if fault == "missing":
        desk.values.pop("/ch/01/mix/06/level")
    if fault == "syncing":
        desk.syncing = True
    if fault == "recalling":
        desk.recalling = True
    controller = SceneAutomation(desk)
    asyncio.run(controller.tick(cue(config())))
    assert not desk.writes
    assert controller.status["state"] == "waiting"


def test_each_scene_applies_once_and_manual_adjustments_are_preserved():
    async def scenario():
        desk = Desk()
        controller = SceneAutomation(desk)
        cfg = config()
        await controller.tick(cue(cfg))
        assert len(desk.writes) == 3
        await controller.tick(cue(cfg))
        assert controller.status["state"] == "applied"
        desk.values["/ch/01/mix/fader"] = 0.3
        await controller.tick(cue(cfg))
        assert len(desk.writes) == 3
        assert controller.status["state"] == "adjusted"
        await controller.tick(cue(cfg, "worship"))
        assert desk.values["/ch/01/mix/lr"] == 0
        assert desk.values["/ch/01/mix/05/level"] == 0
        assert desk.values["/ch/01/mix/fader"] == 0.3

    asyncio.run(scenario())


def test_offline_recovery_applies_only_the_latest_section():
    async def scenario():
        desk = Desk()
        desk.connected = False
        controller = SceneAutomation(desk)
        cfg = config()
        await controller.tick(cue(cfg, "pastor"))
        await controller.tick(cue(cfg, "worship"))
        assert not desk.writes
        desk.connected = True
        await controller.tick(cue(cfg, "worship"))
        assert set(desk.writes) == {
            ("/ch/01/mix/lr", 0),
            ("/ch/01/mix/05/level", 0),
            ("/ch/01/mix/06/level", 0),
        }

    asyncio.run(scenario())


def test_pause_discards_automation_retries_but_preserves_manual_commands():
    desk = Desk()
    desk.pending = {"auto": (0, 0, 0), "manual": (1, 0, 0)}
    desk.pending_origins = {"auto": "automation", "manual": "manual"}
    controller = SceneAutomation(desk)
    asyncio.run(controller.tick(cue(config(enabled=False))))
    assert desk.pending == {"manual": (1, 0, 0)}
    assert desk.pending_origins == {"manual": "manual"}


def test_room_only_and_stream_only_have_independent_scope():
    room = config(livestream_enabled=False)
    assert set(scene_commands(room, room.scenes[0])) == {"/ch/01/mix/lr", "/ch/01/mix/fader"}
    stream = config(room_enabled=False)
    assert set(scene_commands(stream, stream.scenes[0])) == {
        "/ch/01/mix/05/level",
        "/ch/01/mix/06/level",
    }


def test_follow_requires_live_service_but_manual_hold_can_be_used_in_rehearsal():
    async def scenario():
        desk = Desk()
        controller = SceneAutomation(desk)
        await controller.tick(cue(config(), service=None))
        await controller.tick(cue(config(), automation=False))
        assert not desk.writes
        cfg = config(follow_service=False, manual_scene_id="worship")
        await controller.tick(cue(cfg, "pastor", service=None, automation=False))
        assert desk.values["/ch/01/mix/lr"] == 0

    asyncio.run(scenario())


def test_suggestions_keep_ambience_out_of_house_and_preserve_unmapped_inputs():
    scenes = {
        scene.id: scene for scene in suggested_scenes({"/ch/01": "ambience", "/rtn/aux": "media"})
    }
    assert scenes["worship"].channels["/rtn/aux"].room.enabled
    assert scenes["worship"].channels["/rtn/aux"].livestream.enabled
    assert not scenes["pre_service"].channels["/rtn/aux"].room.enabled
    assert all(not scene.channels["/ch/01"].room.enabled for scene in scenes.values())
    assert all("/ch/02" not in scene.channels for scene in scenes.values())
    assert fader_wire(0) == 0.75
    assert fader_wire(-90) == 0


def test_service_scene_waits_for_startup_mutes():
    async def scenario():
        desk = Desk()
        desk.startup_muting = True
        worker = SceneAutomation(desk)
        await worker.tick(cue(config()))
        assert not desk.writes
        assert worker.status['detail'] == 'Waiting for startup mute confirmation'
        desk.startup_muting = False
        await worker.tick(cue(config()))
        assert desk.writes
    asyncio.run(scenario())
