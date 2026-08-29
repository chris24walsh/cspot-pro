from datetime import UTC, datetime

import pytest
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.library.models import ItemFile, StoredFile
from app.modules.music.models import Song  # noqa: F401 - registers the foreign-key table
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.planning.reference_data import ensure_worship_set_plan_type
from app.modules.planning.routes import get_plan, plan_item_to_read


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
