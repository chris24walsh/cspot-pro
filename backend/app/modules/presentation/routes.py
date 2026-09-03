import json
from datetime import UTC, datetime
from threading import Lock, Timer
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal, get_session
from app.modules.broadcast.audio_scenes import activate_audio_scene, automatic_scene_for_item
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.recording import schedule_sermon_recording
from app.modules.broadcast.schemas import ServiceScheduleRule
from app.modules.broadcast.settings import service_schedules
from app.modules.identity.auth import list_role_names, require_any_permission, require_permission
from app.modules.identity.models import User
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.planning.service_scaffold import ensure_welcome_stage_items
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
    output_active: bool = False
    service_stage: str = "ready"
    pre_service_phase: str | None = None
    rehearsal: bool = False


OUTPUT_STALE_MS = 7000
SERVICE_TIME_ZONE = ZoneInfo("Europe/Dublin")
PROGRAM_AUDIO_FADE_SECONDS = 6.0
_audio_scene_fade_lock = Lock()
_audio_scene_fade_timers: dict[str, tuple[object, Timer]] = {}


def _scene_for_item(item: PlanItem | None, video_action: str | None, service_stage: str | None) -> str:
    configured = (getattr(item, "presentation_options", None) or {}).get("audio_scene_id") if item else None
    if isinstance(configured, str) and configured.strip():
        return configured.strip()
    return automatic_scene_for_item(item.item_type if item else None, video_action, service_stage)


def _audio_scene_fade_pending(plan_id: str) -> bool:
    with _audio_scene_fade_lock:
        scheduled = _audio_scene_fade_timers.get(plan_id)
        return scheduled is not None and scheduled[1].is_alive()


def _activate_current_audio_scene(plan_id: str) -> None:
    with SessionLocal() as session:
        presentation_session = _latest_session(session, plan_id)
        position = (
            _latest_position(session, presentation_session.id) if presentation_session else None
        )
        if position is None:
            return
        payload = _position_payload(position)
        settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        if not settings or not settings.audio_scene_automation:
            return
        item_id = payload.get("plan_item_id")
        item = session.get(PlanItem, item_id) if isinstance(item_id, str) else None
        video_action = payload.get("video_action")
        service_stage = payload.get("service_stage")
        activate_audio_scene(
            session,
            settings,
            _scene_for_item(item, video_action if isinstance(video_action, str) else None, service_stage if isinstance(service_stage, str) else None),
        )


def _schedule_audio_scene_after_program_fade(plan_id: str) -> None:
    token = object()

    def finish_transition() -> None:
        try:
            _activate_current_audio_scene(plan_id)
        finally:
            with _audio_scene_fade_lock:
                scheduled = _audio_scene_fade_timers.get(plan_id)
                if scheduled is not None and scheduled[0] is token:
                    _audio_scene_fade_timers.pop(plan_id, None)

    timer = Timer(PROGRAM_AUDIO_FADE_SECONDS, finish_transition)
    timer.daemon = True
    with _audio_scene_fade_lock:
        previous = _audio_scene_fade_timers.get(plan_id)
        if previous is not None:
            previous[1].cancel()
        _audio_scene_fade_timers[plan_id] = (token, timer)
    timer.start()


def cleanup_live_sessions(
    session: Session,
    *,
    active_plan_id: str | None = None,
    now: datetime | None = None,
) -> int:
    """End old sessions and enforce a single live service globally."""
    current_time = now or datetime.now(UTC)
    current_local_date = current_time.astimezone(SERVICE_TIME_ZONE).date()
    ended = 0
    live_sessions = session.scalars(
        select(PresentationSession).where(
            PresentationSession.status == "live",
            PresentationSession.ended_at.is_(None),
        )
    ).all()
    for presentation_session in live_sessions:
        if active_plan_id is not None:
            if presentation_session.plan_id == active_plan_id:
                continue
        else:
            plan = session.get(Plan, presentation_session.plan_id)
            if plan is None:
                continue
            service_date = plan.service_date.astimezone(SERVICE_TIME_ZONE).date()
            past_service = service_date < current_local_date
            expired_today = False
            if service_date == current_local_date:
                plan_type = session.get(PlanType, plan.plan_type_id)
                settings = session.scalar(select(BroadcastViewerSettings).limit(1))
                schedule_candidates = service_schedules(settings) if settings is not None else []
                rule = next(
                    (
                        candidate
                        for candidate in schedule_candidates
                        if candidate.enabled
                        and candidate.weekday == current_time.astimezone(SERVICE_TIME_ZONE).weekday()
                        and plan_type is not None
                        and candidate.plan_type == plan_type.name
                    ),
                    None,
                )
                expired_today = bool(
                    rule
                    and current_time.astimezone(SERVICE_TIME_ZONE)
                    > schedule_time(current_time.astimezone(SERVICE_TIME_ZONE), rule.cleanup_time)
                )
            if not past_service and not expired_today:
                continue
        presentation_session.status = "ended"
        presentation_session.ended_at = current_time
        position = _latest_position(session, presentation_session.id)
        if position is not None:
            payload = _position_payload(position)
            owner_id = payload.get("output_owner_id")
            if isinstance(owner_id, str):
                payload["output_closed_owner_id"] = owner_id
            payload.pop("output_owner_id", None)
            payload.pop("output_heartbeat_at", None)
            payload.pop("output_active", None)
            payload.pop("output_recording_item_id", None)
            payload["service_stage"] = "post_service"
            payload.pop("pre_service_phase", None)
            payload["blanked"] = True
            payload["updated_at"] = int(current_time.timestamp() * 1000)
            position.payload_json = json.dumps(payload)
        ended += 1
    if ended:
        session.commit()
    return ended


def scheduled_service_window_active(
    plan: Plan,
    now: datetime | None = None,
    payload: dict[str, object] | None = None,
) -> bool:
    now_local = now.astimezone(SERVICE_TIME_ZONE) if now else datetime.now(SERVICE_TIME_ZONE)
    if payload:
        start_ms = payload.get("scheduled_window_start")
        end_ms = payload.get("scheduled_window_end")
        if isinstance(start_ms, int | float) and isinstance(end_ms, int | float):
            now_ms = now_local.timestamp() * 1000
            return start_ms <= now_ms <= end_ms
    service_local = plan.service_date.astimezone(SERVICE_TIME_ZONE)
    if service_local.date() != now_local.date():
        return False
    scheduled_start = now_local.replace(hour=10, minute=30, second=0, microsecond=0)
    scheduled_end = now_local.replace(hour=13, minute=30, second=0, microsecond=0)
    return scheduled_start <= now_local <= scheduled_end


def schedule_time(now_local: datetime, value: str) -> datetime:
    hour, minute = (int(part) for part in value.split(":"))
    return now_local.replace(hour=hour, minute=minute, second=0, microsecond=0)


def welcome_stage_at(now_local: datetime, rule: ServiceScheduleRule) -> tuple[str, str]:
    if now_local >= schedule_time(now_local, rule.service_start):
        return "welcome_seated", "complete"
    if now_local >= schedule_time(now_local, rule.countdown_start):
        return "welcome_countdown", "countdown"
    return "welcome_montage", "montage"


def template_cue_at(
    session: Session, plan: Plan, now_local: datetime, automation_start: str
) -> tuple[PlanItem | None, str]:
    """Resolve a template's self-timed opening cue chain from its one start time."""
    started_at = schedule_time(now_local, automation_start)
    elapsed = max(0, int((now_local - started_at).total_seconds()))
    items = list(session.scalars(select(PlanItem).where(
        PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None)
    ).order_by(PlanItem.sequence, PlanItem.created_at)).all())
    roots = [item for item in items if item.parent_item_id is None]
    ordered: list[PlanItem] = []
    for root in roots:
        children = sorted(
            (item for item in items if item.parent_item_id == root.id),
            key=lambda item: (item.sequence, item.created_at),
        )
        ordered.extend(children or [root])
    if not ordered:
        return None, "service"
    for index, item in enumerate(ordered):
        options = item.presentation_options or {}
        if not options.get("auto_advance"):
            return item, "service" if index else "pre_service"
        duration = max(1, int(options.get("auto_advance_seconds") or options.get("dwell_seconds") or 1))
        if elapsed < duration:
            return item, "pre_service"
        elapsed -= duration
    return ordered[-1], "service"


def admin_rehearsal_visible(
    payload: dict[str, object], *, is_admin: bool, output_active: bool
) -> bool:
    return bool(
        is_admin
        and payload.get("auto_started") is not True
        and payload.get("service_stage") == "pre_service"
        and payload.get("pre_service_phase") in {"montage", "countdown", "complete"}
        and not output_active
    )


def ensure_scheduled_pre_service(session: Session) -> None:
    now_local = datetime.now(SERVICE_TIME_ZONE)
    broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
    if broadcast_settings is None:
        return
    rules = [
        rule
        for rule in service_schedules(broadcast_settings)
        if rule.enabled and rule.weekday == now_local.weekday()
    ]
    day_start = now_local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(UTC)
    day_end = now_local.replace(hour=23, minute=59, second=59, microsecond=999999).astimezone(UTC)
    candidates = session.execute(
        select(Plan, PlanType)
        .join(PlanType, Plan.plan_type_id == PlanType.id)
        .where(
            Plan.deleted_at.is_(None),
            Plan.service_date >= day_start,
            Plan.service_date <= day_end,
        )
        .order_by(Plan.service_date)
    ).all()
    scheduled = None
    for plan, plan_type in candidates:
        legacy_rule = next((rule for rule in rules if rule.plan_type == plan_type.name), None)
        automation_start = plan_type.automation_start or (legacy_rule.pre_service_start if legacy_rule else None)
        if not automation_start:
            continue
        rule = legacy_rule or ServiceScheduleRule(
            id=f"template-{plan_type.id}", name=plan_type.name, plan_type=plan_type.name,
            weekday=now_local.weekday(), pre_service_start=automation_start,
            countdown_start=plan_type.starts_at or automation_start,
            service_start=plan_type.starts_at or automation_start,
            cleanup_time="23:59", enabled=True,
        )
        if schedule_time(now_local, automation_start) <= now_local <= schedule_time(now_local, rule.cleanup_time):
            scheduled = (plan, plan_type, rule)
            break
    if scheduled is None:
        return
    plan, plan_type, rule = scheduled
    ensure_welcome_stage_items(session, plan)
    automation_start = plan_type.automation_start or rule.pre_service_start
    plan_items = session.scalars(select(PlanItem).where(
        PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None)
    )).all()
    has_item_cues = any((item.presentation_options or {}).get("auto_advance") for item in plan_items)
    if has_item_cues:
        desired_item, desired_stage = template_cue_at(session, plan, now_local, automation_start)
        desired_phase = None
    else:
        desired_item_type, desired_phase = welcome_stage_at(now_local, rule)
        desired_item = session.scalar(select(PlanItem).where(PlanItem.plan_id == plan.id, PlanItem.item_type == desired_item_type, PlanItem.deleted_at.is_(None)))
        desired_stage = "ready" if now_local >= schedule_time(now_local, rule.service_start) else "pre_service"
    cleanup_live_sessions(session, active_plan_id=plan.id)
    latest = _latest_session(session, plan.id)
    if latest and latest.status == "live" and latest.ended_at is None:
        position = _latest_position(session, latest.id)
        payload = _position_payload(position)
        active_item = session.get(PlanItem, position.plan_item_id) if position else None
        if (
            payload.get("auto_started") is True
            and active_item is not None
            and active_item.item_type
            in {"pre_service", "welcome_montage", "welcome_countdown", "welcome_seated"}
        ):
            # Once a leader claims the output, or explicitly ends the service,
            # the scheduled pre-service clock no longer owns presentation or
            # audio state.
            if (
                payload.get("output_active") is True
                or payload.get("service_stage") == "post_service"
            ):
                return
            if broadcast_settings and broadcast_settings.audio_scene_automation:
                desired_scene = _scene_for_item(desired_item, None, desired_stage)
                if broadcast_settings.active_audio_scene != desired_scene:
                    activate_audio_scene(session, broadcast_settings, desired_scene)
            position_changed = False
            if desired_item is not None and position.plan_item_id != desired_item.id:
                position.plan_item_id = desired_item.id
                position.slide_index = 0
                payload["plan_item_id"] = desired_item.id
                payload["slide_offset"] = 0
                position_changed = True
            if desired_phase is not None and payload.get("pre_service_phase") != desired_phase:
                payload["pre_service_phase"] = desired_phase
                position_changed = True
            elif desired_phase is None and "pre_service_phase" in payload:
                payload.pop("pre_service_phase", None)
                position_changed = True
            if payload.get("service_stage") != desired_stage:
                payload["service_stage"] = desired_stage
                position_changed = True
            if position_changed:
                payload["updated_at"] = int(datetime.now(UTC).timestamp() * 1000)
                position.payload_json = json.dumps(payload)
                session.commit()
            return

        # A rehearsal or abandoned presenter session can otherwise remain
        # marked live for days and prevent Sunday's scheduled welcome from
        # taking ownership. Preserve a genuinely connected output, but retire
        # stale sessions before creating the scheduled pre-service session.
        output_status = _serialize_output_status(
            plan.id, position, int(datetime.now(UTC).timestamp() * 1000)
        )
        if output_status.active:
            return
        latest.status = "ended"
        latest.ended_at = datetime.now(UTC)
        session.commit()
    first_item = desired_item or session.scalar(
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
                    "schedule_id": rule.id,
                    "scheduled_window_start": int(
                        schedule_time(now_local, automation_start).timestamp() * 1000
                    ),
                    "scheduled_window_end": int(
                        schedule_time(now_local, rule.cleanup_time).timestamp() * 1000
                    ),
                    "service_stage": desired_stage,
                    "pre_service_phase": desired_phase,
                }
            ),
        )
    )
    session.commit()
    if broadcast_settings and broadcast_settings.audio_scene_automation:
        activate_audio_scene(session, broadcast_settings, _scene_for_item(first_item, None, desired_stage))


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
    current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[PresentationLiveServiceRead]:
    cleanup_live_sessions(session)
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
    is_admin = "administrator" in list_role_names(session, current_user.id)
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
        admin_rehearsal = admin_rehearsal_visible(
            payload, is_admin=is_admin, output_active=output_status.active
        )
        if auto_started and not scheduled_service_window_active(plan, payload=payload):
            continue
        if (
            not auto_started
            and not admin_rehearsal
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
                output_active=output_status.active,
                service_stage=str(payload.get("service_stage", "ready")),
                pre_service_phase=payload.get("pre_service_phase")
                if isinstance(payload.get("pre_service_phase"), str)
                else None,
                rehearsal=admin_rehearsal,
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
    cleanup_live_sessions(session)
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
    if payload.pre_service_phase is not None and "administrator" not in list_role_names(
        session, current_user.id
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can simulate pre-service timing",
        )
    presentation_session = _latest_session(session, plan_id)
    if presentation_session is None:
        presentation_session = PresentationSession(
            plan_id=plan_id,
            presenter_id=current_user.id,
            status="live" if payload.pre_service_phase is not None else "ready",
        )
        session.add(presentation_session)
        session.flush()
    else:
        presentation_session.presenter_id = current_user.id
        if presentation_session.status == "live" or payload.pre_service_phase is not None:
            presentation_session.status = "live"
            presentation_session.ended_at = None

    position = _latest_position(session, presentation_session.id)
    if position is None:
        position = PresentationPosition(session_id=presentation_session.id)
        session.add(position)

    existing_payload = _position_payload(position)
    previous_video_action = existing_payload.get("video_action")
    previous_service_stage = existing_payload.get("service_stage")
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
    previous_item_id = previous_live_item_id if isinstance(previous_live_item_id, str) else None
    slide_changed = (
        previous_item_id == payload.plan_item_id and previous_slide_offset != payload.slide_offset
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
    service_stage_changed = previous_service_stage != payload.service_stage
    if output_active and (
        previous_item_id != payload.plan_item_id or media_state_changed or service_stage_changed
    ):
        broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        if broadcast_settings and broadcast_settings.audio_scene_automation:
            starting_service_from_pre_service = (
                previous_service_stage == "pre_service" and payload.service_stage == "service"
            )
            if starting_service_from_pre_service:
                _schedule_audio_scene_after_program_fade(plan_id)
            elif not _audio_scene_fade_pending(plan_id):
                item = session.get(PlanItem, payload.plan_item_id) if payload.plan_item_id else None
                activate_audio_scene(
                    session,
                    broadcast_settings,
                    _scene_for_item(item, payload.video_action, payload.service_stage),
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
    position = _latest_position(session, presentation_session.id) if presentation_session else None
    if (
        not payload.release
        and position is not None
        and _position_payload(position).get("output_closed_owner_id") == payload.owner_id
    ):
        # A superseded output may continue heartbeating briefly. Reject it
        # before it can close the service that replaced it.
        return PresentationOutputStatusRead(plan_id=plan_id)
    if not payload.release:
        cleanup_live_sessions(session, active_plan_id=plan_id)
    if presentation_session is None:
        presentation_session = PresentationSession(
            plan_id=plan_id,
            presenter_id=current_user.id,
            status="live",
        )
        session.add(presentation_session)
        session.flush()

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
        next_payload["updated_at"] = payload.heartbeat_at
        presentation_session.status = "ended"
        presentation_session.ended_at = datetime.now(UTC)
    elif next_payload.get("output_closed_owner_id") == payload.owner_id:
        return PresentationOutputStatusRead(plan_id=plan_id)
    elif current_owner and current_owner != payload.owner_id:
        return existing
    else:
        presentation_session.presenter_id = current_user.id
        presentation_session.status = "live"
        presentation_session.ended_at = None
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
            activate_audio_scene(session, broadcast_settings, "pre_service")
        release_slide_offset = next_payload.get("slide_offset", 0)
        schedule_sermon_recording(
            plan_id,
            previous_recording_item_id if isinstance(previous_recording_item_id, str) else None,
            None,
            int(release_slide_offset) if isinstance(release_slide_offset, int | float) else 0,
            current_user.id,
        )
    elif new_output:
        broadcast_settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        if broadcast_settings and broadcast_settings.audio_scene_automation:
            current_item_id = next_payload.get("plan_item_id")
            item = (
                session.get(PlanItem, current_item_id) if isinstance(current_item_id, str) else None
            )
            video_action = next_payload.get("video_action")
            service_stage = next_payload.get("service_stage")
            activate_audio_scene(
                session,
                broadcast_settings,
                _scene_for_item(item, video_action if isinstance(video_action, str) else None, service_stage if isinstance(service_stage, str) else None),
            )
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
