from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.planning.models import Plan, PlanItem, PlanType

SUNDAY_SERVICE_PLAN_TYPE = "Sunday Service"


@dataclass(frozen=True)
class ServiceSectionTemplate:
    sequence: Decimal
    item_type: str
    title: str
    planned_start: str | None
    aliases: frozenset[str]


SUNDAY_SERVICE_SCAFFOLD = (
    ServiceSectionTemplate(
        Decimal("10"),
        "pre_service",
        "Welcome",
        None,
        frozenset({"pre_service", "welcome", "opening", "seating", "countdown"}),
    ),
    ServiceSectionTemplate(
        Decimal("20"), "worship_set", "Worship", None, frozenset({"worship_set", "song"})
    ),
    ServiceSectionTemplate(
        Decimal("30"),
        "open_time",
        "Open time",
        None,
        frozenset({"open_time", "community", "sunday_school", "testimony", "sharing"}),
    ),
    ServiceSectionTemplate(
        Decimal("40"), "sermon", "Sermon", None, frozenset({"sermon", "message"})
    ),
    ServiceSectionTemplate(
        Decimal("50"),
        "announcements",
        "Announcements",
        None,
        frozenset({"announcements", "notices", "end", "dismissal", "post_service"}),
    ),
)


def is_sunday_service(session: Session, plan: Plan) -> bool:
    plan_type = session.get(PlanType, plan.plan_type_id)
    return bool(plan_type and plan_type.name == SUNDAY_SERVICE_PLAN_TYPE)


def ensure_service_scaffold(session: Session, plan: Plan) -> list[PlanItem]:
    if not is_sunday_service(session, plan):
        return []
    existing = list(
        session.scalars(
            select(PlanItem).where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        ).all()
    )
    existing_types = {item.item_type.lower() for item in existing}
    existing_titles = {item.title.strip().lower() for item in existing}
    created: list[PlanItem] = []
    for section in SUNDAY_SERVICE_SCAFFOLD:
        title_match = section.title.lower() in existing_titles
        type_match = bool(section.aliases & existing_types)
        if title_match or type_match:
            continue
        item = PlanItem(
            plan_id=plan.id,
            sequence=section.sequence,
            item_type=section.item_type,
            title=section.title,
            planned_start=section.planned_start,
        )
        session.add(item)
        created.append(item)
    if created:
        session.commit()
        for item in created:
            session.refresh(item)
    return created
