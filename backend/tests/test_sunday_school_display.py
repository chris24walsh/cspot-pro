from datetime import date
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.models import SundaySchoolLesson, SundaySchoolRoom
from app.modules.identity.permissions import permissions_for_roles
from app.modules.presentation.models import PresentationSession
from app.modules.sunday_school.display import (
    SchoolCommand,
    SchoolDisplayState,
    SchoolHeartbeat,
    control_school_display,
    get_school_display,
    heartbeat_school_display,
)


@pytest.fixture
def session():
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(SundaySchoolRoom(id=1))
        db.commit()
        yield db


def command(session, action, day=date(2026, 9, 20), **extra):
    revision = extra.pop("revision", get_school_display(None, session).revision)
    return control_school_display(
        SchoolCommand(action=action, lesson_date=day, revision=revision, **extra),
        SimpleNamespace(),
        session,
    )


def test_room_lifecycle_and_blank_preserves_element(session):
    heartbeat_school_display(SchoolHeartbeat(sound_ready=True), None, session)
    room = get_school_display(None, session)
    assert room.connected and room.sound_ready and room.lesson_date is None
    assert session.query(SundaySchoolLesson).count() == 0
    command(session, "start")
    state = SchoolDisplayState(
        kind="verse",
        element_id="verse-one",
        title="Memory Verse Game",
        last_week={"text": "God is love.", "reference": "1 John 4:8"},
        this_week={"text": "Rejoice evermore.", "reference": "1 Thessalonians 5:16"},
    )
    command(session, "present", state=state)
    command(session, "update", step=10)
    blank = command(session, "update", blanked=True)
    assert blank.state.step == 10 and blank.state.blanked
    resumed = command(session, "update", blanked=False)
    assert resumed.state.last_week == state.last_week and resumed.state.step == 10
    assert command(session, "end_element").lesson_date is not None
    assert get_school_display(None, session).state.kind == "idle"
    assert command(session, "end").lesson_date is None
    assert session.query(PresentationSession).count() == 0


def test_other_lesson_and_stale_controller_cannot_take_over(session):
    initial_revision = get_school_display(None, session).revision
    command(session, "start")
    with pytest.raises(HTTPException) as error:
        command(session, "start", day=date(2026, 9, 27))
    assert error.value.status_code == 409
    with pytest.raises(HTTPException):
        command(session, "end", revision=initial_revision)
    command(session, "end")
    command(session, "start", day=date(2026, 9, 27))
    with pytest.raises(HTTPException):
        command(session, "end")
    assert get_school_display(None, session).lesson_date == date(2026, 9, 27)


def test_school_teacher_can_present_without_sanctuary_control():
    permissions = permissions_for_roles(["sunday_school_teacher"])
    assert "sunday_school:present" in permissions
    assert "presentation:use" not in permissions
    assert "sunday_school:present" not in permissions_for_roles(["viewer"])


def test_simultaneous_starts_only_claim_one_lesson(tmp_path):
    from concurrent.futures import ThreadPoolExecutor

    engine = create_engine(f"sqlite:///{tmp_path}/school-race.sqlite")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        db.add(SundaySchoolRoom(id=1))
        db.commit()

    def start(day):
        with Session(engine) as db:
            try:
                control_school_display(
                    SchoolCommand(action="start", lesson_date=day, revision=0), None, db
                )
                return 200
            except HTTPException as error:
                return error.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(start, [date(2026, 9, 20), date(2026, 9, 27)]))
    assert sorted(results) == [200, 409]


def test_viewer_can_connect_but_only_school_teacher_can_control(tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core.database import get_session
    from app.modules.identity.auth import get_current_user
    from app.modules.identity.models import Role, User, UserRole
    from app.modules.sunday_school.display import router

    engine = create_engine(f"sqlite:///{tmp_path}/school-auth.sqlite")
    Base.metadata.create_all(engine)
    with Session(engine) as db:
        user = User(
            id="classroom-user",
            email="classroom@example.test",
            username="classroom",
            name="Classroom",
        )
        role = Role(id="classroom-role", name="viewer", description="")
        db.add_all([user, role, SundaySchoolRoom(id=1)])
        db.flush()
        db.add(UserRole(user_id=user.id, role_id=role.id))
        db.commit()

    app = FastAPI()
    app.include_router(router)

    def database():
        with Session(engine) as db:
            yield db

    app.dependency_overrides[get_session] = database
    app.dependency_overrides[get_current_user] = lambda: SimpleNamespace(id="classroom-user")
    with TestClient(app) as client:
        assert client.post("/display/heartbeat", json={"sound_ready": True}).status_code == 200
        payload = {"action": "start", "lesson_date": "2026-09-20", "revision": 0}
        assert client.post("/display/control", json=payload).status_code == 403
        with Session(engine) as db:
            db.get(Role, "classroom-role").name = "sunday_school_teacher"
            db.commit()
        assert client.post("/display/control", json=payload).status_code == 200
