from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.planning.completion import plan_edit_cutoff
from app.modules.planning.models import Plan, PlanType


def test_worship_set_inherits_matching_service_edit_cutoff() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[PlanType.__table__, Plan.__table__])
    session = Session(engine)
    try:
        service_type = PlanType(name="Sunday Service", starts_at="11:00", active=True)
        worship_type = PlanType(name="Worship Set", starts_at=None, active=True)
        session.add_all([service_type, worship_type])
        session.flush()
        service = Plan(
            plan_type_id=service_type.id,
            service_date=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
            title="Sunday Service",
            status="draft",
        )
        worship_set = Plan(
            plan_type_id=worship_type.id,
            service_date=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
            title="Worship Set",
            status="draft",
        )
        session.add_all([service, worship_set])
        session.commit()

        cutoff = plan_edit_cutoff(session, worship_set)
        assert cutoff.date().isoformat() == "2026-09-06"
        assert cutoff.hour == 11
        assert cutoff.tzinfo is not None
    finally:
        session.close()


def test_plan_without_start_time_stays_editable_for_whole_service_day() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[PlanType.__table__, Plan.__table__])
    session = Session(engine)
    try:
        plan_type = PlanType(name="Midweek Meeting", starts_at=None, active=True)
        session.add(plan_type)
        session.flush()
        plan = Plan(
            plan_type_id=plan_type.id,
            service_date=datetime(2026, 9, 2, 10, 30, tzinfo=UTC),
            title="Midweek Meeting",
            status="draft",
        )
        session.add(plan)
        session.commit()

        cutoff = plan_edit_cutoff(session, plan)
        assert cutoff.date().isoformat() == "2026-09-02"
        assert cutoff.hour == 23 and cutoff.minute == 59
    finally:
        session.close()
