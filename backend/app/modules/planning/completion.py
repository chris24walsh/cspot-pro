from datetime import datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.modules.identity.auth import list_role_names
from app.modules.identity.models import User
from app.modules.planning.models import Plan, PlanType


def _local_timezone() -> ZoneInfo:
    try:
        return ZoneInfo(settings.app_timezone)
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def plan_edit_cutoff(session: Session, plan: Plan) -> datetime:
    """Return the instant after which ordinary users may no longer edit a plan."""
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
            plan_type = session.get(PlanType, linked.plan_type_id)

    if plan_type is not None and plan_type.starts_at:
        try:
            start = time.fromisoformat(plan_type.starts_at)
            return datetime.combine(service_day, start, tzinfo=zone)
        except ValueError:
            pass
    return datetime.combine(service_day, time.max, tzinfo=zone)


def require_plan_editable(
    session: Session, plan: Plan, user: User, *, now: datetime | None = None
) -> None:
    if "administrator" in set(list_role_names(session, user.id)):
        return
    current = now.astimezone(_local_timezone()) if now else datetime.now(_local_timezone())
    if current > plan_edit_cutoff(session, plan):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This service has finished and can only be edited by an administrator",
        )
