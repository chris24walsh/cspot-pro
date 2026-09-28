from datetime import UTC, datetime

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import User
from app.modules.planning.completion import plan_has_finished
from app.modules.planning.models import Plan, PlanType
from app.modules.presentation.models import PresentationSession


def test_worship_set_inherits_matching_service_finished_state() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[PlanType.__table__, User.__table__, Plan.__table__, PresentationSession.__table__],
    )
    session = Session(engine)
    try:
        service_type = PlanType(name="Sunday Service", starts_at="11:00", active=True)
        worship_type = PlanType(name="Worship Set", starts_at=None, active=True)
        session.add_all([service_type, worship_type])
        session.flush()
        service = Plan(
            plan_type_id=service_type.id,
            service_date=datetime(2026, 9, 6, 10, 30, tzinfo=UTC),
            service_start="11:30",
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

        assert plan_has_finished(
            session, worship_set, now=datetime(2026, 9, 6, 12, 0, tzinfo=UTC)
        ) is False
        ended = PresentationSession(
            plan_id=service.id, status="ended", ended_at=datetime(2026, 9, 6, 12, 30, tzinfo=UTC)
        )
        session.add(ended)
        session.commit()
        assert plan_has_finished(
            session, worship_set, now=datetime(2026, 9, 6, 12, 31, tzinfo=UTC)
        ) is True
    finally:
        session.close()


def test_plan_stays_editable_for_whole_service_day_even_after_start_time() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[PlanType.__table__, User.__table__, Plan.__table__, PresentationSession.__table__],
    )
    session = Session(engine)
    try:
        plan_type = PlanType(name="Midweek Meeting", starts_at="11:00", active=True)
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

        assert plan_has_finished(
            session, plan, now=datetime(2026, 9, 2, 18, 0, tzinfo=UTC)
        ) is False
        assert plan_has_finished(
            session, plan, now=datetime(2026, 9, 3, 0, 1, tzinfo=UTC)
        ) is True
    finally:
        session.close()
