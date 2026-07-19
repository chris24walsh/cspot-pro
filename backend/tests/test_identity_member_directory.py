from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.core.database import Base
from app.modules.identity.models import Role, User, UserRole
from app.modules.identity.permissions import permissions_for_roles
from app.modules.identity.routes import user_to_member_read


def test_member_directory_exposes_team_fields_without_admin_fields() -> None:
    engine = create_engine("sqlite://")
    Base.metadata.create_all(engine, tables=[User.__table__, Role.__table__, UserRole.__table__])

    with Session(engine) as session:
        user = User(
            email="leader@example.com",
            username="leader",
            name="Worship Leader",
            password_hash=None,
            start_page=None,
            calendar_color="teacher-b",
            calendar_avatar=None,
            email_confirmed=True,
            active=True,
        )
        role = Role(name="worship_leader", description=None, system_role=True)
        session.add_all([user, role])
        session.flush()
        session.add(UserRole(user_id=user.id, role_id=role.id))
        session.flush()

        member = user_to_member_read(session, user)

    assert member.roles == ["worship_leader"]
    assert member.username == "leader"
    assert member.calendar_color == "teacher-b"
    assert "password_set" not in member.model_dump()


def test_worship_and_sunday_school_roles_can_read_the_member_directory() -> None:
    for role in ["musician", "worship_leader", "sunday_school_teacher", "sunday_school_leader"]:
        permissions = permissions_for_roles([role])
        assert "team:read" in permissions
        assert "users:manage" not in permissions
