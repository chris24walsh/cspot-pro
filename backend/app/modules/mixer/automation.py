"""Presentation-driven XR18 levels. Configuration is inert until explicitly enabled."""

import asyncio
import logging
import math
from contextlib import suppress
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal

from pydantic import BaseModel, Field, model_validator
from sqlalchemy import or_, select

from app.core.database import SessionLocal
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.mixer.catalog import STRIPS
from app.modules.mixer.engine import engine
from app.modules.mixer.models import MixerConfiguration
from app.modules.presentation.models import PresentationSession

logger = logging.getLogger("uvicorn.error." + __name__)
STRIP_IDS = {strip["id"] for strip in STRIPS if strip["kind"] in {"input", "aux", "return"}}
SCENES = {
    "pastor": "Pastor",
    "congregation": "Congregation",
    "worship": "Worship",
    "media": "Media",
    "pre_service": "Pre-service",
    "post_service": "Post-service",
}
Role = Literal["pastor", "leader", "congregation", "worship", "media", "ambience", "other"]


class SceneLevel(BaseModel):
    enabled: bool = False
    level_db: float = Field(default=0, ge=-90, le=10, allow_inf_nan=False)


class SceneChannel(BaseModel):
    room: SceneLevel | None = None
    livestream: SceneLevel | None = None


class MixerScene(BaseModel):
    id: str = Field(min_length=1, max_length=80, pattern=r"^[a-zA-Z0-9_-]+$")
    label: str = Field(min_length=1, max_length=80)
    channels: dict[str, SceneChannel] = Field(default_factory=dict, max_length=21)

    @model_validator(mode="after")
    def link_service_mixes(self):
        # Room is the authority for old split presets. Pre-service deliberately
        # retains independent routing (room rehearsal versus streamed media).
        if self.id != "pre_service":
            for channel in self.channels.values():
                level = channel.room or channel.livestream
                if level is not None:
                    channel.room = level.model_copy()
                    channel.livestream = level.model_copy()
        return self

    @model_validator(mode="after")
    def valid_channels(self):
        if not set(self.channels).issubset(STRIP_IDS):
            raise ValueError("Scenes may control only input, aux and FX-return channels")
        return self


class AutomationConfiguration(BaseModel):
    enabled: bool = False
    follow_service: bool = True
    room_enabled: bool = True
    livestream_enabled: bool = True
    livestream_bus: Literal[1, 3, 5] = 5
    manual_scene_id: str | None = Field(default=None, max_length=80)
    manual_revision: int = Field(default=0, ge=0)
    desk_stream_muted: bool = False
    desk_stream_restore: dict[str, float] = Field(default_factory=dict, max_length=42)
    roles: dict[str, Role] = Field(default_factory=dict, max_length=21)
    scenes: list[MixerScene] = Field(
        default_factory=lambda: [MixerScene(id=key, label=label) for key, label in SCENES.items()],
        max_length=24,
    )

    @model_validator(mode="after")
    def valid_configuration(self):
        if any(
            path not in {
                f"{strip}/mix/{bus:02}/level" for strip in STRIP_IDS for bus in range(1, 7)
            }
            or not math.isfinite(value) or not 0 <= value <= 1
            for path, value in self.desk_stream_restore.items()
        ):
            raise ValueError("Invalid saved desk stream sends")
        if not set(self.roles).issubset(STRIP_IDS):
            raise ValueError("Assign roles only to input, aux and FX-return channels")
        if self.desk_stream_muted:
            from app.modules.mixer.stream_gate import desk_send_paths
            if set(self.desk_stream_restore) != desk_send_paths(self):
                raise ValueError("Saved desk stream sends must match the mapped desk inputs")
        ids = [scene.id for scene in self.scenes]
        if len(ids) != len(set(ids)):
            raise ValueError("Scene IDs must be unique")
        if self.manual_scene_id and self.manual_scene_id not in ids:
            raise ValueError("The manual scene must be configured")
        return self


def configuration(item: MixerConfiguration | None) -> AutomationConfiguration:
    if item is None or not item.automation_json:
        return AutomationConfiguration()
    # Invalid configuration must never arm the desk accidentally.
    try:
        return AutomationConfiguration.model_validate_json(item.automation_json)
    except ValueError:
        logger.warning("Invalid XR18 automation configuration; hardware automation disabled")
        return AutomationConfiguration()


def suggested_scenes(roles: dict[str, Role]) -> list[MixerScene]:
    """Draft levels for explicitly mapped channels; unmapped inputs stay untouched."""
    profiles = []
    profiles_by_id = dict(SCENES)
    if "leader" in roles.values():
        profiles_by_id["service_leader"] = "Service leader"
    for scene_id, label in profiles_by_id.items():
        channels = {}
        for strip_id, role in roles.items():
            if role == "other":
                continue
            on = (
                role == "pastor"
                and scene_id == "pastor"
                or role == "leader"
                and scene_id == "service_leader"
                or role == "congregation"
                and scene_id == "congregation"
                or role == "worship"
                and scene_id == "worship"
                or role == "media"
                and scene_id in {"worship", "media", "pre_service", "post_service"}
            )
            ambient_db = {"pastor": -18, "congregation": -6, "worship": -12}.get(scene_id)
            channels[strip_id] = SceneChannel(
                room=SceneLevel(
                    enabled=(role == "worship" if scene_id == "pre_service" else bool(on))
                ),
                livestream=SceneLevel(
                    enabled=on,
                    level_db=ambient_db if role == "ambience" and ambient_db is not None else 0,
                ),
            )
        profiles.append(MixerScene(id=scene_id, label=label, channels=channels))
    return profiles


def hold_manual_scene(session, scene_id: str, *, hold: bool = True) -> bool:
    """An explicit scene-button click can audition a configured desk without a service."""
    item = session.get(MixerConfiguration, "xr18")
    cfg = configuration(item)
    if not cfg.enabled:
        return False
    scene = next((scene for scene in cfg.scenes if scene.id == scene_id), None)
    if scene is None or not scene_commands(cfg, scene):
        raise ValueError("Map inputs and save a hardware preset for this scene before applying it")
    cfg.follow_service = not hold
    cfg.manual_scene_id = scene_id
    cfg.manual_revision += 1
    item.automation_json = cfg.model_dump_json()
    return True


def fader_wire(db: float) -> float:
    if db <= -90:
        return 0.0
    if db >= -10:
        return (db + 30) / 40
    if db >= -30:
        return (db + 50) / 80
    if db >= -60:
        return (db + 70) / 160
    return (db + 90) / 480


def scene_commands(cfg: AutomationConfiguration, scene: MixerScene) -> dict[str, float | int]:
    commands = {}
    opens = {}
    separate_routes = scene.id == "pre_service"
    for strip_id, channel in scene.channels.items():
        room = channel.room if cfg.room_enabled else None
        stream = channel.livestream if cfg.livestream_enabled else None
        if (room and room.enabled) or (stream and stream.enabled):
            opens[strip_id + "/mix/on"] = 1
        elif room is not None or stream is not None:
            commands[strip_id + "/mix/on"] = 0
        if cfg.room_enabled and channel.room is not None:
            commands[strip_id + "/mix/lr"] = int(channel.room.enabled or not separate_routes)
            if channel.room.enabled or not separate_routes:
                commands[strip_id + "/mix/fader"] = fader_wire(channel.room.level_db)
        if cfg.livestream_enabled and channel.livestream is not None:
            level = (
                fader_wire(channel.livestream.level_db)
                if channel.livestream.enabled or not separate_routes else 0.0
            )
            for bus in (cfg.livestream_bus, cfg.livestream_bus + 1):
                commands[f"{strip_id}/mix/{bus:02}/level"] = level
    # Route and set levels before opening microphones.
    commands.update(opens)
    return commands


def check_routing(cfg: AutomationConfiguration, scene: MixerScene, values: dict) -> None:
    if not cfg.livestream_enabled or not any(
        c.livestream is not None for c in scene.channels.values()
    ):
        return
    left = cfg.livestream_bus
    if values.get(f"/config/buslink/{left}-{left + 1}") != 1:
        raise ValueError(
            f"Link livestream buses {left}/{left + 1} in Routing before enabling scenes"
        )
    for strip_id, channel in scene.channels.items():
        if channel.livestream is None:
            continue
        for bus in (left, left + 1):
            root = f"{strip_id}/mix/{bus:02}"
            if values.get(root + "/tap") != 3 or values.get(root + "/grpon") != 0:
                raise ValueError(f"Set {strip_id} Bus {bus} to Pre fader, with subgroup off")


@dataclass(frozen=True)
class AutomationState:
    config: AutomationConfiguration
    host: str | None
    service_scene: str
    service_id: str | None
    service_automation: bool


def load_state() -> AutomationState:
    with SessionLocal() as session:
        item = session.get(MixerConfiguration, "xr18")
        settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        now = datetime.now(UTC)
        recent = session.scalar(
            select(PresentationSession)
            .where(
                or_(
                    (PresentationSession.status == "ready")
                    & PresentationSession.ended_at.is_(None)
                    & (PresentationSession.updated_at >= now - timedelta(minutes=30)),
                    (PresentationSession.started_at >= now - timedelta(hours=24))
                    & or_(
                        (PresentationSession.status == "live")
                        & PresentationSession.ended_at.is_(None),
                        (PresentationSession.status == "ended")
                        & (PresentationSession.ended_at >= now - timedelta(hours=2)),
                    ),
                ),
            )
            .order_by(PresentationSession.updated_at.desc())
            .limit(1)
        )
        live_id = None
        if recent is not None:
            if recent.status == "ready":
                live_id = "preview:" + recent.id
            elif recent.status == "live":
                live_id = recent.id
            elif settings and settings.active_audio_scene == "post_service":
                live_id = "post:" + recent.id
        return AutomationState(
            configuration(item),
            item.host if item else None,
            settings.active_audio_scene if settings else "pastor",
            live_id,
            bool(settings and settings.audio_scene_automation),
        )


def persist_stream_targets(host, targets):
    """Keep restore levels durable without letting a stale worker re-arm a gate."""
    from app.modules.mixer.stream_gate import desk_send_paths
    with SessionLocal() as session:
        item = session.scalar(
            select(MixerConfiguration).where(MixerConfiguration.id == "xr18").with_for_update()
        )
        cfg = configuration(item)
        if (item and item.host == host and cfg.desk_stream_muted
                and set(targets) == desk_send_paths(cfg) and cfg.desk_stream_restore != targets):
            cfg.desk_stream_restore = targets
            item.automation_json = cfg.model_dump_json()
            session.commit()


class SceneAutomation:
    def __init__(self, mixer=engine):
        self.mixer = mixer
        self.task = None
        self.loop = None
        self.wake = None
        self.applied_key = None
        self.expected = {}
        self.status = {
            "state": "disabled",
            "scene_id": None,
            "detail": "Hardware automation is off",
        }

    def cancel_pending(self):
        for path, origin in list(self.mixer.pending_origins.items()):
            if origin == "automation":
                self.mixer.pending.pop(path, None)
                self.mixer.pending_origins.pop(path, None)

    async def tick(self, state: AutomationState):
        cfg = state.config
        # Restore once at process startup. A stale state read must never re-arm
        # the gate after an operator has released it through the API.
        if not self.mixer.stream_gate.initialized:
            self.mixer.stream_gate.initialized = True
            if cfg.desk_stream_muted:
                self.mixer.stream_gate.activate(cfg.desk_stream_restore)
        if (self.mixer.stream_gate.paths and self.mixer.connected
                and not self.mixer.syncing and not self.mixer.recalling
                and not getattr(self.mixer, "startup_muting", False)):
            for path in self.mixer.stream_gate.paths:
                if path in self.mixer.values and self.mixer.values[path] != 0:
                    await self.mixer.write(
                        path, self.mixer.stream_gate.targets[path], origin="stream_gate"
                    )
        scene_id = (
            cfg.manual_scene_id or state.service_scene
            if cfg.follow_service
            else cfg.manual_scene_id
        )
        self.status = {"state": "paused", "scene_id": scene_id, "detail": "Automation paused"}
        if not cfg.enabled or not (cfg.room_enabled or cfg.livestream_enabled):
            self.cancel_pending()
            self.applied_key = None
            self.status.update(state="disabled", detail="Hardware automation is off")
            return
        if (
            cfg.follow_service
            and not cfg.manual_scene_id
            and (not state.service_id or not state.service_automation)
        ):
            self.cancel_pending()
            self.applied_key = None
            self.status["detail"] = (
                "Waiting for a selected service with audio scene automation enabled"
            )
            return
        if not cfg.follow_service and not scene_id:
            self.cancel_pending()
            self.applied_key = None
            self.status["detail"] = "Choose Apply & hold, or resume following service cues"
            return
        scene = next((s for s in cfg.scenes if s.id == scene_id), None)
        if scene is None:
            self.cancel_pending()
            self.applied_key = None
            self.status.update(state="error", detail="This service scene has no hardware preset")
            return
        if not state.host:
            self.cancel_pending()
            self.applied_key = None
            self.status.update(
                state="waiting", detail="Connect an XR18 before enabling hardware scenes"
            )
            return
        await self.mixer.configure(state.host)
        if getattr(self.mixer, "startup_muting", False):
            self.cancel_pending()
            self.applied_key = None
            self.status.update(state="waiting", detail="Waiting for startup mute confirmation")
            return
        if not self.mixer.connected or self.mixer.syncing or self.mixer.recalling:
            self.cancel_pending()
            # Reading the desk again is not a new cue. Retain the last applied
            # scene so recovery cannot erase live manual adjustments.
            self.status.update(
                state="waiting", detail="Waiting for connected, synchronized mixer readbacks"
            )
            return
        if getattr(self.mixer, "startup_scene_hold", False):
            self.cancel_pending()
            self.applied_key = None
            self.status.update(
                state="waiting", detail="Startup muted: apply a scene or unmute when ready"
            )
            return
        commands = scene_commands(cfg, scene)
        service_id = state.service_id
        if service_id:
            service_id = service_id.removeprefix("preview:").removeprefix("post:")
        key = (
            state.host,
            scene_id,
            tuple(sorted(commands.items())),
            cfg.manual_revision,
            service_id if cfg.follow_service else None,
        )
        if self.applied_key == key:
            if any(origin == "automation" for origin in self.mixer.pending_origins.values()):
                self.status.update(state="applying", detail="Waiting for hardware confirmation")
            elif any(path in self.mixer.failed for path in self.expected):
                self.status.update(
                    state="error", detail="Scene changes were not confirmed; check mixer connection"
                )
            elif any(
                not math.isclose(float(self.mixer.values.get(path, -999)),
                                 self.mixer.stream_gate.effective(path, value), abs_tol=0.002)
                for path, value in self.expected.items()
            ):
                self.status.update(
                    state="adjusted", detail="Manual adjustments retained until the next scene"
                )
            else:
                self.status.update(state="applied", detail="Scene confirmed by the mixer")
            return
        self.cancel_pending()
        commands = scene_commands(cfg, scene)
        if not commands:
            self.status.update(
                state="waiting",
                detail="Map inputs and save scene levels before enabling automation",
            )
            return
        try:
            check_routing(cfg, scene, self.mixer.values)
            # Validate every command before sending any of them. In particular,
            # missing readbacks must never cause a half-applied house/stream scene.
            for path, value in commands.items():
                self.mixer.command_value(path, value)
        except ValueError as error:
            self.status.update(state="waiting", detail=str(error))
            return
        self.expected = commands
        self.status.update(state="applying", detail="Applying room and livestream scene levels")
        logger.info(
            "Applying hardware scene scene=%s service=%s manual_revision=%s commands=%s",
            scene_id, state.service_id, cfg.manual_revision, len(commands),
        )
        for path, value in commands.items():
            if self.wake is not None and self.wake.is_set():
                self.cancel_pending()
                self.applied_key = None
                return
            self.mixer.stream_gate.remember(path, value)
            effective = self.mixer.stream_gate.effective(path, value)
            if math.isclose(float(self.mixer.values[path]), effective, abs_tol=0.002):
                continue
            await self.mixer.write(path, value, origin="automation")
            await asyncio.sleep(0.01)
        self.applied_key = key

    async def run(self):
        while True:
            self.wake.clear()
            try:
                state = await asyncio.to_thread(load_state)
                await self.tick(state)
                targets = self.mixer.stream_gate.targets.copy()
                if targets and targets != state.config.desk_stream_restore:
                    await asyncio.to_thread(persist_stream_targets, state.host, targets)
            except asyncio.CancelledError:
                raise
            except Exception:
                self.cancel_pending()
                self.status.update(
                    state="error", detail="Could not load or apply the current hardware scene"
                )
                logger.exception("Hardware scene automation failed")
            try:
                await asyncio.wait_for(self.wake.wait(), timeout=1)
            except TimeoutError:
                pass

    def notify(self):
        if self.loop is not None and self.wake is not None and not self.loop.is_closed():
            with suppress(RuntimeError):
                self.loop.call_soon_threadsafe(self.wake.set)

    def start(self):
        self.loop = asyncio.get_running_loop()
        self.wake = asyncio.Event()
        self.task = asyncio.create_task(self.run())

    async def stop(self):
        if self.task:
            self.task.cancel()
            with suppress(asyncio.CancelledError):
                await self.task
            self.task = None
        self.cancel_pending()
        self.applied_key = None
        self.loop = self.wake = None


automation = SceneAutomation()
