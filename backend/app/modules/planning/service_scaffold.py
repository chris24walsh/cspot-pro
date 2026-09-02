from dataclasses import dataclass
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.modules.library.models import ItemFile
from app.modules.planning.models import DefaultItem, Plan, PlanItem, PlanType

SUNDAY_SERVICE_PLAN_TYPE = "Sunday Service"
WELCOME_STAGE_TYPES = (
    ("welcome_montage", "Welcome montage", Decimal("10")),
    ("welcome_countdown", "Service countdown", Decimal("20")),
    ("welcome_seated", "Please be seated", Decimal("30")),
)


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


def ensure_welcome_stage_items(session: Session, plan: Plan) -> list[PlanItem]:
    welcome = session.scalar(
        select(PlanItem).where(
            PlanItem.plan_id == plan.id,
            PlanItem.parent_item_id.is_(None),
            PlanItem.item_type == "pre_service",
            PlanItem.deleted_at.is_(None),
        )
    )
    if welcome is None:
        return []

    children = list(
        session.scalars(
            select(PlanItem).where(
                PlanItem.plan_id == plan.id,
                PlanItem.parent_item_id == welcome.id,
                PlanItem.deleted_at.is_(None),
            )
        ).all()
    )
    children_by_type = {item.item_type: item for item in children}
    created: list[PlanItem] = []
    for item_type, title, sequence in WELCOME_STAGE_TYPES:
        if item_type in children_by_type:
            continue
        child = PlanItem(
            plan_id=plan.id,
            parent_item_id=welcome.id,
            sequence=sequence,
            item_type=item_type,
            title=title,
        )
        session.add(child)
        session.flush()
        children_by_type[item_type] = child
        created.append(child)

    montage = children_by_type["welcome_montage"]
    # Existing Welcome photos belong to the montage stage. Moving the links
    # preserves both service-specific and persistent media without duplication.
    migrated_files = False
    for item_file in session.scalars(
        select(ItemFile).where(ItemFile.plan_item_id == welcome.id)
    ).all():
        item_file.plan_item_id = montage.id
        migrated_files = True

    if created or migrated_files:
        session.commit()
        for item in created:
            session.refresh(item)
    return created


def ensure_service_scaffold(session: Session, plan: Plan) -> list[PlanItem]:
    defaults = list(
        session.scalars(
            select(DefaultItem)
            .where(DefaultItem.plan_type_id == plan.plan_type_id)
            .order_by(DefaultItem.sequence, DefaultItem.created_at)
        ).all()
    )
    if defaults:
        templates = tuple(
            ServiceSectionTemplate(
                item.sequence,
                item.item_type,
                item.title,
                None,
                frozenset() if item.item_type == "custom" else frozenset({item.item_type}),
            )
            for item in defaults
        )
    elif is_sunday_service(session, plan):
        templates = SUNDAY_SERVICE_SCAFFOLD
    else:
        return []
    existing = list(
        session.scalars(
            select(PlanItem).where(PlanItem.plan_id == plan.id, PlanItem.deleted_at.is_(None))
        ).all()
    )
    existing_types = {item.item_type.lower() for item in existing}
    existing_titles = {item.title.strip().lower() for item in existing}
    created: list[PlanItem] = []
    for section in templates:
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
            comment=next(
                (item.comment for item in defaults if item.sequence == section.sequence), None
            ),
        )
        session.add(item)
        created.append(item)
    if created:
        session.commit()
        for item in created:
            session.refresh(item)
    created.extend(ensure_welcome_stage_items(session, plan))
    return created
