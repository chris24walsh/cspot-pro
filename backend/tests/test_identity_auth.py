from fastapi import Response
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import Role, ServingArea, User, UserRole, VolunteerPreference
from app.modules.identity.routes import login
from app.modules.identity.schemas import LoginRequest
from app.modules.identity.security import hash_password


def _identity_session() -> Session:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Role.__table__,
            UserRole.__table__,
            ServingArea.__table__,
            VolunteerPreference.__table__,
        ],
    )
    session = Session(engine)
    session.add(
        User(
            email="screen@example.com",
            username="church-screen",
            name="Church Screen",
            password_hash=hash_password("test-password"),
            start_page=None,
            calendar_color=None,
            calendar_avatar=None,
            email_confirmed=True,
            active=True,
        )
    )
    session.commit()
    return session


def test_login_accepts_username_or_email() -> None:
    with _identity_session() as session:
        username_result = login(
            LoginRequest(identifier="Church-Screen", password="test-password"),
            Response(),
            session,
        )
        email_result = login(
            LoginRequest(email="SCREEN@example.com", password="test-password"),
            Response(),
            session,
        )

    assert username_result.email == "screen@example.com"
    assert email_result.username == "church-screen"


def test_remembered_login_sets_legacy_compatible_expiry() -> None:
    with _identity_session() as session:
        remembered_response = Response()
        login(
            LoginRequest(identifier="church-screen", password="test-password", remember=True),
            remembered_response,
            session,
        )
        session_response = Response()
        login(
            LoginRequest(identifier="church-screen", password="test-password", remember=False),
            session_response,
            session,
        )

    remembered_cookie = remembered_response.headers["set-cookie"].lower()
    session_cookie = session_response.headers["set-cookie"].lower()
    assert "max-age=" in remembered_cookie
    assert "expires=" in remembered_cookie
    assert "max-age=" not in session_cookie
    assert "expires=" not in session_cookie
