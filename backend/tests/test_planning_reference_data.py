from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.planning.models import PlanType
from app.modules.planning.reference_data import ensure_worship_set_plan_type


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
