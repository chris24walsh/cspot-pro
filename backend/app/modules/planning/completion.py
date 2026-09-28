from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.identity.auth import list_role_names
from app.modules.identity.models import User
from app.modules.planning.models import Plan, PlanType
from app.modules.presentation.models import PresentationSession


def _local_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.app_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def plan_has_finished(session: Session, plan: Plan, *, now: datetime | None = None) -> bool:
    """Return whether a plan is historical or its latest service run has ended."""
    zone = _local_timezone()
    service_day = plan.service_date.astimezone(zone).date()
    plan_type = session.get(PlanType, plan.plan_type_id)

    # A worship set follows the real service on the same local calendar day.
    if plan_type is not None and plan_type.name.casefold() == "worship set":
        linked = session.scalar(
            select(Plan)
            .join(PlanType, Plan.plan_type_id == PlanType.id)
            .where(
                Plan.deleted_at.is_(None),
                Plan.id != plan.id,
                func.date(Plan.service_date) == service_day,
                func.lower(PlanType.name) != "worship set",
            )
            .order_by(Plan.service_date)
        )
        if linked is not None:
            plan = linked
    current = now.astimezone(zone) if now else datetime.now(zone)
    if service_day < current.date():
        return True
    latest = session.scalar(
        select(PresentationSession)
        .where(PresentationSession.plan_id == plan.id)
        .order_by(PresentationSession.created_at.desc())
        .limit(1)
    )
    return bool(latest and latest.status == "ended" and latest.ended_at is not None)


def require_plan_editable(
    session: Session, plan: Plan, user: User, *, now: datetime | None = None
) -> None:
    if "administrator" in set(list_role_names(session, user.id)):
        return
    if plan_has_finished(session, plan, now=now):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This service has finished and can only be edited by an administrator",
        )
