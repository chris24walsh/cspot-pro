import asyncio
import ipaddress
import json
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.auth import require_permission
from app.modules.mixer.catalog import PARAMETERS, STRIPS
from app.modules.mixer.engine import discover, engine, validate_host
from app.modules.mixer.models import MixerConfiguration

router = APIRouter(dependencies=[Depends(require_permission("broadcast:use"))])


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
    return await discover(hosts)


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
