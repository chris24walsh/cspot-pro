from datetime import UTC, datetime
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.library.models import ItemFile, StoredFile
from app.modules.music.models import Song  # noqa: F401 - registers the foreign-key table
from app.modules.planning.models import DefaultItem, Plan, PlanItem, PlanType
from app.modules.planning.reference_data import ensure_worship_set_plan_type
from app.modules.planning.routes import create_plan, create_plan_item, get_plan, plan_item_to_read
from app.modules.planning.schemas import PlanCreate, PlanItemCreate


def test_ensure_worship_set_plan_type_repairs_missing_reference_data() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[PlanType.__table__])

    with Session(engine) as session:
        first = ensure_worship_set_plan_type(session)
        second = ensure_worship_set_plan_type(session)
        session.commit()

        count = session.scalar(
            select(func.count(PlanType.id)).where(PlanType.name == "Worship Set")
        )
        first_id = first.id
        second_id = second.id
        active = first.active

    assert first_id == second_id
    assert active is True
    assert count == 1


def test_get_plan_returns_the_loaded_plan_detail() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine, tables=[PlanType.__table__, Plan.__table__, PlanItem.__table__]
    )

    with Session(engine) as session:
        plan_type = PlanType(name="Service", active=True)
        session.add(plan_type)
        session.flush()
        plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 8, 16, tzinfo=UTC),
            title="Sunday service",
            status="draft",
        )
        session.add(plan)
        session.commit()

        detail = get_plan(plan.id, None, session)  # type: ignore[arg-type]

    assert detail.id == plan.id
    assert detail.title == "Sunday service"


def test_get_plan_does_not_materialize_an_empty_outline() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        plan_type = PlanType(name="Sunday Service", active=True)
        session.add(plan_type)
        session.flush()
        session.add_all([
            DefaultItem(
                plan_type_id=plan_type.id,
                sequence=10,
                item_type="pre_service",
                title="Welcome",
            ),
            DefaultItem(
                plan_type_id=plan_type.id,
                sequence=20,
                item_type="worship_set",
                title="Worship",
            ),
            DefaultItem(plan_type_id=plan_type.id, sequence=30, item_type="sermon", title="Sermon"),
            DefaultItem(
                plan_type_id=plan_type.id,
                sequence=40,
                item_type="announcements",
                title="Notices",
            ),
        ])
        plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
            title="Empty Sunday service",
            status="draft",
        )
        session.add(plan)
        session.commit()

        first = get_plan(plan.id, None, session)  # type: ignore[arg-type]
        second = get_plan(plan.id, None, session)  # type: ignore[arg-type]

        assert first.items == []
        assert second.items == []
        assert list(session.scalars(select(PlanItem).where(PlanItem.plan_id == plan.id))) == []


def test_plan_date_stays_empty_until_first_content_addition() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        plan_type = PlanType(name="Sunday Service", active=True)
        session.add(plan_type)
        session.flush()
        session.add(DefaultItem(plan_type_id=plan_type.id, sequence=10, item_type="pre_service", title="Welcome"))
        session.commit()

        detail = create_plan(
            PlanCreate(
                plan_type_id=plan_type.id,
                service_date=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
                title="Sunday Service 6 September 2026",
            ),
            None,  # type: ignore[arg-type]
            session,
        )
        assert detail.items == []

        with patch("app.modules.planning.routes.require_plan_editable"):
            create_plan_item(
                detail.id,
                PlanItemCreate(item_type="sermon", sequence=40, title="Sermon deck"),
                None,  # type: ignore[arg-type]
                session,
            )
        items = list(session.scalars(select(PlanItem).where(PlanItem.plan_id == detail.id)).all())

    assert {(item.item_type, item.title) for item in items} == {
        ("pre_service", "Welcome"),
        ("sermon", "Sermon deck"),
    }


@pytest.mark.parametrize(
    ("service_date", "expected_type"),
    [
        (datetime(2026, 9, 6, 10, 30, tzinfo=UTC), "Sunday Service"),
        (datetime(2026, 9, 9, 19, 30, tzinfo=UTC), "Midweek Meeting"),
    ],
)
def test_first_worship_content_materializes_the_day_default_service(service_date: datetime, expected_type: str) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        worship_type = PlanType(name="Worship Set", active=True)
        sunday_type = PlanType(name="Sunday Service", active=True)
        midweek_type = PlanType(name="Midweek Meeting", active=True)
        session.add_all([worship_type, sunday_type, midweek_type])
        session.flush()
        session.add_all([
            DefaultItem(plan_type_id=sunday_type.id, sequence=10, item_type="pre_service", title="Welcome"),
            DefaultItem(plan_type_id=midweek_type.id, sequence=10, item_type="open_time", title="Welcome"),
        ])
        session.commit()

        set_detail = create_plan(
            PlanCreate(plan_type_id=worship_type.id, service_date=service_date, title="Worship Set"),
            None,  # type: ignore[arg-type]
            session,
        )
        assert session.scalar(select(func.count(Plan.id))) == 1

        with patch("app.modules.planning.routes.require_plan_editable"):
            create_plan_item(
                set_detail.id,
                PlanItemCreate(item_type="song", sequence=10, title="Song"),
                None,  # type: ignore[arg-type]
                session,
            )
        service = session.scalar(select(Plan).where(Plan.id != set_detail.id))
        assert service is not None
        service_type = session.get(PlanType, service.plan_type_id)
        service_items = list(session.scalars(select(PlanItem).where(PlanItem.plan_id == service.id)).all())

    assert service_type is not None and service_type.name == expected_type
    assert len(service_items) == 1


@pytest.mark.parametrize("item_type", ["sermon", "pre_service"])
def test_persistent_slide_image_is_inherited_only_by_future_services(item_type: str) -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        plan_type = PlanType(name="Service", active=True)
        session.add(plan_type)
        session.flush()
        earlier_plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 8, 2, tzinfo=UTC),
            title="Earlier",
            status="draft",
        )
        source_plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 8, 9, tzinfo=UTC),
            title="Source",
            status="draft",
        )
        future_plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 8, 16, tzinfo=UTC),
            title="Future",
            status="draft",
        )
        session.add_all([earlier_plan, source_plan, future_plan])
        session.flush()
        earlier_item = PlanItem(
            plan_id=earlier_plan.id, item_type=item_type, sequence=10, title="Section"
        )
        source_item = PlanItem(
            plan_id=source_plan.id, item_type=item_type, sequence=10, title="Section"
        )
        future_item = PlanItem(
            plan_id=future_plan.id, item_type=item_type, sequence=10, title="Section"
        )
        session.add_all([earlier_item, source_item, future_item])
        session.flush()
        image = StoredFile(
            display_name="Persistent.jpg",
            storage_path="/tmp/persistent.jpg",
            content_type="image/jpeg",
            flatten_builds=False,
        )
        session.add(image)
        session.flush()
        session.add(
            ItemFile(plan_item_id=source_item.id, file_id=image.id, persistent=True, sort_order=0)
        )
        session.commit()

        earlier = plan_item_to_read(session, earlier_item)
        future = plan_item_to_read(session, future_item)

    assert earlier.files == []
    assert len(future.files) == 1
    assert future.files[0].file_id == image.id
    assert future.files[0].persistent is True
