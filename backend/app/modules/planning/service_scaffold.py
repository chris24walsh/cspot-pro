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
    planned_start: str
    aliases: frozenset[str]


SUNDAY_SERVICE_SCAFFOLD = (
    ServiceSectionTemplate(
        Decimal("10"), "pre_service", "Pre-service fellowship", "10:30", frozenset({"pre_service"})
    ),
    ServiceSectionTemplate(
        Decimal("20"), "seating", "Call to seats", "10:55", frozenset({"seating", "countdown"})
    ),
    ServiceSectionTemplate(
        Decimal("30"),
        "welcome",
        "Welcome, opening word and prayer",
        "11:00",
        frozenset({"welcome", "opening"}),
    ),
    ServiceSectionTemplate(
        Decimal("40"), "worship_set", "Worship", "11:05", frozenset({"worship_set", "song"})
    ),
    ServiceSectionTemplate(
        Decimal("50"),
        "sunday_school",
        "Sunday school prayer and dismissal",
        "11:35",
        frozenset({"sunday_school"}),
    ),
    ServiceSectionTemplate(
        Decimal("60"),
        "testimony",
        "Testimony and congregational sharing",
        "11:40",
        frozenset({"testimony", "sharing"}),
    ),
    ServiceSectionTemplate(
        Decimal("70"), "sermon", "Sermon / message", "11:50", frozenset({"sermon", "message"})
    ),
    ServiceSectionTemplate(
        Decimal("80"),
        "response",
        "Response, closing song or prayer",
        "12:30",
        frozenset({"response", "closing"}),
    ),
    ServiceSectionTemplate(
        Decimal("90"),
        "announcements",
        "Announcements",
        "12:40",
        frozenset({"announcements", "notices"}),
    ),
    ServiceSectionTemplate(
        Decimal("100"),
        "end",
        "Dismissal and fellowship",
        "12:45",
        frozenset({"end", "dismissal", "post_service"}),
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
