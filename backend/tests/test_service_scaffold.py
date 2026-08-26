from datetime import UTC, datetime

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import User
from app.modules.music.models import Song
from app.modules.planning.models import Plan, PlanItem, PlanType
from app.modules.planning.service_scaffold import (
    SUNDAY_SERVICE_SCAFFOLD,
    ensure_service_scaffold,
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
        assert len(created) == len(SUNDAY_SERVICE_SCAFFOLD)
        assert [(item.item_type, item.planned_start) for item in created] == [
            (section.item_type, section.planned_start) for section in SUNDAY_SERVICE_SCAFFOLD
        ]
        assert ensure_service_scaffold(session, plan) == []
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
