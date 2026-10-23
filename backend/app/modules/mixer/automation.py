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

logger = logging.getLogger(__name__)
STRIP_IDS = {strip["id"] for strip in STRIPS if strip["kind"] in {"input", "aux", "return"}}
SCENES = {
    "pastor": "Pastor",
    "congregation": "Congregation",
    "worship": "Worship",
    "media": "Media",
    "pre_service": "Pre-service",
    "post_service": "Post-service",
}
Role = Literal["pastor", "congregation", "worship", "media", "ambience", "other"]


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
    roles: dict[str, Role] = Field(default_factory=dict, max_length=21)
    scenes: list[MixerScene] = Field(
        default_factory=lambda: [MixerScene(id=key, label=label) for key, label in SCENES.items()],
        max_length=24,
    )

    @model_validator(mode="after")
    def valid_configuration(self):
        if not set(self.roles).issubset(STRIP_IDS):
            raise ValueError("Assign roles only to input, aux and FX-return channels")
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
    for scene_id, label in SCENES.items():
        channels = {}
        for strip_id, role in roles.items():
            if role == "other":
                continue
            on = (
                role == "pastor"
                and scene_id in {"pastor", "congregation"}
                or role == "congregation"
                and scene_id == "congregation"
                or role == "worship"
                and scene_id == "worship"
                or role == "media"
                and scene_id in {"worship", "media", "pre_service", "post_service"}
            )
            ambient_db = {"pastor": -18, "congregation": -6, "worship": -12}.get(scene_id)
            channels[strip_id] = SceneChannel(
                room=SceneLevel(enabled=bool(on and scene_id != "pre_service")),
                livestream=SceneLevel(
                    enabled=on or role == "ambience" and ambient_db is not None,
                    level_db=ambient_db if role == "ambience" and ambient_db is not None else 0,
                ),
            )
        profiles.append(MixerScene(id=scene_id, label=label, channels=channels))
    return profiles


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
    for strip_id, channel in scene.channels.items():
        if cfg.room_enabled and channel.room is not None:
            commands[strip_id + "/mix/lr"] = int(channel.room.enabled)
            if channel.room.enabled:
                commands[strip_id + "/mix/fader"] = fader_wire(channel.room.level_db)
        if cfg.livestream_enabled and channel.livestream is not None:
            level = fader_wire(channel.livestream.level_db) if channel.livestream.enabled else 0.0
            for bus in (cfg.livestream_bus, cfg.livestream_bus + 1):
                commands[f"{strip_id}/mix/{bus:02}/level"] = level
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
                PresentationSession.started_at >= now - timedelta(hours=24),
                or_(
                    (PresentationSession.status == "live") & PresentationSession.ended_at.is_(None),
                    (PresentationSession.status == "ended")
                    & (PresentationSession.ended_at >= now - timedelta(hours=2)),
                ),
            )
            .order_by(PresentationSession.started_at.desc())
            .limit(1)
        )
        live_id = None
        if recent is not None:
            if recent.status == "live":
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
        scene_id = state.service_scene if cfg.follow_service else cfg.manual_scene_id
        self.status = {"state": "paused", "scene_id": scene_id, "detail": "Automation paused"}
        if not cfg.enabled or not (cfg.room_enabled or cfg.livestream_enabled):
            self.cancel_pending()
            self.applied_key = None
            self.status.update(state="disabled", detail="Hardware automation is off")
            return
        if cfg.follow_service and (not state.service_id or not state.service_automation):
            self.cancel_pending()
            self.applied_key = None
            self.status["detail"] = "Waiting for a live service with audio scene automation enabled"
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
        if not self.mixer.connected or self.mixer.syncing or self.mixer.recalling:
            self.cancel_pending()
            self.applied_key = None
            self.status.update(
                state="waiting", detail="Waiting for connected, synchronized mixer readbacks"
            )
            return
        key = (
            state.host,
            cfg.model_dump_json(),
            scene_id,
            state.service_id if cfg.follow_service else None,
        )
        if self.applied_key == key:
            if any(origin == "automation" for origin in self.mixer.pending_origins.values()):
                self.status.update(state="applying", detail="Waiting for hardware confirmation")
            elif any(path in self.mixer.failed for path in self.expected):
                self.status.update(
                    state="error", detail="Scene changes were not confirmed; check mixer connection"
                )
            elif any(
                not math.isclose(float(self.mixer.values.get(path, -999)), value, abs_tol=0.002)
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
        self.applied_key = key
        self.expected = commands
        self.status.update(state="applying", detail="Applying room and livestream scene levels")
        for path, value in commands.items():
            if self.wake is not None and self.wake.is_set():
                self.cancel_pending()
                self.applied_key = None
                return
            if math.isclose(float(self.mixer.values[path]), value, abs_tol=0.002):
                continue
            await self.mixer.write(path, value, origin="automation")
            await asyncio.sleep(0.01)

    async def run(self):
        while True:
            self.wake.clear()
            try:
                await self.tick(await asyncio.to_thread(load_state))
            except asyncio.CancelledError:
                raise
            except Exception:
                self.cancel_pending()
                self.applied_key = None
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
