import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.broadcast.recording import stop_recording, sync_sermon_recording
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
from app.modules.identity.models import User
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.presentation.models import PresentationPosition, PresentationSession

router = APIRouter()


class PresentationLiveStateRead(BaseModel):
    plan_id: str
    session_id: str | None = None
    presenter_id: str | None = None
    status: str
    index: int = 0
    plan_item_id: str | None = None
    slide_offset: int = 0
    updated_at: int = 0
    theme: str = "light"
    blanked: bool = False
    fullscreen: bool = False
    video_action: str | None = None
    video_action_at: int | None = None


class PresentationLiveStateWrite(BaseModel):
    plan_id: str
    index: int = 0
    plan_item_id: str | None = None
    slide_offset: int = 0
    updated_at: int
    theme: str = "light"
    blanked: bool = False
    fullscreen: bool = False
    video_action: str | None = None
    video_action_at: int | None = None


class PresentationOutputStatusRead(BaseModel):
    plan_id: str
    active: bool = False
    owner_id: str | None = None
    heartbeat_at: int | None = None
    claimed: bool = False


class PresentationOutputStatusWrite(BaseModel):
    owner_id: str
    heartbeat_at: int
    release: bool = False


class PresentationLiveServiceRead(BaseModel):
    plan_id: str
    title: str
    subtitle: str | None = None
    service_date: datetime
    plan_type: str
    item_count: int
    session_id: str
    status: str
    index: int = 0
    plan_item_id: str | None = None
    slide_offset: int = 0
    updated_at: int = 0
    output_owner_id: str
    output_heartbeat_at: int


OUTPUT_STALE_MS = 7000


def _position_payload(position: PresentationPosition | None) -> dict[str, object]:
    if position and position.payload_json:
        try:
            parsed = json.loads(position.payload_json)
            if isinstance(parsed, dict):
                return parsed
        except json.JSONDecodeError:
            return {}
    return {}


def _serialize_live_state(
    presentation_session: PresentationSession | None,
    position: PresentationPosition | None,
    plan_id: str,
) -> PresentationLiveStateRead:
    payload = _position_payload(position)

    return PresentationLiveStateRead(
        plan_id=plan_id,
        session_id=presentation_session.id if presentation_session else None,
        presenter_id=presentation_session.presenter_id if presentation_session else None,
        status=presentation_session.status if presentation_session else "ready",
        index=int(payload.get("index", position.slide_index if position else 0)),
        plan_item_id=payload.get("plan_item_id", position.plan_item_id if position else None),
        slide_offset=int(payload.get("slide_offset", 0)),
        updated_at=int(payload.get("updated_at", 0)),
        theme=str(payload.get("theme", "light")),
        blanked=bool(payload.get("blanked", False)),
        fullscreen=bool(payload.get("fullscreen", False)),
        video_action=payload.get("video_action")
        if isinstance(payload.get("video_action"), str)
        else None,
        video_action_at=int(payload["video_action_at"])
        if payload.get("video_action_at") is not None
        else None,
    )


def _latest_session(session: Session, plan_id: str) -> PresentationSession | None:
    return session.scalar(
        select(PresentationSession)
        .where(PresentationSession.plan_id == plan_id)
        .order_by(PresentationSession.updated_at.desc())
    )


def _latest_position(session: Session, session_id: str) -> PresentationPosition | None:
    return session.scalar(
        select(PresentationPosition)
        .where(PresentationPosition.session_id == session_id)
        .order_by(PresentationPosition.updated_at.desc())
    )


def _serialize_output_status(
    plan_id: str, position: PresentationPosition | None, now: int | None = None
) -> PresentationOutputStatusRead:
    payload = _position_payload(position)
    owner_id = (
        payload.get("output_owner_id") if isinstance(payload.get("output_owner_id"), str) else None
    )
    heartbeat_at = (
        int(payload["output_heartbeat_at"])
        if payload.get("output_heartbeat_at") is not None
        else None
    )
    active = bool(
        owner_id and heartbeat_at and now is not None and now - heartbeat_at < OUTPUT_STALE_MS
    )
    return PresentationOutputStatusRead(
        plan_id=plan_id,
        active=active,
        owner_id=owner_id if active else None,
        heartbeat_at=heartbeat_at if active else None,
    )


@router.get("/live", response_model=list[PresentationLiveServiceRead])
def list_live_presentation_services(
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[PresentationLiveServiceRead]:
    now = int(datetime.now(UTC).timestamp() * 1000)
    presentation_sessions = session.scalars(
        select(PresentationSession)
        .where(
            PresentationSession.status == "live",
            PresentationSession.ended_at.is_(None),
        )
        .order_by(PresentationSession.updated_at.desc())
    ).all()

    live_services: list[PresentationLiveServiceRead] = []
    seen_plan_ids: set[str] = set()
    for presentation_session in presentation_sessions:
        if presentation_session.plan_id in seen_plan_ids:
            continue
        plan = session.get(Plan, presentation_session.plan_id)
        if plan is None or plan.deleted_at is not None:
            continue
        position = _latest_position(session, presentation_session.id)
        output_status = _serialize_output_status(plan.id, position, now)
        if (
            not output_status.active
            or not output_status.owner_id
            or output_status.heartbeat_at is None
        ):
            continue
        payload = _position_payload(position)
        plan_type = session.get(PlanType, plan.plan_type_id)
        item_count = session.scalar(
            select(func.count(PlanItem.id)).where(
                PlanItem.plan_id == plan.id,
                PlanItem.deleted_at.is_(None),
                PlanItem.item_type != "worship_set",
            )
        )
        live_services.append(
            PresentationLiveServiceRead(
                plan_id=plan.id,
                title=plan.title,
                subtitle=plan.subtitle,
                service_date=plan.service_date,
                plan_type=plan_type.name if plan_type else "Unknown",
                item_count=item_count or 0,
                session_id=presentation_session.id,
                status=presentation_session.status,
                index=int(payload.get("index", position.slide_index if position else 0)),
                plan_item_id=payload.get(
                    "plan_item_id", position.plan_item_id if position else None
                ),
                slide_offset=int(payload.get("slide_offset", 0)),
                updated_at=int(payload.get("updated_at", 0)),
                output_owner_id=output_status.owner_id,
                output_heartbeat_at=output_status.heartbeat_at,
            )
        )
        seen_plan_ids.add(plan.id)

    return live_services


@router.get("/live/{plan_id}", response_model=PresentationLiveStateRead)
def get_presentation_live_state(
    plan_id: str,
    _current_user: User = Depends(require_any_permission("plans:read", "presentation:use")),
    session: Session = Depends(get_session),
) -> PresentationLiveStateRead:
    presentation_session = _latest_session(session, plan_id)
    position = _latest_position(session, presentation_session.id) if presentation_session else None
    return _serialize_live_state(presentation_session, position, plan_id)


@router.patch("/live/{plan_id}", response_model=PresentationLiveStateRead)
def update_presentation_live_state(
    plan_id: str,
    payload: PresentationLiveStateWrite,
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> PresentationLiveStateRead:
    presentation_session = _latest_session(session, plan_id)
    if presentation_session is None:
        presentation_session = PresentationSession(
            plan_id=plan_id,
            presenter_id=current_user.id,
            status="live",
        )
        session.add(presentation_session)
        session.flush()
    else:
        presentation_session.presenter_id = current_user.id
        presentation_session.status = "live"

    position = _latest_position(session, presentation_session.id)
    if position is None:
        position = PresentationPosition(session_id=presentation_session.id)
        session.add(position)

    existing_payload = _position_payload(position)
    previous_live_item_id = existing_payload.get("output_recording_item_id")
    now = int(datetime.now(UTC).timestamp() * 1000)
    output_active = _serialize_output_status(plan_id, position, now).active
    next_payload = {**existing_payload, **payload.model_dump()}
    if output_active:
        next_payload["output_recording_item_id"] = payload.plan_item_id
    else:
        next_payload.pop("output_recording_item_id", None)
    position.plan_item_id = payload.plan_item_id
    position.slide_index = payload.index
    position.payload_json = json.dumps(next_payload)
    session.commit()
    session.refresh(presentation_session)
    session.refresh(position)
    if output_active:
        sync_sermon_recording(
            session,
            plan_id,
            previous_live_item_id if isinstance(previous_live_item_id, str) else None,
            payload.plan_item_id,
            payload.slide_offset,
            current_user.id,
        )
    else:
        stop_recording(session, plan_id)
    return _serialize_live_state(presentation_session, position, plan_id)


@router.get("/output/{plan_id}", response_model=PresentationOutputStatusRead)
def get_presentation_output_status(
    plan_id: str,
    now: int,
    _current_user: User = Depends(require_permission("presentation:use")),
    session: Session = Depends(get_session),
) -> PresentationOutputStatusRead:
    presentation_session = _latest_session(session, plan_id)
    position = _latest_position(session, presentation_session.id) if presentation_session else None
    return _serialize_output_status(plan_id, position, now)


@router.patch("/output/{plan_id}", response_model=PresentationOutputStatusRead)
def update_presentation_output_status(
    plan_id: str,
    payload: PresentationOutputStatusWrite,
    current_user: CurrentUser,
    session: Session = Depends(get_session),
) -> PresentationOutputStatusRead:
    presentation_session = _latest_session(session, plan_id)
    if presentation_session is None:
        presentation_session = PresentationSession(
            plan_id=plan_id,
            presenter_id=current_user.id,
            status="live",
        )
        session.add(presentation_session)
        session.flush()

    position = _latest_position(session, presentation_session.id)
    if position is None:
        position = PresentationPosition(session_id=presentation_session.id)
        session.add(position)
        session.flush()

    existing = _serialize_output_status(plan_id, position, payload.heartbeat_at)
    current_owner = existing.owner_id if existing.active else None
    next_payload = _position_payload(position)
    new_output = False
    if payload.release:
        closed_owner = current_owner or next_payload.get("output_owner_id")
        if isinstance(closed_owner, str):
            next_payload["output_closed_owner_id"] = closed_owner
        next_payload.pop("output_owner_id", None)
        next_payload.pop("output_heartbeat_at", None)
        next_payload.pop("output_recording_item_id", None)
    elif next_payload.get("output_closed_owner_id") == payload.owner_id:
        return PresentationOutputStatusRead(plan_id=plan_id)
    elif current_owner and current_owner != payload.owner_id:
        return existing
    else:
        new_output = current_owner is None
        next_payload.pop("output_closed_owner_id", None)
        next_payload["output_owner_id"] = payload.owner_id
        next_payload["output_heartbeat_at"] = payload.heartbeat_at
        if new_output:
            next_payload["output_recording_item_id"] = next_payload.get("plan_item_id")

    position.payload_json = json.dumps(next_payload)
    session.commit()
    session.refresh(position)
    if payload.release:
        stop_recording(session, plan_id)
    else:
        current_item_id = next_payload.get("plan_item_id")
        slide_offset = next_payload.get("slide_offset", 0)
        sync_sermon_recording(
            session,
            plan_id,
            None,
            current_item_id if isinstance(current_item_id, str) else None,
            int(slide_offset) if isinstance(slide_offset, int | float) else 0,
            current_user.id,
        )
    status = _serialize_output_status(plan_id, position, payload.heartbeat_at)
    status.claimed = not payload.release and status.owner_id == payload.owner_id
    return status


@router.get("/status", response_model=PresentationLiveStateRead)
def get_presentation_status(
    _current_user: User = Depends(require_permission("presentation:use")),
) -> PresentationLiveStateRead:
    return PresentationLiveStateRead(
        plan_id="demo-sunday-service",
        status="ready",
    )
