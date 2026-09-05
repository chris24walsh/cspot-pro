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
WELCOME_STAGE_OPTIONS = {
    "welcome_montage": {"dwell_seconds": 12, "auto_advance": True, "auto_advance_seconds": 1500, "overlay_mode": "countdown", "overlay_countdown_seconds": 1800, "overlay_text": "Service begins in", "audio_scene_id": "pre_service", "display_targets": ["church", "livestream"]},
    "welcome_countdown": {"dwell_seconds": 12, "auto_advance": True, "auto_advance_seconds": 300, "overlay_mode": "countdown", "overlay_countdown_seconds": 300, "overlay_text": "Service begins in", "audio_scene_id": "pre_service", "display_targets": ["church", "livestream"]},
    "welcome_seated": {"auto_advance": False, "audio_scene_id": "pastor", "display_targets": ["church", "livestream"]},
}


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


def section_auto_collapse_preference(
    session: Session, item_type: str, title: str
) -> bool:
    query = select(PlanItem.auto_collapse_items).where(
        PlanItem.parent_item_id.is_(None),
        PlanItem.item_type == item_type,
        PlanItem.deleted_at.is_(None),
    )
    if item_type == "custom":
        query = query.where(PlanItem.title == title)
    preference = session.scalar(query.order_by(PlanItem.updated_at.desc()).limit(1))
    return bool(preference)


def set_section_auto_collapse_preference(
    session: Session, item: PlanItem, auto_collapse: bool
) -> None:
    query = select(PlanItem).where(
        PlanItem.parent_item_id.is_(None),
        PlanItem.item_type == item.item_type,
        PlanItem.deleted_at.is_(None),
    )
    if item.item_type == "custom":
        query = query.where(PlanItem.title == item.title)
    for matching_section in session.scalars(query).all():
        matching_section.auto_collapse_items = auto_collapse


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
            presentation_options=WELCOME_STAGE_OPTIONS[item_type],
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
                (item.presentation_options or {}).get("scheduled_start") or None,
                frozenset() if item.item_type == "custom" else frozenset({item.item_type}),
            )
            for item in defaults if item.parent_item_id is None
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
    existing_types = {item.item_type.lower() for item in existing if not item.parent_item_id}
    existing_titles = {item.title.strip().lower() for item in existing if not item.parent_item_id}
    created: list[PlanItem] = []
    for section in templates:
        title_match = section.title.lower() in existing_titles
        type_match = bool(section.aliases & existing_types)
        definition = next((entry for entry in defaults if entry.parent_item_id is None and entry.sequence == section.sequence), None)
        linked = definition and any((item.presentation_options or {}).get("template_id") == definition.id for item in existing)
        if linked or title_match or (type_match and not defaults):
            continue
        section_options = (
            next(
                (
                    item.presentation_options
                    for item in defaults
                    if item.sequence == section.sequence and item.parent_item_id is None
                ),
                {},
            )
            or {}
        )
        item = PlanItem(
            plan_id=plan.id,
            sequence=section.sequence,
            item_type=section.item_type,
            title=section.title,
            planned_start=section.planned_start,
            comment=next(
                (item.comment for item in defaults if item.sequence == section.sequence and item.parent_item_id is None), None
            ),
            auto_collapse_items=(
                bool(section_options.get("auto_collapse_items"))
                if "auto_collapse_items" in section_options
                else section_auto_collapse_preference(session, section.item_type, section.title)
            ),
            presentation_options={**section_options, **({"template_id": next(d.id for d in defaults if d.sequence == section.sequence and d.parent_item_id is None)} if defaults else {})},
        )
        session.add(item)
        created.append(item)
    if created:
        session.commit()
        for item in created:
            session.refresh(item)
    template_roots = {item.id: item for item in defaults if item.parent_item_id is None}
    plan_roots = {
        (item.item_type, item.title.strip().lower()): item
        for item in session.scalars(select(PlanItem).where(PlanItem.plan_id == plan.id, PlanItem.parent_item_id.is_(None), PlanItem.deleted_at.is_(None))).all()
    }
    for default in defaults:
        if not default.parent_item_id:
            continue
        parent_default = template_roots.get(default.parent_item_id)
        parent = plan_roots.get((parent_default.item_type, parent_default.title.strip().lower())) if parent_default else None
        if parent is None:
            continue
        exists = session.scalar(select(PlanItem.id).where(PlanItem.plan_id == plan.id, PlanItem.parent_item_id == parent.id, PlanItem.item_type == default.item_type, PlanItem.title == default.title, PlanItem.deleted_at.is_(None)))
        if exists:
            continue
        child = PlanItem(plan_id=plan.id, parent_item_id=parent.id, sequence=default.sequence, item_type=default.item_type, title=default.title, comment=default.comment, planned_start=(default.presentation_options or {}).get("scheduled_start") or None, presentation_options={**(default.presentation_options or {}), "template_id": default.id})
        session.add(child)
        created.append(child)
    if defaults:
        session.commit()
    else:
        created.extend(ensure_welcome_stage_items(session, plan))
    return created
