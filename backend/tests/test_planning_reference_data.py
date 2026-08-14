from datetime import UTC, datetime

from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.planning.reference_data import ensure_worship_set_plan_type
from app.modules.planning.routes import get_plan


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
