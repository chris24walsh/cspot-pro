from fastapi import Request
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import Base
from app.modules.identity.models import AuthToken, Role, User, UserRole
from app.modules.identity.permissions import permissions_for_roles
from app.modules.identity.routes import approve_registration, registration_qr, self_register
from app.modules.identity.schemas import SelfRegistrationRequest
from app.modules.site.models import SiteContentBlock


def test_self_registration_stays_inactive_until_admin_approval() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(
        engine,
        tables=[
            User.__table__,
            Role.__table__,
            UserRole.__table__,
            AuthToken.__table__,
            SiteContentBlock.__table__,
        ],
    )
    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/",
            "headers": [],
            "client": ("192.0.2.1", 1234),
        }
    )
    with Session(engine) as session:
        session.add(
            SiteContentBlock(
                key="identity.self_registration",
                label="Registration",
                block_type="setting",
                value="enabled",
                published=True,
            )
        )
        session.commit()

        result = self_register(
            SelfRegistrationRequest(
                name="New Member",
                email="new@example.com",
                username="new-member",
                password="a-strong-password",
            ),
            request,
            session,
        )
        user = session.scalar(select(User).where(User.email == "new@example.com"))
        assert user is not None
        assert result.detail.startswith("Registration received")
        assert user.registration_pending is True
        assert user.active is False

        approved = approve_registration(user.id, user, session)
        assert approved.registration_pending is False
        assert approved.active is True
        assert approved.roles == ["viewer"]
        assert permissions_for_roles(approved.roles) == {
            "plans:read",
            "songs:read",
            "library:read",
        }


def test_registration_qr_is_generated_as_svg() -> None:
    previous_url = settings.public_app_url
    settings.public_app_url = "https://church.example/app"
    try:
        response = registration_qr(None)  # Dependency enforcement is covered by the route.
    finally:
        settings.public_app_url = previous_url

    assert response.media_type == "image/svg+xml"
    assert b"<svg" in response.body
