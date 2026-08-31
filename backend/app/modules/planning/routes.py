import json
from datetime import UTC, date, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.broadcast.models import BroadcastViewerSettings
from app.modules.broadcast.settings import service_schedules
from app.modules.identity.auth import list_role_names, require_any_permission, require_permission
from app.modules.identity.models import User
from app.modules.library.models import FileCategory, ItemFile, StoredFile
from app.modules.planning.models import (
    HistoryEntry,
    DefaultItem,
    ItemNote,
    Plan,
    PlanItem,
    PlanType,
    WorshipLeaderAssignment,
)
from app.modules.planning.schemas import (
    PlanCreate,
    DefaultOutlineItem,
    PlanDetail,
    PlanHistoryCreate,
    PlanHistoryRead,
    PlanItemCreate,
    PlanItemRead,
    PlanItemUpdate,
    PlanSummary,
    PlanTypeRead,
    PlanTypeCreate,
    PlanTypeUpdate,
    PlanUpdate,
    WorshipLeaderAssignmentRead,
    WorshipLeaderAssignmentUpdate,
)
from app.modules.planning.service_scaffold import ensure_service_scaffold, is_sunday_service

router = APIRouter()
PLAN_HISTORY_ACTION = "item_snapshot"
PLAN_HISTORY_ENTITY_TYPE = "plan"
PLAN_HISTORY_LIMIT = 80
FIXED_SUNDAY_OUTLINE_ITEM_TYPES = {
    "pre_service",
    "worship_set",
    "open_time",
    "sermon",
    "announcements",
}


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
    if item.item_type in {"pre_service", "open_time", "sermon", "announcements"}:
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
                    PlanItem.item_type == item.item_type,
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

    if item.item_type == "pre_service":
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
        song_id=item.song_id,
        item_type=item.item_type,
        sequence=item.sequence,
        title=item.title,
        planned_start=item.planned_start,
        comment=item.comment,
        key_signature=item.key_signature,
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
        actor_id=entry.actor_id,
        actor_name=actor.name if actor else None,
        created_at=entry.created_at,
        label=details.get("label", entry.action),
        before=details.get("before", []),
        after=details.get("after", []),
        affected=details.get("affected"),
        change_type=details.get("change_type", "plan_items"),
        restorable=details.get("restorable", bool(details.get("before") or details.get("after"))),
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
    return PlanTypeRead(
        id=plan_type.id,
        name=plan_type.name,
        description=plan_type.description,
        starts_at=plan_type.starts_at,
        default_duration_minutes=plan_type.default_duration_minutes,
        active=plan_type.active,
        default_outline=[
            {
                "item_type": item.item_type,
                "title": item.title,
                "sequence": item.sequence,
                "comment": item.comment,
            }
            for item in defaults
        ],
    )


def replace_default_outline(
    session: Session, plan_type: PlanType, outline: list[DefaultOutlineItem]
) -> None:
    for item in session.scalars(
        select(DefaultItem).where(DefaultItem.plan_type_id == plan_type.id)
    ).all():
        session.delete(item)
    for definition in outline:
        values = definition.model_dump()
        session.add(DefaultItem(plan_type_id=plan_type.id, **values))


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
    _current_user: User = Depends(require_permission("users:manage")),
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
                PlanItem.item_type != "worship_set",
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
    session.add(plan)
    session.commit()
    session.refresh(plan)
    items = ensure_service_scaffold(session, plan)
    return plan_to_detail(session, plan, items)


@router.post("/plans/{plan_id}/service-scaffold", response_model=PlanDetail)
def add_missing_service_sections(
    plan_id: str,
    _current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = get_plan_or_404(session, plan_id)
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
    items = session.scalars(
        select(PlanItem)
        .where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        .order_by(
            PlanItem.sequence,
            PlanItem.created_at,
        )
    ).all()
    return plan_to_detail(session, plan, list(items))


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
    history = [
        entry for entry in (history_entry_to_read(session, entry) for entry in entries) if entry
    ]
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
    get_plan_or_404(session, plan_id)
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
    _current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = get_plan_or_404(session, plan_id)
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
    _current_user: User = Depends(require_permission("plans:delete")),
    session: Session = Depends(get_session),
) -> Response:
    plan = get_plan_or_404(session, plan_id)
    plan.deleted_at = datetime.now(UTC)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/plans/{plan_id}/restore", response_model=PlanDetail)
def restore_plan(
    plan_id: str,
    _current_user: User = Depends(require_permission("plans:delete")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = session.get(Plan, plan_id)
    if plan is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan not found")
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
    _current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanItemRead:
    plan = get_plan_or_404(session, plan_id)
    item = PlanItem(plan_id=plan_id, **payload.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    if item.item_type in {"song", "worship_set", "sermon", "message"}:
        ensure_service_scaffold(session, plan)
    return plan_item_to_read(session, item)


@router.patch("/items/{item_id}", response_model=PlanItemRead)
def update_plan_item(
    item_id: str,
    payload: PlanItemUpdate,
    current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanItemRead:
    item = get_item_or_404(session, item_id)
    payload_data = payload.model_dump(exclude_unset=True)
    teacher_notes = payload_data.pop("teacher_notes", None)

    if presenter_cannot_change_outline(session, current_user, item) and any(
        field in payload_data for field in {"item_type", "sequence", "title"}
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Presenters cannot move or change Sunday service outline slides",
        )

    for field, value in payload_data.items():
        setattr(item, field, value)

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
    if presenter_cannot_change_outline(session, current_user, item):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Presenters cannot remove Sunday service outline slides",
        )
    item.deleted_at = datetime.now(UTC)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
