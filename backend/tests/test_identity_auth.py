import pytest
from fastapi import HTTPException, Response
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import Role, ServingArea, User, UserRole, VolunteerPreference
from app.modules.identity.routes import login, resolve_username
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


def test_generated_username_uses_first_name_then_surname_initials() -> None:
    with _identity_session() as session:
        assert resolve_username(
            session, username=None, email="john.one@example.com", name="John Smith"
        ) == "john"
        session.add(
            User(
                email="john.one@example.com",
                username="john",
                name="John Smith",
                password_hash=None,
                start_page=None,
                calendar_color=None,
                calendar_avatar=None,
                email_confirmed=True,
                active=True,
            )
        )
        session.flush()

        assert resolve_username(
            session, username=None, email="john.two@example.com", name="John Paul Jones"
        ) == "johnpj"


def test_generated_username_adds_number_after_initials_also_clash() -> None:
    with _identity_session() as session:
        for username in ("sarah", "sarahs"):
            session.add(
                User(
                    email=f"{username}@example.com",
                    username=username,
                    name="Sarah Smith",
                    password_hash=None,
                    start_page=None,
                    calendar_color=None,
                    calendar_avatar=None,
                    email_confirmed=True,
                    active=True,
                )
            )
        session.flush()

        assert resolve_username(
            session, username=None, email="another@example.com", name="Sarah Smith"
        ) == "sarahs-2"


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


def test_pending_self_registration_gets_approval_message_after_valid_password() -> None:
    with _identity_session() as session:
        user = session.scalar(select(User).where(User.email == "screen@example.com"))
        assert user is not None
        user.active = False
        user.registration_pending = True
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            login(
                LoginRequest(identifier="screen@example.com", password="test-password"),
                Response(),
                session,
            )

        assert exc_info.value.status_code == 403
        assert exc_info.value.detail == "Your account is awaiting administrator approval."


def test_pending_registration_does_not_disclose_status_for_wrong_password() -> None:
    with _identity_session() as session:
        user = session.scalar(select(User).where(User.email == "screen@example.com"))
        assert user is not None
        user.active = False
        user.registration_pending = True
        session.commit()

        with pytest.raises(HTTPException) as exc_info:
            login(
                LoginRequest(identifier="screen@example.com", password="wrong-password"),
                Response(),
                session,
            )

        assert exc_info.value.status_code == 401
        assert exc_info.value.detail == "Invalid email/username or password."
