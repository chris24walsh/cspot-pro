import json
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.settings import service_schedules
from app.modules.identity.auth import (
    list_permissions,
    list_role_names,
    require_any_permission,
    require_permission,
)
from app.modules.identity.models import User
from app.modules.library.models import FileCategory, ItemFile, StoredFile
from app.modules.planning.completion import require_plan_editable
from app.modules.planning.models import (
    DefaultItem,
    HistoryEntry,
    ItemNote,
    Plan,
    PlanItem,
    PlanType,
    WorshipLeaderAssignment,
)
from app.modules.planning.schemas import (
    DefaultOutlineItem,
    PlanCreate,
    PlanDetail,
    PlanHistoryCreate,
    PlanHistoryRead,
    PlanItemCreate,
    SectionTemplateInsert,
    PlanItemRead,
    PlanItemUpdate,
    PlanSummary,
    StashedWorshipSetRead,
    PlanTypeCreate,
    PlanTypeRead,
    PlanTypeUpdate,
    PlanUpdate,
    WorshipLeaderAssignmentRead,
    WorshipLeaderAssignmentUpdate,
)
from app.modules.planning.service_scaffold import (
    ensure_service_scaffold,
    is_sunday_service,
    section_auto_collapse_preference,
)

router = APIRouter()
SERVICE_TIME_ZONE = ZoneInfo("Europe/Dublin")
PLAN_HISTORY_ACTION = "item_snapshot"
PLAN_HISTORY_ENTITY_TYPE = "plan"
PLAN_HISTORY_LIMIT = 80
FIXED_SUNDAY_OUTLINE_ITEM_TYPES = {
    "pre_service",
    "welcome_montage",
    "welcome_countdown",
    "welcome_seated",
    "worship_set",
    "open_time",
    "sermon",
    "announcements",
}

PRESENTATION_DEFAULT_GROUP_FIELDS = {
    "visual": {"fit_mode", "transition", "dwell_seconds"},
    "playback": {"auto_advance", "auto_advance_seconds", "repeat"},
    "overlay_style": {
        "overlay_mode", "overlay_countdown_seconds", "overlay_position", "overlay_size",
        "overlay_font", "overlay_panel_opacity", "overlay_background_dim",
    },
    "routing": {"audio_scene_id", "display_targets"},
}


def presentation_defaults_for_groups(
    existing: dict, item_options: dict, groups: list[str]
) -> dict:
    next_defaults = dict(existing)
    for group in groups:
        for option_name in PRESENTATION_DEFAULT_GROUP_FIELDS.get(group, set()):
            if option_name in item_options:
                next_defaults[option_name] = item_options[option_name]
            else:
                next_defaults.pop(option_name, None)
    return next_defaults


def presenter_cannot_change_outline(session: Session, user: User, item: PlanItem) -> bool:
    roles = set(list_role_names(session, user.id))
    if "administrator" in roles or "presenter" not in roles:
        return False
    plan = session.get(Plan, item.plan_id)
    if plan is None:
        return False
    default_match = session.scalar(
        select(DefaultItem).where(
            DefaultItem.plan_type_id == plan.plan_type_id,
            DefaultItem.item_type == item.item_type,
            (DefaultItem.item_type != "custom") | (DefaultItem.title == item.title),
        )
    )
    return bool(
        default_match
        or (
            is_sunday_service(session, plan)
            and item.item_type in FIXED_SUNDAY_OUTLINE_ITEM_TYPES
        )
    )


def changes_protected_outline_fields(item: PlanItem, payload_data: dict[str, object]) -> bool:
    """Return true only when a request actually changes the fixed outline."""
    return any(
        field in payload_data and payload_data[field] != getattr(item, field)
        for field in {"item_type", "sequence", "title"}
    )


@router.get("/worship-leader-assignments", response_model=list[WorshipLeaderAssignmentRead])
def list_worship_leader_assignments(
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[WorshipLeaderAssignment]:
    return list(
        session.scalars(
            select(WorshipLeaderAssignment).order_by(WorshipLeaderAssignment.service_date)
        ).all()
    )


@router.patch(
    "/worship-leader-assignments/{service_date}", response_model=WorshipLeaderAssignmentRead | None
)
def set_worship_leader_assignment(
    service_date: date,
    payload: WorshipLeaderAssignmentUpdate,
    _current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> WorshipLeaderAssignment | None:
    assignment = session.scalar(
        select(WorshipLeaderAssignment).where(WorshipLeaderAssignment.service_date == service_date)
    )
    if payload.leader_id is None:
        if assignment is not None:
            session.delete(assignment)
            session.commit()
        return None
    if session.get(User, payload.leader_id) is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid worship leader"
        )
    if assignment is None:
        assignment = WorshipLeaderAssignment(service_date=service_date, leader_id=payload.leader_id)
        session.add(assignment)
    else:
        assignment.leader_id = payload.leader_id
    session.commit()
    session.refresh(assignment)
    return assignment


def plan_item_to_read(session: Session, item: PlanItem) -> PlanItemRead:
    item_files = session.scalars(
        select(ItemFile).where(ItemFile.plan_item_id == item.id).order_by(ItemFile.sort_order)
    ).all()
    if item.item_type in {"pre_service", "welcome_montage", "open_time", "sermon", "announcements"}:
        target_plan = session.get(Plan, item.plan_id)
        if target_plan is not None:
            inherited_files = session.scalars(
                select(ItemFile)
                .join(PlanItem, ItemFile.plan_item_id == PlanItem.id)
                .join(Plan, PlanItem.plan_id == Plan.id)
                .join(StoredFile, ItemFile.file_id == StoredFile.id)
                .where(
                    ItemFile.persistent.is_(True),
                    PlanItem.id != item.id,
                    PlanItem.item_type.in_(
                        {"pre_service", "welcome_montage"}
                        if item.item_type in {"pre_service", "welcome_montage"}
                        else {item.item_type}
                    ),
                    PlanItem.deleted_at.is_(None),
                    Plan.deleted_at.is_(None),
                    Plan.service_date < target_plan.service_date,
                    StoredFile.content_type.like("image/%"),
                )
                .order_by(Plan.service_date, ItemFile.sort_order)
            ).all()
            seen_file_ids = {row.file_id for row in item_files}
            for row in inherited_files:
                if row.file_id not in seen_file_ids:
                    item_files.append(row)
                    seen_file_ids.add(row.file_id)
    teacher_note = session.scalar(
        select(ItemNote)
        .where(ItemNote.plan_item_id == item.id)
        .order_by(ItemNote.updated_at.desc(), ItemNote.created_at.desc())
    )
    files = []
    for row in item_files:
        stored_file = session.get(StoredFile, row.file_id)
        if stored_file:
            files.append(
                {
                    "id": row.id,
                    "file_id": row.file_id,
                    "sort_order": row.sort_order,
                    "persistent": row.persistent,
                    "display_name": stored_file.display_name,
                    "content_type": stored_file.content_type,
                }
            )

    if item.item_type in {"pre_service", "welcome_montage"}:
        montage_category = session.scalar(
            select(FileCategory).where(FileCategory.name == "Pre-service Montage")
        )
        if montage_category:
            montage_files = session.scalars(
                select(StoredFile)
                .where(
                    StoredFile.category_id == montage_category.id,
                    StoredFile.content_type.like("image/%"),
                )
                .order_by(StoredFile.created_at, StoredFile.display_name)
            ).all()
            files.extend(
                {
                    "id": f"pre-service:{stored.id}",
                    "file_id": stored.id,
                    "sort_order": index,
                    "persistent": True,
                    "display_name": stored.display_name,
                    "content_type": stored.content_type,
                }
                for index, stored in enumerate(montage_files)
            )

    return PlanItemRead(
        id=item.id,
        plan_id=item.plan_id,
        parent_item_id=item.parent_item_id,
        song_id=item.song_id,
        item_type=item.item_type,
        sequence=item.sequence,
        title=item.title,
        planned_start=item.planned_start,
        comment=item.comment,
        key_signature=item.key_signature,
        montage_random=item.montage_random,
        auto_collapse_items=item.auto_collapse_items,
        presentation_options=item.presentation_options or {},
        files=files,
        teacher_notes=teacher_note.body if teacher_note else None,
    )


def plan_to_detail(session: Session, plan: Plan, items: list[PlanItem]) -> PlanDetail:
    plan_type = session.get(PlanType, plan.plan_type_id)
    return PlanDetail(
        id=plan.id,
        plan_type=plan_type.name if plan_type else "Unknown",
        plan_type_id=plan.plan_type_id,
        service_date=plan.service_date,
        title=plan.title,
        subtitle=plan.subtitle,
        leader_id=plan.leader_id,
        teacher_id=plan.teacher_id,
        status=plan.status,
        info=plan.info,
        queued_start=plan.queued_start,
        items=[plan_item_to_read(session, item) for item in items],
    )


def get_plan_or_404(session: Session, plan_id: str) -> Plan:
    plan = session.get(Plan, plan_id)
    if plan is None or plan.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    return plan


def history_entry_to_read(session: Session, entry: HistoryEntry) -> PlanHistoryRead | None:
    if entry.details is None:
        return None
    try:
        details = json.loads(entry.details)
    except json.JSONDecodeError:
        return None

    actor = session.get(User, entry.actor_id) if entry.actor_id else None
    return PlanHistoryRead(
        id=entry.id,
        entity_id=entry.entity_id,
        entity_type=entry.entity_type,
        actor_id=entry.actor_id,
        actor_name=actor.name if actor else None,
        created_at=entry.created_at,
        label=details.get("label", entry.action),
        before=details.get("before", []),
        after=details.get("after", []),
        affected=details.get("affected"),
        change_type=details.get("change_type", "plan_items"),
        restorable=details.get("restorable", bool(details.get("before") or details.get("after"))),
        data_before=details.get("data_before", {}),
        data_after=details.get("data_after", {}),
    )


def get_item_or_404(session: Session, item_id: str) -> PlanItem:
    item = session.get(PlanItem, item_id)
    if item is None or item.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan item not found")
    return item


def plan_type_to_read(session: Session, plan_type: PlanType) -> PlanTypeRead:
    defaults = session.scalars(
        select(DefaultItem)
        .where(DefaultItem.plan_type_id == plan_type.id)
        .order_by(DefaultItem.sequence, DefaultItem.created_at)
    ).all()
    default_by_parent: dict[str | None, list[DefaultItem]] = {}
    for item in defaults:
        default_by_parent.setdefault(item.parent_item_id, []).append(item)
    ordered_defaults = [
        nested
        for root in default_by_parent.get(None, [])
        for nested in (root, *default_by_parent.get(root.id, []))
    ]
    return PlanTypeRead(
        id=plan_type.id,
        name=plan_type.name,
        description=plan_type.description,
        starts_at=plan_type.starts_at,
        automation_start=plan_type.automation_start,
        default_duration_minutes=plan_type.default_duration_minutes,
        active=plan_type.active,
        default_outline=[
            {
                "id": item.id,
                "parent_id": item.parent_item_id,
                "item_type": item.item_type,
                "title": item.title,
                "sequence": item.sequence,
                "comment": item.comment,
                "presentation_options": item.presentation_options or {},
            }
            for item in ordered_defaults
        ],
    )


def replace_default_outline(
    session: Session, plan_type: PlanType, outline: list[DefaultOutlineItem]
) -> None:
    existing = {item.id: item for item in session.scalars(
        select(DefaultItem).where(DefaultItem.plan_type_id == plan_type.id)
    ).all()}
    retained: set[str] = set()
    created_ids: dict[str, str] = {}
    for definition in outline:
        item = existing.get(definition.id)
        if item is None:
            item = DefaultItem(plan_type_id=plan_type.id)
            session.add(item)
        for field, value in definition.model_dump(exclude={"id", "parent_id"}).items():
            setattr(item, field, value)
        item.parent_item_id = created_ids.get(definition.parent_id) if definition.parent_id else None
        session.flush()
        retained.add(item.id)
        if definition.id:
            created_ids[definition.id] = item.id
    for item in sorted(existing.values(), key=lambda candidate: candidate.parent_item_id is None):
        if item.id not in retained:
            session.delete(item)
    session.flush()


@router.get("/plan-types", response_model=list[PlanTypeRead])
def list_plan_types(
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[PlanTypeRead]:
    plan_types = session.scalars(select(PlanType).order_by(PlanType.name)).all()
    return [plan_type_to_read(session, plan_type) for plan_type in plan_types]


@router.post("/plan-types", response_model=PlanTypeRead, status_code=status.HTTP_201_CREATED)
def create_plan_type(
    payload: PlanTypeCreate,
    _current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanTypeRead:
    if session.scalar(select(PlanType).where(func.lower(PlanType.name) == payload.name.lower())):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Plan type name already exists")
    values = payload.model_dump(exclude={"default_outline"})
    plan_type = PlanType(**values)
    session.add(plan_type)
    session.flush()
    replace_default_outline(session, plan_type, payload.default_outline)
    session.commit()
    session.refresh(plan_type)
    return plan_type_to_read(session, plan_type)


@router.patch("/plan-types/{plan_type_id}", response_model=PlanTypeRead)
def update_plan_type(
    plan_type_id: str,
    payload: PlanTypeUpdate,
    _current_user: User = Depends(require_permission("users:manage")),
    session: Session = Depends(get_session),
) -> PlanTypeRead:
    plan_type = session.get(PlanType, plan_type_id)
    if plan_type is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan type not found")
    old_queue_start = plan_type.automation_start or plan_type.starts_at
    updates = payload.model_dump(exclude_unset=True, exclude={"default_outline"})
    if "name" in updates and session.scalar(
        select(PlanType).where(
            func.lower(PlanType.name) == updates["name"].lower(), PlanType.id != plan_type.id
        )
    ):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Plan type name already exists")
    old_name = plan_type.name
    for field, value in updates.items():
        setattr(plan_type, field, value)
    new_queue_start = plan_type.automation_start or plan_type.starts_at
    if new_queue_start != old_queue_start:
        future_plans = session.scalars(select(Plan).where(
            Plan.plan_type_id == plan_type.id,
            Plan.deleted_at.is_(None),
            Plan.service_date >= datetime.now(UTC),
        )).all()
        for future_plan in future_plans:
            future_plan.queued_start = new_queue_start
    if plan_type.name != old_name:
        settings = session.scalar(select(BroadcastViewerSettings).limit(1))
        if settings is not None:
            schedules = service_schedules(settings)
            changed = False
            for rule in schedules:
                if rule.plan_type == old_name:
                    rule.plan_type = plan_type.name
                    changed = True
            if changed:
                settings.service_schedules_json = json.dumps(
                    [rule.model_dump() for rule in schedules], separators=(",", ":")
                )
    if payload.default_outline is not None:
        replace_default_outline(session, plan_type, payload.default_outline)
    session.commit()
    session.refresh(plan_type)
    return plan_type_to_read(session, plan_type)


@router.get("/plans", response_model=list[PlanSummary])
def list_plans(
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[PlanSummary]:
    plans = session.scalars(
        select(Plan).where(Plan.deleted_at.is_(None)).order_by(Plan.service_date)
    ).all()
    summaries: list[PlanSummary] = []

    for plan in plans:
        plan_type = session.get(PlanType, plan.plan_type_id)
        item_count = session.scalar(
            select(func.count(PlanItem.id)).where(
                PlanItem.plan_id == plan.id,
                PlanItem.deleted_at.is_(None),
                PlanItem.item_type.not_in(
                    {"worship_set", "welcome_montage", "welcome_countdown", "welcome_seated"}
                ),
                or_(PlanItem.parent_item_id.is_not(None), PlanItem.song_id.is_not(None)),
            )
        )
        summaries.append(
            PlanSummary(
                id=plan.id,
                title=plan.title,
                subtitle=plan.subtitle,
                service_date=plan.service_date,
                status=plan.status,
                plan_type=plan_type.name if plan_type else "Unknown",
                leader_id=plan.leader_id,
                item_count=item_count or 0,
            )
        )

    return summaries


@router.get("/plans/stashed-worship-sets", response_model=list[StashedWorshipSetRead])
def list_stashed_worship_sets(
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[StashedWorshipSetRead]:
    """Return archived worship sets, including their songs, for reuse on another date."""
    plans = session.scalars(
        select(Plan)
        .join(PlanType, Plan.plan_type_id == PlanType.id)
        .where(
            Plan.deleted_at.is_not(None),
            PlanType.name == "Worship Set",
            select(PlanItem.id)
            .where(
                PlanItem.plan_id == Plan.id,
                PlanItem.deleted_at.is_(None),
                PlanItem.song_id.is_not(None),
            )
            .exists(),
        )
        .order_by(Plan.deleted_at.desc(), Plan.service_date.desc())
    ).all()
    results: list[StashedWorshipSetRead] = []
    for plan in plans:
        items = list(session.scalars(
            select(PlanItem)
            .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
            .order_by(PlanItem.sequence, PlanItem.created_at)
        ).all())
        detail = plan_to_detail(session, plan, items)
        results.append(StashedWorshipSetRead(
            **detail.model_dump(),
            stashed_at=plan.deleted_at,
        ))
    return results


@router.post("/plans", response_model=PlanDetail, status_code=status.HTTP_201_CREATED)
def create_plan(
    payload: PlanCreate,
    _current_user: User = Depends(require_permission("plans:create")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan_type = session.get(PlanType, payload.plan_type_id)
    if plan_type is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid plan type"
        )

    plan = Plan(**payload.model_dump())
    if plan.queued_start is None:
        plan.queued_start = plan_type.automation_start or plan_type.starts_at
    session.add(plan)
    session.commit()
    session.refresh(plan)
    # A plan row is the durable date slot.  Keep it empty until somebody adds
    # real content; the first item materializes the applicable outline.
    return plan_to_detail(session, plan, [])


def ensure_service_for_worship_set(session: Session, plan: Plan) -> None:
    plan_type = session.get(PlanType, plan.plan_type_id)
    if plan_type is not None and plan_type.name == "Worship Set":
        default_name = "Sunday Service" if plan.service_date.weekday() == 6 else "Midweek Meeting"
        service_type = session.scalar(
            select(PlanType).where(PlanType.name == default_name, PlanType.active.is_(True))
        )
        if service_type is None:
            service_type = session.scalar(
                select(PlanType).where(
                    func.lower(PlanType.name).like(f"{default_name.split()[0].lower()}%"),
                    PlanType.active.is_(True),
                )
            )
        if service_type is not None:
            service_plan = session.scalar(
                select(Plan).where(
                    Plan.deleted_at.is_(None),
                    Plan.plan_type_id == service_type.id,
                    func.date(Plan.service_date) == plan.service_date.date(),
                )
            )
            if service_plan is None:
                service_plan = Plan(
                    plan_type_id=service_type.id,
                    service_date=plan.service_date,
                    title=f"{service_type.name} {plan.service_date.strftime('%d %b %Y')}",
                    subtitle=None,
                    leader_id=None,
                    teacher_id=None,
                    status="draft",
                    info=None,
                    queued_start=service_type.automation_start or service_type.starts_at,
                )
                session.add(service_plan)
                session.commit()
                session.refresh(service_plan)
            ensure_service_scaffold(session, service_plan)


@router.post("/plans/{plan_id}/service-scaffold", response_model=PlanDetail)
def add_missing_service_sections(
    plan_id: str,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
    if "queued_start" in payload.model_fields_set and payload.queued_start:
        now_local = datetime.now(SERVICE_TIME_ZONE)
        service_day = plan.service_date.astimezone(SERVICE_TIME_ZONE).date()
        queued_hour, queued_minute = (int(part) for part in payload.queued_start.split(":"))
        queued_at = now_local.replace(hour=queued_hour, minute=queued_minute, second=0, microsecond=0)
        if service_day < now_local.date() or (service_day == now_local.date() and queued_at <= now_local):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Queued start must be in the future for today's service",
            )
    ensure_service_scaffold(session, plan)
    items = list(
        session.scalars(
            select(PlanItem)
            .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
            .order_by(PlanItem.sequence, PlanItem.created_at)
        ).all()
    )
    return plan_to_detail(session, plan, items)


@router.get("/plans/{plan_id}", response_model=PlanDetail)
def get_plan(
    plan_id: str,
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = get_plan_or_404(session, plan_id)
    items = list(session.scalars(
        select(PlanItem)
        .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        .order_by(
            PlanItem.sequence,
            PlanItem.created_at,
        )
    ).all())
    # Reading a durable date slot must not turn its template into visible
    # content. Existing services still get legacy outline repairs, while a
    # genuinely empty service stays empty until content is explicitly added.
    if items and not session.scalar(select(DefaultItem.id).where(DefaultItem.plan_type_id == plan.plan_type_id).limit(1)):
        ensure_service_scaffold(session, plan)
        items = list(session.scalars(
            select(PlanItem)
            .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
            .order_by(PlanItem.sequence, PlanItem.created_at)
        ).all())
    return plan_to_detail(session, plan, items)


@router.get("/plans/{plan_id}/history", response_model=list[PlanHistoryRead])
def list_plan_history(
    plan_id: str,
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[PlanHistoryRead]:
    get_plan_or_404(session, plan_id)
    song_ids = session.scalars(
        select(PlanItem.song_id).where(
            PlanItem.plan_id == plan_id,
            PlanItem.deleted_at.is_(None),
            PlanItem.song_id.is_not(None),
        )
    ).all()
    history_filters = [
        (HistoryEntry.entity_type == PLAN_HISTORY_ENTITY_TYPE)
        & (HistoryEntry.entity_id == plan_id),
    ]
    if song_ids:
        history_filters.append(
            (HistoryEntry.entity_type == "song") & HistoryEntry.entity_id.in_(song_ids)
        )
    entries = session.scalars(
        select(HistoryEntry)
        .where(
            HistoryEntry.action == PLAN_HISTORY_ACTION,
            or_(*history_filters),
        )
        .order_by(HistoryEntry.created_at.desc())
        .limit(PLAN_HISTORY_LIMIT)
    ).all()
    history = []
    for stored_entry in entries:
        entry = history_entry_to_read(session, stored_entry)
        if entry and (stored_entry.entity_type == PLAN_HISTORY_ENTITY_TYPE or entry.restorable):
            history.append(entry)
    return list(reversed(history))


@router.post(
    "/plans/{plan_id}/history", response_model=PlanHistoryRead, status_code=status.HTTP_201_CREATED
)
def create_plan_history(
    plan_id: str,
    payload: PlanHistoryCreate,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanHistoryRead:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
    details = payload.model_dump(mode="json")
    entry = HistoryEntry(
        actor_id=current_user.id,
        entity_type=PLAN_HISTORY_ENTITY_TYPE,
        entity_id=plan_id,
        action=PLAN_HISTORY_ACTION,
        details=json.dumps(details, separators=(",", ":")),
    )
    session.add(entry)
    session.commit()
    session.refresh(entry)
    read_entry = history_entry_to_read(session, entry)
    if read_entry is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create plan history",
        )
    return read_entry


@router.patch("/plans/{plan_id}", response_model=PlanDetail)
def update_plan(
    plan_id: str,
    payload: PlanUpdate,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(plan, field, value)

    session.commit()
    session.refresh(plan)
    items = session.scalars(
        select(PlanItem)
        .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        .order_by(
            PlanItem.sequence,
            PlanItem.created_at,
        )
    ).all()
    return plan_to_detail(session, plan, list(items))


@router.delete("/plans/{plan_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan(
    plan_id: str,
    current_user: User = Depends(require_permission("plans:delete")),
    session: Session = Depends(get_session),
) -> Response:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
    plan.deleted_at = datetime.now(UTC)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/plans/{plan_id}/restore", response_model=PlanDetail)
def restore_plan(
    plan_id: str,
    current_user: User = Depends(require_permission("plans:delete")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
    require_plan_editable(session, plan, current_user)
    plan.deleted_at = None
    session.commit()
    session.refresh(plan)
    items = session.scalars(
        select(PlanItem)
        .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        .order_by(PlanItem.sequence, PlanItem.created_at)
    ).all()
    return plan_to_detail(session, plan, list(items))


@router.post(
    "/plans/{plan_id}/items",
    response_model=PlanItemRead,
    status_code=status.HTTP_201_CREATED,
)
def create_plan_item(
    plan_id: str,
    payload: PlanItemCreate,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanItemRead:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
    if payload.parent_item_id:
        parent = session.get(PlanItem, payload.parent_item_id)
        if parent is None or parent.plan_id != plan_id or parent.deleted_at is not None or parent.parent_item_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Items can only be added directly beneath a group in the same plan",
            )
    first_content = not session.scalar(select(PlanItem.id).where(
        PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None)
    ).limit(1))
    item_values = payload.model_dump()
    if not payload.parent_item_id and "auto_collapse_items" not in payload.model_fields_set:
        item_values["auto_collapse_items"] = section_auto_collapse_preference(
            session, payload.item_type, payload.title
        )
    item = PlanItem(plan_id=plan_id, **item_values)
    session.add(item)
    session.commit()
    session.refresh(item)
    plan_type = session.get(PlanType, plan.plan_type_id)
    if plan_type is not None and plan_type.name == "Worship Set":
        ensure_service_for_worship_set(session, plan)
    elif first_content or not session.scalar(select(DefaultItem.id).where(DefaultItem.plan_type_id == plan.plan_type_id).limit(1)):
        ensure_service_scaffold(session, plan)
    return plan_item_to_read(session, item)


def seed_implicit_template(session: Session, plan: Plan) -> None:
    if not is_sunday_service(session, plan) or session.scalar(select(DefaultItem.id).where(DefaultItem.plan_type_id == plan.plan_type_id).limit(1)):
        return
    items = list(session.scalars(select(PlanItem).where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None)).order_by(PlanItem.sequence)).all())
    for item in sorted(items, key=lambda candidate: candidate.parent_item_id is not None):
        if not item.song_id:
            save_item_template(session, plan, item, item.title)


def save_item_template(session: Session, plan: Plan, item: PlanItem, original_title: str, *, update_existing: bool = True) -> DefaultItem:
    """Copy configuration into this service type, never into the source type."""
    parent_default = None
    if item.parent_item_id:
        parent = get_item_or_404(session, item.parent_item_id)
        parent_default = save_item_template(session, plan, parent, parent.title, update_existing=False)
    defaults = list(session.scalars(select(DefaultItem).where(
        DefaultItem.plan_type_id == plan.plan_type_id,
        DefaultItem.parent_item_id == (parent_default.id if parent_default else None),
    )).all())
    source_id = (item.presentation_options or {}).get("template_id")
    default = next((entry for entry in defaults if entry.id == source_id), None)
    if default is None:
        matches = [entry for entry in defaults if entry.item_type == item.item_type and entry.title == original_title]
        default = matches[0] if len(matches) == 1 else None
    if default is not None and not update_existing:
        return default
    if default is None:
        default = DefaultItem(plan_type_id=plan.plan_type_id, parent_item_id=parent_default.id if parent_default else None,
                              item_type=item.item_type, title=item.title, sequence=item.sequence)
        session.add(default)
        session.flush()
    default.title = item.title
    default.presentation_options = {
        **{key: value for key, value in (item.presentation_options or {}).items() if key not in {"template_id", "announcement_date", "announcement_location", "announcement_contact", "announcement_url"}},
        "auto_collapse_items": item.auto_collapse_items,
        "scheduled_start": item.planned_start or "",
    }
    item.presentation_options = {**(item.presentation_options or {}), "template_id": default.id}
    return default


@router.post("/plans/{plan_id}/save-outline", response_model=PlanTypeRead)
def save_service_outline(
    plan_id: str,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanTypeRead:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
    items = list(session.scalars(select(PlanItem).where(
        PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None), PlanItem.song_id.is_(None)
    ).order_by(PlanItem.sequence, PlanItem.created_at)).all())
    retained: set[str] = set()
    for item in sorted(items, key=lambda candidate: candidate.parent_item_id is not None):
        default = save_item_template(session, plan, item, item.title)
        default.sequence = item.sequence
        retained.add(default.id)
    defaults = list(session.scalars(select(DefaultItem).where(DefaultItem.plan_type_id == plan.plan_type_id)).all())
    for default in sorted(defaults, key=lambda candidate: candidate.parent_item_id is None):
        if default.id not in retained:
            session.delete(default)
    session.commit()
    return plan_type_to_read(session, session.get(PlanType, plan.plan_type_id))


@router.post("/plans/{plan_id}/sections", response_model=PlanItemRead, status_code=status.HTTP_201_CREATED)
def insert_section_template(
    plan_id: str,
    payload: SectionTemplateInsert,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanItemRead:
    plan = get_plan_or_404(session, plan_id)
    require_plan_editable(session, plan, current_user)
    source = session.get(DefaultItem, payload.template_id) if payload.template_id else None
    if payload.template_id and (source is None or source.parent_item_id):
        raise HTTPException(status_code=404, detail="Section template not found")
    options = dict(source.presentation_options or {}) if source else {}
    options.pop("template_id", None)
    item = PlanItem(plan_id=plan.id, sequence=payload.sequence, title=payload.title.strip(),
                    item_type=source.item_type if source else "custom", comment=source.comment if source else None,
                    planned_start=options.get("scheduled_start") or None,
                    auto_collapse_items=bool(options.get("auto_collapse_items")), presentation_options=options)
    if not item.title:
        raise HTTPException(status_code=422, detail="Section name is required")
    session.add(item)
    session.flush()
    if payload.save_template:
        seed_implicit_template(session, plan)
        save_item_template(session, plan, item, item.title)
    children = list(session.scalars(select(DefaultItem).where(DefaultItem.parent_item_id == source.id).order_by(DefaultItem.sequence)).all()) if source else []
    for child in children:
        child_options = {key: value for key, value in (child.presentation_options or {}).items() if key != "template_id"}
        added = PlanItem(plan_id=plan.id, parent_item_id=item.id, sequence=child.sequence,
                         item_type=child.item_type, title=child.title, comment=child.comment,
                         planned_start=child_options.get("scheduled_start") or None, presentation_options=child_options)
        session.add(added)
        session.flush()
        if payload.save_template:
            save_item_template(session, plan, added, added.title)
    session.commit()
    session.refresh(item)
    return plan_item_to_read(session, item)


@router.patch("/items/{item_id}", response_model=PlanItemRead)
def update_plan_item(
    item_id: str,
    payload: PlanItemUpdate,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanItemRead:
    item = get_item_or_404(session, item_id)
    plan = get_plan_or_404(session, item.plan_id)
    require_plan_editable(session, plan, current_user)
    payload_data = payload.model_dump(exclude_unset=True)
    teacher_notes = payload_data.pop("teacher_notes", None)
    default_groups = payload_data.pop("default_groups", [])
    save_template = payload_data.pop("save_template", False)
    original_title = item.title

    if default_groups and "users:manage" not in set(list_permissions(session, current_user.id)):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only administrators can change service template defaults",
        )

    if presenter_cannot_change_outline(
        session, current_user, item
    ) and changes_protected_outline_fields(item, payload_data):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Presenters cannot move or change Sunday service outline slides",
        )

    if save_template:
        seed_implicit_template(session, plan)

    for field, value in payload_data.items():
        setattr(item, field, value)

    if default_groups and item.presentation_options:
        plan_type_id = plan.plan_type_id
        default_query = select(DefaultItem).where(
            DefaultItem.plan_type_id == plan_type_id,
            DefaultItem.item_type == item.item_type,
        )
        default_query = default_query.where(
            DefaultItem.parent_item_id.is_not(None)
            if item.parent_item_id
            else DefaultItem.parent_item_id.is_(None)
        )
        default_item = session.scalar(default_query.order_by(DefaultItem.sequence).limit(1))
        if default_item is not None:
            default_item.presentation_options = presentation_defaults_for_groups(
                default_item.presentation_options or {}, item.presentation_options, default_groups
            )

    if save_template:
        save_item_template(session, plan, item, original_title)

    if "teacher_notes" in payload.model_fields_set:
        note = session.scalar(
            select(ItemNote)
            .where(ItemNote.plan_item_id == item.id)
            .order_by(ItemNote.updated_at.desc(), ItemNote.created_at.desc())
        )
        note_text = (teacher_notes or "").strip()
        if note_text:
            if note is None:
                note = ItemNote(plan_item_id=item.id, author_id=current_user.id, body=note_text)
            else:
                note.body = note_text
                note.author_id = current_user.id
            session.add(note)
        elif note is not None:
            session.delete(note)

    session.commit()
    session.refresh(item)
    return plan_item_to_read(session, item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan_item(
    item_id: str,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> Response:
    item = get_item_or_404(session, item_id)
    plan = get_plan_or_404(session, item.plan_id)
    require_plan_editable(session, plan, current_user)
    if presenter_cannot_change_outline(session, current_user, item):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Presenters cannot remove Sunday service outline slides",
        )
    item.deleted_at = datetime.now(UTC)
    session.query(PlanItem).filter(
        PlanItem.parent_item_id == item.id,
        PlanItem.deleted_at.is_(None),
    ).update({PlanItem.deleted_at: item.deleted_at}, synchronize_session=False)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
