from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.planning.models import PlanType

WORSHIP_SET_PLAN_TYPE = "Worship Set"


def ensure_worship_set_plan_type(session: Session) -> PlanType:
    plan_type = session.scalar(select(PlanType).where(PlanType.name == WORSHIP_SET_PLAN_TYPE))
    if plan_type is None:
        plan_type = PlanType(
            name=WORSHIP_SET_PLAN_TYPE,
            description=(
                "Dated worship song set used by musicians and pulled into matching services."
            ),
            starts_at="10:30",
            default_duration_minutes=30,
            active=True,
        )
        session.add(plan_type)
        session.flush()
    return plan_type
