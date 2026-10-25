import asyncio
import ipaddress
import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import require_permission
from app.modules.mixer.automation import AutomationConfiguration
from app.modules.mixer.catalog import PARAMETERS, STRIPS
from app.modules.mixer.engine import discover, engine, validate_host
from app.modules.mixer.models import MixerConfiguration

router = APIRouter(dependencies=[Depends(require_permission("mixer:use"))])


def config(session):
    item = session.get(MixerConfiguration, "xr18")
    if item is None:
        item = MixerConfiguration(id="xr18", snapshots_json="[]")
        session.add(item)
        try:
            session.commit()
        except IntegrityError:
            # State, stream and snapshot requests can initialize concurrently.
            session.rollback()
            item = session.get(MixerConfiguration, "xr18")
    return item


class Connection(BaseModel):
    host: str | None = None


class Discovery(BaseModel):
    subnet: str | None = None


class Command(BaseModel):
    path: str
    value: str | float | int
    confirm_phantom: bool = False


class Commands(BaseModel):
    commands: list[Command] = Field(min_length=1, max_length=32)


class SnapshotName(BaseModel):
    name: str = Field(min_length=1, max_length=80, pattern=r".*\S.*")


@router.get("/catalog")
def catalog():
    return dict(strips=STRIPS, parameters=PARAMETERS)


@router.get("/state")
async def state(session: Session = Depends(get_session)):
    item = config(session)
    await engine.configure(item.host)
    return engine.snapshot()


@router.put("/connection")
async def connect(payload: Connection, session: Session = Depends(get_session)):
    if engine.recalling:
        raise HTTPException(409, "Wait for snapshot recall to finish")
    try:
        host = validate_host(payload.host) if payload.host else None
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    item = config(session)
    item.host = host
    session.commit()
    await engine.configure(host)
    return engine.snapshot()


@router.post("/discover")
async def discovery(payload: Discovery):
    hosts = ["255.255.255.255"]
    if payload.subnet:
        try:
            network = ipaddress.IPv4Network(payload.subnet, strict=False)
            if not network.is_private or network.prefixlen < 24:
                raise ValueError("Discovery accepts a private /24 or smaller subnet")
            hosts = [str(host) for host in network.hosts()]
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
    try:
        return await discover(hosts)
    except OSError as exc:
        raise HTTPException(
            503, "Mixer discovery could not access the server network. Check its LAN connection."
        ) from exc


@router.post("/command")
async def command(payload: Command):
    if engine.recalling:
        raise HTTPException(409, "Wait for snapshot recall to finish")
    if payload.path.endswith("/phantom") and payload.value == 1 and not payload.confirm_phantom:
        raise HTTPException(409, "Confirm enabling 48V phantom power")
    try:
        await engine.write(payload.path, payload.value)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"status": "pending", "path": payload.path}


@router.post("/commands")
async def commands(payload: Commands):
    if engine.recalling:
        raise HTTPException(409, "Wait for snapshot recall to finish")
    # Validate the complete batch before applying any of it.
    validated = []
    try:
        for command in payload.commands:
            if (
                command.path.endswith("/phantom")
                and command.value == 1
                and not command.confirm_phantom
            ):
                raise ValueError("Confirm enabling 48V phantom power")
            validated.append((command.path, engine.command_value(command.path, command.value)))
        for path, value in validated:
            await engine.write(path, value)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    return {"status": "pending", "paths": [path for path, _ in validated]}


@router.post("/sync")
async def sync():
    if engine.recalling:
        raise HTTPException(409, "Wait for snapshot recall to finish")
    if not engine.connected:
        raise HTTPException(409, "Mixer is offline")
    if not engine.sync_task or engine.sync_task.done():
        engine.sync_task = asyncio.create_task(engine.synchronize())
    return {"status": "syncing"}


@router.get("/events")
async def events(session: Session = Depends(get_session)):
    host = config(session).host
    # Release the authentication/config DB connection before the long-lived stream.
    session.close()
    await engine.configure(host)

    async def stream():
        previous = {}
        previous_host = object()
        previous_fx = {}
        while True:
            state = engine.snapshot()
            reset = state["host"] != previous_host
            state["reset"] = reset
            current = state["values"]
            if not reset:
                state["values"] = {p: v for p, v in current.items() if previous.get(p) != v}
            state["removed"] = [p for p in previous if p not in current]
            fx_specs = state["fx_specs"]
            if not reset:
                state["fx_specs"] = {p: v for p, v in fx_specs.items() if previous_fx.get(p) != v}
            state["removed_fx"] = [p for p in previous_fx if p not in fx_specs]
            previous_fx = fx_specs
            previous, previous_host = current, state["host"]
            yield "data: " + json.dumps(state, separators=(",", ":"), allow_nan=False) + "\n\n"
            await asyncio.sleep(0.05)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "private, no-store, no-transform",
            "X-Accel-Buffering": "no",
            "Content-Encoding": "identity",
        },
    )


@router.get("/snapshots")
def snapshots(session: Session = Depends(get_session)):
    return json.loads(config(session).snapshots_json)


@router.post("/snapshots")
def save_snapshot(payload: SnapshotName, session: Session = Depends(get_session)):
    if (
        not engine.connected
        or not engine.synchronized
        or engine.syncing
        or engine.pending
        or engine.recalling
    ):
        raise HTTPException(409, "Wait for a connected, synchronized mixer with no pending changes")
    item = config(session)
    entries = json.loads(item.snapshots_json)
    if len(entries) >= 50:
        raise HTTPException(409, "Maximum 50 snapshots; delete an old snapshot first")
    entry = dict(
        id=str(uuid.uuid4()),
        name=payload.name.strip(),
        created_at=datetime.now(UTC).isoformat(),
        identity=engine.identity,
        values=engine.values.copy(),
    )
    entries.append(entry)
    item.snapshots_json = json.dumps(entries)
    session.commit()
    return entry


@router.post("/snapshots/{snapshot_id}/recall")
async def recall(snapshot_id: str, session: Session = Depends(get_session)):
    entries = json.loads(config(session).snapshots_json)
    entry = next((e for e in entries if e["id"] == snapshot_id), None)
    if not entry:
        raise HTTPException(404, "Snapshot not found")
    if (
        not engine.connected
        or not engine.synchronized
        or engine.syncing
        or engine.pending
        or engine.recalling
    ):
        raise HTTPException(409, "Wait for a connected, synchronized mixer with no pending changes")
    # Phantom and preamp gain are always recall-safe. Never power an attached mic via a scene.
    values = {
        p: v
        for p, v in entry["values"].items()
        if p in engine.values and not p.startswith("/headamp/")
    }
    engine.recalling = True
    try:
        # Algorithms must settle before their typed parameter controls can be recalled.
        for path, value in values.items():
            if path.startswith("/fx/") and path.endswith("/type"):
                await engine.write(path, value)
        await asyncio.sleep(0.75)
        ordered = sorted(values, key=lambda p: (p.endswith("/on"), p.endswith("/fader")))
        for path in ordered:
            if path.startswith("/fx/") and path.endswith("/type"):
                continue
            if path in engine.values:
                await engine.write(path, values[path])
                await asyncio.sleep(0.005)
    except ValueError as exc:
        raise HTTPException(409, "Recall interrupted: " + str(exc)) from exc
    finally:
        engine.recalling = False
    return {"status": "pending", "parameters": len(values), "headamps_excluded": True}


@router.delete("/snapshots/{snapshot_id}")
def delete_snapshot(snapshot_id: str, session: Session = Depends(get_session)):
    item = config(session)
    item.snapshots_json = json.dumps(
        [e for e in json.loads(item.snapshots_json) if e["id"] != snapshot_id]
    )
    session.commit()
    return {"status": "deleted"}


@router.get("/automation")
def get_automation(session: Session = Depends(get_session)):
    from app.modules.broadcast.models import BroadcastViewerSettings
    from app.modules.broadcast.settings import audio_scenes
    from app.modules.mixer.automation import automation, configuration
    settings = session.scalar(select(BroadcastViewerSettings).limit(1))
    available = [{"id": scene.id, "label": scene.label} for scene in audio_scenes(settings)] if settings else []
    return {"configuration": configuration(config(session)), "status": automation.status,
            "available_scenes": available}


@router.put("/automation")
def save_automation(payload: AutomationConfiguration, session: Session = Depends(get_session)):
    from app.modules.mixer.automation import automation, configuration
    item = config(session)
    previous = configuration(item)
    item.automation_json = payload.model_dump_json()
    session.commit()
    if payload.enabled and (
        not previous.enabled or not previous.follow_service and payload.follow_service
    ):
        engine.startup_scene_hold = False
    automation.notify()
    return {"configuration": payload, "status": automation.status}


@router.post("/automation/suggestions")
def draft_automation(payload: AutomationConfiguration):
    from app.modules.mixer.automation import suggested_scenes
    drafted = suggested_scenes(payload.roles)
    defaults = {scene.id for scene in drafted}
    return payload.model_copy(update={"scenes": drafted + [
        scene for scene in payload.scenes if scene.id not in defaults
    ]})


class SceneControl(BaseModel):
    scene_id: str | None = Field(default=None, min_length=1, max_length=80)
    follow_service: bool | None = None


@router.patch("/automation/control")
def control_automation(payload: SceneControl, session: Session = Depends(get_session)):
    from app.modules.broadcast.models import BroadcastViewerSettings
    from app.modules.mixer.automation import automation, configuration, hold_manual_scene

    item = config(session)
    cfg = configuration(item)
    if not cfg.enabled:
        raise HTTPException(409, "Enable hardware automation before selecting scenes")
    if payload.follow_service is not None:
        cfg.follow_service = payload.follow_service
        if cfg.follow_service:
            cfg.manual_scene_id = None
        elif not cfg.manual_scene_id:
            viewer = session.scalar(select(BroadcastViewerSettings).limit(1))
            current = automation.status.get("scene_id") or (viewer.active_audio_scene if viewer else None)
            cfg.manual_scene_id = current if current in {s.id for s in cfg.scenes} else None
    item.automation_json = cfg.model_dump_json()
    if payload.scene_id:
        try:
            hold_manual_scene(session, payload.scene_id, hold=not cfg.follow_service)
        except ValueError as exc:
            session.rollback()
            raise HTTPException(409, str(exc)) from exc
    session.commit()
    if payload.scene_id or payload.follow_service is True:
        engine.startup_scene_hold = False
    automation.notify()
    return {"configuration": configuration(item), "status": automation.status}


@router.post("/automation/apply/{scene_id}")
def hold_automation_scene(scene_id: str, session: Session = Depends(get_session)):
    from app.modules.mixer.automation import automation, configuration
    item = config(session)
    cfg = configuration(item)
    if not cfg.enabled:
        raise HTTPException(409, "Enable hardware automation before applying a scene")
    if scene_id not in {scene.id for scene in cfg.scenes}:
        raise HTTPException(404, "Hardware scene not found")
    from app.modules.mixer.automation import hold_manual_scene
    try:
        hold_manual_scene(session, scene_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc
    session.commit()
    engine.startup_scene_hold = False
    automation.notify()
    return {"configuration": configuration(item), "status": automation.status}


@router.post("/automation/capture/{scene_id}")
def capture_automation_scene(scene_id: str, session: Session = Depends(get_session)):
    from app.modules.mixer.automation import SceneChannel, SceneLevel, automation, configuration
    item = config(session)
    cfg = configuration(item)
    scene = next((scene for scene in cfg.scenes if scene.id == scene_id), None)
    if scene is None:
        raise HTTPException(404, "Hardware scene not found")
    if not engine.connected or engine.syncing or engine.recalling:
        raise HTTPException(409, "Wait for a connected, synchronized mixer")
    values = engine.values.copy()

    def level(path):
        if path not in values:
            raise HTTPException(409, "Wait for all mapped channel levels to be read")
        wire = values[path]
        return wire, (wire * 40 - 30 if wire >= .5 else wire * 80 - 50 if wire >= .25
                      else wire * 160 - 70 if wire >= .0625 else wire * 480 - 90)

    channels = {}
    for strip_id, role in cfg.roles.items():
        if role == "other":
            continue
        previous = scene.channels.get(strip_id, SceneChannel())
        channel = previous.model_copy(deep=True)
        if cfg.room_enabled:
            if strip_id + "/mix/lr" not in values:
                raise HTTPException(409, "Wait for mapped Main LR assignments to be read")
            _, room_db = level(strip_id + "/mix/fader")
            channel.room = SceneLevel(
                enabled=values[strip_id + "/mix/lr"] == 1, level_db=round(room_db, 2)
            )
        if cfg.livestream_enabled:
            wire, stream_db = level(f"{strip_id}/mix/{cfg.livestream_bus:02}/level")
            channel.livestream = SceneLevel(enabled=wire > 0, level_db=round(stream_db, 2))
        channels[strip_id] = channel
    if not channels:
        raise HTTPException(409, "Map inputs before capturing a hardware scene")
    scene.channels = channels
    item.automation_json = cfg.model_dump_json()
    session.commit()
    automation.notify()
    return {"configuration": cfg, "status": automation.status}
