from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import patch

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import User
from app.modules.library.models import ItemFile, StoredFile
from app.modules.music.models import Song
from app.modules.planning.models import DefaultItem, Plan, PlanItem, PlanType
from app.modules.planning.routes import get_plan, presenter_cannot_change_outline
from app.modules.planning.service_scaffold import (
    SUNDAY_SERVICE_SCAFFOLD,
    ensure_service_scaffold,
    set_section_auto_collapse_preference,
)


def scaffold_session() -> tuple[Session, Plan]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Song.__table__,
            PlanType.__table__,
            Plan.__table__,
            PlanItem.__table__,
            DefaultItem.__table__,
            StoredFile.__table__,
            ItemFile.__table__,
        ],
    )
    session = Session(engine)
    plan_type = PlanType(name="Sunday Service", starts_at="10:30", active=True)
    session.add(plan_type)
    session.flush()
    plan = Plan(
        plan_type_id=plan_type.id,
        service_date=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
        title="Sunday Service",
        status="draft",
    )
    session.add(plan)
    session.commit()
    return session, plan


def test_empty_sunday_service_gets_complete_timed_scaffold() -> None:
    session, plan = scaffold_session()
    try:
        created = ensure_service_scaffold(session, plan)
        assert len(created) == 8
        assert [(item.item_type, item.planned_start) for item in created[:5]] == [
            (section.item_type, section.planned_start) for section in SUNDAY_SERVICE_SCAFFOLD
        ]
        assert [item.item_type for item in created[5:]] == [
            "welcome_montage",
            "welcome_countdown",
            "welcome_seated",
        ]
        assert all(item.parent_item_id == created[0].id for item in created[5:])
        assert ensure_service_scaffold(session, plan) == []
    finally:
        session.close()


def test_template_children_keep_their_cue_settings_when_scaffolded() -> None:
    session, plan = scaffold_session()
    try:
        root = DefaultItem(plan_type_id=plan.plan_type_id, sequence=10, item_type="pre_service", title="Welcome")
        session.add(root)
        session.flush()
        session.add(DefaultItem(
            plan_type_id=plan.plan_type_id,
            parent_item_id=root.id,
            sequence=10,
            item_type="welcome_montage",
            title="Welcome montage",
            presentation_options={"auto_advance": True, "auto_advance_seconds": 1500, "audio_scene_id": "pre_service"},
        ))
        session.commit()

        ensure_service_scaffold(session, plan)
        welcome = session.scalar(select(PlanItem).where(PlanItem.plan_id == plan.id, PlanItem.parent_item_id.is_(None)))
        cue = session.scalar(select(PlanItem).where(PlanItem.parent_item_id == welcome.id))
        assert cue.presentation_options["auto_advance_seconds"] == 1500
        assert cue.presentation_options["audio_scene_id"] == "pre_service"
    finally:
        session.close()


def test_existing_song_message_notices_and_end_are_not_duplicated() -> None:
    session, plan = scaffold_session()
    try:
        session.add_all(
            [
                PlanItem(plan_id=plan.id, sequence=40, item_type="song", title="Existing song"),
                PlanItem(plan_id=plan.id, sequence=70, item_type="message", title="Message"),
                PlanItem(plan_id=plan.id, sequence=90, item_type="notices", title="Notices"),
                PlanItem(plan_id=plan.id, sequence=100, item_type="end", title="Finish"),
            ]
        )
        session.commit()
        ensure_service_scaffold(session, plan)
        items = list(session.scalars(select(PlanItem).where(PlanItem.plan_id == plan.id)).all())
        types = [item.item_type for item in items]
        assert "worship_set" not in types
        assert "sermon" not in types
        assert "announcements" not in types
        assert types.count("end") == 1
    finally:
        session.close()


def test_presenter_cannot_change_fixed_sunday_outline_item() -> None:
    session, plan = scaffold_session()
    try:
        item = PlanItem(plan_id=plan.id, sequence=10, item_type="pre_service", title="Welcome")
        session.add(item)
        session.commit()

        with patch("app.modules.planning.routes.list_role_names", return_value=["presenter"]):
            assert presenter_cannot_change_outline(
                session, SimpleNamespace(id="presenter"), item  # type: ignore[arg-type]
            )

        with patch(
            "app.modules.planning.routes.list_role_names",
            return_value=["presenter", "administrator"],
        ):
            assert not presenter_cannot_change_outline(
                session, SimpleNamespace(id="admin"), item  # type: ignore[arg-type]
            )
    finally:
        session.close()


def test_existing_welcome_photos_move_to_montage_stage() -> None:
    session, plan = scaffold_session()
    try:
        welcome = PlanItem(plan_id=plan.id, sequence=10, item_type="pre_service", title="Welcome")
        stored = StoredFile(
            display_name="Welcome photo",
            storage_path="/tmp/welcome.jpg",
            content_type="image/jpeg",
            checksum="photo",
        )
        session.add_all([welcome, stored])
        session.flush()
        link = ItemFile(plan_item_id=welcome.id, file_id=stored.id, sort_order=0, persistent=True)
        session.add(link)
        session.commit()

        ensure_service_scaffold(session, plan)

        montage = session.scalar(
            select(PlanItem).where(
                PlanItem.parent_item_id == welcome.id,
                PlanItem.item_type == "welcome_montage",
            )
        )
        assert montage is not None
        session.refresh(link)
        assert link.plan_item_id == montage.id
        assert link.persistent is True
    finally:
        session.close()


def test_reading_an_existing_service_repairs_legacy_welcome() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as session:
        plan_type = PlanType(name="Sunday Service", starts_at="10:30", active=True)
        session.add(plan_type)
        session.flush()
        plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
            title="Existing Sunday Service",
            status="draft",
        )
        session.add(plan)
        session.flush()
        session.add(
            PlanItem(plan_id=plan.id, sequence=10, item_type="pre_service", title="Welcome")
        )
        session.commit()

        detail = get_plan(plan.id, None, session)  # type: ignore[arg-type]

        assert [
            item.item_type
            for item in detail.items
            if item.item_type.startswith("welcome_")
        ] == ["welcome_montage", "welcome_countdown", "welcome_seated"]


def test_custom_plan_type_uses_its_default_outline() -> None:
    session, plan = scaffold_session()
    try:
        plan_type = session.get(PlanType, plan.plan_type_id)
        assert plan_type is not None
        plan_type.name = "Midweek Gathering"
        session.add_all(
            [
                DefaultItem(plan_type_id=plan_type.id, sequence=10, item_type="open_time", title="Community time"),
                DefaultItem(plan_type_id=plan_type.id, sequence=20, item_type="custom", title="Discussion"),
            ]
        )
        session.commit()

        created = ensure_service_scaffold(session, plan)

        assert [(item.item_type, item.title) for item in created] == [
            ("open_time", "Community time"),
            ("custom", "Discussion"),
        ]
        assert ensure_service_scaffold(session, plan) == []
    finally:
        session.close()


def test_section_auto_collapse_choice_applies_to_existing_and_future_services() -> None:
    session, first_plan = scaffold_session()
    try:
        ensure_service_scaffold(session, first_plan)
        first_welcome = session.scalar(
            select(PlanItem).where(
                PlanItem.plan_id == first_plan.id,
                PlanItem.item_type == "pre_service",
            )
        )
        assert first_welcome is not None

        plan_type = session.get(PlanType, first_plan.plan_type_id)
        assert plan_type is not None
        second_plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 9, 13, 10, 30, tzinfo=UTC),
            title="Next Sunday Service",
            status="draft",
        )
        session.add(second_plan)
        session.commit()
        ensure_service_scaffold(session, second_plan)

        set_section_auto_collapse_preference(session, first_welcome, True)
        session.commit()
        second_welcome = session.scalar(
            select(PlanItem).where(
                PlanItem.plan_id == second_plan.id,
                PlanItem.item_type == "pre_service",
            )
        )
        assert second_welcome is not None
        assert second_welcome.auto_collapse_items is True

        third_plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 9, 20, 10, 30, tzinfo=UTC),
            title="Future Sunday Service",
            status="draft",
        )
        session.add(third_plan)
        session.commit()
        ensure_service_scaffold(session, third_plan)
        third_welcome = session.scalar(
            select(PlanItem).where(
                PlanItem.plan_id == third_plan.id,
                PlanItem.item_type == "pre_service",
            )
        )
        assert third_welcome is not None
        assert third_welcome.auto_collapse_items is True
    finally:
        session.close()
