from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import get_session
from app.modules.identity.models import User
from app.modules.identity.auth import CurrentUser, require_any_permission, require_permission
from app.modules.library.models import ItemFile, StoredFile
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.planning.schemas import (
    PlanCreate,
    PlanDetail,
    PlanItemCreate,
    PlanItemRead,
    PlanItemUpdate,
    PlanSummary,
    PlanTypeRead,
    PlanUpdate,
)

router = APIRouter()


def plan_item_to_read(session: Session, item: PlanItem) -> PlanItemRead:
    item_files = session.scalars(
        select(ItemFile).where(ItemFile.plan_item_id == item.id).order_by(ItemFile.sort_order)
    ).all()
    files = []
    for row in item_files:
        stored_file = session.get(StoredFile, row.file_id)
        if stored_file:
            files.append(
                {
                    "id": row.id,
                    "file_id": row.file_id,
                    "sort_order": row.sort_order,
                    "display_name": stored_file.display_name,
                    "content_type": stored_file.content_type,
                }
            )

    return PlanItemRead(
        id=item.id,
        plan_id=item.plan_id,
        song_id=item.song_id,
        item_type=item.item_type,
        sequence=item.sequence,
        title=item.title,
        comment=item.comment,
        key_signature=item.key_signature,
        files=files,
    )


def plan_to_detail(session: Session, plan: Plan, items: list[PlanItem]) -> PlanDetail:
    return PlanDetail(
        id=plan.id,
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


def get_item_or_404(session: Session, item_id: str) -> PlanItem:
    item = session.get(PlanItem, item_id)
    if item is None or item.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Plan item not found")
    return item


@router.get("/plan-types", response_model=list[PlanTypeRead])
def list_plan_types(
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> list[PlanTypeRead]:
    plan_types = session.scalars(select(PlanType).order_by(PlanType.name)).all()
    return [
        PlanTypeRead(
            id=plan_type.id,
            name=plan_type.name,
            description=plan_type.description,
            starts_at=plan_type.starts_at,
            default_duration_minutes=plan_type.default_duration_minutes,
            active=plan_type.active,
        )
        for plan_type in plan_types
    ]


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
    if session.get(PlanType, payload.plan_type_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid plan type")

    plan = Plan(**payload.model_dump())
    session.add(plan)
    session.commit()
    session.refresh(plan)
    return plan_to_detail(session, plan, [])


@router.get("/plans/{plan_id}", response_model=PlanDetail)
def get_plan(
    plan_id: str,
    _current_user: User = Depends(require_permission("plans:read")),
    session: Session = Depends(get_session),
) -> PlanDetail:
    plan = get_plan_or_404(session, plan_id)
    items = session.scalars(
        select(PlanItem).where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None)).order_by(
            PlanItem.sequence,
            PlanItem.created_at,
        )
    ).all()
    return plan_to_detail(session, plan, list(items))


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
    return get_plan(plan.id, session)


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
    get_plan_or_404(session, plan_id)
    item = PlanItem(plan_id=plan_id, **payload.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    return plan_item_to_read(session, item)


@router.patch("/items/{item_id}", response_model=PlanItemRead)
def update_plan_item(
    item_id: str,
    payload: PlanItemUpdate,
    _current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> PlanItemRead:
    item = get_item_or_404(session, item_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(item, field, value)

    session.commit()
    session.refresh(item)
    return plan_item_to_read(session, item)


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_plan_item(
    item_id: str,
    _current_user: User = Depends(require_any_permission("plans:edit", "plans:create")),
    session: Session = Depends(get_session),
) -> Response:
    item = get_item_or_404(session, item_id)
    item.deleted_at = datetime.now(UTC)
    session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
