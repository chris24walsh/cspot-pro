from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.modules.identity.models import (
    AuthToken,
    Role,
    ServingArea,
    User,
    UserRole,
    VolunteerPreference,
)
from app.modules.identity.permissions import permissions_for_roles
from app.modules.integrations.routes import (
    authorize_website_editor,
    exchange_website_editor_code,
    start_website_editor,
)
from app.modules.integrations.schemas import WebsiteEditorExchangeRequest


def _session(*, active: bool = True, role_name: str = "website_editor") -> tuple[Session, User]:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Role.__table__,
            UserRole.__table__,
            AuthToken.__table__,
            ServingArea.__table__,
            VolunteerPreference.__table__,
        ],
    )
    session = Session(engine)
    user = User(
        email="editor@example.com",
        username="website-editor",
        name="Website Editor",
        password_hash=None,
        start_page=None,
        calendar_color=None,
        calendar_avatar=None,
        email_confirmed=True,
        active=active,
    )
    role = Role(name=role_name, description="test", system_role=True)
    session.add_all([user, role])
    session.flush()
    session.add(UserRole(user_id=user.id, role_id=role.id))
    session.commit()
    return session, user


@pytest.fixture(autouse=True)
def _website_config(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        settings, "website_editor_start_url", "https://site.example/cms/cspot-sso/start"
    )
    monkeypatch.setattr(
        settings, "website_editor_callback_url", "https://site.example/cms/cspot-sso/callback"
    )
    monkeypatch.setattr(settings, "website_editor_client_id", "site-cms")
    monkeypatch.setattr(settings, "website_editor_client_secret", "secret-value")
    monkeypatch.setattr(settings, "website_editor_handoff_seconds", 60)


def _issue_code(session: Session, user: User) -> str:
    response = authorize_website_editor("a" * 43, "website-home", user, session)
    return parse_qs(urlparse(response.headers["location"]).query)["code"][0]


def _exchange(session: Session, code: str):
    return exchange_website_editor_code(
        WebsiteEditorExchangeRequest(code=code, destination="website-home"),
        "site-cms",
        "secret-value",
        session,
    )


def test_website_access_is_available_to_administrators() -> None:
    assert {"website:edit", "website:publish"}.issubset(
        permissions_for_roles(["administrator"])
    )
    assert permissions_for_roles(["website_editor"]) == {"website:edit"}
    assert permissions_for_roles(["website_publisher"]) == {
        "website:edit",
        "website:publish",
    }


def test_start_and_authorize_only_use_configured_destinations() -> None:
    with _session()[0] as session:
        user = session.scalar(select(User))
        assert user is not None
        start = start_website_editor("website-home", user)
        assert start.headers["location"] == (
            "https://site.example/cms/cspot-sso/start?destination=website-home"
        )
        callback = authorize_website_editor("a" * 43, "website-home", user, session)
        assert callback.headers["location"].startswith(
            "https://site.example/cms/cspot-sso/callback?code="
        )
        assert callback.headers["referrer-policy"] == "no-referrer"

        with pytest.raises(HTTPException) as exc_info:
            authorize_website_editor("a" * 43, "https://evil.example", user, session)
        assert exc_info.value.status_code == 400


def test_code_is_single_use_and_returns_stable_identity() -> None:
    session, user = _session()
    with session:
        code = _issue_code(session, user)
        identity = _exchange(session, code)
        assert identity.subject == user.id
        assert identity.email == user.email
        assert identity.permissions == ["website:edit"]

        with pytest.raises(HTTPException) as replay:
            _exchange(session, code)
        assert replay.value.status_code == 400


def test_expired_code_and_bad_client_are_rejected() -> None:
    session, user = _session()
    with session:
        code = _issue_code(session, user)
        handoff = session.scalar(select(AuthToken))
        assert handoff is not None
        handoff.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        session.commit()

        with pytest.raises(HTTPException) as expired:
            _exchange(session, code)
        assert expired.value.status_code == 400

        with pytest.raises(HTTPException) as bad_client:
            exchange_website_editor_code(
                WebsiteEditorExchangeRequest(code=code, destination="website-home"),
                "site-cms",
                "wrong-secret",
                session,
            )
        assert bad_client.value.status_code == 401


def test_revocation_between_authorize_and_exchange_consumes_code() -> None:
    session, user = _session()
    with session:
        code = _issue_code(session, user)
        assignment = session.scalar(select(UserRole))
        assert assignment is not None
        session.delete(assignment)
        session.commit()

        with pytest.raises(HTTPException) as revoked:
            _exchange(session, code)
        assert revoked.value.status_code == 403
        handoff = session.scalar(select(AuthToken))
        assert handoff is not None and handoff.used_at is not None
