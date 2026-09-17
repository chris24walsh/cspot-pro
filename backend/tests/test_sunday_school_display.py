from datetime import date
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models import SundaySchoolLesson  # registers all foreign key targets
from app.modules.sunday_school.routes import (
    SchoolDisplayState,
    get_school_display,
    heartbeat_school_display,
    update_school_display,
)


def test_school_display_keeps_verse_stage_and_connection_for_selected_date() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    today = date(2026, 9, 20)
    other_day = date(2026, 9, 27)
    viewer = SimpleNamespace()
    with Session(engine) as session:
        state = SchoolDisplayState(
            kind="verse", detail="God is love", reference="1 John 4:8", mode="challenge", stage=3
        )
        update_school_display(today, state, viewer, session)
        heartbeat_school_display(today, viewer, session)

        result = get_school_display(today, viewer, session)
        assert result.connected
        assert result.state == state
        assert get_school_display(other_day, viewer, session).state.kind == "blank"
        assert session.query(SundaySchoolLesson).count() == 1
