import json
from datetime import UTC, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.broadcast.audio_scenes import activate_audio_scene, automatic_scene_for_item
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.recording import schedule_sermon_recording
from app.modules.identity.auth import require_any_permission, require_permission
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
    service_stage: str = "ready"
    pre_service_phase: str | None = None


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
    service_stage: str = "ready"
    pre_service_phase: str | None = None


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
    service_stage: str = "ready"
    pre_service_phase: str | None = None


OUTPUT_STALE_MS = 7000
SERVICE_TIME_ZONE = ZoneInfo("Europe/Dublin")


def scheduled_service_window_active(plan: Plan, now: datetime | None = None) -> bool:
    now_local = now.astimezone(SERVICE_TIME_ZONE) if now else datetime.now(SERVICE_TIME_ZONE)
    service_local = plan.service_date.astimezone(SERVICE_TIME_ZONE)
    if service_local.date() != now_local.date():
        return False
    scheduled_start = now_local.replace(hour=10, minute=30, second=0, microsecond=0)
    scheduled_end = now_local.replace(hour=13, minute=30, second=0, microsecond=0)
    return scheduled_start <= now_local <= scheduled_end


def ensure_scheduled_pre_service(session: Session) -> None:
    now_local = datetime.now(SERVICE_TIME_ZONE)
    scheduled_start = now_local.replace(hour=10, minute=30, second=0, microsecond=0)
    scheduled_end = now_local.replace(hour=13, minute=30, second=0, microsecond=0)
    if not scheduled_start <= now_local <= scheduled_end:
        return
    plan_type = session.scalar(select(PlanType).where(PlanType.name == "Sunday Service"))
    if plan_type is None:
        return
    day_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    day_end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(UTC)
    plan = session.scalar(
        select(Plan)
        .where(
            Plan.plan_type_id == plan_type.id,
            Plan.deleted_at.is_(None),
            Plan.service_date >= day_start,
            Plan.service_date <= day_end,
        )
        .order_by(Plan.service_date)
    )
    if plan is None:
        return
    latest = _latest_session(session, plan.id)
    if latest and latest.status == "live" and latest.ended_at is None:
        position = _latest_position(session, latest.id)
        payload = _position_payload(position)
        active_item = session.get(PlanItem, position.plan_item_id) if position else None
        if (
            payload.get("auto_started") is True
            and active_item is not None
            and active_item.item_type == "pre_service"
        ):
            # Once a leader claims the output, or explicitly ends the service,
            # the scheduled pre-service clock no longer owns presentation or
            # audio state.
            if (
                payload.get("output_active") is True
                or payload.get("service_stage") == "post_service"
            ):
                return
            broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
            if broadcast_settings and broadcast_settings.audio_scene_automation:
                desired_scene = "media"
                if broadcast_settings.active_audio_scene != desired_scene:
                    activate_audio_scene(session, broadcast_settings, desired_scene)
            desired_stage = "ready" if now_local.hour >= 11 else "pre_service"
            if payload.get("service_stage") != desired_stage:
                payload["service_stage"] = desired_stage
                payload["updated_at"] = int(datetime.now(UTC).timestamp() * 1000)
                position.payload_json = json.dumps(payload)
                session.commit()
        return
    first_item = session.scalar(
        select(PlanItem)
        .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        .order_by(
            case((PlanItem.item_type == "pre_service", 0), else_=1),
            PlanItem.sequence,
            PlanItem.created_at,
        )
    )
    if first_item is None:
        return
    presentation_session = PresentationSession(
        plan_id=plan.id,
        status="live",
        started_at=datetime.now(UTC),
    )
    session.add(presentation_session)
    session.flush()
    now_ms = int(datetime.now(UTC).timestamp() * 1000)
    session.add(
        PresentationPosition(
            session_id=presentation_session.id,
            plan_item_id=first_item.id,
            slide_index=0,
            payload_json=json.dumps(
                {
                    "index": 0,
                    "plan_item_id": first_item.id,
                    "slide_offset": 0,
                    "updated_at": now_ms,
                    "theme": "dark",
                    "blanked": False,
                    "fullscreen": False,
                    "auto_started": True,
                    "service_stage": "pre_service",
                }
            ),
        )
    )
    session.commit()
    broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
    if broadcast_settings and broadcast_settings.audio_scene_automation:
        activate_audio_scene(session, broadcast_settings, "media")


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
        service_stage=str(payload.get("service_stage", "ready")),
        pre_service_phase=payload.get("pre_service_phase")
        if isinstance(payload.get("pre_service_phase"), str)
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
    explicitly_active = payload.get("output_active") is True
    legacy_heartbeat_active = bool(
        "output_active" not in payload
        and heartbeat_at
        and now is not None
        and now - heartbeat_at < OUTPUT_STALE_MS
    )
    active = bool(owner_id and (explicitly_active or legacy_heartbeat_active))
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
    ensure_scheduled_pre_service(session)
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
        payload = _position_payload(position)
        auto_started = payload.get("auto_started") is True
        if auto_started and not scheduled_service_window_active(plan):
            continue
        if (
            not auto_started
            and (
                not output_status.active
                or not output_status.owner_id
                or output_status.heartbeat_at is None
            )
        ):
            continue
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
                output_owner_id=output_status.owner_id or "scheduled",
                output_heartbeat_at=output_status.heartbeat_at or now,
                service_stage=str(payload.get("service_stage", "ready")),
                pre_service_phase=payload.get("pre_service_phase")
                if isinstance(payload.get("pre_service_phase"), str)
                else None,
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
    current_user: User = Depends(require_permission("presentation:use")),
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
    previous_video_action = existing_payload.get("video_action")
    previous_live_item_id = existing_payload.get("output_recording_item_id")
    previous_slide_offset = existing_payload.get("slide_offset", 0)
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
    previous_item_id = (
        previous_live_item_id if isinstance(previous_live_item_id, str) else None
    )
    slide_changed = (
        previous_item_id == payload.plan_item_id
        and previous_slide_offset != payload.slide_offset
    )
    if output_active and (previous_item_id != payload.plan_item_id or slide_changed):
        schedule_sermon_recording(
            plan_id,
            previous_item_id,
            payload.plan_item_id,
            payload.slide_offset,
            current_user.id,
        )
    elif not output_active and previous_item_id is not None:
        schedule_sermon_recording(
            plan_id,
            previous_item_id,
            None,
            payload.slide_offset,
            current_user.id,
        )
    media_state_changed = previous_video_action != payload.video_action
    if output_active and (previous_item_id != payload.plan_item_id or media_state_changed):
        broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        if broadcast_settings and broadcast_settings.audio_scene_automation:
            item = session.get(PlanItem, payload.plan_item_id) if payload.plan_item_id else None
            activate_audio_scene(
                session,
                broadcast_settings,
                automatic_scene_for_item(item.item_type if item else None, payload.video_action),
            )
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
    current_user: User = Depends(require_permission("presentation:use")),
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
    previous_recording_item_id = next_payload.get("output_recording_item_id")
    new_output = False
    if payload.release:
        closed_owner = current_owner or next_payload.get("output_owner_id")
        if isinstance(closed_owner, str):
            next_payload["output_closed_owner_id"] = closed_owner
        next_payload.pop("output_owner_id", None)
        next_payload.pop("output_heartbeat_at", None)
        next_payload.pop("output_active", None)
        next_payload.pop("output_recording_item_id", None)
        next_payload["service_stage"] = "post_service"
        next_payload.pop("pre_service_phase", None)
        next_payload["blanked"] = True
        next_payload["updated_at"] = payload.heartbeat_at
    elif next_payload.get("output_closed_owner_id") == payload.owner_id:
        return PresentationOutputStatusRead(plan_id=plan_id)
    elif current_owner and current_owner != payload.owner_id:
        return existing
    else:
        new_output = current_owner is None
        next_payload.pop("output_closed_owner_id", None)
        next_payload["output_owner_id"] = payload.owner_id
        next_payload["output_heartbeat_at"] = payload.heartbeat_at
        next_payload["output_active"] = True
        next_payload["service_stage"] = "service"
        next_payload.pop("pre_service_phase", None)
        if new_output:
            next_payload["output_recording_item_id"] = next_payload.get("plan_item_id")

    position.payload_json = json.dumps(next_payload)
    session.commit()
    session.refresh(position)
    if payload.release:
        broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        if broadcast_settings and broadcast_settings.audio_scene_automation:
            activate_audio_scene(session, broadcast_settings, "media")
        release_slide_offset = next_payload.get("slide_offset", 0)
        schedule_sermon_recording(
            plan_id,
            previous_recording_item_id
            if isinstance(previous_recording_item_id, str)
            else None,
            None,
            int(release_slide_offset)
            if isinstance(release_slide_offset, int | float)
            else 0,
            current_user.id,
        )
    elif new_output:
        broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        if broadcast_settings and broadcast_settings.audio_scene_automation:
            activate_audio_scene(session, broadcast_settings, "pastor")
        current_item_id = next_payload.get("plan_item_id")
        slide_offset = next_payload.get("slide_offset", 0)
        schedule_sermon_recording(
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
